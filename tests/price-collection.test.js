'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { parseHtml, parseMintit, amount, sourceModelKey } = require('../part2_price_disposal/lib/price-sources');
const { DEFAULT_CSV, CONTRACTS, canonicalUrl, readCsv, writeCsv, mergeCollection, fetchDocument } = require('../part2_price_disposal/lib/price-collection');
const { assertPreservesExisting, sha } = require('../part2_price_disposal/scripts/price-refresh');
const { runDaily, fileLease, status } = require('../part2_price_disposal/scripts/price-daily');
const { searchPrices } = require('../part2_price_disposal/lib/price-search');
const dir = path.join(__dirname, 'fixtures/price-sources');
const fixture = name => fs.readFileSync(path.join(dir, name), 'utf8');
const url = 'https://phonesam.com/sell/%EC%95%84%EC%9D%B4%ED%8F%B0-12';
const query = { brand: 'Apple', model: 'iPhone 12', storage: '128GB', grade: 'S급' };
const raw = () => parseHtml('phonesam', fixture('phonesam.html'), { url }).offers.filter(o => o.eligible).map(({ conditionDocument, ...o }) => ({ ...o, fetchedAt: '2026-11-02T18:00:00.000Z', responseSha256: sha(fixture('phonesam.html')), conditionResponseSha256: sha(fixture('phonesam.html')), evidenceFile: 'evidence/fixture.html', conditionEvidenceFile: 'evidence/fixture.html', parserVersion: 'public-vendor-table/v1' }));
function baseFixture() {
  const { headers, rows } = readCsv(fs.readFileSync(DEFAULT_CSV, 'utf8'));
  const row = rows.find(r => r.brand === 'Apple' && r.model_key === 'iphone12' && r.storage === '128GB' && r.condition_code === 'clean');
  return { headers, rows: [row], text: writeCsv(headers, [row]) };
}
const collection = offers => ({ schema: 'vendor-price-collection/v1', mappingVersion: CONTRACTS.mappingVersion, collectedAt: new Date().toISOString(), offers });
function temporary() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gc-collect-')); }
function removeTemporary(folder) { assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep + 'gc-collect-')); fs.rmSync(folder, { recursive: true, force: true }); }

test('실제 공개 응답에서 발췌한 6개 업체 표/조건 파싱과 정확한 금액 단위', () => {
  const cases = [
    ['phonesam', 'phonesam.html', null, url],
    ['retemz', 'retemz.html', null, 'https://www.retemz.com/custom/seo/sell/iphone-12.html'],
    ['rediva', 'rediva.html', 'rediva-policy.html', 'https://rediva.ai/price'],
    ['kspe', 'kspe.html', null, 'https://www.kspeinc.com/kspe/price/'],
    ['moa', 'moa.html', 'moa-policy.html', 'https://moa.must-pick.com/price'],
    ['uzphone', 'uzphone.html', null, 'https://uzphone.co.kr/sell/아이폰15-프로'],
  ];
  for (const [vendor, name, policy, source] of cases) {
    const result = parseHtml(vendor, fixture(name), { url: source, conditionHtml: policy ? fixture(policy) : fixture(name) });
    assert.ok(result.offers.some(o => o.eligible), vendor);
    assert.ok(CONTRACTS.vendors[vendor].acceptedConditionSignatures.includes(result.conditionSignature), vendor + ' 등급 계약');
    assert.ok(result.offers.filter(o => o.eligible).every(o => o.sourceModel && o.storage && o.grade && o.conditionsText && o.minKrw > 0));
  }
  assert.deepEqual(amount('27~28.3만'), { minKrw: 270000, maxKrw: 283000 });
  assert.deepEqual(amount('1,380,000원'), { minKrw: 1380000, maxKrw: 1380000 });
  for (const invalid of ['-', '문의', '0원', '- 30000원', '12.3원', '29~27만']) assert.equal(amount(invalid), null);
  assert.notEqual(sourceModelKey('갤럭시 A52'), sourceModelKey('갤럭시 A52 5G'));
  assert.notEqual(sourceModelKey('갤럭시 A52s'), sourceModelKey('갤럭시 A52 5G'));
  assert.equal(sourceModelKey('갤럭시 A33 5G'), 'galaxya33');
  assert.equal(sourceModelKey('갤럭시 A34 5G'), 'galaxya34');
  assert.equal(sourceModelKey('아이폰 SE 2세대'), 'iphonese2');
  assert.equal(sourceModelKey('아이폰 SE 3세대'), 'iphonese3');
  assert.equal(sourceModelKey('아이폰 에어'), 'iphoneair');
  assert.notEqual(sourceModelKey('아이폰 17 에어'), 'iphoneair');
  assert.equal(raw().find(o => o.storage === '128GB' && o.grade === 'S급').minKrw, 180000);
});

