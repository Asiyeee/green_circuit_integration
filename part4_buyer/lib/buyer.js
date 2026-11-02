'use strict';
// ④ 구매자 추천 (Deafest_GreenCircuit_buyer 를 이 서버에 합친 것). 판매 중(listed) 보증서를 저장소에서 바로 읽습니다.
//  - GET  /buyer                  : 구매자 화면 (buyer.html)
//  - POST /api/public/recommend   : { device_model, priorities[3] } → 추천 목록
//  - GET  /api/public/models      : 판매 중인 기종 목록 (자동완성)

const fs = require('fs');
const path = require('path');
const { START: ECO_BASE } = require('../../part3_certificate/lib/eco-temperature.js');

// ---------- 설정값 (여기만 바꿔서 튜닝) ----------
const TESTS = ['camera', 'mic', 'speaker', 'gyro', 'touch'];
const RANK_WEIGHTS = [0.5, 0.3, 0.2]; // 1순위, 2순위, 3순위 가중치 (합 = 1)
const W_PERF = 0.4, W_PRICE = 0.35, W_ECO = 0.25; // 최종 점수 비중 (합 = 1)
const MIN_PRIORITY_SCORE = 60; // 선택한 3개 항목 중 이 점수 미만이면 제외
const TEST_KEY = { camera: 'camera', mic: 'microphone', speaker: 'speaker', gyro: 'gyro', touch: 'touch' };
// 점검 pass → 100점, 그 외 → null(미확인). 카메라는 촬영 사진 화질 등급으로 차등 (외관 등급과 무관)
const CAMERA_GRADE_SCORE = { S: 100, A: 92, B: 84, C: 72, D: 60 };
const ECO_TARGET = 40.0; // 추천 점수 환산용 임시 기준

// 한글 별칭도 영문 기종명과 맞도록: "갤럭시 S23" ↔ "Galaxy S23", "아이폰 14" ↔ "iPhone 14"
const normalize = (text) =>
  String(text || '').toLowerCase().replace(/갤럭시/g, 'galaxy').replace(/아이폰/g, 'iphone').replace(/\+/g, 'plus').replace(/\s+/g, '');
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const round1 = (x) => Math.round(x * 10) / 10;
function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// c: seller-routes listItem() 결과
function toListing(c, temperature) {
  const scores = {};
  for (const k of TESTS) {
    const pass = c.test.statuses[TEST_KEY[k]] === 'pass';
    scores[k] = !pass ? null : k === 'camera' ? CAMERA_GRADE_SCORE[c.test.cameraPhotoGrade] ?? 80 : 100;
  }
  return {
    id: c.id,
    model: c.device.model,
    brand: c.device.brand,
    storage: c.device.storage,
    condition: c.condition.label_ko,
    price: c.askingPriceKrw, // 판매 희망가. 없으면 null
    reference: c.price.status === 'ok' ? { minKrw: c.price.minKrw, maxKrw: c.price.maxKrw, label_ko: c.price.label_ko } : null,
    battery: c.battery,
    trust: c.trust,
    seller: c.seller,
    eco_temp: temperature ?? ECO_BASE,
    carbon_kg: c.carbon.avoidedKg,
    scores,
    cert_url: c.url,
    thumbnail: c.thumbnail,
  };
}

