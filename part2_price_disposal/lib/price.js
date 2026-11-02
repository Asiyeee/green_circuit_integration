'use strict';
// 중고폰 시세 조회 (data/중고폰_시세_통합.csv)
// 규칙은 data/스마트폰_처리_매뉴얼.md 의 '개발 연결 규격'을 따릅니다.
//  - 조회 키: brand + model_key + storage + condition_code 정확히 일치
//  - 없으면 가격을 추정하지 않고 no_data (0원 반환 금지, 다른 용량·상태로 대체 금지)
//  - requires_no_known_function_fault=true 인 상태는 '알려진 기능 이상 없음'일 때만 조회

const fs = require('fs');
const path = require('path');

const csvPath = () => path.resolve(process.env.PRICE_CSV_PATH || path.join(__dirname, '..', 'data', '중고폰_시세_통합.csv'));

const CONDITIONS = [
  { code: 'clean', label_ko: '흠집·파손·잔상 없음', hint_ko: '외관이 깨끗하고 파손·잔상이 없음' },
  { code: 'minor_wear', label_ko: '생활 흠집', hint_ko: '미세한 흠집·작은 사용감, 파손·잔상 없음' },
  { code: 'visible_wear', label_ko: '뚜렷한 흠집·찍힘', hint_ko: '눈에 띄는 흠집이나 찍힘, 파손·잔상 없음' },
  { code: 'burn_in', label_ko: '잔상 있음', hint_ko: '화면은 표시되지만 잔상이 있음' },
  { code: 'rear_damage', label_ko: '후면 파손', hint_ko: '뒷면 유리가 깨짐' },
  { code: 'display_fault', label_ko: '화면 표시 불량', hint_ko: '화면이 정상적으로 표시되지 않음' },
  { code: 'damage_or_fault', label_ko: '파손 또는 기능 이상', hint_ko: '유리 파손이나 알려진 기능 이상이 섞인 상태' },
];

// 매뉴얼의 model_key 규칙: 소문자, 공백·괄호·점·가운뎃점·하이픈 제거, Plus/+ → plus, SE (2세대) → se2
function modelKey(model) {
  return String(model || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/se\s*\(\s*2세대\s*\)/g, 'se2')
    .replace(/se\s*\(\s*3세대\s*\)/g, 'se3')
    .replace(/\+/g, 'plus')
    .replace(/[\s().·\-]/g, '');
}

// 쉼표·따옴표·줄바꿈을 처리하는 CSV 파서 (RFC 4180)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

let cache = null;
let externalWarning = null;
function load() {
  const CSV_PATH = csvPath();
  const stat = fs.statSync(CSV_PATH);
  const signature = `${CSV_PATH}|${stat.mtimeMs}|${stat.size}|${stat.ctimeMs}`;
  if (cache?.signature === signature) return cache;
  const text = fs.readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
  // atomic rename 후 변경을 감지해 검증된 새 스냅샷만 사용. 잘못된 파일은 마지막 정상 캐시 보존.
  const errors = require('../scripts/price-refresh').validate(text).errors;
  if (errors.length) {
    if (cache) { cache.warning = '갱신 파일 검증 실패. 마지막 정상 시세 자료를 사용합니다.'; return cache; }
    throw new Error('시세 자료 검증 실패: ' + errors.slice(0, 3).join('; '));
  }
  const [header, ...lines] = parseCsv(text);
  const index = new Map();
  const models = new Map(); // brand|model_key → { brand, model, storages:Set }
  for (const line of lines) {
    const r = Object.fromEntries(header.map((h, i) => [h, line[i]]));
    const row = {
      referenceId: r.reference_id,
      brand: r.brand,
      model: r.model,
      modelKey: r.model_key,
      storage: r.storage,
      conditionCode: r.condition_code,
      conditionLabel: r.condition_label_ko,
      conditionDescription: r.condition_description_ko,
      requiresNoKnownFault: r.requires_no_known_function_fault === 'true',
      min: Number(r.reference_min_krw),
      max: Number(r.reference_max_krw),
      vendorCount: Number(r.vendor_count),
      quoteCount: Number(r.quote_count),
      kind: r.reference_kind,
      checkedOn: r.checked_on,
      notice: r.notice_ko,
      quotes: JSON.parse(r.source_quotes_json || '[]'),
    };
    index.set([row.brand, row.modelKey, row.storage, row.conditionCode].join('|'), row);
    const mk = `${row.brand}|${row.modelKey}`;
    if (!models.has(mk)) models.set(mk, { brand: row.brand, model: row.model, storages: new Set(), conditions: new Set() });
    models.get(mk).storages.add(row.storage);
    models.get(mk).conditions.add(row.conditionCode);
  }
  cache = { index, models, signature, warning: null, loadedAt: new Date().toISOString() };
  return cache;
}

