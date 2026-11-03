'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { validate, promote, sha } = require('../part2_price_disposal/scripts/price-refresh');
const { parseCsv } = require('../part2_price_disposal/lib/price');
const source = fs.readFileSync(path.join(__dirname, '../part2_price_disposal/data/중고폰_시세_통합.csv'), 'utf8');
const [headers, ...rows] = parseCsv(source.replace(/^\uFEFF/, ''));
const csv = rows => [headers, ...rows].map(row => row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')).join('\r\n');
test('기존 1784행 검증, 중복·가격 집계 충돌·미검증 출처·미래일 차단', () => {
  assert.equal(validate(source).errors.length, 0);
  assert.equal(validate(source).rows.length, 1784);
  assert.ok(validate(csv([rows[0], rows[0]])).errors.some(x => x.includes('중복')));
  const mutate = (column, value) => { const row = [...rows[0]]; row[headers.indexOf(column)] = value; return validate(csv([row])); };
  assert.ok(mutate('reference_min_krw', '1').errors.some(x => x.includes('불일치')));
  assert.ok(mutate('checked_on', '2099-12-01').errors.length);
  assert.ok(mutate('checked_on', '2026-99-99').errors.length);
  assert.ok(mutate('requires_no_known_function_fault', 'false').errors.length);
  const quotes = JSON.parse(rows[0][headers.indexOf('source_quotes_json')]);
  quotes[0].source_url = 'https://example.invalid/unverified';
  assert.ok(mutate('source_quotes_json', JSON.stringify(quotes)).errors.some(x => x.includes('HTTPS')));
});
test('승격 실패 시 기존 자료 보존, 증빙·검토 해시 일치 시만 원자적 교체/백업', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-refresh-'));
  try {
    const live = path.join(dir, 'live.csv'), candidate = path.join(dir, 'candidate.csv'), review = path.join(dir, 'review.json');
    const candidateCsv = csv(rows);
    fs.writeFileSync(live, source); fs.writeFileSync(candidate, candidateCsv);
    fs.writeFileSync(review, '{}');
    assert.throws(() => promote(candidate, review, live), /해시 불일치/);
    assert.equal(fs.readFileSync(live, 'utf8'), source);
    const urls = [...new Set(rows.flatMap(row => JSON.parse(row[headers.indexOf('source_quotes_json')]).flatMap(q => [q.source_url, q.condition_source_url])))];
    // 합성 테스트 증빙. 실제 원문 수집/검증을 수행했다는 의미가 아님.
    fs.writeFileSync(path.join(dir, 'synthetic-evidence.txt'), 'synthetic test fixture only');
    const record = { reviewer: 'test fixture', reviewedAt: new Date().toISOString(), candidateSha256: sha(candidateCsv), baseSha256: sha(source), fullSnapshotConfirmed: true, modelStorageGradeAmountsConfirmed: true, sources: urls.map(url => ({ url, verified: true, evidenceFile: 'synthetic-evidence.txt', evidenceSha256: sha('synthetic test fixture only') })) };
    fs.writeFileSync(review, JSON.stringify({ ...record, sources: [] }));
    assert.throws(() => promote(candidate, review, live), /미검증 출처/);
    assert.equal(fs.readFileSync(live, 'utf8'), source);
    fs.writeFileSync(review, JSON.stringify(record));
    assert.equal(promote(candidate, review, live).restartRequired, true);
    assert.equal(fs.readFileSync(live, 'utf8'), candidateCsv);
    const backups = fs.readdirSync(path.join(dir, 'refresh-backups')).filter(x => x.endsWith('.csv'));
    assert.equal(fs.readFileSync(path.join(dir, 'refresh-backups', backups[0]), 'utf8'), source);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'gc-refresh-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
