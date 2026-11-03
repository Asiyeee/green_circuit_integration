'use strict';
// 별도 Gemini Google Search grounding 경로. 사진 분석/보증서 요약과 다른 호출.
// 모델의 금액은 후보 주장일 뿐. 인용 출처를 다시 수집한 표와 정확히 일치해야 채택.
const fs = require('node:fs'), path = require('node:path');
const { modelKey } = require('./price');
const { allowedUrl, canonicalUrl, fetchDocument, CONTRACTS } = require('./price-collection');
const { parseHtml, gradeKey } = require('./price-sources');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const VENDOR_HOSTS = { 'phonesam.com': 'phonesam', 'retemz.com': 'retemz', 'rediva.ai': 'rediva', 'kspeinc.com': 'kspe', 'moa.must-pick.com': 'moa', 'uzphone.co.kr': 'uzphone', 'mintit.co.kr': 'mintit' };
async function resolveCitation(uri, fetcher) {
  let u = new URL(uri);
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('인용 URL 형식 오류');
  if (u.hostname === 'vertexaisearch.cloud.google.com' && u.pathname.startsWith('/grounding-api-redirect/')) {
    const r = await fetcher(u.href, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (![301, 302, 303, 307, 308].includes(r.status)) throw new Error('Google 인용 리다이렉트 확인 불가');
    u = new URL(r.headers.get('location'), u);
  }
  return allowedUrl(u.href).href;
}
async function verifyClaims({ claims, query, groundedUrls, loadSource }) {
  const verified = [], rejected = [];
  for (const claim of claims.slice(0, 10)) {
    try {
      const sourceUrl = allowedUrl(claim.sourceUrl).href;
      if (!groundedUrls.has(canonicalUrl(sourceUrl))) throw new Error('검색 근거에 없는 출처');
      const vendor = VENDOR_HOSTS[new URL(sourceUrl).hostname.replace(/^www\./, '')];
      if (claim.vendor !== vendor || claim.brand !== query.brand || modelKey(claim.model) !== modelKey(query.model) || claim.storage !== query.storage || gradeKey(claim.grade, vendor) !== gradeKey(query.grade, vendor)) throw new Error('검색 후보의 업체·기종·용량·등급 불일치');
      const offers = await loadSource(vendor, sourceUrl);
      const hits = offers.filter(o => o.eligible && o.brand === query.brand && o.modelKey === modelKey(query.model) && o.storage === query.storage && gradeKey(o.grade, vendor) === gradeKey(query.grade, vendor));
      if (new Set(hits.map(o => JSON.stringify([o.minKrw, o.maxKrw, o.conditionSignature]))).size !== 1) throw new Error('출처의 정확한 가격 없음 또는 충돌');
      const raw = hits[0];
      if (claim.minKrw !== raw.minKrw || claim.maxKrw !== raw.maxKrw) throw new Error('Gemini 금액과 실제 출처 표 불일치');
      if (!CONTRACTS.vendors[vendor]?.acceptedConditionSignatures.includes(raw.conditionSignature)) throw new Error('기존 서비스 분류와 대조하지 않은 조건');
      verified.push(raw); // 반드시 실제 표에서 읽은 객체. 모델 객체를 가격표에 전달하지 않음.
    } catch (e) { rejected.push({ sourceUrl: typeof claim.sourceUrl === 'string' ? claim.sourceUrl : null, reason: e.message }); }
  }
  return { verified, rejected };
}
async function searchPrices({ cfg, query, dir, fetcher = fetch, sourceLoader } = {}) {
  if (!cfg?.key) fail(503, 'GEMINI_API_KEY 없음. 시세 검색 실제 호출은 실행하지 않았습니다. CSV·수동 입력은 계속 사용할 수 있습니다.');
  if (!['Apple', 'Samsung'].includes(query?.brand) || typeof query.model !== 'string' || !query.model.trim() || query.model.length > 100 || !/^(?:\d+GB|[12]TB)$/.test(query.storage || '') || typeof query.grade !== 'string' || query.grade.length > 40) fail(400, '제조사·정확한 기종·저장 용량·업체 원래 등급이 필요합니다');
  const model = process.env.GEMINI_SEARCH_MODEL || 'gemini-2.5-flash';
  const prompt = `Find public Korean vendor buyback reference tables for exactly this device/grade: ${JSON.stringify(query)}. Search the web. Use only phonesam.com, retemz.com, rediva.ai, kspeinc.com, moa.must-pick.com, uzphone.co.kr, mintit.co.kr. Never substitute another model, storage or grade; no private-sale prices. Do not infer missing numbers. Cite sources. Then include a JSON code block with {"offers":[{"vendor":"phonesam|retemz|rediva|kspe|moa|uzphone|mintit","brand":"Apple|Samsung","model":"exact requested model","storage":"exact requested storage","grade":"exact requested grade","minKrw":integer,"maxKrw":integer,"sourceUrl":"original vendor URL"}]}. Empty offers if unverified. Values will be checked by fetching original sources independently.`;
  const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key }, signal: AbortSignal.timeout(60000),
    // responseMimeType/responseSchema를 함께 강제하지 않음. 실제 grounding 메타데이터를 필수 검사.
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.1 } }),
  }).catch(() => fail(502, 'Gemini 검색 연결 실패. 기존 시세 자료를 유지합니다'));
  if (!response.ok) fail(response.status === 429 ? 429 : 502, 'Gemini 검색 HTTP ' + response.status + '. 기존 시세 자료를 유지합니다');
  let raw; try { raw = await response.json(); } catch { fail(502, 'Gemini 검색 JSON 응답 해석 실패'); }
  const candidate = raw.candidates?.[0], metadata = candidate?.groundingMetadata;
  if (!metadata?.webSearchQueries?.length || !metadata?.groundingChunks?.length || !metadata?.groundingSupports?.length) fail(502, '실제 검색 근거/인용 메타데이터 없음. 모델 기억의 숫자를 채택하지 않습니다');
  const answer = (candidate.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
  const block = answer.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let claims; try { claims = JSON.parse(block?.[1] || answer).offers; } catch { fail(502, '검색 후보 형식 해석 실패'); }
  if (!Array.isArray(claims)) fail(502, '검색 후보 배열 없음');
  const cited = new Set(metadata.groundingSupports.flatMap(s => s.groundingChunkIndices || [])), groundedUrls = new Set(), citationErrors = [];
  for (const index of cited) {
    const uri = metadata.groundingChunks[index]?.web?.uri;
    if (!uri) continue;
    try { groundedUrls.add(canonicalUrl(await resolveCitation(uri, fetcher))); } catch (e) { citationErrors.push({ uri, reason: e.message }); }
  }
  const evidence = [];
  const loadSource = sourceLoader || (async (vendor, sourceUrl) => {
    if (vendor === 'mintit') throw new Error('민팃은 전용 공개 API 수집 경로에서만 검증. 검색 HTML의 숫자 추출 금지');
    const doc = await fetchDocument(sourceUrl, { fetcher });
    const policyUrl = ({ rediva: 'https://rediva.ai/sell/policy', moa: 'https://moa.must-pick.com/grade' })[vendor];
    const policy = policyUrl ? await fetchDocument(policyUrl, { fetcher }) : doc;
    const parsed = parseHtml(vendor, doc.text, { url: sourceUrl, conditionHtml: policy.text, conditionUrl: policy.url });
    if (dir) {
      fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
      for (const d of [doc, policy]) { const file = 'evidence/' + d.sha256 + '.html'; fs.writeFileSync(path.join(dir, file), d.text); evidence.push({ ...d, text: undefined, file }); }
    }
    return parsed.offers.map(({ conditionDocument, ...o }) => ({ ...o, fetchedAt: doc.fetchedAt, responseSha256: doc.sha256, conditionResponseSha256: policy.sha256, parserVersion: 'public-vendor-table/v1', evidenceFile: 'evidence/' + doc.sha256 + '.html', conditionEvidenceFile: 'evidence/' + policy.sha256 + '.html' }));
  });
  const verified = await verifyClaims({ claims, query, groundedUrls, loadSource });
  const result = { schema: 'grounded-price-search/v1', by: 'gemini_google_search', model, searchedAt: new Date().toISOString(), query, answer, grounding: metadata, ...verified, citationErrors, evidence, note_ko: '검색 후보 금액이 아닌 실제 업체 표와 일치한 원자료만 검증됨. 개인 간 판매가·실제 검수 매입가 보장 아님' };
  if (dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'gemini-search.json'), JSON.stringify(result, null, 2)); }
  return result;
}
module.exports = { searchPrices, verifyClaims, resolveCitation };
