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

/* ───────────────  1. DATASETS  ─────────────── */
const dsLines = fs.readFileSync(
  path.join(__dirname, 'data', 'datasets.jsonl'), 'utf8'
).split('\n').filter(Boolean);

const DATASETS     = dsLines.map(l => JSON.parse(l));
const DATASET_IDS  = DATASETS.map(d => d.id);
const DATASETS_MAP = DATASETS.reduce((m, d) => (m[d.id] = d, m), {});

const FIRST_DS      = DATASET_IDS[0];
const MAX_RESPONSES = 10;

/* ───────────────  2. APP & REDIS  ───────────── */
const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/maps', express.static(path.join(__dirname, 'maps')));

const redis = createClient({ url: 'redis://localhost:6379' });
redis.connect().catch(console.error);

/* ───────────────  3. QUESTIONS CACHE  ───────── */
const questions = {};

function normalise(q) {
  if (!q.QID      && q.uid)      q.QID      = q.uid;
  if (!q.Question && q.question) q.Question = q.question;
  if (!q.Map      && q.map)      q.Map      = q.map;
  if (!q.locations)              q.locations = [];
  return q;
}

async function loadQuestionFiles() {
  for (const ds of DATASETS) {
    const fp  = path.join(__dirname, 'data', ds.file);
    const arr = fs.readFileSync(fp, 'utf8')
                  .split('\n').filter(Boolean)
                  .map(l => normalise(JSON.parse(l)));
    questions[ds.id] = arr;
    console.log(`Loaded ${arr.length} questions for ${ds.id}`);
  }
}

/* ───────────────  4. USER HELPERS  ───────────── */
async function ensureUser(pid) {
  const key = `user:${pid}`;
  if (!await redis.exists(key))
    await redis.hSet(key, 'prolificID', pid);
}

async function userFinished(pid, dsID) {
  const total = questions[dsID].length;
  for (let i = 0; i < total; i++) {
    if (!await redis.sIsMember(`questionUsers:${dsID}:${i}`, pid))
      return false;
  }
  return true;
}

/* ───────────────  5. ROUTES  ─────────────────── */

/* datasets list */
app.get('/datasets', (_req, res) =>
  res.json(DATASETS.map(({ id, label }) => ({ id, label }))));

/* login (ensure user exists) */
app.post('/login', async (req, res) => {
  const { prolificID } = req.body;
  if (!prolificID) return res.status(400).json({ error: 'prolificID required' });
  await ensureUser(prolificID);
  res.json({ success: true });
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
  if (!prolificID || !dataset) return res.status(400).json({ error: 'params' });
  if (!DATASETS_MAP[dataset])   return res.status(400).json({ error: 'invalid ds' });
  await ensureUser(prolificID);

  if (dataset !== FIRST_DS && !await userFinished(prolificID, FIRST_DS))
    return res.status(403).json({ error: `Please finish "${FIRST_DS}" first.` });

  for (let i = 0; i < questions[dataset].length; i++) {
    const setKey = `questionUsers:${dataset}:${i}`;
    if (await redis.sIsMember(setKey, prolificID)) continue;
    const count = await redis.sCard(setKey);
    if (dataset === FIRST_DS || count < MAX_RESPONSES) {
      return res.json({ done: false, questionIndex: i, question: questions[dataset][i] });
    }
  }
  res.json({ done: true });
});

/* submit an answer */
app.post('/submit_question', async (req, res) => {
  const { dataset, prolificID, questionIndex,
          question, QID, answer, difficulty } = req.body;
  if (!prolificID || !dataset) return res.status(400).json({ error: 'params' });
  if (!DATASETS_MAP[dataset])   return res.status(400).json({ error: 'invalid ds' });
  await ensureUser(prolificID);

  if (dataset !== FIRST_DS && !await userFinished(prolificID, FIRST_DS))
    return res.status(403).json({ error: `Please finish "${FIRST_DS}" first.` });

  const setKey = `questionUsers:${dataset}:${questionIndex}`;
  if (await redis.sIsMember(setKey, prolificID))
    return res.status(400).json({ error: 'Already answered' });
  if (dataset !== FIRST_DS && await redis.sCard(setKey) >= MAX_RESPONSES)
    return res.status(400).json({ error: 'No slots left' });

  await redis.sAdd(setKey, prolificID);

  const rid = `qresp:${Date.now()}`;
  await redis.lPush(`user:${prolificID}:qresponses:${dataset}`, rid);

  await redis.set(
    `user:${prolificID}:qresponse:${dataset}:${rid}`,
    JSON.stringify({
      responseID: rid, dataset, QID, question, answer,
      prolificID, questionIndex, difficulty, timestamp: Date.now()
    })
  );
  res.json({ success: true });
});

/* fetch past answers – no dummy rows remain, so just return all rows
   that belong to this <pid> & <dataset> (list key guarantees that). */
   app.get('/qresponses/:pid', async (req, res) => {
    const { dataset } = req.query;
    const pid = req.params.pid;
  
    if (!dataset) {
      return res.status(400).json({ error: "dataset query param required" });
    }
  
    const pattern = `user:${pid}:qresponse:*`;
    const out = [];
  
    for await (const key of redis.scanIterator({ MATCH: pattern })) {
      const str = await redis.get(key);
      if (!str) continue;
  
      let obj;
      try { obj = JSON.parse(str); }
      catch { continue; }
  
      if (
        obj &&
        obj.prolificID === pid &&
        obj.dataset     === dataset
      ) {
        out.push(obj);
      }
    }
  
    res.json({ responses: out });
  });

/* edit an existing answer */
app.post('/edit_qresponse/:pid', async (req, res) => {
  const { pid } = req.params;
  const { dataset, responseID, answer, difficulty } = req.body;
  const key = `user:${pid}:qresponse:${dataset}:${responseID}`;
  const str = await redis.get(key);
  if (!str) return res.status(404).json({ error: 'not found' });

  const obj = JSON.parse(str);
  if (obj.prolificID !== pid)
    return res.status(403).json({ error: 'not your response' });

  obj.answer     = answer;
  obj.difficulty = difficulty;
  obj.timestamp  = Date.now();
  await redis.set(key, JSON.stringify(obj));
  res.json({ success: true });
});

/* ───────────────  6. BOOT  ───────────────────── */
(async () => {
  await loadQuestionFiles();
  app.listen(3000, () => console.log('▶  http://localhost:3000'));
})();





















