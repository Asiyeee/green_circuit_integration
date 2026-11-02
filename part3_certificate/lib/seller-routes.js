'use strict';
// ③ 판매자: 테스트 결과 JSON + 시세 → 성능 보증서 발급·저장·조회, 환경 온도
//
// 토큰 없이 열리는 공개 경로 (구매자가 링크/QR 로 보는 곳)
//  - GET  /c/{id}                         : 보증서 페이지 (certificate.html)
//  - GET  /c/{id}/photos/{n}.jpg          : 보증서 사진
//  - GET  /api/public/certificates        : 보증서 목록 (구매자 비교용)
//  - GET  /api/public/certificates/{id}   : 보증서 JSON + 무결성 확인 결과 + 판매자 환경 온도
//  - GET  /api/public/users/{nickname}    : 환경 온도와 행동 기록
// 토큰(?t=)이 필요한 경로 (판매자 화면)
//  - GET  /seller                         : 보증서 발급 페이지 (seller.html, 페이지 자체는 공개, API 는 토큰 필요)
//  - GET  /api/results/file?name=...      : results/ 의 특정 테스트 결과
//  - GET  /api/price/options?brand&model  : 이 기종의 용량·상태 선택지
//  - POST /api/price/quote                : 시세 + 탄소 + 처분 추천·처리 매뉴얼 미리보기
//  - POST /api/assess                     : ② 외관 사진·배터리 캡처 → Gemini 상태 제안·배터리 판독
//  - POST /api/certificates               : 보증서 발급 (Gemini 요약 포함)
//  - POST /api/certificates/{id}/outcome  : 판매/기부/배출 완료 처리 → 환경 온도 반영

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const price = require('../../part2_price_disposal/lib/price.js');
const carbon = require('./carbon.js');
const eco = require('./eco-temperature.js');
const certificate = require('./certificate.js');
const assessment = require('../../part2_price_disposal/lib/assessment.js');
const { validateReport } = require('../../common/scripts/validate.js');
const { FIRESTORE_PHOTO_LIMIT } = require('../../common/lib/certificate-store.js');
const { createMarketService, secret, hash } = require('./market.js');

const ROOT = path.join(__dirname, '..');
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const PHOTO_KIND = { test_camera: '테스트 촬영 사진', front: '앞면', back: '뒷면', side: '옆면', other: '기타' };
const FAULTS = ['none', 'yes', 'unknown'];
const OUTCOMES = ['sold', 'donated', 'recycled'];
const ASSESS_TTL_MS = 60 * 60 * 1000;

// 다섯 가지 웹 점검은 미점검 기능까지 보장하지 않음. 판매자의 모름 응답을 보존.
function resolveFault(knownFault, summary) {
  const k = FAULTS.includes(knownFault) ? knownFault : 'unknown';
  return { knownFault: k, source: 'seller_declared' };
}

function sendFile(res, file, type) {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(path.join(ROOT, file)));
}

function isExpired(cert) {
  return cert.status === 'listed' && Date.now() > Date.parse(cert.expiresAt);
}

// 목록에서는 무거운 필드를 빼고 비교에 필요한 값만 내려줍니다.
function listItem(cert) {
  return {
    id: cert.id,
    url: `/c/${cert.id}`,
    issuedAt: cert.issuedAt,
    expiresAt: cert.expiresAt,
    status: isExpired(cert) ? 'expired' : cert.status,
    seller: cert.seller.nickname,
    device: cert.device,
    condition: cert.condition,
    test: { passedCount: cert.test.passedCount, totalCount: cert.test.totalCount, allPassed: cert.test.allPassed, statuses: Object.fromEntries(certificate.KEYS.map((k) => [k, cert.test.items[k].status])), cameraPhotoGrade: cert.test.items.camera.photoGrade },
    price: cert.price.status === 'ok' ? { status: 'ok', minKrw: cert.price.minKrw, maxKrw: cert.price.maxKrw, label_ko: cert.price.label_ko, vendorCount: cert.price.vendorCount } : { status: cert.price.status },
    carbon: { avoidedKg: cert.carbon.avoidedKg, basis: cert.carbon.basis },
    trust: cert.trust.level,
    askingPriceKrw: cert.askingPriceKrw ?? null,
    battery: cert.assessment && cert.assessment.battery ? { healthPct: cert.assessment.battery.healthPct, source: 'seller_screenshot' } : null,
    disposal: cert.assessment && cert.assessment.disposal ? cert.assessment.disposal.action : null,
    thumbnail: cert.photos.find((p) => !p.skipped) ? cert.photos.find((p) => !p.skipped).url : null,
  };
}