test('민팃 실제 API의 깨진 조건/모델명은 가격이 있어도 정상 반영 금지', () => {
  const parsed = parseMintit(JSON.parse(fixture('mintit_result.json')), JSON.parse(fixture('mintit_grades.json')), { url: 'https://mintit.co.kr/price-check/results?petname=AIP12-128G', conditionUrl: 'https://mintit.co.kr/rest/api/sale/grade-standard/list', modelCode: 'AIP12-128G' });
  assert.ok(parsed.offers.some(o => o.minKrw > 0));
  assert.ok(parsed.offers.every(o => !o.eligible && o.rejection.includes('조건')));
});

test('부분 수집은 기존 모든 행/실패 업체/등급 분류를 유지하고 정확한 견적만 갱신', () => {
  const before = baseFixture(), oldRow = before.rows[0], oldQuotes = JSON.parse(oldRow.source_quotes_json);
  const merged = mergeCollection(before.text, collection(raw()));
  assert.equal(merged.rows, 1); assert.equal(merged.updatedQuotes, 1);
  const updated = readCsv(merged.text).rows[0], quotes = JSON.parse(updated.source_quotes_json);
  for (const q of oldQuotes.filter(q => q.vendor !== 'phonesam')) assert.deepEqual(quotes.find(n => n.vendor === q.vendor), q);
  assert.equal(updated.condition_code, oldRow.condition_code);
  assert.equal(updated.requires_no_known_function_fault, oldRow.requires_no_known_function_fault);
  assert.equal(quotes.find(q => q.vendor === 'phonesam').min_krw, 180000);
  assert.throws(() => assertPreservesExisting(before.rows, []), /기존 조회 행/);
  const bad = { ...updated, source_quotes_json: JSON.stringify(quotes.filter(q => q.vendor !== 'mintit')) };
  assert.throws(() => assertPreservesExisting(before.rows, [bad]), /업체 견적/);
});

test('출처 충돌·누락·다른 용량·미검증 조건이면 기존 가격 보존', () => {
  const before = baseFixture(), offers = raw(), target = offers.find(o => o.storage === '128GB' && o.grade === 'S급');
  const conflicting = mergeCollection(before.text, collection([...offers, { ...target, minKrw: target.minKrw + 1 }]));
  assert.ok(conflicting.conflicts.length); assert.equal(conflicting.updatedQuotes, 0);
  assert.deepEqual(readCsv(conflicting.text).rows, before.rows);
  for (const candidates of [[], [{ ...target, eligible: false }], [{ ...target, storage: '256GB' }]]) {
    const result = mergeCollection(before.text, collection(candidates));
    assert.equal(result.updatedQuotes, 0); assert.deepEqual(readCsv(result.text).rows, before.rows);
  }
  assert.throws(() => mergeCollection(before.text, collection([{ ...target, conditionSignature: 'unreviewed' }])), /조건 계약/);
});

test('수집/승격 명령의 성공 시각·실패 로그·중복 잠금과 실패 시 기존 파일 유지', async () => {
  const folder = temporary(), live = path.join(folder, 'live.csv'), root = path.join(folder, 'job');
  fs.writeFileSync(live, baseFixture().text);
  try {
    const fetcher = async () => new Response(fixture('phonesam.html'), { status: 200, headers: { 'content-type': 'text/html' } });
    const result = await runDaily({ live, root, vendors: ['phonesam'], apply: true, delayMs: 0, fetcher });
    assert.equal(result.applied, true); assert.equal(result.rowsAfter, 1);
    const success = status(root).state.lastPublishSuccessAt; assert.ok(success);
    const before = fs.readFileSync(live);
    await assert.rejects(runDaily({ live, root, vendors: ['phonesam'], apply: true, delayMs: 0, fetcher: async () => new Response('', { status: 503 }) }), /갱신 대상이 0건/);
    assert.equal(sha(fs.readFileSync(live)), sha(before));
    assert.equal(status(root).state.lastPublishSuccessAt, success);
    assert.equal(status(root).state.status, 'failed');
    const lease = fileLease(root);
    await assert.rejects(runDaily({ live, root }), /EEXIST/);
    await lease.release();
    assert.ok(fs.readFileSync(path.join(root, 'failures.jsonl'), 'utf8').includes('skipped_duplicate'));
    assert.equal(status(root).lock, null);
  } finally { removeTemporary(folder); }
});

