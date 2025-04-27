/**
 * server.js – Map‑Survey backend  (strict past‑answer filtering)
 * Run with:   node server.js
 * Needs:      npm i express redis body-parser sharp
 */

const express       = require('express');
const fs            = require('fs');
const path          = require('path');
const bodyParser    = require('body-parser');
const { createClient } = require('redis');
const sharp         = require('sharp');
const { execFile }  = require('child_process');
const { pythonBin, testScript } = require('./public/config/paths');

/* ───────────────  1. DATASETS  ─────────────── */
let DATASETS      = [];           // [{id,label}, …]
let DATASET_IDS   = [];           // [id, id, …]
let DATASETS_MAP  = {};           // id → {id,label}

const MAX_RESPONSES = 10;

/**
 * Populate DATASETS / DATASET_IDS / DATASETS_MAP from Redis.
 *   – v1:datasets         : SET of dataset IDs
 *   – label defaults to the ID itself; extend as needed.
 */
async function loadDatasetsFromRedis() {
  const ids = await redis.sMembers('v1:datasets');
  ids.sort();                               // stable order

  DATASETS = ids.map(id => ({ id, label: id }));
  DATASET_IDS  = ids;
  DATASETS_MAP = DATASETS.reduce((m, d) => (m[d.id] = d, m), {});

  console.log(`Datasets loaded from Redis: ${ids.join(', ')}`);
}

async function getDatasetMeta(dsID) {
  const raw = await redis.get(`v1:datasets:${dsID}:meta`);
  if (!raw) return { label: dsID, description: '' };   // sensible defaults
  try   { return JSON.parse(raw); }
  catch  { return { label: dsID, description: '' }; }
}


/* ───────────────  2. APP & REDIS  ───────────── */
const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/maps', express.static(path.join(__dirname, 'maps')));

const redis = createClient({ url: 'redis://localhost:6379' });

/* prefix helpers --------------------------------------------------------- */
const v1          = key => `v1:${key}`;
const v1Users     = v1('usernames');                // set of pids
const v1Assign    = pid => v1(`assignments:${pid}`);// set of datasets for a pid
const v1AnswerKey = (pid, ds, uid) => v1(`${pid}:${ds}:${uid}`);

/* ---------- Question normaliser ---------- */
function normalise(q) {
  // canon-field: uid
  if (q.uid == null && q.QID != null) q.uid = q.QID;

  // remove deprecated alias so we don’t rely on it later
  delete q.QID;

  // keep legacy client fields consistent
  if (!q.Question && q.question) q.Question = q.question;
  if (!q.Map      && q.map)      q.Map      = q.map;
  if (!q.locations)              q.locations = [];

  return q;
}

/* ───────────────  3. QUESTIONS CACHE  ───────── */
const questionsCache = {};

/**
 * Return an array of questions for <dsID>.
 * If the set in Redis is empty, cache and return [] without calling MGET.
 */
async function getDatasetQuestions(dsID) {
  if (questionsCache[dsID]) return questionsCache[dsID];

  const uids = await redis.sMembers(`v1:datasets:${dsID}`);
  if (uids.length === 0) {
    return (questionsCache[dsID] = []);
  }

  const keys = uids.map(uid => `v1:datasets:${dsID}:${uid}`);
  const vals = await redis.mGet(keys);

  const arr = [];
  vals.forEach(v => {
    if (!v) return;                          // null entry – key missing
    try {
      const obj = JSON.parse(v.toString());  // ← convert Buffer → string
      arr.push(normalise(obj));
    } catch (err) {
      console.warn('Bad question JSON:', err);
    }
  });

  questionsCache[dsID] = arr;
  return arr;
}

/* ───────────────  4. USER HELPERS  ───────────── */
async function ensureUser(pid) {
  await redis.sAdd(v1Users, pid);
}

async function userFinished(pid, dsID) {
  const qs = await getDatasetQuestions(dsID);
  for (const q of qs) {
    const uid = q.uid || q.QID;
    if (!await redis.exists(v1AnswerKey(pid, dsID, uid))) return false;
  }
  return true;
}

async function setAccess (pid, datasetID, allow) {
  if (allow)
    await redis.sAdd(v1Assign(pid), datasetID);
  else
    await redis.sRem(v1Assign(pid), datasetID);
}

/* ───────────────  5. ROUTES  ─────────────────── */

/* admin */
app.get('/admin/users',      async (req,res) =>
  res.json(await redis.sMembers(v1Users)));          // <- update if you store users elsewhere

