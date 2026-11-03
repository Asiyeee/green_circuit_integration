'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../server');
const { localStore } = require('../common/lib/certificate-store');
const { createSellerService } = require('../part3_certificate/lib/seller-routes');
const { createMarketService, secret, hash } = require('../part3_certificate/lib/market');
const certificate = require('../part3_certificate/lib/certificate');
const price = require('../part2_price_disposal/lib/price');
const { recommend } = require('../part4_buyer/lib/buyer');
const sample = require('../part1_hardware_test/sample-result.json');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-flow-'));
let server, base, store;
const access = 'test-server-access';
const makeBody = (patch = {}) => ({ report: structuredClone(sample), brand: 'Apple', model: 'iPhone 12', storage: '128GB', conditionCode: 'clean', knownFault: 'none', nickname: '판매자A', askingPriceKrw: 900000, ...patch });
async function api(url, { method = 'GET', body, owner, buyer, auth = true } = {}) {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { 'x-access-token': access } : {}), ...(owner ? { 'x-owner-token': owner } : {}), ...(buyer ? { 'x-buyer-token': buyer } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const issue = (patch) => api('/api/certificates', { method: 'POST', body: makeBody(patch) });
before(async () => {
  store = localStore(path.join(temp, 'store'), path.join(temp, 'results'));
  ({ server } = await start({ store, config: { port: 0, key: '', token: access } }));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'gc-flow-'));
  fs.rmSync(temp, { recursive: true, force: true });
});

test('점검 JSON 저장 → 추가 입력 → 참고가/희망가 분리 → 등록/목록/추천/상세/보증서', async () => {
  const saved = await api('/api/report', { method: 'POST', body: structuredClone(sample) });
  assert.equal(saved.status, 200);
  const result = await api('/api/results/file?name=' + encodeURIComponent(saved.data.jsonFile));
  assert.equal(result.data.schema, 'device-hw-test/v1');
  const quote = await api('/api/price/quote', { method: 'POST', body: makeBody() });
  assert.equal(quote.data.price.status, 'ok');
  assert.equal(quote.data.disposal.action, 'sell');
  assert.ok(quote.data.disposal.manual.some(x => x.title.includes('데이터 삭제')));
  const manual = await api('/api/public/manual?type=recycled&brand=Apple', { auth: false });
  assert.equal(manual.data.sections.length,3);
  assert.equal(manual.data.type,'recycled');
  const issued = await api('/api/certificates', { method: 'POST', body: { ...makeBody(), report: undefined, resultFile: saved.data.jsonFile } });
  assert.equal(issued.status, 200);
  const { id, ownerToken, certificate: cert } = issued.data;
  assert.equal(ownerToken.length, 43);
  assert.equal(cert.askingPriceKrw, 900000); // 참고 범위 밖 허용
  assert.equal(cert.schema, 'seller-certificate/v1');
  assert.ok(certificate.verify(cert));
  const list = await api('/api/public/certificates', { auth: false });
  assert.ok(list.data.items.some(x => x.id === id && x.askingPriceKrw === 900000));
  const detail = await api('/api/public/certificates/' + id, { auth: false });
  assert.equal(detail.data.verified, true);
  assert.ok(!JSON.stringify(detail.data).includes(ownerToken));
  assert.ok(!JSON.stringify(detail.data).includes('ownerHash'));
  const rec = await api('/api/public/recommend', { auth: false, method: 'POST', body: { device_model: '아이폰 12', priorities: ['camera', 'mic', 'touch'] } });
  assert.equal(rec.status, 200);
  assert.equal(rec.data.items.find(x => x.id === id).breakdown.price, null);
  assert.equal((await fetch(base + '/c/' + id)).status, 200);
});

