'use strict';
// Cloud Run 경로. 실제 프로젝트 자격증명이 없는 로컬에서는 호출하지 않음.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { validate, sha } = require('../scripts/price-refresh');
function checked(bytes) {
  const result = validate(bytes.toString('utf8'));
  if (result.errors.length || result.rows.length < 1784) throw new Error('공유 시세 스냅샷 검증 실패/기존 행 누락');
  return bytes;
}
function clients() {
  const { Storage } = require('@google-cloud/storage');
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID || undefined });
  return { storage: new Storage(), db: admin.firestore() };
}
async function createCloudJob({ storage, db, bucketName = process.env.PRICE_BUCKET, object = process.env.PRICE_OBJECT || 'prices/current.csv', prefix = process.env.PRICE_ARCHIVE_PREFIX || 'price-collections', leaseDocument = process.env.PRICE_LEASE_DOCUMENT || 'priceJobs/daily', bootstrap = process.env.PRICE_BOOTSTRAP_FROM_REPO === 'true' } = {}) {
  if (!bucketName) throw new Error('Cloud 모드는 PRICE_BUCKET이 필요합니다');
  if (!storage || !db) ({ storage, db } = clients());
  const bucket = storage.bucket(bucketName), file = bucket.file(object), ref = db.doc(leaseDocument);
  const owner = crypto.randomUUID(); let generation, before, lostLease = false;
  const assertLease = async () => {
    if (lostLease) throw new Error('분산 수집 잠금을 잃었습니다');
    const snap = await ref.get(), data = snap.data();
    if (!snap.exists || data.owner !== owner || data.expiresAtMs <= Date.now()) throw new Error('분산 수집 잠금을 잃었습니다');
  };
  const saveNew = (name, bytes, contentType) => bucket.file(name).save(bytes, { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType } });
  return {
    async lease() {
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (snap.exists && snap.data().expiresAtMs > Date.now()) throw new Error('다른 Cloud Run 수집 작업이 실행 중입니다');
        tx.set(ref, { owner, acquiredAt: new Date().toISOString(), expiresAtMs: Date.now() + 120000 });
      });
      let pending = Promise.resolve();
      const timer = setInterval(() => {
        pending = pending.then(() => db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists || snap.data().owner !== owner || snap.data().expiresAtMs <= Date.now()) throw new Error('lease owner 불일치/만료');
          tx.update(ref, { expiresAtMs: Date.now() + 120000 });
        })).catch(() => { lostLease = true; });
      }, 30000); timer.unref();
      return { release: async () => { clearInterval(timer); await pending; await db.runTransaction(async tx => { const snap = await tx.get(ref); if (snap.exists && snap.data().owner === owner) tx.delete(ref); }); } };
    },
    async download(live) {
      try {
        const [meta] = await file.getMetadata(); generation = meta.generation;
        [before] = await bucket.file(object, { generation }).download({ validation: 'crc32c' }); checked(before);
        if (meta.metadata?.csvSha256 !== sha(before) || meta.metadata?.verification !== 'green-circuit-collection/v1') throw new Error('공유 시세의 검증 메타데이터/해시 불일치');
        fs.mkdirSync(path.dirname(live), { recursive: true }); fs.writeFileSync(live + '.next', before); fs.renameSync(live + '.next', live);
      } catch (e) {
        if (e.code !== 404 || !bootstrap) throw e;
        generation = 0; before = checked(fs.readFileSync(live));
      }
    },
    async publish({ candidate, baseSha256, dir, receipt }) {
      await assertLease();
      if (sha(before) !== baseSha256) throw new Error('공유 시세 기준 해시 불일치');
      const bytes = checked(Buffer.from(candidate));
      await saveNew(`${prefix}/${receipt.runId}/before.csv`, before, 'text/csv; charset=utf-8');
      // Cloud Storage object generation을 조건으로 갱신: 다른 실행의 변경을 덮어쓰지 않음.
      await file.save(bytes, { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: generation }, metadata: { contentType: 'text/csv; charset=utf-8', metadata: { csvSha256: sha(bytes), verification: 'green-circuit-collection/v1', runId: receipt.runId, collectedAt: receipt.finishedAt } } });
      fs.writeFileSync(path.join(dir, 'cloud-publish.json'), JSON.stringify({ bucket: bucketName, object, priorGeneration: generation, csvSha256: sha(bytes), at: new Date().toISOString() }, null, 2));
    },
    async archive(dir, state) {
      await assertLease();
      const runId = path.basename(dir);
      function* files(folder) { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) { const full = path.join(folder, entry.name); if (entry.isDirectory()) yield* files(full); else if (entry.isFile()) yield full; } }
      for (const full of files(dir)) {
        const relative = path.relative(dir, full).split(path.sep).join('/');
        if (relative === 'before.csv') continue; // publish에서 먼저 보관
        await saveNew(`${prefix}/${runId}/${relative}`, fs.readFileSync(full), relative.endsWith('.json') ? 'application/json' : 'application/octet-stream');
      }
      await bucket.file(`${prefix}/status.json`).save(JSON.stringify(state, null, 2), { resumable: false, metadata: { contentType: 'application/json' } });
    },
  };
}
function createCloudSync({ storage, bucketName = process.env.PRICE_BUCKET, object = process.env.PRICE_OBJECT || 'prices/current.csv', live = process.env.PRICE_CSV_PATH, intervalMs = 60000, onWarning = () => {} } = {}) {
  if (!bucketName) return null;
  if (!live) throw new Error('Cloud 시세 동기화는 PRICE_CSV_PATH의 쓰기 가능한 임시 파일 경로가 필요합니다');
  if (!storage) { const { Storage } = require('@google-cloud/storage'); storage = new Storage(); }
  if (!fs.existsSync(live)) {
    const fallback = checked(fs.readFileSync(path.resolve(__dirname, '../data/중고폰_시세_통합.csv')));
    fs.mkdirSync(path.dirname(live), { recursive: true }); fs.writeFileSync(live, fallback);
  }
  const bucket = storage.bucket(bucketName), file = bucket.file(object); let generation = null, nextCheck = 0, pending;
  return { async ensure() {
    if (pending) return pending;
    if (Date.now() < nextCheck) return;
    pending = (async () => {
      try {
        const [meta] = await file.getMetadata();
        if (meta.generation !== generation) {
          const [bytes] = await bucket.file(object, { generation: meta.generation }).download({ validation: 'crc32c' }); checked(bytes);
          if (meta.metadata?.csvSha256 !== sha(bytes) || meta.metadata?.verification !== 'green-circuit-collection/v1') throw new Error('공유 시세 검증 메타데이터/해시 불일치');
          fs.mkdirSync(path.dirname(live), { recursive: true }); fs.writeFileSync(live + '.next', bytes); fs.renameSync(live + '.next', live); generation = meta.generation;
        }
        onWarning(null);
      } catch { onWarning('공유 시세 동기화 실패. 마지막 검증 자료를 사용합니다.'); }
      finally { nextCheck = Date.now() + intervalMs; pending = null; }
    })(); return pending;
  } };
}
module.exports = { checked, createCloudJob, createCloudSync };