app.get('/admin/datasets', async (_req, res) => {
  const metaArr = await Promise.all(
    DATASET_IDS.map(async id => {
      const meta = await getDatasetMeta(id);
      return { id, ...meta };
    })
  );
  res.json(metaArr);
});

app.post('/admin/dataset_meta/:id', async (req, res) => {
  const dsID = req.params.id;
  const { label, description } = req.body || {};
  if (!DATASET_IDS.includes(dsID))
    return res.status(404).json({ error: 'unknown dataset' });

  const meta = { label: label || dsID, description: description || '' };
  await redis.set(`v1:datasets:${dsID}:meta`, JSON.stringify(meta));
  res.json({ ok: true });
});

app.get('/admin/user_datasets/:pid', async (req,res) =>
  res.json(await redis.sMembers(v1Assign(req.params.pid))));

app.post('/admin/assign', express.json(), async (req,res) => {
  const { prolificID, datasetID, allow } = req.body;
  try { await setAccess(prolificID, datasetID, allow); res.json({ok:true}); }
  catch (e) { console.error(e); res.status(500).json({error:'db'}); }
});

/* datasets list */
app.get('/datasets', (_req, res) =>
  res.json(DATASETS.map(({ id, label }) => ({ id, label }))));

/* quick count for progress bar */
app.get('/dataset_count/:ds', async (req, res) => {
  const ds = req.params.ds;
  const total = (await redis.sMembers(`v1:datasets:${ds}`)).length;
  res.json({ total });
});

/* login (ensure user exists) */
app.post('/login', async (req, res) => {
  const { prolificID, datasetID } = req.body;
  if (!prolificID) 
    return res.status(400).json({ error: 'prolificID required' });

  // Attempt to add them to the set of users
  // SADD returns 1 if new, 0 if already existed
  const added = await redis.sAdd(v1Users, prolificID);

  // If they came in with a valid dataset, auto-assign it
  if (datasetID && DATASET_IDS.includes(datasetID)) {
    await setAccess(prolificID, datasetID, true);
  }

  res.json({
    success: true,
    isNew:    added === 1   // <— tell the client
  });
});

/* thumbnail helper */
app.get('/thumb', async (req, res) => {
  try {
    const { file, width = 200, height = 200 } = req.query;
    const fp = path.join(__dirname, 'maps', file);
    if (!fs.existsSync(fp)) return res.status(404).send('File not found');
    const img = await sharp(fp)
                  .resize(+width, +height, { fit: 'inside', withoutEnlargement: true })
                  .toBuffer();
    res.type('jpeg').send(img);
  } catch { res.status(500).send('Error'); }
});

/* get next unanswered question */
app.get('/get_questions', async (req, res) => {
  const { prolificID, dataset } = req.query;
  if (!prolificID || !dataset)      return res.status(400).json({ error: 'params' });
  if (!DATASET_IDS.includes(dataset)) return res.status(400).json({ error: 'invalid ds' });

  await ensureUser(prolificID);

  const qs = await getDatasetQuestions(dataset);

  for (let i = 0; i < qs.length; i++) {
    const q   = qs[i];
    const uid = q.uid || q.QID;

    /* already answered by this user? */
    if (await redis.exists(v1AnswerKey(prolificID, dataset, uid))) continue;

    /* how many total answers exist for this question? */
    let count = 0;
    for await (const _ of redis.scanIterator({ MATCH: `v1:*:${dataset}:${uid}` })) {
      count++;
    }

    if (count < MAX_RESPONSES) {
      return res.json({ done: false, questionIndex: i, question: q });
    }
  }
  res.json({ done: true });
});

/* submit an answer */
app.post('/submit_question', async (req, res) => {
  const { dataset, prolificID, questionIndex,
          question, QID, answer, difficulty } = req.body;
  if (!prolificID || !dataset)       return res.status(400).json({ error: 'params' });
  if (!DATASET_IDS.includes(dataset)) return res.status(400).json({ error: 'invalid ds' });

  await ensureUser(prolificID);

  /* capacity check */
  const qArr = await getDatasetQuestions(dataset);
  const uid  = QID || (qArr[questionIndex]?.uid);
  let count  = 0;
  for await (const _ of redis.scanIterator({ MATCH: `v1:*:${dataset}:${uid}` })) {
    count++;
  }
  if (count >= MAX_RESPONSES)
    return res.status(400).json({ error: 'No slots left' });

  /* store answer */
  await redis.set(
    v1AnswerKey(prolificID, dataset, uid),
    JSON.stringify({
      responseID: uid,
      dataset, 
      QID: uid,
      question,
      answer,
      prolificID,
      questionIndex,
      difficulty,
      badQuestion: req.body.badQuestion ?? false,
      badReason: req.body.badReason ?? '',
      timestamp: Date.now()
    })
  );
  res.json({ success: true });
});