function decodePhoto(p) {
  const m = String(p.dataUrl || '').match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/);
  if (!m) return null;
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) return null;
  return { kind: PHOTO_KIND[p.kind] ? p.kind : 'other', buffer, mime: m[1] === 'png' ? 'image/png' : 'image/jpeg' };
}

// 발급·거래 처리 로직. HTTP 와 무관해서 scripts/seed-demo.js 도 그대로 씁니다.
// geminiJson 이 없으면(또는 cfg.key 가 없으면) 규칙 기반 요약을 씁니다.
function createSellerService({ cfg = {}, store, httpError, geminiJson }) {
  async function loadResultFile(name) {
    const base = path.basename(String(name || ''));
    if (!base.endsWith('.json')) throw httpError(400, '결과 파일 이름(.json)이 필요합니다');
    const rep = await store.getReport(base.slice(0, -5));
    if (!rep) throw httpError(404, `results/${base} 가 없습니다`);
    return rep;
  }

  async function userOf(nickname) {
    return (await store.getUser(nickname)) || eco.newUser(nickname);
  }

  async function summarize(cert) {
    if (!cfg.key || !geminiJson) return certificate.ruleSummary(cert);
    try {
      const { system, schema } = certificate.loadSummaryPrompt();
      const out = await geminiJson({ system, schema, text: `CERTIFICATE_FACTS (JSON):\n${JSON.stringify(certificate.factsFor(cert), null, 1)}` });
      const s = certificate.normalizeSummary(out, cfg.model);
      if (!s.summary_ko) throw new Error('summary_ko 가 비었습니다');
      return s;
    } catch (e) {
      console.log(`  보증서 요약: Gemini 실패 → 규칙 기반 요약 사용 (${e.message})`);
      return { ...certificate.ruleSummary(cert), geminiError: e.message };
    }
  }

  // ② 외관 사진(앞·뒤) + 배터리 캡처 → Gemini 1회. 결과는 서버에 잠시 두고 assessId 로만 보증서에 붙입니다
  // (클라이언트가 보낸 판별 결과를 그대로 믿지 않기 위해).
  // ponytail: 메모리 보관이라 서버 재시작 시 사라짐. 여러 서버로 늘리면 store 에 저장
  const analyses = new Map();
  async function analyzePhotos(body) {
    if (!cfg.key || !geminiJson) throw httpError(503, '서버에 GEMINI_API_KEY 가 없어 AI 판별을 할 수 없어요. 상태를 직접 골라 주세요.');
    const images = [];
    for (const p of (Array.isArray(body.photos) ? body.photos : []).slice(0, MAX_PHOTOS)) {
      const d = decodePhoto(p);
      if (d && (d.kind === 'front' || d.kind === 'back')) images.push({ label: d.kind, mime: d.mime, data: d.buffer.toString('base64') });
    }
    const bat = body.batteryShot && decodePhoto({ kind: 'other', dataUrl: body.batteryShot });
    if (bat) images.push({ label: 'battery', mime: bat.mime, data: bat.buffer.toString('base64') });
    if (!images.length) throw httpError(400, '앞·뒷면 사진이나 배터리 캡처를 하나 이상 올려 주세요');
    const { system, schema } = assessment.loadPrompt();
    const device = { brand: String(body.brand || ''), model: String(body.model || '') };
    const out = await geminiJson({ system, schema, images, text: `DEVICE (JSON):
${JSON.stringify(device)}
Images given: ${images.map((i) => i.label).join(', ')}` });
    const a = { ...assessment.normalize(out, cfg.model), inputs: images.map((i) => i.label) };
    const id = crypto.randomBytes(8).toString('hex');
    const now = Date.now();
    for (const [k, v] of analyses) if (now - v.at > ASSESS_TTL_MS) analyses.delete(k);
    analyses.set(id, { at: now, a });
    console.log(`✔ AI 판별 ${id} · ${device.brand} ${device.model} · 상태 제안 ${a.condition.code || '없음'}(${a.condition.confidence}) · 배터리 ${a.battery ? (a.battery.healthPct ?? '?') + '%' : '없음'}`);
    return { assessId: id, analysis: a };
  }
  const analysisOf = (id) => {
    const entry = id && analyses.get(id);
    if (!entry || Date.now() - entry.at > ASSESS_TTL_MS) return null;
    return entry.a;
  };

  // 시세 미리보기와 보증서 발급이 같은 규칙을 쓰도록 한 곳에 둡니다.
  function disposalFor({ brand, conditionCode, price: p, report, analysis }) {
    return assessment.recommend({ brand, conditionCode, price: p, report, battery: analysis && analysis.battery });
  }

  // opts.demo: 데모 데이터 표시 (HTTP 요청으로는 켤 수 없고 scripts/seed-demo.js 만 씁니다)
  async function createCertificate(body, opts = {}) {
    const report = body.report && typeof body.report === 'object' ? body.report : await loadResultFile(body.resultFile);
    const errors = validateReport(report);
    if (errors.length) throw httpError(400, '테스트 결과 JSON 이 스키마와 다릅니다', { details: errors });

    const declared = report.device && report.device.declared;
    const brand = String(body.brand || (declared && declared.brand) || '').trim();
    const model = String(body.model || (declared && declared.model) || '').trim();
    if (!brand || !model) throw httpError(400, '기종(brand, model)이 필요합니다. 테스트 결과에 기종이 없으면 직접 입력하세요.');
    const input = {
      brand,
      model,
      storage: String(body.storage || '').trim(),
      conditionCode: String(body.conditionCode || ''),
      knownFault: FAULTS.includes(body.knownFault) ? body.knownFault : 'unknown',
      nickname: String(body.nickname || '').normalize('NFC').trim().slice(0, 20),
      // 기존 보증서 API의 가격 미정(null)은 호환. 새 화면은 희망가 입력 후 등록.
      askingPriceKrw: body.askingPriceKrw ?? null,
    };
    const fault = resolveFault(input.knownFault, report.summary);
    input.knownFault = fault.knownFault;
    input.knownFaultSource = fault.source;
    if (!input.nickname) throw httpError(400, '닉네임이 필요합니다');
    if (input.askingPriceKrw !== null && (!Number.isSafeInteger(input.askingPriceKrw) || input.askingPriceKrw < 1)) throw httpError(400, '판매 희망가는 양의 정수 원 단위로 입력하세요');
    if (!price.CONDITIONS.some((c) => c.code === input.conditionCode)) throw httpError(400, '외관·화면 상태(conditionCode)를 골라 주세요');
    if (!input.storage) throw httpError(400, '저장 용량을 골라 주세요');

    const id = certificate.newId();
    // 사진: 테스트 때 찍은 사진(results/*.jpg) + 판매자가 올린 외관 사진
    const photoBufs = [];
    const testImg = report.results?.camera?.photo?.imageFile;
    const testBuf = testImg && await store.getReportImage(path.basename(testImg).replace(/\.jpg$/, ''));
    if (testBuf) photoBufs.push({ kind: 'test_camera', buffer: testBuf, mime: 'image/jpeg' });
    for (const p of (Array.isArray(body.photos) ? body.photos : []).slice(0, MAX_PHOTOS)) {
      const d = decodePhoto(p);
      if (d) photoBufs.push(d);
    }
    const photos = photoBufs.map((p, i) => ({
      index: i,
      kind: p.kind,
      label_ko: PHOTO_KIND[p.kind],
      url: `/c/${id}/photos/${i}.jpg`,
      bytes: p.buffer.length,
      sha256: crypto.createHash('sha256').update(p.buffer).digest('hex'),
      skipped: store.kind === 'firestore' && p.buffer.length > FIRESTORE_PHOTO_LIMIT,
    }));

    const priceResult = price.lookup(input);
    const carbonResult = carbon.receipt(input);
    let analysis = analysisOf(body.assessId);
    if (!analysis && cfg.key && geminiJson && (body.batteryShot || (Array.isArray(body.photos) && body.photos.length))) {
      try { analysis = (await analyzePhotos({ ...body, brand, model })).analysis; }
      catch (e) { console.log(`  발급 중 AI 판별 실패 → 판별 없이 발급 (${e.message})`); }
    }
    input.assessment = {
      ai: analysis, // null = AI 판별 안 함
      sellerAgreesWithAi: analysis && analysis.condition.code ? analysis.condition.code === input.conditionCode : null,
      battery: analysis ? analysis.battery : null,
      disposal: disposalFor({ brand, conditionCode: input.conditionCode, price: priceResult, report, analysis }),
    };
    let user = await userOf(input.nickname);
    const issued = eco.preview('certificate_issued', 0, user.temperature);
    const cert = certificate.build({
      id,
      demo: !!opts.demo,
      report,
      input,
      price: priceResult,
      carbon: carbonResult,
      photos,
      sellerTemperature: issued.after,
      preview: {
        note_ko: '거래 완료 시 판매자 환경 온도 상승분',
        sold: eco.preview('sold', carbonResult.avoidedKg, issued.after),
        donated: eco.preview('donated', carbonResult.avoidedKg, issued.after),
        recycled: eco.preview('recycled', 0, issued.after),
      },
    });
    cert.summary = await summarize(cert);
    await store.createCertificate(cert, photoBufs, opts.ownerHash);
    await store.transactMarket(id, ({ user: current }) => ({ user: eco.apply(current || eco.newUser(input.nickname), { type: 'certificate_issued', certificateId: id }) }));
    console.log(`✔ 보증서 발급 ${id} · ${brand} ${model} ${input.storage} · 시세 ${priceResult.status} · 탄소 ${carbonResult.avoidedKg}kg (${carbonResult.basis}) · 요약 ${cert.summary.by}`);
    return cert;
  }

  const recordOutcome = (id, type, ownerToken) => createMarketService(store).outcome(id, type, ownerToken);

  return { loadResultFile, createCertificate, recordOutcome, analyzePhotos, analysisOf, disposalFor };
}

