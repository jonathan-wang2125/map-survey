/**
 * server.js – Map‑Survey backend  (strict past‑answer filtering)
 * Run with:   node server.js
 * Needs:      npm i express redis body-parser sharp
 */

const DEFAULT_REDIS_PORT  = 6397;
const DEFAULT_SERVER_PORT = 3000;

const REDIS_PORT = process.env.REDIS_PORT || DEFAULT_REDIS_PORT;
const PORT       = process.env.PORT       || DEFAULT_SERVER_PORT;

const express = require('express');
const { promisify } = require('util');
const fs            = require('fs');
const path          = require('path');
const bodyParser    = require('body-parser');
const { createClient } = require('redis');
const sharp         = require('sharp');
const { execFile }  = require('child_process');
const { randomUUID } = require('crypto');
const { pythonBin, pythonRoot, gradeDataset, createDataset, compareResponses, addEval, addUnmatchedResponse, surveyPython, surveyRoot} = require('./public/config/paths');
const { get } = require('http');

const ADJUDICATION_PASSCODE = 'letmein';

/* ───────────────  1. DATASETS  ─────────────── */
let DATASETS      = [];           // [{id,label}, …]
let DATASET_IDS   = [];           // [id, id, …]
// let DATASETS_MAP  = {};           // id → {id,label}

const MAX_RESPONSES = 10;

const execFileAsync = promisify(execFile);

/**
 * Redis Schema
 * ===================================================================================
 *  - v1:usernames                        -> SET of usernames
 *  - v1:datasets                         -> SET of datasets
 *  - v1:assignments:usernames            -> SET of datasets assigned to username
 *  - v1:assignments:dataset              -> SET of usernames assigned to dataset
 * 
 *  - v1:datasets:<dataset_name>          -> SET of questions uids
 *  - v1:datasets:<dataset_name>:meta     -> JSON_VALUE of dataset metadata
 *                                            { label, description, topic }
 *  - v1:datasets:<dataset_name>:<uid>    -> JSON_VALUE of question metadata
 *                                            { uid, Question, Map, Expression Complexity, Label }
 * 
 *  - v1:campaigns:<topic>                 -> SET of datasets
 *  - v1:campaigns:<topic>:meta            -> JSON_VALUE of campaign metadata
 *                                            { curIndex, numImages }
 * 
 *  - v1:<user_name>:<dataset_name>:meta  -> STR_VALUE indicating dataset submission
 *  - v1:<user_name>:<dataset_name>:<uid> -> JSON_VALUE of user response
 *                                            { uid, prolificID, dataset, question, answer, 
 *                                              difficulty, badQuestion, badReason, 
 *                                              origTimestamp, editTimestamp, eval }
 */

/* ───────────────  2. APP & REDIS  ───────────── */
const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/maps', express.static(path.join(__dirname, 'maps')));

const redis = createClient({ url: `redis://localhost:${REDIS_PORT}` });

/* prefix helpers --------------------------------------------------------- */
const v1            = key => `v1:${key}`;
const v1Users       = v1('usernames');                // set of pids
const v1AssignUser  = pid => v1(`assignments:${pid}`);// set of datasets for a pid
const v1AssignDb    = ds => v1(`assignments:${ds}`);
const v1AnswerKey   = (pid, ds, uid) => v1(`${pid}:${ds}:${uid}`);

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
  // DATASETS_MAP = DATASETS.reduce((m, d) => (m[d.id] = d, m), {});

  console.log(`Datasets loaded from Redis: ${ids.join(', ')}`);
}

async function getDatasetMeta(dsID) {
  const raw = await redis.get(`v1:datasets:${dsID}:meta`);
  if (!raw) return { label: dsID, description: '', topic: ''};   // sensible defaults
  try   { return JSON.parse(raw); }
  catch  { return { label: dsID, description: '', topic: ''}; }
}

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

async function fetchUserQuestions(dsIDs, membersByDs){
  // 1) Build the multi (pipeline)
  const multi = redis.multi();
  const patterns = [];

  // queue a KEYS command for every (ds, pid) pattern
  for (const ds of dsIDs) {
    for (const pid of membersByDs[ds]) {
      const pattern = `v1:${pid}:${ds}:*`;
      patterns.push({ ds, pid });
      multi.keys(pattern);
    }
  }

  // 2) Execute all the KEYS calls in one shot
  //    results is an array of key‑lists, in the same order
  const keyLists = await multi.exec(); // [ [keysForPattern1], [keysForPattern2], … ]

  // 3) Flatten out all the individual keys for the second pipeline
  const allKeys = keyLists.flat();
  const keyToIndex = [];
  keyLists.forEach((keys, idx) => {
    for (const key of keys) {
      keyToIndex.push(idx);  // record which (ds, pid) this key belongs to
    }
  });

  // 4) Build a second multi that GETs (or JSON.GETs) each key’s value
  const multi2 = redis.multi();
  for (const key of allKeys) {
    // Replace .get with .jsonGet if you’re storing JSON
    multi2.get(key);
  }
  const values = await multi2.exec();  // array of string results

  // 5) Assemble the nested object
  const questionsByDsUser = {};
  dsIDs.forEach(ds => (questionsByDsUser[ds] = {}));
  patterns.forEach(({ ds, pid }, patternIdx) => {
    questionsByDsUser[ds][pid] = [];
  });

  // Walk each returned value → put into the right ds/pid bucket
  values.forEach((val, i) => {
    const patternIdx = keyToIndex[i];
    const { ds, pid } = patterns[patternIdx];
    questionsByDsUser[ds][pid].push(val);
  });

  return questionsByDsUser;
}