function recommend(listings, deviceModel, priorities) {
  // 1) 기종 필터 (공백/대소문자/한글 별칭 무시, 부분 일치)
  const q = normalize(deviceModel);
  let candidates = listings.filter((l) => normalize(l.model).includes(q));
  // 2) 중시하는 성능 3개가 최소 기준 미만이거나 미확인인 매물 제외
  candidates = candidates.filter((l) => priorities.every((p) => l.scores[p] !== null && l.scores[p] >= MIN_PRIORITY_SCORE));
  if (!candidates.length) return [];

  // 3) 가격 기준선: 업체 매입 참고 최고가. 시세가 없으면 후보 희망가의 중앙값
  // ponytail: 매입가 최고가를 개인 거래 기준으로 씀. 실거래가 자료가 생기면 교체
  const asks = candidates.map((l) => l.price).filter(Boolean);
  const fallbackRef = asks.length ? median(asks) : null;

  return candidates.map((l) => {
    const perf = priorities.reduce((sum, p, i) => sum + RANK_WEIGHTS[i] * l.scores[p], 0) / 100;
    // 가격 점수: 기준가 대비 0.7배 이하 1점, 1.3배 이상 0점. 희망가가 없으면 빼고 나머지 비중으로 다시 계산
    const ref = l.reference ? l.reference.maxKrw : fallbackRef;
    const price = l.price && ref ? clamp(1 - (l.price / ref - 0.7) / 0.6) : null;
    const eco = clamp((l.eco_temp - ECO_BASE) / (ECO_TARGET - ECO_BASE));
    const final = price === null
      ? (W_PERF * perf + W_ECO * eco) / (W_PERF + W_ECO)
      : W_PERF * perf + W_PRICE * price + W_ECO * eco;
    return {
      ...l,
      final_score: round1(final * 100),
      breakdown: { performance: round1(perf * 100), price: price === null ? null : round1(price * 100), eco: round1(eco * 100) },
    };
  }).sort((a, b) => b.final_score - a.final_score);
}

function createBuyerRoutes({ store, listItem, readJson, sendJson }) {
  async function listings() {
    const items = (await store.listCertificates({ limit: 200 })).map(listItem).filter((c) => c.status === 'listed');
    const temps = {};
    await Promise.all([...new Set(items.map((c) => c.seller))].map(async (n) => { temps[n] = (await store.getUser(n))?.temperature; }));
    return items.map((c) => toListing(c, temps[c.seller]));
  }

  // 처리했으면 true
  return async function handle(req, res, url) {
    const p = url.pathname;
    if (req.method === 'GET' && (p === '/buyer' || p === '/buyer.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(path.join(__dirname, '..', 'buyer.html')));
      return true;
    }
    if (req.method === 'GET' && p === '/api/public/models') {
      sendJson(res, 200, [...new Set((await listings()).map((l) => l.model))].sort());
      return true;
    }
    if (req.method === 'POST' && p === '/api/public/recommend') {
      const { device_model, priorities } = (await readJson(req)) || {};
      if (typeof device_model !== 'string' || !device_model.trim()) { sendJson(res, 422, { detail: '기종을 입력해야 합니다.' }); return true; }
      if (!Array.isArray(priorities) || priorities.length !== 3 || new Set(priorities).size !== 3 || !priorities.every((x) => TESTS.includes(x))) {
        sendJson(res, 422, { detail: `서로 다른 성능 항목 3개를 순위대로 선택해야 합니다. (가능: ${TESTS.join(', ')})` });
        return true;
      }
      const items = recommend(await listings(), device_model, priorities);
      if (!items.length) { sendJson(res, 404, { detail: '조건에 맞는 매물이 없습니다.' }); return true; }
      sendJson(res, 200, { query: { device_model, priorities }, count: items.length, items });
      return true;
    }
    return false;
  };
}

module.exports = { createBuyerRoutes, recommend, toListing, normalize };

// 자체 점검: node lib/buyer.js
if (require.main === module) {
  const assert = require('assert');
  const L = (model, price, maxKrw, statuses = {}) => ({
    model, price, reference: maxKrw ? { maxKrw } : null, eco_temp: ECO_BASE,
    scores: Object.fromEntries(TESTS.map((k) => [k, statuses[k] === 'fail' ? null : 100])),
  });
  const r = recommend([L('Galaxy S23', 300000, 320000), L('Galaxy S23', 400000, 320000), L('Galaxy S23', 200000, 320000, { mic: 'fail' })], '갤럭시 s23', ['camera', 'mic', 'touch']);
  assert.strictEqual(r.length, 2, '마이크 미확인 매물 제외');
  assert.strictEqual(r[0].price, 300000, '싼 매물이 위');
  assert.strictEqual(recommend([L('iPhone 13', null, null)], '아이폰', ['camera', 'mic', 'touch'])[0].breakdown.price, null, '희망가 없으면 가격 점수 없음');
  assert.strictEqual(recommend([L('iPhone 13', 1, 1)], 'galaxy', ['camera', 'mic', 'touch']).length, 0);
  console.log('buyer.js OK');
}
