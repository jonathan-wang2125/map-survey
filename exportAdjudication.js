const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

async function exportAdjudicated(redis) {
  const ids = await redis.sMembers('v1:past_adjudications');
  const lines = [];
  for (const id of ids) {
    const [pid, dataset, uid] = id.split(':');
    const ansRaw    = await redis.get(`v1:${pid}:${dataset}:${uid}`);
    const qRaw      = await redis.get(`v1:datasets:${dataset}:${uid}`);
    const dsMetaRaw = await redis.get(`v1:datasets:${dataset}:meta`);
    if (!ansRaw) continue;
    let obj;
    try { obj = JSON.parse(ansRaw.toString()); }
    catch { continue; }
    obj.prolificID = pid;
    obj.dataset    = dataset;
    obj.uid        = uid;
    if (qRaw) {
      try {
        const q = JSON.parse(qRaw.toString());
        obj.question = q.Question || q.question || '';
        obj.label    = q.Label || '';
        obj.map      = q.Map || q.map || '';
        obj.questionData = q; // include full question metadata
      } catch {}
    }
    if (dsMetaRaw) {
      try { obj.datasetMeta = JSON.parse(dsMetaRaw.toString()); }
      catch {}
    }
    lines.push(JSON.stringify(obj));
  }
  if (lines.length === 0) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const repoUrl = 'https://github.com/Scuwr/mapqa.git';
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mapqa-'));
  await execFileAsync('git', ['clone', repoUrl, tmpDir]);
  const outDir = path.join(tmpDir, 'survey-responses/annotations/adjudicated');
  await fs.mkdir(outDir, { recursive: true });
  const fileName = `${timestamp}.jsonl`;
  const filePath = path.join(outDir, fileName);
  await fs.writeFile(filePath, lines.join('\n') + '\n');
  await execFileAsync('git', ['-C', tmpDir, 'add', path.join('survey-responses/annotations/adjudicated', fileName)]);
  await execFileAsync('git', ['-C', tmpDir, 'commit', '-m', `Export adjudicated questions ${timestamp}`]);
  await execFileAsync('git', ['-C', tmpDir, 'push']);
}

function scheduleAdjudicationExport(redis) {
  const run = () => exportAdjudicated(redis).catch(err => console.error('adjudication export failed', err));
  run();
  setInterval(run, 12 * 60 * 60 * 1000); // every 12 hours
}

module.exports = { scheduleAdjudicationExport };