test('요청 영속 저장 → 소유 판매자 확인 → 명시적 판매 완료 → 목록/추천 제외', async () => {
  const { data: a } = await issue({ nickname: '요청 판매자' });
  const b = secret(), other = secret();
  const body = { type: 'trade', nickname: '구매자', contact: 'test@example.invalid', message: '상태 확인 후 거래하고 싶어요' };
  const request = await api(`/api/public/certificates/${a.id}/requests`, { method: 'POST', buyer: b, auth: false, body });
  assert.equal(request.status, 200);
  assert.equal(request.data.request.status, 'pending');
  assert.equal((await store.getCertificate(a.id)).status, 'listed');
  const restored = createMarketService(localStore(path.join(temp, 'store'), path.join(temp, 'results')));
  assert.equal((await restored.inbox(a.id, a.ownerToken)).length, 1);
  assert.equal((await api(`/api/public/certificates/${a.id}/requests/mine`, { buyer: other, auth: false })).data.items.length, 0);
  assert.equal((await api(`/api/certificates/${a.id}/requests`, { owner: other })).status, 403);
  const owned = await api('/api/certificates/owned', { method: 'POST', owner: a.ownerToken });
  assert.equal(owned.data.item.id, a.id); assert.equal(owned.data.requests.length, 1);
  assert.equal((await api('/api/certificates/owned', { method: 'POST', owner: other })).status, 404);
  assert.equal((await api('/api/certificates/owned', { method: 'POST', owner: a.ownerToken, auth: false })).status, 401);
  const inbox = await api(`/api/certificates/${a.id}/requests`, { owner: a.ownerToken });
  assert.equal(inbox.data.items[0].contact, body.contact);
  assert.ok(!JSON.stringify(inbox.data).includes('buyerHash'));
  const ackUrl = `/api/certificates/${a.id}/requests/${request.data.request.id}/acknowledge`;
  assert.equal((await api(ackUrl, { method: 'POST', owner: a.ownerToken, body: {} })).status, 200);
  assert.equal((await api(ackUrl, { method: 'POST', owner: a.ownerToken, body: {} })).status, 409);
  assert.equal((await api(`/api/public/certificates/${a.id}/requests/mine`, { buyer: b, auth: false })).data.items[0].status, 'acknowledged');
  assert.equal((await store.getCertificate(a.id)).status, 'listed');
  const done = await api(`/api/certificates/${a.id}/outcome`, { method: 'POST', owner: a.ownerToken, body: { type: 'sold' } });
  assert.equal(done.status, 200); assert.equal(done.data.certificate.status, 'sold');
  assert.ok(certificate.verify(done.data.certificate));
  assert.ok(!(await api('/api/public/certificates', { auth: false })).data.items.some(x => x.id === a.id));
  const limited = await api('/api/public/certificates?limit=1', { auth: false });
  assert.equal(limited.data.items.length, 1, '최근 완료 매물을 제외한 뒤 limit 적용');
  assert.equal(limited.data.items[0].status, 'listed');
  const rec = await api('/api/public/recommend', { auth: false, method: 'POST', body: { device_model: 'iphone12', priorities: ['camera', 'mic', 'touch'] } });
  assert.ok(!(rec.data.items || []).some(x => x.id === a.id));
  assert.equal((await api(`/api/public/certificates/${a.id}/requests`, { method: 'POST', buyer: other, auth: false, body })).status, 409);
});

test('시세 미존재·모름·RAM·카메라 화질을 가격으로 보정하지 않고 등록 가능', async () => {
  const patch = { model: 'Galaxy A52', brand: 'Samsung', storage: '2TB', conditionCode: 'damage_or_fault', knownFault: 'unknown', askingPriceKrw: 12345 };
  const created = await issue(patch); assert.equal(created.status, 200);
  const cert = created.data.certificate;
  assert.equal(cert.price.status, 'no_data'); assert.equal(cert.price.minKrw, undefined);
  assert.equal(cert.askingPriceKrw, 12345); assert.equal(cert.condition.knownFault, 'unknown');
  const unknown = await issue({ knownFault: 'unknown' });
  assert.equal(unknown.data.certificate.condition.knownFault, 'unknown');
  assert.equal(unknown.data.certificate.price.status, 'needs_check');
  assert.equal(unknown.data.certificate.condition.verified.fault, false);
  const ram = structuredClone(sample); ram.device.deviceMemoryGB = 8;
  const unknownStorage = await issue({ report: ram, storage: 'unknown' });
  assert.equal(unknownStorage.data.certificate.device.storage, 'unknown');
  assert.equal(unknownStorage.data.certificate.price.status, 'needs_input');
  const gradeReport = structuredClone(sample); gradeReport.results.camera.profile.grade = 'D';
  const gradeChanged = await issue({ report: gradeReport });
  assert.equal(gradeChanged.data.certificate.condition.code, 'clean');
  assert.deepEqual(gradeChanged.data.certificate.price, price.lookup(makeBody()));
  for (const model of ['Galaxy A52', 'Galaxy A52 5G', 'Galaxy A52s']) {
    assert.equal(price.modelKey(model), model.toLowerCase().replace(/\s/g, ''));
  }
  assert.notEqual(price.modelKey('Galaxy A52'), price.modelKey('Galaxy A52 5G'));
  assert.notEqual(price.modelKey('Galaxy A52s'), price.modelKey('Galaxy A52 5G'));
});

