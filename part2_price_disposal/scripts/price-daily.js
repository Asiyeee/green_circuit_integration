'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { DEFAULT_CSV, VENDORS, readCsv, collect, mergeCollection, publish } = require('../lib/price-collection');
const { loadEnv } = require('../../server');
const ROOT = path.resolve(__dirname, '../data/refresh-staging');
function atomicJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n'); fs.renameSync(file + '.tmp', file); }
function fileLease(root) {
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'daily.lock'); let fd;
  try { fd = fs.openSync(file, 'wx'); }
  catch (e) { if (e.code === 'EEXIST') fs.appendFileSync(path.join(root, 'failures.jsonl'), JSON.stringify({ at: new Date().toISOString(), status: 'skipped_duplicate', reason: '다른 수집 실행의 잠금이 있음' }) + '\n'); throw e; }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), acquiredAt: new Date().toISOString() }));
  return { release: async () => { fs.closeSync(fd); fs.unlinkSync(file); } };
}
function status(root = ROOT) {
  const read = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  return { state: read(path.join(root, 'status.json')), lock: read(path.join(root, 'daily.lock')), scheduledByThisTool: false };
}
function recoverLock(root = ROOT) {
  const { lock } = status(root);
  if (!lock) return { removed: false };
  if (lock.host !== os.hostname()) throw new Error('다른 호스트의 잠금은 자동 제거하지 않음');
  try { process.kill(lock.pid, 0); throw new Error('수집 프로세스가 살아 있어 잠금 유지'); }
  catch (e) { if (e.code !== 'ESRCH') throw e; }
  fs.unlinkSync(path.join(root, 'daily.lock'));
  const failure = { at: new Date().toISOString(), status: 'recovered_dead_process', reason: '실행 프로세스가 없는 로컬 잠금을 복구', previousLock: lock };
  fs.appendFileSync(path.join(root, 'failures.jsonl'), JSON.stringify(failure) + '\n');
  const current = status(root).state;
  if (current?.status === 'running') atomicJson(path.join(root, 'status.json'), { ...current, activeRunId: null, status: 'failed', lastFailure: failure });
  return { removed: true, previousLock: lock };
}
async function runDaily({ live = process.env.PRICE_CSV_PATH || DEFAULT_CSV, root = process.env.PRICE_JOB_DIR || ROOT, apply = false, vendors = VENDORS, limit = Infinity, modelKeys = [], delayMs = 400, fetcher, cloud = null, onProgress } = {}) {
  const lease = cloud ? await cloud.lease() : fileLease(root);
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const dir = path.join(root, 'runs', runId), previous = status(root).state || {};
  fs.mkdirSync(dir, { recursive: true });
  const startedAt = new Date().toISOString();
  const state = { ...previous, lastAttemptAt: startedAt, activeRunId: runId, status: 'running', mode: cloud ? 'cloud' : 'local', scheduledByThisTool: false };
  atomicJson(path.join(root, 'status.json'), state);
  try {
    if (cloud) {
      if (!fs.existsSync(live)) { fs.mkdirSync(path.dirname(live), { recursive: true }); fs.copyFileSync(DEFAULT_CSV, live); }
      await cloud.download(live);
    }
    const baseBytes = fs.readFileSync(live), baseText = baseBytes.toString('utf8');
    const collection = await collect({ rows: readCsv(baseText).rows, dir, vendors, limit, modelKeys, delayMs, fetcher, onProgress });
    atomicJson(path.join(dir, 'vendor-offers.json'), collection);
    const merged = mergeCollection(baseText, collection);
    fs.writeFileSync(path.join(dir, 'candidate.csv'), merged.text);
    const success = merged.updatedQuotes > 0, partial = collection.issues.length > 0 || merged.conflicts.length > 0 || merged.unchangedQuotes > 0;
    const finishedAt = new Date().toISOString();
    const receipt = { schema: 'price-daily-receipt/v1', runId, startedAt, finishedAt, status: !success ? 'failed' : partial ? 'partial_success' : 'success', applied: false, requestedVendors: vendors, selectedModelKeys: modelKeys, pageLimitPerVendor: Number.isFinite(limit) ? limit : null, stats: collection.stats, rowsBefore: readCsv(baseText).rows.length, rowsAfter: merged.rows, updatedQuotes: merged.updatedQuotes, retainedQuotes: merged.unchangedQuotes, priceChanges: merged.priceChanges, baseSha256: merged.baseSha256, candidateSha256: merged.candidateSha256, issues: collection.issues, conflicts: merged.conflicts, changes: merged.changes, sourceDocuments: collection.documents, directory: dir };
    if (success && apply) {
      if (cloud) await cloud.publish({ candidate: merged.text, baseSha256: merged.baseSha256, dir, receipt });
      else publish({ live, baseBytes, candidate: merged.text, receipt, dir });
      receipt.applied = true;
    }
    atomicJson(path.join(dir, 'receipt.json'), receipt);
    if (collection.issues.length || merged.conflicts.length) fs.appendFileSync(path.join(root, 'failures.jsonl'), JSON.stringify({ runId, at: finishedAt, issues: collection.issues, conflicts: merged.conflicts }) + '\n');
    if (!success) throw new Error('검증된 갱신 대상이 0건입니다. 기존 자료를 유지합니다');
    const next = { ...state, activeRunId: null, status: receipt.status, lastCollectionSuccessAt: finishedAt, lastSuccessfulRunAt: finishedAt, ...(receipt.applied ? { lastPublishSuccessAt: finishedAt } : {}), ...(!partial ? { lastFullSuccessAt: finishedAt } : {}), lastReceipt: path.relative(root, path.join(dir, 'receipt.json')), summary: { rows: merged.rows, updatedQuotes: merged.updatedQuotes, retainedQuotes: merged.unchangedQuotes, priceChanges: merged.priceChanges, issues: collection.issues.length, applied: receipt.applied } };
    atomicJson(path.join(root, 'status.json'), next);
    if (cloud) await cloud.archive(dir, next);
    return receipt;
  } catch (e) {
    const failure = { runId, at: new Date().toISOString(), error: e.message };
    atomicJson(path.join(root, 'status.json'), { ...(status(root).state || state), activeRunId: null, status: 'failed', lastFailure: failure });
    fs.appendFileSync(path.join(root, 'failures.jsonl'), JSON.stringify(failure) + '\n');
    if (cloud) await cloud.archive(dir, { ...state, status: 'failed', lastFailure: failure }).catch(() => {});
    throw e;
  } finally { await lease.release(); }
}
async function main() {
  loadEnv(); const [command = 'status', ...args] = process.argv.slice(2);
  const root = process.env.PRICE_JOB_DIR || ROOT;
  if (command === 'status') return console.log(JSON.stringify(status(root), null, 2));
  if (command === 'recover-lock') return console.log(JSON.stringify(recoverLock(root), null, 2));
  if (command !== 'run') throw new Error('사용: price-daily.js run [--apply] [--vendors=phonesam,retemz,...] [--limit=1] [--cloud] | status | recover-lock');
  const selected = args.find(a => a.startsWith('--vendors='))?.slice(10).split(',') || VENDORS;
  const modelKeys = args.find(a => a.startsWith('--models='))?.slice(9).split(',') || [];
  const limit = Number(args.find(a => a.startsWith('--limit='))?.slice(8) || Infinity);
  if (!(limit > 0) || (Number.isFinite(limit) && !Number.isInteger(limit))) throw new Error('limit은 양의 정수');
  const cloud = args.includes('--cloud') ? await require('../lib/price-cloud').createCloudJob() : null;
  const result = await runDaily({ root, apply: args.includes('--apply'), vendors: selected, limit, modelKeys, cloud, onProgress: p => { if ((p.fetched + p.errors) % 25 === 0) console.log(JSON.stringify({ progress: p })); } });
  const { changes, sourceDocuments, issues, conflicts, ...summary } = result; console.log(JSON.stringify({ ...summary, issueCount: issues.length, conflictCount: conflicts.length, sampleIssues: issues.slice(0, 5) }, null, 2));
}
if (require.main === module) main().catch(e => { console.error('시세 수집 실패: ' + e.message); process.exitCode = 1; });
module.exports = { runDaily, status, recoverLock, fileLease, atomicJson, ROOT };
