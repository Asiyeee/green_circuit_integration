'use strict';
// 실제 수집 실행 폴더의 원자료/이전 CSV를 사용. 합성 금액이나 네트워크 mock을 사용하지 않음.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
const { readCsv, mergeCollection, publish } = require('../lib/price-collection');
const { sha } = require('./price-refresh');
async function verifyRun(runDir) {
  const before = fs.readFileSync(path.join(runDir, 'before.csv'));
  const collection = JSON.parse(fs.readFileSync(path.join(runDir, 'vendor-offers.json'), 'utf8'));
  const merged = mergeCollection(before.toString('utf8'), collection);
  assert.equal(merged.candidateSha256, sha(fs.readFileSync(path.join(runDir, 'candidate.csv'))), '실제 실행 결과를 원자료에서 동일하게 재생성');
  const oldRows = readCsv(before.toString('utf8')).rows, newRows = readCsv(merged.text).rows;
  const hit = newRows.find(row => { const old = oldRows.find(r => r.reference_id === row.reference_id); return old.reference_min_krw !== row.reference_min_krw || old.reference_max_krw !== row.reference_max_krw; });
  if (!hit) throw new Error('이 수집 실행에는 집계 범위가 바뀐 행이 없습니다. 다른 실행을 선택하세요');
  const prior = oldRows.find(r => r.reference_id === hit.reference_id);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-live-price-'));
  const live = path.join(folder, 'prices.csv'); fs.writeFileSync(live, before);
  const child = fork(path.resolve(__dirname, '../..', 'tests/helpers/price-live-server.cjs'), [], { env: { ...process.env, PRICE_CSV_PATH: live, PRICE_BUCKET: '', GC_VERIFY_DIR: folder }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('검증 서버 시작 제한 시간')), 15000);
      child.once('message', msg => { clearTimeout(timeout); msg.error ? reject(new Error(msg.error)) : resolve(msg.port); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error('검증 서버 조기 종료 ' + code + ': ' + stderr)); });
    });
    const api = async (endpoint, body) => {
      const r = await fetch(`http://127.0.0.1:${port}${endpoint}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-access-token': 'live-price-verification' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await r.json(); if (!r.ok) throw new Error(result.error); return result;
    };
    const input = { brand: hit.brand, model: hit.model, storage: hit.storage, conditionCode: hit.condition_code, knownFault: 'none' };
    const quoteBefore = (await api('/api/price/quote', input)).price;
    assert.equal(quoteBefore.minKrw, +prior.reference_min_krw); assert.equal(quoteBefore.maxKrw, +prior.reference_max_krw);
    const body = { ...input, report: require('../../part1_hardware_test/sample-result.json'), nickname: '수집검증데모', askingPriceKrw: 123456 };
    const oldCert = await api('/api/certificates', body);
    const publishDir = path.join(folder, 'publish'); fs.mkdirSync(publishDir);
    publish({ live, baseBytes: before, candidate: merged.text, receipt: { verification: 'recorded-real-collection' }, dir: publishDir });
    const quoteAfter = (await api('/api/price/quote', input)).price;
    assert.equal(quoteAfter.minKrw, +hit.reference_min_krw); assert.equal(quoteAfter.maxKrw, +hit.reference_max_krw);
    const kept = await api('/api/public/certificates/' + oldCert.id);
    assert.equal(kept.verified, true); assert.equal(kept.certificate.price.minKrw, quoteBefore.minKrw); assert.equal(kept.certificate.price.maxKrw, quoteBefore.maxKrw);
    const newCert = await api('/api/certificates', body);
    assert.equal(newCert.certificate.price.minKrw, quoteAfter.minKrw);
    assert.equal(newCert.certificate.price.maxKrw, quoteAfter.maxKrw);
    // 손상된 새 파일을 임의로 놓아도 마지막 정상 캐시를 쓰고 경고.
    fs.writeFileSync(live + '.next', 'corrupt snapshot'); fs.renameSync(live + '.next', live);
    const rejected = (await api('/api/price/quote', input)).price;
    assert.equal(rejected.minKrw, quoteAfter.minKrw); assert.equal(rejected.maxKrw, quoteAfter.maxKrw); assert.ok(rejected.dataWarning);
    return { verifiedAt: new Date().toISOString(), sourceRunId: path.basename(runDir), model: hit.model, storage: hit.storage, condition: hit.condition_code, before: { min: quoteBefore.minKrw, max: quoteBefore.maxKrw }, after: { min: quoteAfter.minKrw, max: quoteAfter.maxKrw }, serverRestarted: false, oldCertificatePreserved: true, newCertificateUsesRefreshedSnapshot: true, invalidSnapshotRejected: true, rawEvidenceReproducedSha256: merged.candidateSha256, rowsPreserved: merged.rows, note_ko: '실제 수집 원자료로 재생성한 CSV의 서버 반영 검증. 실제 기기 검수/매입 정확도 검증 아님' };
  } finally {
    if (child.connected) child.send('stop', () => {});
    await new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); const timer = setTimeout(() => { child.kill(); resolve(); }, 3000); timer.unref(); });
    assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep + 'gc-live-price-')); fs.rmSync(folder, { recursive: true, force: true });
  }
}
if (require.main === module) verifyRun(path.resolve(process.argv[2] || '')).then(result => console.log(JSON.stringify(result, null, 2))).catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { verifyRun };