test('파손·저가 판매 및 기부/배출 안내는 완료와 분리', async () => {
  for (const type of ['donated', 'recycled']) {
    const created = await issue({ conditionCode: 'display_fault', knownFault: 'yes', askingPriceKrw: 1 });
    const a = created.data;
    assert.equal(a.certificate.assessment.disposal.action, 'sell');
    assert.ok((await api('/api/public/certificates', { auth: false })).data.items.some(x => x.id === a.id));
    const guide = await api('/api/public/manual?brand=Apple', { auth: false });
    assert.ok(guide.data.items.some(x => x.title.includes('기부')));
    assert.equal((await store.getCertificate(a.id)).status, 'listed');
    assert.equal((await api(`/api/certificates/${a.id}/outcome`, { method: 'POST', owner: a.ownerToken, body: { type } })).status, 200);
    assert.ok(!(await api('/api/public/certificates', { auth: false })).data.items.some(x => x.id === a.id));
  }
});

test('권한 차단·동시 완료·요청 중복·비공개 연락처', async () => {
  const { data: a } = await issue({ nickname: '권한 판매자' });
  const { data: other } = await issue({ nickname: '다른 판매자' });
  const url = `/api/certificates/${a.id}/outcome`;
  for (const options of [{ auth: false, owner: a.ownerToken }, {}, { owner: other.ownerToken }]) {
    const r = await api(url, { method: 'POST', body: { type: 'sold' }, ...options });
    assert.ok([401, 403].includes(r.status));
  }
  const body = { type: 'inquiry', nickname: '중복', contact: 'private@example.invalid', message: '문의' }, b = secret();
  assert.equal((await api(`/api/public/certificates/${a.id}/requests`, { method: 'POST', auth: false, body })).status, 401);
  const requests = await Promise.all([1, 2].map(() => api(`/api/public/certificates/${a.id}/requests`, { method: 'POST', auth: false, buyer: b, body })));
  assert.deepEqual(requests.map(x => x.data.duplicate).sort(), [false, true]);
  const pub = await api(`/api/public/certificates/${a.id}`, { auth: false });
  assert.ok(!JSON.stringify(pub.data).includes(body.contact));
  const done = await Promise.all([1, 2].map(() => api(url, { method: 'POST', owner: a.ownerToken, body: { type: 'sold' } })));
  assert.deepEqual(done.map(x => x.status).sort(), [200, 409]);
  const user = await store.getUser('권한 판매자');
  assert.equal(user.actions.filter(x => x.certificateId === a.id && x.type === 'sold').length, 1);
});

test('단일/복수 업체 라벨은 실제 vendor_count 사용, 정확한 키·견적 출처 보존', () => {
  const [h, ...rows] = price.parseCsv(fs.readFileSync(path.join(__dirname, '../part2_price_disposal/data/중고폰_시세_통합.csv'), 'utf8').replace(/^\uFEFF/, ''));
  const objects = rows.map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
  for (const count of [1, 2]) {
    const r = objects.find(x => count === 1 ? +x.vendor_count === 1 : +x.vendor_count > 1);
    const p = price.lookup({ brand: r.brand, model: r.model, storage: r.storage, conditionCode: r.condition_code, knownFault: 'none' });
    assert.equal(p.label_ko, count === 1 ? '단일 업체 참고가' : '업체 매입 참고 범위');
    assert.ok(p.quotes.every(q => q.url && q.grade && q.conditions_ko && q.verificationMethod));
  }
  const equalMulti = objects.find(x => +x.vendor_count > 1 && x.reference_min_krw === x.reference_max_krw);
  assert.ok(equalMulti, '같은 금액의 복수 업체 실제 CSV 행');
  const p = price.lookup({ brand: equalMulti.brand, model: equalMulti.model, storage: equalMulti.storage, conditionCode: equalMulti.condition_code, knownFault: 'none' });
  assert.equal(p.singleAmount, true); assert.equal(p.label_ko, '업체 매입 참고 범위');
  assert.equal(price.lookup({ brand: 'Apple', model: 'iPhone 12', storage: '999GB', conditionCode: 'clean', knownFault: 'none' }).status, 'no_data');
});