async function fetchAllQuestions(dsIDs){
  const pipeline = redis.multi();
  for (const ds of dsIDs) {
    pipeline.sMembers(`v1:datasets:${ds}`);
  }
  const results = await pipeline.exec();

  const questionsByDs = {};
  for (let i = 0; i < dsIDs.length; i++) {
    questionsByDs[dsIDs[i]] = results[i];
  }
  return questionsByDs;
}

async function fetchAllAssignments(dsIDs) {
  // 1) build the pipeline
  const pipeline = redis.multi();
  for (const ds of dsIDs) {
    pipeline.sMembers(`v1:assignments:${ds}`);
  }

  // 2) execute & await the pipeline
  //    returns an array of [err, result] tuples, one per command
  const results = await pipeline.exec();

  // 3) map back to a dict keyed by dsID
  const membersByDs = {};
  for (let i = 0; i < dsIDs.length; i++) {
    membersByDs[dsIDs[i]] = results[i];
  }

  return membersByDs;
}

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
  // uids.forEach(uid => {
  //   if (uid === '6d70fc39-7e2a-4e99-90e2-dd27b7d490ae') {
  //     console.log(`v1:datasets:${dsID}:${uid}`);
  //   }
  // });
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
    await Promise.all([
      redis.sAdd(v1AssignUser(pid), datasetID),
      redis.sAdd(v1AssignDb(datasetID), pid)
    ]);
  else
    await Promise.all([
      redis.sRem(v1AssignUser(pid), datasetID),
      redis.sRem(v1AssignDb(datasetID), pid)
    ]);
}

function addDatasetToGlobals(id, label = id) {
  if (!DATASET_IDS.includes(id)) {
    DATASET_IDS.push(id);
    DATASETS.push({ id, label });
    // DATASETS_MAP[id] = { id, label };
  }
}

function removeDatasetFromGlobals(id) {
  DATASET_IDS = DATASET_IDS.filter(d => d !== id);
  DATASETS    = DATASETS.filter(d => d.id !== id);
  // delete DATASETS_MAP[id];
}

/* ─── helper: reuse or create a next dataset ───────────────────────── */
async function getNextDataset (pid, currentDs) {
  /* 1. discover the topic of the current dataset */
  const { topic } = await getDatasetMeta(currentDs);
  if (!topic) return null;                      // no topic → nothing to do

  const campSetKey = `v1:campaigns:${topic}`;
  const existing   = await redis.sMembers(campSetKey);
  let nextDs = null;

  for (const cand of existing) {
    const assigned = await redis.sIsMember(`v1:assignments:${cand}`, pid);
    if (!assigned) continue;

    const metaExists = await redis.exists(`v1:${pid}:${cand}:meta`);
    if (!metaExists && cand !== currentDs) {
      nextDs = cand;
      break;
    }
  }

  if (!nextDs) {
    for (const cand of existing) {
      const numAssigned = await redis.sCard(`v1:assignments:${cand}`);
      if (numAssigned >= 2) continue;

      const assigned = await redis.sIsMember(`v1:assignments:${cand}`, pid);
      if (!assigned) {
        nextDs = cand;
        break;
      }
    }
  }

  for (const cand of existing) {
    if (cand.endsWith('Accuracy')){
      const assigned = await redis.sIsMember(`v1:assignments:${cand}`, pid);
      if (!assigned) {                                     // user not on it
        nextDs = cand;
        break;
      }
    }
  }

  /* 3. otherwise create one */
  if (!nextDs) {
    /* read / validate campaign meta */
    const metaRaw = await redis.get(`${campSetKey}:meta`);
    if (!metaRaw) throw new Error('campaign metadata missing');

    let meta;
    try { meta = JSON.parse(metaRaw); }          // strict parse
    catch { throw new Error('campaign metadata invalid'); }

    /* ── capacity check ──────────────────────────────────── */
    const limit = meta.numImages ?? meta.NumImages;          // accept either key
    if (limit == null) throw new Error('numImages not set in campaign metadata');

    if (meta.curIndex >= limit) {
      return null;
    }

    let index = meta.curIndex++;

    nextDs      = `${topic}_${index}`;

    /* generate dataset via Python */
    console.log(`Generating ${nextDs}`)
    const out = await new Promise((resolve, reject) => {
      execFile(
        pythonBin,
        [createDataset, topic, index],
        { cwd: pythonRoot },           // ← use the root, not path.dirname(createDataset)
        (err, stdout) => err ? reject(err) : resolve(stdout)
      );
    });

    
    if (out.includes('skipped')){
      console.log('CreateDataset python script returned skipped')
      return 0;
    }
      // Fail quietly because a dataset could not be generated

    let payload;
    try {
      payload = JSON.parse(out);
    } catch {
      throw new Error('dataset generator returned bad JSON');
    }

    /* ---- extract and sanity-check ----------------------------------- */
    const metaFromPy = payload.dataset_meta;
    // console.log(payload)
    if (!metaFromPy || !metaFromPy.topic || !Array.isArray(payload.dataset_entries))
      throw new Error(`generator payload missing required fields\nreturned: ${out}`);

    const questions = payload.dataset_entries; // array of { uid, Question, Map, … }

    /* bulk-insert question objects ------------------------------------ */
    const dsSetKey = `v1:datasets:${nextDs}`;
    const pipe     = redis.multi();
    questions.forEach(q => {
      if (!q.uid) return;                      // guard malformed rows
      pipe.sAdd(dsSetKey, q.uid);
      pipe.set(`${dsSetKey}:${q.uid}`, JSON.stringify(q));
    });
    await pipe.exec();

    /* register new dataset  & campaign links -------------------------- */
    await Promise.all([
      redis.sAdd('v1:datasets', nextDs),
      redis.sAdd(campSetKey,    nextDs),
      redis.set(`v1:datasets:${nextDs}:meta`, JSON.stringify(metaFromPy)),
      redis.set(`${campSetKey}:meta`,         JSON.stringify(meta))
    ]);

    DATASET_IDS.push(nextDs);
    DATASETS.push({ id: nextDs, label: metaFromPy.label || nextDs });
  }

  /* 4. assign the user if not already */
  await setAccess(pid, nextDs, true);
  return nextDs;
}

