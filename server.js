'use strict';
// 기기 하드웨어 테스트 서버 (외부 의존성 없음, Node 20+)
//  - GET  /                     : index.html
//  - GET  /api/config           : 서버 상태 (키는 절대 내려주지 않음)
//  - POST /api/analyze-camera   : 사진+메타데이터를 Gemini 로 분석 (프롬프트는 prompts/ 폴더)
//  - POST /api/report           : 결과 JSON 검증 후 results/ 에 저장
//  - GET  /api/results/latest   : 가장 최근 결과 JSON
//  - GET  /api/results          : 저장된 결과 파일 목록
//  - /seller, /c/{id}, /api/public/*, /api/price/*, /api/certificates* : ③ 판매자 보증서 (lib/seller-routes.js 참고)
// /api/* 는 접속 토큰(?t=... 또는 x-access-token 헤더)이 있어야 합니다. /api/public/* 만 예외입니다.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateReport, KEYS } = require('./common/scripts/validate.js');
const { loadPrompt, normalizeAnalysis, applyChecks } = require('./part1_hardware_test/lib/camera-profile.js');
const { createStore } = require('./common/lib/certificate-store.js');
const { createBuyerRoutes } = require('./part4_buyer/lib/buyer.js');
const { createSellerRoutes, listItem } = require('./part3_certificate/lib/seller-routes.js');

const ROOT = __dirname;
const RESULTS_DIR = path.join(ROOT, 'results');
const MAX_BODY = 25 * 1024 * 1024;
const GEMINI_PER_MINUTE = 20;
const GEMINI_TIMEOUT_MS = 60000; // 요청 1건당 제한. 헤징(20초)까지 합쳐도 80초 < Cloudflare 터널 한도(약 100초)