test('Gemini 키 부재/호출 실패 후 수동 등록과 규칙 요약, 기존 보증서 호환', async () => {
  assert.equal((await api('/api/assess', { method: 'POST', body: {} })).status, 503);
  const httpError = (status, message) => Object.assign(new Error(message), { status });
  const service = createSellerService({ cfg: { key: 'synthetic-test-key' }, store, httpError, geminiJson: async () => { throw new Error('injected upstream failure'); } });
  await assert.rejects(service.analyzePhotos({ photos: [{ kind: 'front', dataUrl: 'data:image/jpeg;base64,' + Buffer.alloc(250, 1).toString('base64') }] }), /injected upstream failure/);
  const cert = await service.createCertificate(makeBody({ knownFault: 'unknown', batteryShot: null }));
  assert.equal(cert.summary.by, 'rule'); assert.equal(cert.condition.knownFault, 'unknown');
  assert.equal(cert.assessment.battery, null); assert.ok(certificate.verify(cert));
  const legacy = require('../part3_certificate/sample-certificate.json');
  assert.equal(legacy.schema, 'seller-certificate/v1');
  const originalVerified = certificate.verify(legacy);
  await store.createCertificate(legacy, []);
  const detail = await api('/api/public/certificates/' + legacy.id, { auth: false });
  assert.equal(detail.status, 200); assert.equal(detail.data.verified, originalVerified);
  assert.equal((await api(`/api/certificates/${legacy.id}/outcome`, { method: 'POST', owner: secret(), body: { type: 'sold' } })).status, 403);
});

test('미확인 시세·다른 모델의 희망가가 가격 점수를 생성하지 않음', () => {
  const listings = [1, 1000000].map(price => ({ model: 'iPhone 12', price, reference: null, eco_temp: 36.6, scores: { camera: 100, mic: 100, touch: 100 } }));
  const result = recommend(listings, 'iphone12', ['camera', 'mic', 'touch']);
  assert.equal(result[0].final_score, result[1].final_score);
  assert.ok(result.every(x => x.breakdown.price === null));
});

test('후면 파손·화면 불량·복합 손상·시세 없음·기능 모름의 조회/추천/등록 분기', async () => {
  const cases = [
    { conditionCode: 'rear_damage', knownFault: 'none', expected: 'ok' },
    { conditionCode: 'display_fault', knownFault: 'yes', expected: 'ok' },
    { conditionCode: 'damage_or_fault', knownFault: 'yes', expected: 'ok' },
    { conditionCode: 'damage_or_fault', storage: '2TB', knownFault: 'unknown', expected: 'no_data' },
    { conditionCode: 'clean', knownFault: 'unknown', expected: 'needs_check' },
  ];
  for (const scenario of cases) {
    const quote = await api('/api/price/quote', { method: 'POST', body: makeBody(scenario) });
    assert.equal(quote.data.price.status, scenario.expected);
    assert.equal(quote.data.disposal.action, 'sell');
    assert.ok(quote.data.disposal.alternatives.includes('donate'));
    const created = await issue(scenario); assert.equal(created.status, 200);
    const cert = created.data.certificate;
    assert.equal(cert.condition.knownFault, scenario.knownFault);
    assert.equal(cert.condition.code, scenario.conditionCode);
    assert.ok((await api('/api/public/certificates', { auth: false })).data.items.some(c => c.id === cert.id));
    if (scenario.expected !== 'ok') { assert.equal(cert.price.minKrw, undefined); assert.equal(cert.price.maxKrw, undefined); }
  }
  assert.equal((await api('/api/price/search', { method: 'POST', body: { brand: 'Apple', model: 'iPhone 12', storage: '128GB', grade: 'S급' } })).status, 503);
});

test('로컬 트랜잭션 journal 재시작 복구', () => {
  const dir = path.join(temp, 'recovery'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'market-transaction.json'), JSON.stringify([['market/recover.json', { ownerHash: hash(secret()), requests: [] }], ['certificates/recover.json', { id: 'recover' }]]));
  localStore(dir, path.join(temp, 'recovery-results'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'certificates/recover.json'))).id, 'recover');
  assert.ok(!fs.existsSync(path.join(dir, 'market-transaction.json')));
});