async function getAssigned(dataset){
  return await redis.sMembers(`v1:assignments:${dataset}`);
}

async function getStatus(pid, ds){
  return await redis.exists(`v1:${pid}:${ds}:meta`);
}

async function getMeta(pid, ds){
  if (await getStatus(pid, ds) === 1){
    return await redis.get(`v1:${pid}:${ds}:meta`);
  }
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

/* POST /admin/dataset  – create a dataset record + meta
Body: { id, label, description, topic }                  */
app.post('/admin/dataset', async (req, res) => {
  const { id, label = id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  if (DATASET_IDS.includes(id))
    return res.status(409).json({ error: 'dataset exists' });

  /* add to in-memory globals */
  addDatasetToGlobals(id, label);

  res.json({ ok: true });
});

/* DELETE /admin/dataset/:id  – remove dataset + questions + meta */
app.delete('/admin/dataset/:id', async (req, res) => {
  const id = req.params.id;
  if (!DATASET_IDS.includes(id))
    return res.status(404).json({ error: 'unknown dataset' });

  /* update globals */
  removeDatasetFromGlobals(id);

  res.json({ ok: true });
});

app.post('/admin/dataset_meta/:id', async (req, res) => {
  const dsID = req.params.id;
  const { label, description, topic } = req.body || {};
  if (!DATASET_IDS.includes(dsID))
    return res.status(404).json({ error: 'unknown dataset' });

  const prevMeta = await getDatasetMeta(dsID);

  const meta = { label: label || dsID, description: description || '', topic: topic || '' };
  await redis.set(`v1:datasets:${dsID}:meta`, JSON.stringify(meta));

  const oldTopic = (prevMeta.topic || '').trim();
  const newTopic = (meta.topic   || '').trim();

  if (oldTopic !== newTopic) {
    if (oldTopic) {
      await redis.sRem(`v1:campaigns:${oldTopic}`, dsID);
      /* optional: clean up empty sets or meta keys here */
    }
    if (newTopic) {
      /* add dataset to the new campaign set */
      await redis.sAdd(`v1:campaigns:${newTopic}`, dsID);

      /* ensure campaign meta exists once */
      const campMetaKey = `v1:campaigns:${newTopic}:meta`;
      if (!(await redis.exists(campMetaKey))) {
        await redis.set(campMetaKey, JSON.stringify({ curIndex: 0, numImages: 0 }));
      }
    }
  }

  res.json({ ok: true });
});

app.get('/admin/user_datasets/:pid', async (req,res) =>
  res.json(await redis.sMembers(v1AssignUser(req.params.pid))));

app.post('/admin/assign', express.json(), async (req,res) => {
  const { prolificID, datasetID, allow } = req.body;
  try { await setAccess(prolificID, datasetID, allow); res.json({ok:true}); }
  catch (e) { console.error(e); res.status(500).json({error:'db'}); }
});

/* GET /admin/campaign_status/:topic */
app.get('/admin/campaign_status/:topic', async (req, res) => {
  const topic = req.params.topic.trim();
  const dsIDs  = await redis.sMembers(`v1:campaigns:${topic}`);   // SET of datasets
  if (!dsIDs.length) return res.status(404).json({ error: 'unknown topic' });

  /* --- all users assigned to *any* dataset in this campaign --- */
  const userSet = new Set();
  for (const ds of dsIDs) {
    if (ds.endsWith("Accuracy")) {
      const members = await redis.sMembers(`v1:assignments:${ds}`);
      members.forEach(u => userSet.add(u));
    }
  }
  const users = Array.from(userSet);

  /* --- accuracy per user on the <campaign>Accuracy dataset --- */
  const accPromises = users.map(async pid => {
    const key = `v1:${pid}:${topic}Accuracy:meta`;
    const raw = await redis.get(key);      // raw is either "0", "0.94", "submitted", or null
    const num = Number(raw);               // Number("0") -> 0; Number("submitted") -> NaN; Number(null) -> 0
    // note: Number(null) is 0, but redis.get(null-key) actually returns null, not the string "null"
    const accuracy = (raw !== null && Number.isFinite(num))
      ? num
      : null;

    return { pid, accuracy };
  });
  const accuracyArr = await Promise.all(accPromises);

  const membersByDs = await fetchAllAssignments(dsIDs);
  const questionsByDs = await fetchAllQuestions(dsIDs);
  const questionsByDsUser = await fetchUserQuestions(dsIDs, membersByDs);

  const progArr = [];
  for (const ds of dsIDs){
    const total = questionsByDs[ds].length;
    for (const pid of membersByDs[ds]){
      let answered = questionsByDsUser[ds][pid].length
      let lastTS = null, submitted = false;
      for (const question of questionsByDsUser[ds][pid]){
        const asNum = parseFloat(question);
        const isNumericFlag = !isNaN(asNum) && asNum >= 0 && asNum <= 1;

        if (question === 'submitted' || isNumericFlag) {
          submitted = true;
          continue;
        }

        // otherwise assume it's your JSON blob
        try {
          const obj = JSON.parse(question);
          const ts  = obj.editTimestamp || obj.origTimestamp;
          if (ts && (!lastTS || ts > lastTS)) {
            lastTS = ts;
          }
        } catch (e) {
          console.warn(`Invalid JSON for ${pid}/${ds}:`, question);
        }
      }
      if (submitted){
        answered--;
      }
      progArr.push({ pid, dataset: ds, answered, total, lastTS, submitted });
    }
  }

  /* ➊ read campaign meta (curIndex, numImages, etc.) */
  const metaRaw = await redis.get(`v1:campaigns:${topic}:meta`);
  let meta = { curIndex: 0, numImages: 0 };
  if (metaRaw) {
    try { meta = JSON.parse(metaRaw); } catch {}
  }

  res.json({
    users: accuracyArr,
    datasets: dsIDs,
    progress: progArr,
    meta
  });
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

  // await ensureUser(prolificID);

  const qs = await getDatasetQuestions(dataset);

  for (let i = 0; i < qs.length; i++) {
    const q   = qs[i];
    const uid = q.uid || q.QID;

    /* already answered by this user? */
    if (await redis.exists(v1AnswerKey(prolificID, dataset, uid))) continue;

    /* how many total answers exist for this question? */
    // let count = 0;
    // for await (const _ of redis.scanIterator({ MATCH: `v1:*:${dataset}:${uid}` })) {
    //   count++;
    // }

    // console.log(count, MAX_RESPONSES)
    // if (count < MAX_RESPONSES) {
      console.log(prolificID, dataset, i)
      return res.json({ done: false, questionIndex: i, question: q });
    // }
  }
  res.json({ done: true });
});

/* submit an answer */
app.post('/submit_question', async (req, res) => {
  const { dataset, prolificID } = req.body
  if (!prolificID || !dataset)       return res.status(400).json({ error: 'params' });
  if (!DATASET_IDS.includes(dataset)) return res.status(400).json({ error: 'invalid ds' });

  await ensureUser(prolificID);

  /* capacity check */
  const qArr = await getDatasetQuestions(dataset);
  const uid  = req.body.uid || (qArr[questionIndex]?.uid);
  let count  = 0;
  for await (const _ of redis.scanIterator({ MATCH: `v1:*:${dataset}:${uid}` })) {
    count++;
  }
  // if (count >= MAX_RESPONSES)
  //   return res.status(400).json({ error: 'No slots left' });

  /* store answer */
  await redis.set(
    v1AnswerKey(prolificID, dataset, uid),
    JSON.stringify({
      uid: uid,
      prolificID,
      dataset, 
      questionIndex: req.body.questionIndex,
      question: req.body.question,
      answer: req.body.answer,
      difficulty: req.body.difficulty,
      badQuestion: req.body.badQuestion ?? false,
      badReason: req.body.badReason ?? '',
      discard: req.body.discard,
      startTime: req.body.startTime,
      stopTime: req.body.stopTime,
      origTimestamp: Date.now()
    })
  );
  res.json({ success: true });
});

// POST /submit_dataset — mark this user+dataset as submitted
app.post('/submit_dataset', express.json(), async (req, res) => {
  const { prolificID, dataset, value } = req.body;
  if (!prolificID || !dataset) 
    return res.status(400).json({ error: 'prolificID & dataset required' });
  // key = v1:<user>:<dataset>:meta
  await redis.set(`v1:${prolificID}:${dataset}:meta`, value);
  res.json({ ok: true });
});

// GET /dataset_submission/:pid/:ds — has this dataset been submitted by this user?
app.get('/dataset_submission/:pid/:ds', async (req, res) => {
  const { pid, ds } = req.params;
  const exists = await getStatus(pid, ds);
  res.json({ submitted: exists === 1 });
});

app.get('/dataset_meta/:pid/:ds', async (req, res) => {
  const { pid, ds } = req.params;
  const meta = await getMeta(pid, ds);
  res.json({ accuracy: meta });
});

app.get('/get_question_by_uid', async (req, res) => {
  const dsID = req.query.dataset;
  const uid  = req.query.uid;

  if (!dsID || !uid) {
    return res.status(400).json({ error: 'Missing dataset or uid' });
  }

  const key = `v1:datasets:${dsID}:${uid}`;
  try {
    const raw = await redis.get(key);   // node‐redis v4 supports promise syntax
    if (!raw) {
      return res.status(404).json({ error: 'Question not found' });
    }
    const obj = JSON.parse(raw);
    return res.json(obj);
  } catch (e) {
    console.error('Redis error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});


/* datasets visible to a single user */
app.get('/user_datasets/:pid', async (req, res) => {
  const pid  = req.params.pid;

  /* dataset IDs this user is assigned to */
  const ids  = await redis.sMembers(v1AssignUser(pid));

  /* build [{ id, label }] using meta stored in Redis */
  const list = await Promise.all(
    ids.map(async id => {
      const { label, topic } = await getDatasetMeta(id);
      return { id, label, topic };
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

// GET /user_datasets_summary/:pid
// returns [{ id, submitted, accuracy, hasResponses }, …] for all datasets assigned to pid
app.get('/user_datasets_summary/:pid', async (req, res) => {
  const pid = req.params.pid;

  // 1) what datasets does this user have?
  const dsIDs = await redis.sMembers(v1AssignUser(pid));

  // 2) pipeline to check submission-flag and to get the meta value
  const pipe = redis.multi();
  for (const ds of dsIDs) {
    pipe.exists(`v1:${pid}:${ds}:meta`);  // -> 1 if submitted
    pipe.get   (`v1:${pid}:${ds}:meta`);  // -> raw accuracy or flag
  }
  const results = await pipe.exec();  // [ exists1, meta1, exists2, meta2, … ]

  // 3) build up a map id -> { submitted, accuracy }
  const summary = {};
  for (let i = 0; i < dsIDs.length; i++) {
    const exists    = results[2*i];
    const rawMeta   = results[2*i + 1];
    const submitted = exists === 1;
    const accuracy  = submitted && !isNaN(Number(rawMeta))
                      ? Number(rawMeta)
                      : null;
    summary[dsIDs[i]] = { submitted, accuracy, hasResponses: false };
  }

  // 4) single SCAN over all this user’s answer keys to flag any past answers
  for await (const key of redis.scanIterator({ MATCH: `v1:${pid}:*:*` })) {
    if (key.endsWith(':meta')) continue;        // skip the “…:meta” keys
    const parts = key.split(':');               // ["v1","<pid>","<ds>","<uid>"]
    const ds    = parts[2];
    if (summary[ds]) summary[ds].hasResponses = true;
  }

  // 5) turn it into an array and send
  const datasets = dsIDs.map(id => ({ id, ...summary[id] }));
  res.json({ datasets });
});

/* edit an existing answer */
app.post('/edit_qresponse/:pid', async (req, res) => {
  const { pid } = req.params;
  const { dataset, uid, answer, difficulty, badQuestion, badReason, discard } = req.body;
  const key = v1AnswerKey(pid, dataset, uid);
  const str = await redis.get(key);
  if (!str) return res.status(404).json({ error: 'not found' });

  const obj = JSON.parse(str);
  if (obj.prolificID !== pid)
    return res.status(403).json({ error: 'not your response' });

  obj.answer     = answer;
  obj.difficulty = difficulty;
  obj.badQuestion = !!badQuestion;
  obj.badReason = badQuestion ? (badReason || '') : '';
  obj.discard = !!discard;
  obj.editTimestamp = Date.now();
  await redis.set(key, JSON.stringify(obj));
  res.json({ success: true });
});

// User requests adjudication for a specific answer
app.post('/request_adjudication', express.json(), async (req, res) => {
  const { pid, dataset, uid } = req.body || {};
  if (!pid || !dataset || !uid)
    return res.status(400).json({ error: 'missing fields' });
  if (dataset.endsWith('Accuracy') || dataset.endsWith('Training'))
    return res.status(400).json({ error: 'adjudication not allowed' });

  await redis.sAdd('v1:adjudications', `${pid}:${dataset}:${uid}`);
  res.json({ ok: true });
});

// List all pending adjudication requests
app.get('/adjudications', async (req, res) => {
  if (req.query.code !== ADJUDICATION_PASSCODE)
    return res.status(403).json({ error: 'forbidden' });

  const ids = await redis.sMembers('v1:adjudications');
  const out = [];
  for (const id of ids) {
    const [pid, dataset, uid] = id.split(':');
    if (dataset.endsWith('Accuracy') || dataset.endsWith('Training'))
      continue;
    const ansRaw = await redis.get(`v1:${pid}:${dataset}:${uid}`);
    const qRaw   = await redis.get(`v1:datasets:${dataset}:${uid}`);
    let answer = '', otherAnswer = '', question = '', label = '', mapFile = '';
    let adjudicator_label = '', badReason = '', otherBadReason = '';
    try {
      if (ansRaw) {
        const obj = JSON.parse(ansRaw.toString());
        answer = obj.answer || '';
        otherAnswer = obj.nonconcurred_response || '';
        adjudicator_label = obj.adjudicator_label || '';
        badReason = obj.badReason || '';
      }
    } catch {}
    try {
      if (qRaw) {
        const q = JSON.parse(qRaw.toString());
        question = q.Question || q.question || '';
        label    = q.Label || '';
        mapFile  = q.Map || q.map || '';

      }
    } catch {}
    let otherPid = null;
    try {
      const assigned = await getAssigned(dataset);
      otherPid = assigned.find(p => p !== pid) || null;
    } catch {}
    if (otherPid) {
      try {
        const otherRaw = await redis.get(`v1:${otherPid}:${dataset}:${uid}`);
        if (otherRaw) {
          const obj2 = JSON.parse(otherRaw.toString());
          if (!otherAnswer) otherAnswer = obj2.answer || '';
          otherBadReason = obj2.badReason || '';
        }
      } catch {}
    }

    out.push({ pid, otherPid, dataset, uid, question, answer, otherAnswer, label, mapFile, adjudicator_label, badReason, otherBadReason });
  }
  res.json(out);
});

// List previously resolved adjudications
app.get('/past_adjudications', async (req, res) => {
  if (req.query.code !== ADJUDICATION_PASSCODE)
    return res.status(403).json({ error: 'forbidden' });

  const ids = await redis.sMembers('v1:past_adjudications');
  const out = [];
  for (const id of ids) {
    const [pid, dataset, uid] = id.split(':');
    const ansRaw = await redis.get(`v1:${pid}:${dataset}:${uid}`);
    const qRaw  = await redis.get(`v1:datasets:${dataset}:${uid}`);
    let answer='', otherAnswer='', question='', label='', mapFile='';
    let adjudication='', adjudication_reason='';
    let adjudicator_label='', badReason='', otherBadReason='';
    try {
      if (ansRaw) {
        const obj = JSON.parse(ansRaw.toString());
        answer = obj.answer || '';
        otherAnswer = obj.nonconcurred_response || '';
        adjudication = obj.adjudication || '';
        adjudication_reason = obj.adjudication_reason || '';
        adjudicator_label = obj.adjudicator_label || '';
        badReason = obj.badReason || '';
      }
    } catch {}
    try {
      if (qRaw) {
        const q = JSON.parse(qRaw.toString());
        question = q.Question || q.question || '';
        label = q.Label || '';
        mapFile = q.Map || q.map || '';
      }
    } catch {}
    let otherPid = null;
    try {
      const assigned = await getAssigned(dataset);
      otherPid = assigned.find(p => p !== pid) || null;
    } catch {}
    if (otherPid) {
      try {
        const otherRaw = await redis.get(`v1:${otherPid}:${dataset}:${uid}`);
        if (otherRaw) {
          const obj2 = JSON.parse(otherRaw.toString());
          if (!otherAnswer) otherAnswer = obj2.answer || '';
          otherBadReason = obj2.badReason || '';
        }
      } catch {}
    }
    out.push({ pid, otherPid, dataset, uid, question, answer, otherAnswer, label,
       mapFile, adjudication, adjudication_reason, adjudicator_label, badReason, otherBadReason });
  }
  res.json(out);
});


// Resolve an adjudication request
app.post('/adjudicate_result', express.json(), async (req, res) => {
  if (req.query.code !== ADJUDICATION_PASSCODE)
    return res.status(403).json({ error: 'forbidden' });

  const { pid, dataset, uid, choice, reason, label, newQuestion } = req.body || {};
  if (!pid || !dataset || !uid || !choice)
    return res.status(400).json({ error: 'missing fields' });

  if (dataset.endsWith('Accuracy') || dataset.endsWith('Training'))
    return res.status(400).json({ error: 'adjudication not allowed' });

  let otherPid = null;
  try {
    const assigned = await getAssigned(dataset);
    otherPid = assigned.find(p => p !== pid) || null;
  } catch {}
  let mapFile = '';
  try {
    const qRaw = await redis.get(`v1:datasets:${dataset}:${uid}`);
    if (qRaw) {
      const qObj = JSON.parse(qRaw.toString());
      mapFile = qObj.Map || qObj.map || '';
    }
  } catch {}

  const key1 = `v1:${pid}:${dataset}:${uid}`;
  const raw1 = await redis.get(key1);
  if (raw1) {
    try {
      const obj = JSON.parse(raw1.toString());
      obj.adjudication =
        choice === '1' ? 'Correct'
        : choice === '2' ? 'Incorrect'
        : 'Rejected';
      obj.adjudication_reason = reason || '';
      obj.adjudicator_label = label || '';
      await redis.set(key1, JSON.stringify(obj));
    } catch {}
  }

  if (otherPid) {
    const key2 = `v1:${otherPid}:${dataset}:${uid}`;
    const raw2 = await redis.get(key2);
    if (raw2) {
      try {
        const obj2 = JSON.parse(raw2.toString());
        obj2.adjudication =
          choice === '1' ? 'Incorrect'
          : choice === '2' ? 'Correct'
          : 'Rejected';
        obj2.adjudication_reason = reason || '';
        obj2.adjudicator_label = label || '';
        await redis.set(key2, JSON.stringify(obj2));
      } catch {}
    }
  }

  await redis.sAdd('v1:past_adjudications', `${pid}:${dataset}:${uid}`);

  await redis.sRem('v1:adjudications', `${pid}:${dataset}:${uid}`);
   if (newQuestion && newQuestion.trim()) {
    try {
      const { topic } = await getDatasetMeta(dataset);
      const cat = topic || 'General';
      const prefix = `${cat}QuestionsRephrased`;
      const idx = await redis.incr(`v1:${prefix}:idx`);
      const newDsId = `${prefix}_${idx}`;
      const newLabel = `${cat} Questions Rephrased ${idx}`;

      await redis.sAdd('v1:datasets', newDsId);
      await redis.set(`v1:datasets:${newDsId}:meta`, JSON.stringify({ label: newLabel, topic: cat }));
      addDatasetToGlobals(newDsId, newLabel);

      const newUid = randomUUID();
      await redis.sAdd(`v1:datasets:${newDsId}`, newUid);
      await redis.set(`v1:datasets:${newDsId}:${newUid}`, JSON.stringify({
        uid: newUid,
        Question: newQuestion,
        Map: mapFile,
        sourceDataset: dataset,
        sourceUid: uid
      }));
    } catch (err) {
      console.error('Failed to create rephrased question dataset', err);
    }
  }
  res.json({ ok: true });
});

// Cancel an adjudication request without judging
app.post('/cancel_adjudication', express.json(), async (req, res) => {
  if (req.query.code !== ADJUDICATION_PASSCODE)
    return res.status(403).json({ error: 'forbidden' });

  const { pid, dataset, uid } = req.body || {};
  if (!pid || !dataset || !uid)
    return res.status(400).json({ error: 'missing fields' });
  await redis.sRem('v1:adjudications', `${pid}:${dataset}:${uid}`);
  res.json({ ok: true });
});

// POST /run-python – grade a dataset exactly once
app.post('/run-python', async (req, res) => {
  const { prolificID, dataset } = req.body || {};

  console.log(`Submitting ${dataset} for ${prolificID}`)

  if (!prolificID || !dataset)
    return res.status(400).json({ error: 'prolificID & dataset required' });

  if (!DATASET_IDS.includes(dataset))
    return res.status(400).json({ error: 'unknown dataset' });

  const metaKey = `v1:${prolificID}:${dataset}:meta`;
  if (await redis.exists(metaKey))
    return res.status(403).json({ error: 'dataset already submitted' });
  
  let output;
  let nextDs;
  let accuracy = 'submitted';
  if (dataset.endsWith('Accuracy') || dataset.endsWith('Training')) {
    execFile(
      pythonBin,
      [gradeDataset, prolificID, dataset],    // pass PID and dataset to the script
      { cwd: pythonRoot },
      async (err, stdout, stderr) => {
        if (err) {
          console.error('Python error:', stderr);
          return res.status(500).json({ error: 'grading failed' });
        }

        /* stdout should be a single JSON line:  {"accuracy": 0.83} */
        try {
          // keep only the last non-empty line (in case Python prints warnings)
          const lastLine = stdout.split('\n').filter(Boolean).pop() || '{}';
          accuracy = JSON.parse(lastLine).accuracy;
          save_file = JSON.parse(lastLine).eval_file;
          if (typeof accuracy !== 'number' && accuracy !== 'string')
            throw new Error('missing accuracy field');
          execFile(surveyPython, [addEval, prolificID, dataset, save_file], {cwd: surveyRoot}, async (err, stdout, stderr) =>{
            if (err) {
              console.error('Python error:', stderr);
              return res.status(500).json({ error: 'database update failed' });
            }
          })
        } catch (e) {
          console.error('Bad grader output:', stdout);
          return res.status(500).json({ error: 'invalid grader output' });
        }

        if (typeof accuracy === 'string') {
          output = 'Thank you for your submission.'
        } else  if (dataset.endsWith('Training') || (accuracy >= 0.85)) {             // only then branch to new work
          try { nextDs = await getNextDataset(prolificID, dataset); }
          catch (e) { return res.status(500).json({ error: e.message }); }
          if (dataset.endsWith('Training')){
            output = `You scored ${(accuracy*100).toFixed(1)}% accuracy in training. Please review your answers and understand what you might have done wrong before proceeding to the evaulation dataset on the "Home" page.`
          }
          else {
            output = `Congratulations! You have passed the test with ${(accuracy*100).toFixed(1)}% accuracy. Please proceed to the next available dataset on the "Home" page.`
          }
        }
        else {
          output = 'We are sorry, you do not meet the requirements to continue this study. Thank you for your participation.'
        }

        await redis.set(metaKey, accuracy);
        return res.json({ ok:true, output });
      }
    );

    return;
  }

  // Check if dataset being submitted has two annotators
  assigned = await getAssigned(dataset);

  let allStatuses = [];
  for (const member of assigned) {
    const status = await getStatus(member, dataset);
    console.log(status)
    if (status)
      allStatuses = allStatuses.concat(status);
  }
  // if dataset has two annotators, grade dataset
  if (assigned.length > 1 && allStatuses.length > 0){
    // find annotator matches and filter
    try {
      const compareOut = await execFileAsync(pythonBin, [compareResponses, assigned[0], assigned[1], dataset], { cwd: pythonRoot });   // pass PID and dataset to the script
      const lastLine = compareOut.stdout.split('\n').filter(Boolean).pop() || '{}';
      accuracy = JSON.parse(lastLine).accuracy;
      const incorrect_annotations = JSON.parse(lastLine).incorrect_annotations;
      if (typeof accuracy !== 'number' && accuracy !== 'string')
        throw new Error('missing accuracy field');
          // update user response for unmatched answers
      const unmatchedOut = await execFileAsync(surveyPython, [addUnmatchedResponse, assigned[0], assigned[1], dataset, JSON.stringify(incorrect_annotations)], {cwd: surveyRoot});
      console.log(unmatchedOut.stdout)
    } catch (err) {
      console.error('Error in executing compareRespones.py\n', err);
      // Only one header ever goes out
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message || 'Internal error' });
      }
    }
    const user1_meta_key = `v1:${assigned[0]}:${dataset}:meta`;
    const user2_meta_key = `v1:${assigned[1]}:${dataset}:meta`;
    await redis.set(user1_meta_key, accuracy);
    await redis.set(user2_meta_key, accuracy);
  }

  try { nextDs = await getNextDataset(prolificID, dataset); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  if (nextDs) {
    output = 'Thank you for your submission. Please proceed to the next available dataset on the home page.';
  } else {
    output = 'This campaign has reached its limit. ' +
             'Thank you for your participation. ' +
             'Please check back at Prolific for future campaigns.';
  }

  await redis.set(metaKey, accuracy);
  res.json({ ok:true, output });
});


/* export dataset */
app.get('/export_responses/:pid/:ds', async (req, res) => {
  const { pid, ds } = req.params;

  // sanity-check inputs
  if (!DATASET_IDS.includes(ds))
    return res.status(404).json({ error: 'unknown dataset' });

  // Only keys that match this user & dataset
  //  v1:<pid>:<ds>:<uid>
  const pattern = `v1:${pid}:${ds}:*`;

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');

  try {
    for await (const keyBuf of redis.scanIterator({ MATCH: pattern })) {
      const key = keyBuf.toString();

      // ignore status marker v1:<pid>:<ds>:meta
      if (key.endsWith(':meta')) continue;

      const raw = await redis.get(key);
      if (!raw) continue;

      let obj;
      try { obj = JSON.parse(raw.toString()); }
      catch { continue; }

      // ensure the three core fields are present
      const uid = key.split(':').at(-1);  // last token
      obj.prolificID = pid;
      obj.dataset    = ds;
      obj.uid        = uid;

      res.write(JSON.stringify(obj) + '\n');
    }
    res.end();
  } catch (err) {
    console.error('export_responses error:', err);
    res.status(500).json({ error: 'internal' });
  }
});

async function exportAdjudicatedData() {
  const ids = await redis.sMembers('v1:past_adjudications');
  const byDataset = {};
  for (const id of ids) {
    const [pid, dataset, uid] = id.split(':');
    const raw = await redis.get(`v1:${pid}:${dataset}:${uid}`);
    if (!raw) continue;
    let obj;
    try { obj = JSON.parse(raw.toString()); }
    catch { continue; }
    obj.prolificID = pid;
    obj.dataset = dataset;
    obj.uid = uid;
    (byDataset[dataset] ||= []).push(obj);
  }
  const outDir = path.resolve(__dirname, '../maps/survey-responses/adjudicated');
  await fs.promises.mkdir(outDir, { recursive: true });
  for (const [dataset, records] of Object.entries(byDataset)) {
    const file = path.join(outDir, `${dataset}.jsonl`);
    const contents = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    await fs.promises.writeFile(file, contents);
  }
}

function scheduleDailyExport() {
  const now = new Date();
  const nowNY = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const targetNY = new Date(nowNY);
  targetNY.setHours(5, 0, 0, 0);
  if (nowNY > targetNY) targetNY.setDate(targetNY.getDate() + 1);
  const delay = targetNY - nowNY;
  setTimeout(async () => {
    try {
      await exportAdjudicatedData();
    } catch (err) {
      console.error('exportAdjudicatedData failed:', err);
    }
    scheduleDailyExport();
  }, delay);
}

/* ───────────────  6. BOOT  ───────────────────── */
(async () => {
  await redis.connect();
  await loadDatasetsFromRedis();            // ← new
  scheduleDailyExport();
  app.listen(PORT, () => console.log(`Started server on http://localhost:${PORT}`));
})();