function createSellerRoutes({ cfg, store, readJson, sendJson, httpError, geminiJson }) {
  const { loadResultFile, createCertificate, recordOutcome, analyzePhotos, analysisOf, disposalFor } = createSellerService({ cfg, store, httpError, geminiJson });
  const market = createMarketService(store);
  let searchCalls = [];

  // 처리했으면 true
  return async function handle(req, res, url, tokenValid) {
    const p = url.pathname;
    const m = (re) => p.match(re);
    let g;
    // 공개 API·사진은 다른 포트의 프런트엔드(React/Vite 개발 서버 등)에서도 읽을 수 있게 엽니다.
    if (p.startsWith('/api/public/') || p.startsWith('/c/')) res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'GET' && (p === '/seller' || p === '/seller.html')) { sendFile(res, 'seller.html', 'text/html; charset=utf-8'); return true; }
    if (req.method === 'GET' && (g = m(/^\/c\/([A-Za-z0-9]+)\/?$/))) { sendFile(res, 'certificate.html', 'text/html; charset=utf-8'); return true; }
    if (req.method === 'GET' && (g = m(/^\/c\/([A-Za-z0-9]+)\/photos\/(\d+)\.jpg$/))) {
      const ph = await store.getPhoto(g[1], g[2]);
      if (!ph) { res.writeHead(404); res.end(); return true; }
      res.writeHead(200, { 'Content-Type': ph.mime, 'Cache-Control': 'public, max-age=86400' });
      res.end(ph.buffer);
      return true;
    }

    if (req.method === 'GET' && p === '/api/public/certificates') {
      const list = await store.listCertificates({ limit: Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 50)), activeOnly: true });
      const items = list.map(listItem).filter((c) => c.status === 'listed');
      sendJson(res, 200, { schema: certificate.SCHEMA, count: items.length, items });
      return true;
    }
    if (req.method === 'GET' && p === '/api/public/manual') {
      const rec = assessment.recommend({ brand: url.searchParams.get('brand'), conditionCode: 'damage_or_fault' });
      sendJson(res, 200, { items: rec.manualSections.map(assessment.manualSection).filter(Boolean) });
      return true;
    }
    if ((g = m(/^\/api\/public\/certificates\/([A-Za-z0-9]+)\/requests(?:\/mine)?$/))) {
      if (req.method === 'POST' && !p.endsWith('/mine')) sendJson(res, 200, await market.request(g[1], await readJson(req), req.headers['x-buyer-token']));
      else if (req.method === 'GET' && p.endsWith('/mine')) sendJson(res, 200, { items: await market.mine(g[1], req.headers['x-buyer-token']) });
      else sendJson(res, 405, { error: '지원하지 않는 메서드입니다' });
      return true;
    }
    if (req.method === 'GET' && (g = m(/^\/api\/public\/certificates\/([A-Za-z0-9]+)$/))) {
      const cert = await store.getCertificate(g[1]);
      if (!cert) { sendJson(res, 404, { error: '보증서가 없습니다' }); return true; }
      const user = await store.getUser(cert.seller.nickname);
      sendJson(res, 200, {
        certificate: cert,
        verified: certificate.verify(cert),
        expired: isExpired(cert),
        seller: user ? { nickname: user.nickname, temperature: user.temperature, totalAvoidedKg: user.totalAvoidedKg, certificates: user.certificates, reused: user.reused, recycled: user.recycled } : null,
      });
      return true;
    }
    if (req.method === 'GET' && (g = m(/^\/api\/public\/users\/(.+)$/))) {
      const user = await store.getUser(decodeURIComponent(g[1]));
      if (!user) { sendJson(res, 404, { error: '사용자가 없습니다' }); return true; }
      sendJson(res, 200, { ...user, rules: eco.RULES, start: eco.START });
      return true;
    }

    const sellerApi = p === '/api/results/file' || p.startsWith('/api/price/') || p.startsWith('/api/certificates') || p === '/api/assess';
    if (!sellerApi) return false;
    if (!tokenValid) { sendJson(res, 401, { error: '접속 토큰이 없거나 틀립니다. 터미널에 출력된 URL(?t=...)로 접속하세요.' }); return true; }

    if (req.method === 'GET' && p === '/api/results/file') {
      sendJson(res, 200, await loadResultFile(url.searchParams.get('name')));
      return true;
    }
    if (req.method === 'GET' && p === '/api/price/options') {
      sendJson(res, 200, price.options(url.searchParams.get('brand'), url.searchParams.get('model')));
      return true;
    }
    if (req.method === 'GET' && p === '/api/price/status') {
      sendJson(res, 200, price.datasetInfo()); return true;
    }
    if (req.method === 'POST' && p === '/api/price/quote') {
      const b = await readJson(req);
      const input = { brand: b.brand, model: b.model, storage: b.storage, conditionCode: b.conditionCode, knownFault: resolveFault(b.knownFault, b.testSummary).knownFault };
      const pr = price.lookup(input);
      const disposal = disposalFor({ brand: b.brand, conditionCode: b.conditionCode, price: pr, report: { summary: b.testSummary }, analysis: analysisOf(b.assessId) });
      sendJson(res, 200, { price: pr, carbon: carbon.receipt(input), disposal: { ...disposal, manual: disposal.manualSections.map(assessment.manualSection).filter(Boolean) } });
      return true;
    }
    if (req.method === 'POST' && p === '/api/price/search') {
      searchCalls = searchCalls.filter(at => Date.now() - at < 60000);
      if (searchCalls.length >= 3) throw httpError(429, '시세 검색은 분당 3회까지 가능합니다');
      searchCalls.push(Date.now());
      const result = await require('../../part2_price_disposal/lib/price-search').searchPrices({ cfg, query: await readJson(req) });
      sendJson(res, 200, result); return true;
    }
    if (req.method === 'POST' && p === '/api/assess') {
      sendJson(res, 200, await analyzePhotos(await readJson(req)));
      return true;
    }
    if (req.method === 'POST' && p === '/api/certificates') {
      const ownerToken = secret();
      const cert = await createCertificate(await readJson(req), { ownerHash: hash(ownerToken) });
      sendJson(res, 200, { ok: true, id: cert.id, url: `/c/${cert.id}`, certificate: cert, ownerToken });
      return true;
    }
    if (req.method === 'GET' && (g = m(/^\/api\/certificates\/([A-Za-z0-9]+)\/requests$/))) {
      sendJson(res, 200, { items: await market.inbox(g[1], req.headers['x-owner-token']) });
      return true;
    }
    if (req.method === 'POST' && (g = m(/^\/api\/certificates\/([A-Za-z0-9]+)\/requests\/([a-f0-9]+)\/acknowledge$/))) {
      sendJson(res, 200, { request: await market.acknowledge(g[1], g[2], req.headers['x-owner-token']) });
      return true;
    }
    if (req.method === 'POST' && (g = m(/^\/api\/certificates\/([A-Za-z0-9]+)\/outcome$/))) {
      const b = await readJson(req);
      sendJson(res, 200, { ok: true, ...(await recordOutcome(g[1], b.type, req.headers['x-owner-token'])) });
      return true;
    }
    sendJson(res, 404, { error: '없는 API 입니다' });
    return true;
  };
}

module.exports = { createSellerRoutes, createSellerService, listItem };