function loadEnv() {
  // 윈도우 메모장으로 만들면 숨은 확장자 때문에 .env.txt 가 되기 쉬워서 그것도 읽습니다.
  const p = ['.env', '.env.txt'].map((n) => path.join(ROOT, n)).find((f) => fs.existsSync(f));
  if (!p) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

// GEMINI_THINKING: auto(기본, 끄기→low→기본 순으로 자동 선택) | default(생각 설정을 보내지 않음) | 숫자(thinkingBudget 고정)
function parseThinking(v) {
  const t = String(v === undefined ? '' : v).trim().toLowerCase();
  if (t === '' || t === 'auto') return { mode: 'auto' };
  if (t === 'default') return { mode: 'default' };
  if (Number.isFinite(Number(t))) return { mode: 'budget', budget: Number(t) };
  return { mode: 'auto' };
}

function getConfig() {
  return {
    port: Number(process.env.PORT) || 3000,
    key: (process.env.GEMINI_API_KEY || '').trim(),
    model: (process.env.GEMINI_MODEL || 'gemini-flash-lite-latest').trim().replace(/^models\//, ''),
    baseUrl: (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').trim().replace(/\/$/, ''),
    thinking: parseThinking(process.env.GEMINI_THINKING !== undefined ? process.env.GEMINI_THINKING : process.env.GEMINI_THINKING_BUDGET),
    hedgeMs: process.env.GEMINI_HEDGE_MS !== undefined && process.env.GEMINI_HEDGE_MS.trim() !== '' && Number.isFinite(Number(process.env.GEMINI_HEDGE_MS))
      ? Number(process.env.GEMINI_HEDGE_MS) : 20000,
    token: (process.env.ACCESS_TOKEN || '').trim() || crypto.randomBytes(9).toString('base64url'),
  };
}

function tokenOk(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function httpError(status, message, extra) {
  return Object.assign(new Error(message), { status, extra });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > MAX_BODY) { failed = true; reject(httpError(413, '요청 본문이 너무 큽니다')); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  try { return JSON.parse(buf.toString('utf8')); }
  catch { throw httpError(400, 'JSON 파싱에 실패했습니다'); }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const safeName = (s) =>
  String(s || '').normalize('NFC').replace(/[^\w가-힣-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);

// 같은 세션에서 다시 전송하면 같은 파일을 덮어씁니다.
const sessionFiles = new Map();

async function saveReport(store, report) {
  const sid = safeName(report.sessionId) || crypto.randomBytes(4).toString('hex');
  let base = sessionFiles.get(sid);
  if (!base) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    base = [ts, safeName(report.tester) || 'anon', sid.slice(0, 8)].join('_');
    sessionFiles.set(sid, base);
  }

  // 카메라 사진은 JSON 에서 빼서 .jpg 로 따로 저장하고, 파일명만 남깁니다.
  const photo = report.results && report.results.camera && report.results.camera.photo;
  let imageFile = null;
  let image = null;
  if (photo && typeof photo.imageBase64 === 'string') {
    image = Buffer.from(photo.imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    imageFile = `${base}.jpg`;
    delete photo.imageBase64;
    photo.imageFile = imageFile;
  }
  await store.saveReport(base, report, image);
  return { jsonFile: `${base}.json`, imageFile };
}

async function callGemini(cfg, payload, signal) {
  const signals = [AbortSignal.timeout(GEMINI_TIMEOUT_MS)];
  if (signal) signals.push(signal);
  const sig = signals.length > 1 && AbortSignal.any ? AbortSignal.any(signals) : signals[0];
  try {
    const r = await fetch(`${cfg.baseUrl}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
      body: JSON.stringify(payload),
      signal: sig,
    });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    if (e && e.name === 'AbortError') throw httpError(499, '취소됨'); // 헤징에서 진 쪽, 조용히 종료
    console.log(`✖ Gemini 연결 실패: ${e.message}`);
    throw httpError(502, `Gemini 에 연결하지 못했습니다: ${e.message}`);
  }
}

// 느린 요청 헤징: hedgeMs 안에 응답이 없으면 같은 요청을 한 번 더 보내고, 먼저 온 쪽을 쓴다.
function hedged(run, hedgeMs) {
  return new Promise((resolve, reject) => {
    const ctrls = [];
    let started = 0;
    let failed = 0;
    let done = false;
    let timer = null;
    const launch = () => {
      const c = new AbortController();
      ctrls.push(c);
      started++;
      run(c.signal).then(
        (v) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          ctrls.forEach((x) => { if (x !== c) x.abort(); });
          resolve(v);
        },
        (e) => {
          if (done) return;
          failed++;
          if (failed >= started) { done = true; clearTimeout(timer); reject(e); }
        },
      );
    };
    if (hedgeMs > 0) {
      timer = setTimeout(() => {
        if (done) return;
        console.log(`  Gemini 응답이 ${hedgeMs / 1000}초 넘게 걸려 두 번째 요청을 함께 보냅니다`);
        launch();
      }, hedgeMs);
    }
    launch();
  });
}

// 모델마다 지원하는 옵션이 달라서, 빠른 방식부터 순서대로 시도하고 성공한 방식을 기억합니다.
function buildPlans(cfg) {
  const t = cfg.thinking;
  const schemaOnly = { name: 'schema', schema: true };
  const promptOnly = { name: 'prompt-only', schema: false };
  if (t.mode === 'default') return [schemaOnly, promptOnly];
  if (t.mode === 'budget') {
    return [{ name: `schema+budget${t.budget}`, schema: true, thinkingConfig: { thinkingBudget: t.budget } }, schemaOnly, promptOnly];
  }
  return [
    { name: 'schema+thinking-off', schema: true, thinkingConfig: { thinkingBudget: 0 } },
    { name: 'schema+thinking-low', schema: true, thinkingConfig: { thinkingLevel: 'low' } },
    schemaOnly,
    promptOnly,
  ];
}

// 사진 + 메타데이터 → Gemini → 정규화된 { qa, profile }
async function analyzeCamera(cfg, imageB64, metadata, state) {
  const { system, schema } = loadPrompt();
  const metaText = JSON.stringify(metadata, null, 1).slice(0, 12000);
  const contents = [{
    role: 'user',
    parts: [{ text: `METADATA (JSON):\n${metaText}` }, { inline_data: { mime_type: 'image/jpeg', data: imageB64 } }],
  }];
  const payloadFor = (plan) => {
    const gen = { responseMimeType: 'application/json', temperature: 0.2 };
    if (plan.schema) gen.responseSchema = schema;
    if (plan.thinkingConfig) gen.thinkingConfig = plan.thinkingConfig;
    const sys = plan.schema ? system : `${system}\n\n# JSON schema (follow exactly)\n${JSON.stringify(schema)}`;
    return { systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: gen };
  };

  const plans = buildPlans(cfg);
  const t0 = Date.now();
  const sizeKB = Math.round(imageB64.length / 1024);
  let r;
  let used = Math.min(state.planIdx || 0, plans.length - 1);
  for (; used < plans.length; used++) {
    r = await hedged((sig) => callGemini(cfg, payloadFor(plans[used]), sig), cfg.hedgeMs);
    if (r.status !== 400) break;
    console.log(`  Gemini 400 (${plans[used].name}) → 다음 방식으로 재시도: ${r.text.slice(0, 160).replace(/\s+/g, ' ')}`);
  }
  if (used >= plans.length) used = plans.length - 1;
  if (r.status === 200 && used !== (state.planIdx || 0)) {
    state.planIdx = used;
    console.log(`  → 이 모델은 '${plans[used].name}' 방식으로 동작합니다. 앞으로 이 방식을 먼저 씁니다.`);
  }
  const ms = Date.now() - t0;
  const plan = plans[used].name;
  console.log(`Gemini ${r.status} (${ms}ms, 이미지 ${sizeKB}KB, model ${cfg.model}, ${plan})`);
  if (r.status !== 200) {
    const brief = r.text.trim().startsWith('<') ? '(HTML 응답)' : r.text.slice(0, 300).replace(/\s+/g, ' ');
    console.log(`  ${brief}`);
    throw httpError(r.status === 429 ? 429 : r.status >= 500 ? 502 : 424, `Gemini HTTP ${r.status}: ${brief}`);
  }

  let j;
  try { j = JSON.parse(r.text); } catch { throw httpError(502, 'Gemini 응답을 해석하지 못했습니다'); }
  const cand = j.candidates && j.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const txt = parts.filter((x) => !x.thought).map((x) => x.text || '').join('');
  if (!txt) {
    const why = (cand && cand.finishReason) || (j.promptFeedback && j.promptFeedback.blockReason) || '?';
    throw httpError(502, `Gemini 응답이 비었습니다 (finishReason: ${why})`);
  }
  let parsed;
  try { parsed = JSON.parse(txt); } catch {
    const m = txt.match(/\{[\s\S]*\}/);
    try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  }
  if (!parsed) throw httpError(502, 'Gemini 가 JSON 이 아닌 응답을 돌려줬습니다');

  const { qa, profile } = normalizeAnalysis(parsed, schema);
  // EXIF·로컬 지표·사용자가 고른 기종과 대조 (optics 는 EXIF 값만 허용, 어긋나면 신뢰도 하향)
  const checks = applyChecks(metadata, qa, profile);
  const u = j.usageMetadata || {};
  const usage = {
    promptTokens: u.promptTokenCount ?? null,
    outputTokens: u.candidatesTokenCount ?? null,
    thoughtsTokens: u.thoughtsTokenCount ?? null,
    ms,
    plan,
  };
  console.log(`  토큰: 입력 ${usage.promptTokens} / 출력 ${usage.outputTokens} / 생각 ${usage.thoughtsTokens} · 등급 ${profile.grade} · 신뢰도 ${profile.confidence}`);
  return { model: cfg.model, qa, profile, checks, usage, fallback: plan === 'prompt-only' };
}

// 텍스트 → Gemini → JSON (보증서 요약 등). 사진 분석과 같은 방식 선택·헤징을 쓰되, 방식 기억은 따로 합니다.
// images: [{ mime, data(base64), label }] — 있으면 라벨 텍스트 뒤에 이미지를 붙여 보냅니다.
async function geminiJson(cfg, state, { system, schema, text, images = [] }) {
  const userParts = [{ text }];
  for (const im of images) userParts.push({ text: `IMAGE: ${im.label}` }, { inline_data: { mime_type: im.mime, data: im.data } });
  const contents = [{ role: 'user', parts: userParts }];
  const plans = buildPlans(cfg);
  let used = Math.min(state.textPlanIdx || 0, plans.length - 1);
  let r;
  const t0 = Date.now();
  for (; used < plans.length; used++) {
    const plan = plans[used];
    const gen = { responseMimeType: 'application/json', temperature: 0.3 };
    if (plan.schema) gen.responseSchema = schema;
    if (plan.thinkingConfig) gen.thinkingConfig = plan.thinkingConfig;
    const sys = plan.schema ? system : `${system}\n\n# JSON schema (follow exactly)\n${JSON.stringify(schema)}`;
    const payload = { systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: gen };
    r = await hedged((sig) => callGemini(cfg, payload, sig), cfg.hedgeMs);
    if (r.status !== 400) break;
  }
  if (used >= plans.length) used = plans.length - 1;
  if (r.status === 200) state.textPlanIdx = used;
  console.log(`Gemini ${r.status} (${Date.now() - t0}ms, ${images.length ? `이미지 ${images.length}장` : '텍스트'}, model ${cfg.model}, ${plans[used].name})`);
  if (r.status !== 200) throw httpError(r.status === 429 ? 429 : 502, `Gemini HTTP ${r.status}: ${r.text.slice(0, 200).replace(/\s+/g, ' ')}`);
  const j = JSON.parse(r.text);
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const txt = parts.filter((x) => !x.thought).map((x) => x.text || '').join('');
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw httpError(502, 'Gemini 가 JSON 이 아닌 응답을 돌려줬습니다');
  return JSON.parse(m[0]);
}

async function handle(req, res, cfg, state) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    const html = fs.readFileSync(path.join(ROOT, 'part1_hardware_test', 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }
  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
  // 공통 스타일·이미지 (assets/ 폴더의 파일만, 하위 폴더 없음)
  if (req.method === 'GET' && p.startsWith('/assets/')) {
    const name = path.basename(p);
    const f = path.join(ROOT, 'common', 'assets', name);
    const types = { '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8' };
    if (!types[path.extname(name)] || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(name)], 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(f));
  }

  if (state.buyerRoutes && await state.buyerRoutes(req, res, url)) return; // ④ 구매자: 토큰 없이 열림
  const given = req.headers['x-access-token'] || url.searchParams.get('t');
  if (state.sellerRoutes && await state.sellerRoutes(req, res, url, tokenOk(given, cfg.token))) return;

  if (p.startsWith('/api/')) {
    if (!tokenOk(given, cfg.token)) {
      return sendJson(res, 401, { error: '접속 토큰이 없거나 틀립니다. 터미널에 출력된 URL(?t=...)로 접속하세요.' });
    }

    if (req.method === 'GET' && p === '/api/config') {
      return sendJson(res, 200, { geminiEnabled: !!cfg.key, model: cfg.model, schema: 'device-hw-test/v1' });
    }

    if (req.method === 'POST' && p === '/api/analyze-camera') {
      if (!cfg.key) return sendJson(res, 503, { error: '서버에 GEMINI_API_KEY 가 없습니다 (.env 확인)' });
      const now = Date.now();
      state.calls = state.calls.filter((t) => now - t < 60000);
      if (state.calls.length >= GEMINI_PER_MINUTE) {
        return sendJson(res, 429, { error: `요청이 너무 많습니다 (분당 ${GEMINI_PER_MINUTE}회 제한)` });
      }
      state.calls.push(now);
      const body = await readJson(req);
      const img = String(body.imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
      if (img.length < 200) return sendJson(res, 400, { error: 'imageBase64(JPEG) 가 필요합니다' });
      const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
      const result = await analyzeCamera(cfg, img, metadata, state);
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === 'POST' && p === '/api/report') {
      const report = await readJson(req);
      const errors = validateReport(report);
      if (errors.length) return sendJson(res, 400, { error: '결과 JSON 이 스키마와 다릅니다', details: errors });
      const saved = await saveReport(state.store, report);
      const line = KEYS.map((k) => `${k}:${report.results[k].status}`).join(' ');
      console.log(`✔ 저장됨 results/${saved.jsonFile}${saved.imageFile ? ' (+jpg)' : ''}\n  ${line}`);
      return sendJson(res, 200, { ok: true, ...saved });
    }

    if (req.method === 'GET' && p === '/api/results/latest') {
      const [last] = await state.store.listReports();
      const rep = last && await state.store.getReport(last);
      if (!rep) return sendJson(res, 404, { error: '아직 저장된 결과가 없습니다' });
      return sendJson(res, 200, rep);
    }

    if (req.method === 'GET' && p === '/api/results') {
      return sendJson(res, 200, { files: (await state.store.listReports()).map((n) => `${n}.json`) });
    }

    return sendJson(res, 404, { error: '없는 API 입니다' });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

async function checkGemini(cfg) {
  if (!cfg.key) {
    console.log('⚠  GEMINI_API_KEY 없음 → 카메라 사진은 로컬 기준(선명도/밝기)으로만 판정됩니다. (.env 확인)');
    return;
  }
  try {
    const r = await fetch(
      `${cfg.baseUrl}/v1beta/models/${encodeURIComponent(cfg.model)}`,
      { headers: { 'x-goog-api-key': cfg.key }, signal: AbortSignal.timeout(10000) },
    );
    if (r.ok) console.log(`✔ Gemini 키/모델 확인 OK (model: ${cfg.model})`);
    else {
      const t = (await r.text()).slice(0, 200).replace(/\s+/g, ' ');
      console.log(`✖ Gemini 확인 실패 HTTP ${r.status}: ${t}`);
      console.log('  → 키 또는 .env 의 GEMINI_MODEL 을 확인하세요. 쓸 수 있는 모델 목록: npm run models');
    }
  } catch (e) {
    console.log(`✖ Gemini 에 연결하지 못했습니다: ${e.message}`);
  }
}

function start(options = {}) {
  loadEnv();
  const cfg = { ...getConfig(), ...(options.config || {}) };
  const state = { calls: [], planIdx: 0, textPlanIdx: 0 };
  const store = options.store || createStore();
  state.store = store;
  state.buyerRoutes = createBuyerRoutes({ store, listItem, readJson, sendJson });
  state.sellerRoutes = createSellerRoutes({
    cfg, state, store, readJson, sendJson, httpError,
    geminiJson: (opts) => geminiJson(cfg, state, opts),
  });
  const server = http.createServer((req, res) => {
    handle(req, res, cfg, state).catch((e) => {
      console.log(`✖ ${req.method} ${req.url.split('?')[0]} → ${e.status || 500}: ${e.message}`);
      if (res.headersSent) return res.end();
      sendJson(res, e.status || 500, { error: e.message || '서버 오류', ...(e.extra || {}) });
    });
  });
  // 터널(cloudflared)이 유휴 연결을 재사용할 때 502 가 나지 않도록 keep-alive 를 길게 잡습니다.
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 125000;
  return new Promise((resolve, reject) => {
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE') console.error(`포트 ${cfg.port} 가 이미 사용 중입니다. .env 에서 PORT 를 바꾸거나 기존 서버를 종료하세요.`);
      reject(e);
    });
    // Cloud Run(K_SERVICE 가 있음)에서는 외부 요청을 받아야 하므로 0.0.0.0, 노트북에서는 이 PC 안에서만
    server.listen(cfg.port, process.env.K_SERVICE ? '0.0.0.0' : '127.0.0.1', () => {
      console.log(`\n서버 실행 중: http://localhost:${cfg.port}/?t=${cfg.token}   (노트북에서 직접 열어 보기)`);
      console.log(`결과 저장 위치: ${store.kind === 'local' ? RESULTS_DIR : store.where}`);
      console.log(`구매자 추천: http://localhost:${cfg.port}/buyer`);
      console.log(`보증서 발급: http://localhost:${cfg.port}/seller?t=${cfg.token}   (저장소: ${store.where})`);
      checkGemini(cfg).finally(() => resolve({ server, cfg }));
    });
  });
}

module.exports = { start, loadEnv, getConfig };

if (require.main === module) {
  start().catch(() => process.exit(1));
}