// POST /submit_dataset — mark this user+dataset as submitted
app.post('/submit_dataset', express.json(), async (req, res) => {
  const { prolificID, dataset } = req.body;
  if (!prolificID || !dataset) 
    return res.status(400).json({ error: 'prolificID & dataset required' });
  // key = v1:<user>:<dataset>:meta
  await redis.set(`v1:${prolificID}:${dataset}:meta`, 'submitted');
  res.json({ ok: true });
});

// GET /dataset_submission/:pid/:ds — has this dataset been submitted by this user?
app.get('/dataset_submission/:pid/:ds', async (req, res) => {
  const { pid, ds } = req.params;
  const exists = await redis.exists(`v1:${pid}:${ds}:meta`);
  res.json({ submitted: exists === 1 });
});


/* datasets visible to a single user */
app.get('/user_datasets/:pid', async (req, res) => {
  const pid  = req.params.pid;

  /* dataset IDs this user is assigned to */
  const ids  = await redis.sMembers(v1Assign(pid));

  /* build [{ id, label }] using meta stored in Redis */
  const list = await Promise.all(
    ids.map(async id => {
      const { label } = await getDatasetMeta(id);   // helper defined earlier
      return { id, label };
    })
  );

  res.json(list);
});


/* fetch past answers (now includes Map file) */
app.get('/qresponses/:pid', async (req, res) => {
  const { dataset } = req.query;
  const pid = req.params.pid;
  if (!dataset) return res.status(400).json({ error: 'dataset query param required' });

  const pattern = `v1:${pid}:${dataset}:*`;
  const out = [];

  for await (const keyBuf of redis.scanIterator({ MATCH: pattern })) {
    const key   = keyBuf.toString();
    const buf   = await redis.get(key);
    if (!buf) continue;

    let ans;
    try { ans = JSON.parse(buf.toString()); } catch { continue; }

    const uid = ans.uid || ans.QID;
    if (!uid) continue;

    /* pull the question to get the Map filename */
    const qRaw = await redis.get(`v1:datasets:${dataset}:${uid}`);
    let mapFile = '';
    if (qRaw) {
      try {
        const qObj = JSON.parse(qRaw.toString());
        mapFile = qObj.Map || qObj.map || '';
      } catch {/* ignore bad json */}
    }

    ans.mapFile = mapFile;        // <- attach for front-end use
    out.push(ans);
  }

  res.json({ responses: out });
});

/* edit an existing answer */
app.post('/edit_qresponse/:pid', async (req, res) => {
  const { pid } = req.params;
  const { dataset, responseID, answer, difficulty, badQuestion, badReason } = req.body;
  const key = v1AnswerKey(pid, dataset, responseID);
  const str = await redis.get(key);
  if (!str) return res.status(404).json({ error: 'not found' });

  const obj = JSON.parse(str);
  if (obj.prolificID !== pid)
    return res.status(403).json({ error: 'not your response' });

  obj.answer     = answer;
  obj.difficulty = difficulty;
  obj.badQuestion = !!badQuestion;
  obj.badReason = badQuestion ? (badReason || '') : '';
  obj.timestamp  = Date.now();
  await redis.set(key, JSON.stringify(obj));
  res.json({ success: true });
});

// POST /run-python — runs the script in /storage/cmarnold/projects/maps
app.post('/run-python', (req, res) => {
  // adjust this path to the exact script you want to run:
  const script = path.resolve(__dirname, '../maps/your_script.py');
  console.log(pythonBin)
  console.log(testScript)

  execFile(pythonBin, [ testScript ], { cwd: path.dirname(testScript) }, (err, stdout, stderr) => {
    if (err) {
      console.error('Python error:', stderr);
      return res.status(500).json({ error: stderr });
    }
    // send back whatever the script printed
    res.json({ output: stdout });
  });
});

/* ───────────────  6. BOOT  ───────────────────── */
(async () => {
  await redis.connect();
  await loadDatasetsFromRedis();            // ← new
  app.listen(3000, () => console.log('Started server on http://localhost:3000'));
})();