const storageOrder = (s) => (/TB$/.test(s) ? parseFloat(s) * 1024 : parseFloat(s));

// 시세 입력 화면용: 이 기종에 CSV 행이 있는 용량·상태 목록
function options(brand, model) {
  const m = load().models.get(`${brand}|${modelKey(model)}`);
  if (!m) return { found: false, modelKey: modelKey(model), storages: [], conditions: CONDITIONS };
  return {
    found: true,
    modelKey: modelKey(model),
    storages: [...m.storages].sort((a, b) => storageOrder(a) - storageOrder(b)),
    conditions: CONDITIONS.map((c) => ({ ...c, available: m.conditions.has(c.code) })),
  };
}

// knownFault: 'none' | 'yes' | 'unknown'
function lookup({ brand, model, storage, conditionCode, knownFault }) {
  const data = load();
  const base = { brand, model, modelKey: modelKey(model), storage, conditionCode, knownFault, dataWarning: externalWarning || data.warning };
  if (!storage || storage === 'unknown') {
    return { ...base, status: 'needs_input', message_ko: '저장 용량 미확인. 시세 추정 안 함' };
  }
  const row = data.index.get([brand, base.modelKey, storage, conditionCode].join('|'));
  if (!row) return { ...base, status: 'no_data', message_ko: '해당 조건의 시세 정보 없음' };
  if (row.requiresNoKnownFault && knownFault !== 'none') {
    return {
      ...base,
      status: 'needs_check',
      message_ko: knownFault === 'yes'
        ? "알려진 고장 있음. '파손 또는 기능 이상' 상태로만 시세 조회 가능"
        : '고장 여부 미확인. 상태별 시세 미확정',
    };
  }
  const single = row.vendorCount === 1;
  const collected = row.quotes.map(q => q.collected_at).filter(Boolean).sort();
  const latestCollectedAt = collected.at(-1) || null;
  const kstDay = stamp => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(stamp));
  return {
    ...base,
    status: 'ok',
    referenceId: row.referenceId,
    displayModel: row.model,
    conditionLabel: row.conditionLabel,
    conditionDescription: row.conditionDescription,
    minKrw: row.min,
    maxKrw: row.max,
    label_ko: single ? '단일 업체 참고가' : '업체 매입 참고 범위',
    singleAmount: row.min === row.max,
    vendorCount: row.vendorCount,
    quoteCount: row.quoteCount,
    checkedOn: row.checkedOn,
    notice_ko: row.notice,
    latestCollectedAt,
    partiallyRefreshed: row.quotes.some(q => !q.collected_at || kstDay(q.collected_at) !== kstDay(latestCollectedAt)),
    quotes: row.quotes.map((q) => ({
      vendor: q.vendor_name,
      grade: q.grade,
      minKrw: q.min_krw,
      maxKrw: q.max_krw,
      conditions_ko: q.conditions_ko,
      priceDate: q.price_date || null,
      priceDateSource: q.price_date_source || null,
      conditionSourceUrl: q.condition_source_url || null,
      verificationMethod: q.verification_method || null,
      collectedAt: q.collected_at || null,
      sourceConditions_ko: q.source_conditions_ko || null,
      sourceModel: q.source_model || row.model,
      sourceGrade: q.source_grade || q.grade,
      evidenceSha256: q.source_evidence_sha256 || null,
      url: q.source_url,
    })),
  };
}

function datasetInfo() { const data = load(); return { rows: data.index.size, loadedAt: data.loadedAt, dataWarning: externalWarning || data.warning, mode: 'collected_csv_snapshot', automaticFetchOnQuote: false }; }
const setExternalWarning = warning => { externalWarning = warning || null; };
module.exports = { CONDITIONS, modelKey, parseCsv, options, lookup, datasetInfo, setExternalWarning };