test('조건 본문 변경과 외부/사설 IP 리다이렉트는 실패 처리', async () => {
  const conflictingWidget = parseHtml('phonesam', fixture('phonesam.html').replace('S급 165,000원', 'S급 문의'), { url });
  assert.ok(conflictingWidget.warnings.length);
  assert.ok(conflictingWidget.offers.filter(o => o.grade === 'S급').every(o => !o.eligible));
  assert.ok(CONTRACTS.vendors.phonesam.acceptedConditionSignatures.includes(conflictingWidget.conditionSignature), '가격 문의와 등급 조건 본문을 구분');
  const folder = temporary(), live = path.join(folder, 'live.csv'); fs.writeFileSync(live, baseFixture().text);
  try {
    const before = sha(fs.readFileSync(live));
    await assert.rejects(runDaily({ live, root: path.join(folder, 'job'), vendors: ['phonesam'], apply: true, delayMs: 0, fetcher: async () => new Response(fixture('phonesam.html').replace('아무 이상 없는', '기능 불량 허용'), { status: 200 }) }), /갱신 대상이 0건/);
    assert.equal(sha(fs.readFileSync(live)), before);
    await assert.rejects(fetchDocument(url, { fetcher: async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/secret' } }) }), /허용하지 않은/);
  } finally { removeTemporary(folder); }
});

test('Gemini 검색: 실제 근거 필수, 숫자는 업체 표 재수집과 일치할 때만 검증', async () => {
  let called = 0;
  await assert.rejects(searchPrices({ cfg: { key: '' }, query, fetcher: async () => { called++; } }), /GEMINI_API_KEY 없음/);
  assert.equal(called, 0);
  const claim = { vendor: 'phonesam', ...query, minKrw: 180000, maxKrw: 180000, sourceUrl: url };
  const response = offers => ({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify({ offers }) + '\n```' }] }, groundingMetadata: { webSearchQueries: ['아이폰12 128GB 폰삼 S급 매입가'], groundingChunks: [{ web: { uri: url, title: '폰삼' } }], groundingSupports: [{ segment: { text: '업체 표 확인' }, groundingChunkIndices: [0] }] } }] });
  const fetcher = claims => async (endpoint, options) => {
    assert.ok(endpoint.includes(':generateContent'));
    const body = JSON.parse(options.body); assert.deepEqual(body.tools, [{ google_search: {} }]);
    assert.equal(body.generationConfig.responseMimeType, undefined);
    return Response.json(response(claims));
  };
  const correct = await searchPrices({ cfg: { key: 'synthetic-key' }, query, fetcher: fetcher([claim]), sourceLoader: async () => raw() });
  assert.equal(correct.by, 'gemini_google_search'); assert.equal(correct.verified.length, 1);
  assert.ok(correct.verified[0].conditionsText.includes('아무 이상 없는'));
  const wrong = await searchPrices({ cfg: { key: 'synthetic-key' }, query, fetcher: fetcher([{ ...claim, minKrw: 1 }]), sourceLoader: async () => raw() });
  assert.equal(wrong.verified.length, 0); assert.ok(wrong.rejected[0].reason.includes('원') || wrong.rejected[0].reason.includes('표 불일치'));
  const noCitations = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ offers: [claim] }) }] } }] });
  await assert.rejects(searchPrices({ cfg: { key: 'synthetic-key' }, query, fetcher: noCitations }), /검색 근거/);
  await assert.rejects(searchPrices({ cfg: { key: 'synthetic-key' }, query, fetcher: async () => new Response('', { status: 429 }) }), /HTTP 429/);
});
