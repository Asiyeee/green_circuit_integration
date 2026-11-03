'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv } = require('./price');
const { validate, assertPreservesExisting, sha } = require('../scripts/price-refresh');
const { parseHtml, parseMintit, gradeKey } = require('./price-sources');
const CONTRACTS = require('../data/source-contracts.json');
const VENDORS = ['phonesam', 'retemz', 'rediva', 'kspe', 'moa', 'uzphone', 'mintit'];
const HOSTS = new Set(['phonesam.com', 'retemz.com', 'rediva.ai', 'kspeinc.com', 'moa.must-pick.com', 'uzphone.co.kr', 'mintit.co.kr']);
const DEFAULT_CSV = path.resolve(__dirname, '../data/중고폰_시세_통합.csv');
const canonicalUrl = s => { const u = new URL(s); u.hostname = u.hostname.replace(/^www\./, ''); u.hash = ''; return u.href; };
function allowedUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !HOSTS.has(u.hostname.replace(/^www\./, ''))) throw new Error('허용하지 않은 공개 출처 URL');
  return u;
}
function readCsv(text) {
  const [headers, ...data] = parseCsv(text.replace(/^\uFEFF/, ''));
  return { headers, rows: data.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]]))) };
}
function writeCsv(headers, rows) {
  return '\uFEFF' + [headers, ...rows.map(r => headers.map(h => r[h]))].map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n') + '\r\n';
}
async function fetchDocument(url, { method = 'GET', body, fetcher = fetch, timeoutMs = 20000 } = {}) {
  let target = allowedUrl(url).href;
  for (let redirect = 0; redirect < 4; redirect++) {
    const response = await fetcher(target, { method, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'text/html,application/json', 'User-Agent': 'GreenCircuit-PriceReference/1.0 (public reference collector)', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if ([301, 302, 303, 307, 308].includes(response.status)) { target = allowedUrl(new URL(response.headers.get('location'), target).href).href; continue; }
    if (!response.ok) throw new Error('공개 출처 HTTP ' + response.status);
    if (Number(response.headers.get('content-length')) > 4 * 1024 * 1024) throw new Error('출처 문서 크기 초과');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 4 * 1024 * 1024) throw new Error('출처 문서 크기 초과'); chunks.push(Buffer.from(chunk)); }
    const bytes = Buffer.concat(chunks);
    return { url, finalUrl: target, fetchedAt: new Date().toISOString(), status: response.status, contentType: response.headers.get('content-type') || '', sha256: sha(bytes), text: bytes.toString('utf8') };
  }
  throw new Error('출처 리다이렉트 과다');
}
function targetsFor(rows, selected = VENDORS, limit = Infinity, modelKeys = []) {
  const sources = new Map();
  for (const row of rows) for (const quote of JSON.parse(row.source_quotes_json)) {
    if (!selected.includes(quote.vendor)) continue;
    const key = quote.vendor + '|' + canonicalUrl(quote.source_url);
    if (!sources.has(key)) sources.set(key, { vendor: quote.vendor, url: quote.source_url, expectedModels: new Set() });
    sources.get(key).expectedModels.add(row.brand + '|' + row.model_key);
  }
  const counts = {};
  return [...sources.values()].filter(s => !modelKeys.length || [...s.expectedModels].some(m => modelKeys.includes(m.split('|')[1]))).filter(s => (counts[s.vendor] = (counts[s.vendor] || 0) + 1) <= limit);
}
async function collect({ rows, dir, vendors = VENDORS, limit = Infinity, modelKeys = [], delayMs = 400, fetcher, onProgress = () => {} }) {
  if (vendors.some(v => !VENDORS.includes(v))) throw new Error('알 수 없는 수집 업체');
  fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
  const targets = targetsFor(rows, vendors, limit, modelKeys), offers = [], documents = [], issues = [], stats = {};
  if (!targets.length) throw new Error('선택한 제조사/모델에 정확히 연결된 기존 공개 출처가 없습니다');
  async function document(url, options) {
    const doc = await fetchDocument(url, { fetcher, ...options });
    const ext = doc.contentType.includes('json') ? '.json' : '.html';
    doc.file = 'evidence/' + sha(url).slice(0, 12) + '-' + doc.sha256.slice(0, 12) + ext;
    fs.writeFileSync(path.join(dir, doc.file), doc.text);
    const { text, ...meta } = doc; documents.push(meta);
    return doc;
  }
  // 업체별 한 요청씩. 서로 다른 업체만 동시에 수집하며 재시도 폭주를 하지 않음.
  await Promise.all(vendors.map(async vendor => {
    stats[vendor] = { targets: targets.filter(t => t.vendor === vendor).length, fetched: 0, parsed: 0, eligibleOffers: 0, rejectedOffers: 0, errors: 0 };
    let policy, failures = 0;
    if (['rediva', 'moa', 'mintit'].includes(vendor)) {
      try { policy = await document(({ rediva: 'https://rediva.ai/sell/policy', moa: 'https://moa.must-pick.com/grade', mintit: 'https://mintit.co.kr/rest/api/sale/grade-standard/list' })[vendor]); }
      catch (e) { issues.push({ vendor, reason: '등급 조건 출처 실패: ' + e.message }); stats[vendor].errors++; return; }
    }
    for (const target of targets.filter(t => t.vendor === vendor)) {
      if (failures >= 3) { issues.push({ vendor, url: target.url, reason: '연속 실패 3회로 나머지 요청 중단' }); stats[vendor].errors++; continue; }
      try {
        let doc, parsed;
        if (vendor === 'mintit') {
          const code = new URL(target.url).searchParams.get('petname');
          if (!/^[A-Za-z0-9_-]+$/.test(code || '')) throw new Error('민팃 모델 코드 미확인');
          doc = await document('https://mintit.co.kr/rest/api/sale/est/v1/price/rslt', { method: 'POST', body: { petname: code } });
          stats[vendor].fetched++;
          parsed = parseMintit(JSON.parse(doc.text), JSON.parse(policy.text), { url: target.url, conditionUrl: policy.url, modelCode: code });
        } else {
          doc = await document(target.url);
          stats[vendor].fetched++;
          parsed = parseHtml(vendor, doc.text, { url: target.url, conditionHtml: policy?.text || doc.text, conditionUrl: policy?.url || target.url });
        }
        stats[vendor].parsed++;
        for (const reason of parsed.warnings || []) issues.push({ vendor, url: target.url, reason });
        const accepted = CONTRACTS.vendors[vendor]?.acceptedConditionSignatures.includes(parsed.conditionSignature);
        for (const raw of parsed.offers) {
          const modelMatches = target.expectedModels.has(raw.brand + '|' + raw.modelKey) && (!modelKeys.length || modelKeys.includes(raw.modelKey));
          const eligible = raw.eligible && !!accepted && modelMatches;
          const { conditionDocument, ...fields } = raw;
          const offer = { ...fields, eligible, rejection: raw.rejection || (!accepted ? '기존 분류와 대조한 등급 조건 계약 불일치/미검토' : !modelMatches ? '기존 출처의 정확한 기종과 미일치' : null), fetchedAt: doc.fetchedAt, responseSha256: doc.sha256, evidenceFile: doc.file, conditionResponseSha256: (policy || doc).sha256, conditionEvidenceFile: (policy || doc).file, parserVersion: 'public-vendor-table/v1.1' };
          offers.push(offer); stats[vendor][eligible ? 'eligibleOffers' : 'rejectedOffers']++;
        }
        if (!accepted) issues.push({ vendor, url: target.url, reason: '등급 조건 변경/미검토. 원자료만 저장하고 참고가 반영 금지', conditionSignature: parsed.conditionSignature });
        failures = 0;
      } catch (e) { failures++; stats[vendor].errors++; issues.push({ vendor, url: target.url, reason: e.message }); }
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      onProgress({ vendor, ...stats[vendor] });
    }
  }));
  return { schema: 'vendor-price-collection/v1', collectedAt: new Date().toISOString(), mappingVersion: CONTRACTS.mappingVersion, contractsSha256: sha(JSON.stringify(CONTRACTS)), stats, documents, issues, offers };
}
const offerKey = o => [o.vendor, o.brand, o.modelKey, o.storage, gradeKey(o.grade, o.vendor)].join('|');
function mergeCollection(baseText, collection) {
  const errors = validate(baseText).errors; if (errors.length) throw new Error('기존 자료 검증 실패: ' + errors.join('; '));
  if (collection.schema !== 'vendor-price-collection/v1' || collection.mappingVersion !== CONTRACTS.mappingVersion) throw new Error('원자료/분류 버전 불일치');
  const { headers, rows } = readCsv(baseText), grouped = new Map(), conflicts = [], changes = [];
  // 실패·누락 기록도 충돌 판정에 포함. 검증 실패한 같은 원자료를 정상 것으로 덮지 않음.
  for (const offer of collection.offers) {
    const key = offerKey(offer); if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(offer);
  }
  const blocked = new Set();
  for (const [key, group] of grouped) {
    const variants = new Set(group.map(o => JSON.stringify([o.minKrw, o.maxKrw, o.conditionSignature, o.eligible])));
    if (variants.size > 1) { blocked.add(key); conflicts.push({ key, reason: '동일 업체·모델·용량·등급의 출처 충돌' }); }
  }
  let updatedQuotes = 0, unchangedQuotes = 0, priceChanges = 0;
  for (const row of rows) {
    const old = JSON.parse(row.source_quotes_json); let refreshed = 0;
    const quotes = old.map(q => {
      const key = offerKey({ vendor: q.vendor, brand: row.brand, modelKey: row.model_key, storage: row.storage, grade: q.grade });
      const raw = !blocked.has(key) && grouped.get(key)?.find(o => o.eligible && canonicalUrl(o.sourceUrl) === canonicalUrl(q.source_url));
      if (!raw) { unchangedQuotes++; return q; }
      if (!CONTRACTS.vendors[raw.vendor]?.acceptedConditionSignatures.includes(raw.conditionSignature)) throw new Error('조건 계약과 맞지 않는 정상 원자료');
      if (![raw.minKrw, raw.maxKrw].every(n => Number.isSafeInteger(n) && n > 0) || raw.minKrw > raw.maxKrw) throw new Error('정상 원자료 금액 오류');
      refreshed++; updatedQuotes++;
      if (q.min_krw !== raw.minKrw || q.max_krw !== raw.maxKrw) priceChanges++;
      const next = { ...q, min_krw: raw.minKrw, max_krw: raw.maxKrw, price_date: raw.priceDate || '', price_date_source: raw.priceDateText, condition_source_url: raw.conditionSourceUrl, verification_method: 'official_http_table/v1', collected_at: raw.fetchedAt, source_model: raw.sourceModel, source_grade: raw.grade, source_amount_text: raw.rawAmount, source_conditions_ko: raw.conditionsText, source_evidence_sha256: raw.responseSha256, condition_evidence_sha256: raw.conditionResponseSha256, condition_contract_sha256: raw.conditionSignature, parser_version: raw.parserVersion };
      changes.push({ referenceId: row.reference_id, vendor: q.vendor, model: row.model, storage: row.storage, condition: row.condition_code, grade: q.grade, oldMin: q.min_krw, oldMax: q.max_krw, newMin: next.min_krw, newMax: next.max_krw, sourceUrl: raw.sourceUrl, evidenceFile: raw.evidenceFile, conditionEvidenceFile: raw.conditionEvidenceFile });
      return next;
    });
    // 행·원래 등급 매핑·업체 수를 유지하며 검증된 기존 견적만 치환. 추가/삭제/분류 추정 금지.
    if (refreshed) {
      row.source_quotes_json = JSON.stringify(quotes);
      row.reference_min_krw = String(Math.min(...quotes.map(q => q.min_krw)));
      row.reference_max_krw = String(Math.max(...quotes.map(q => q.max_krw)));
      if (refreshed === quotes.length) row.checked_on = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(collection.collectedAt));
    }
  }
  const text = writeCsv(headers, rows), validation = validate(text);
  if (validation.errors.length || validation.rows.length !== rows.length) throw new Error('재집계 검증 실패: ' + validation.errors.join('; '));
  assertPreservesExisting(readCsv(baseText).rows, validation.rows);
  return { text, rows: rows.length, updatedQuotes, unchangedQuotes, priceChanges, conflicts, changes, baseSha256: sha(baseText), candidateSha256: sha(text) };
}
function publish({ live, baseBytes, candidate, receipt, dir }) {
  const lock = live + '.lock', fd = fs.openSync(lock, 'wx');
  try {
    if (sha(fs.readFileSync(live)) !== sha(baseBytes)) throw new Error('수집 중 기존 시세 변경 감지. 덮어쓰지 않음');
    const backup = path.join(dir, 'before.csv'); fs.writeFileSync(backup, baseBytes, { flag: 'wx' });
    fs.writeFileSync(path.join(dir, 'publish-receipt.json'), JSON.stringify(receipt, null, 2));
    fs.writeFileSync(live + '.next', candidate); fs.renameSync(live + '.next', live);
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
module.exports = { DEFAULT_CSV, VENDORS, HOSTS, CONTRACTS, canonicalUrl, allowedUrl, readCsv, writeCsv, targetsFor, fetchDocument, collect, offerKey, mergeCollection, publish };
