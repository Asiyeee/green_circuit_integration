'use strict';
// ② 시세 자료에 없는 기종·용량·상태 조합을 Gemini 로 추정합니다.
//  - price.lookup() 이 no_data 일 때만 씁니다 (needs_check·needs_input 은 입력이 더 필요한 경우라 추정 안 함).
//  - 근거는 같은 CSV 의 행뿐입니다: 같은 기종의 다른 용량·상태, 같은 제조사 다른 기종의 같은 용량·상태.
//    같은 제조사 행이 하나도 없으면 추정하지 않습니다 (근거 없는 숫자 방지).
//  - 결과는 status 'ok' + estimated: true + label_ko 'AI 추정 참고가' 로, 업체 시세와 구분해 표시합니다.

const fs = require('fs');
const path = require('path');
const price = require('./price.js');

const PROMPT_DIR = path.join(__dirname, '..', 'prompts');
const MAX_SAME_BRAND_ROWS = 60;
// ponytail: 서버 메모리 캐시(같은 조합은 다시 묻지 않음). 서버를 여러 대로 늘리면 저장소에 캐시
const cache = new Map();

function loadPrompt() {
  return {
    system: fs.readFileSync(path.join(PROMPT_DIR, 'price-estimate.system.md'), 'utf8'),
    schema: JSON.parse(fs.readFileSync(path.join(PROMPT_DIR, 'price-estimate.schema.json'), 'utf8')),
  };
}

const slim = (r) => ({ model: r.model, storage: r.storage, condition: r.conditionCode, minKrw: r.min, maxKrw: r.max, vendorCount: r.vendorCount });

function contextFor({ brand, modelKey, storage, conditionCode }) {
  const rows = price.allRows().filter((r) => r.brand === brand);
  return {
    sameModel: rows.filter((r) => r.modelKey === modelKey).map(slim),
    sameBrand: rows.filter((r) => r.modelKey !== modelKey && r.storage === storage && r.conditionCode === conditionCode).slice(0, MAX_SAME_BRAND_ROWS).map(slim),
  };
}

// Gemini 출력 검증: 정수·범위·상한(같은 기종 clean 최고가) 확인, 1,000원 단위
function normalize(o, ctx) {
  if (!o || o.possible !== true) return null;
  let min = Number(o.minKrw), max = Number(o.maxKrw);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return null;
  if (min > max) [min, max] = [max, min];
  const cleanMax = Math.max(0, ...ctx.sameModel.filter((r) => r.condition === 'clean').map((r) => r.maxKrw));
  if (cleanMax && max > cleanMax) max = cleanMax;
  if (max > 5000000) return null;
  min = Math.round(min / 1000) * 1000;
  max = Math.round(max / 1000) * 1000;
  if (min > max) min = max;
  return {
    minKrw: min,
    maxKrw: max,
    confidence: ['high', 'medium', 'low'].includes(o.confidence) ? o.confidence : 'low',
    basis_ko: typeof o.basis_ko === 'string' ? o.basis_ko.trim().slice(0, 160) : '',
  };
}

// looked: price.lookup() 결과 (status no_data) · input: { brand, model, storage, conditionCode, knownFault, faultDetail_ko }
async function estimate({ looked, input, geminiJson, model }) {
  if (!looked || looked.status !== 'no_data' || !geminiJson) return looked;
  const targetCode = price.appliedCode(input.conditionCode, input.knownFault);
  const key = [input.brand, looked.modelKey, input.storage, targetCode, input.faultDetail_ko || ''].join('|');
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const ctx = contextFor({ brand: input.brand, modelKey: looked.modelKey, storage: input.storage, conditionCode: targetCode });
      if (!ctx.sameModel.length && !ctx.sameBrand.length) return null;
      const cond = price.CONDITIONS.find((c) => c.code === targetCode) || {};
      const target = { brand: input.brand, model: input.model, storage: input.storage, conditionCode: targetCode, conditionLabel_ko: cond.label_ko, conditionHint_ko: cond.hint_ko, knownFault: input.knownFault, faultDetail_ko: input.faultDetail_ko || null };
      const { system, schema } = loadPrompt();
      const out = await geminiJson({ system, schema, text: `TARGET (JSON):\n${JSON.stringify(target)}\n\nSAME_MODEL_ROWS (JSON):\n${JSON.stringify(ctx.sameModel)}\n\nSAME_BRAND_ROWS (JSON):\n${JSON.stringify(ctx.sameBrand)}` });
      return normalize(out, ctx);
    })().catch((e) => { cache.delete(key); console.log(`  시세 AI 추정 실패 (${e.message})`); return null; }));
  }
  const est = await cache.get(key);
  if (!est) return looked;
  const cond = price.CONDITIONS.find((c) => c.code === targetCode) || {};
  return {
    ...looked,
    status: 'ok',
    estimated: true,
    by: 'gemini',
    model,
    minKrw: est.minKrw,
    maxKrw: est.maxKrw,
    singleAmount: est.minKrw === est.maxKrw,
    label_ko: 'AI 추정 참고가',
    confidence: est.confidence,
    basis_ko: est.basis_ko,
    conditionLabel: cond.label_ko,
    ...(targetCode !== input.conditionCode ? { appliedConditionCode: targetCode, reclassified_ko: `알려진 기능 고장이 있어 '파손 또는 기능 이상' 기준 (외관: ${(price.CONDITIONS.find((c) => c.code === input.conditionCode) || {}).label_ko || input.conditionCode})` } : {}),
    vendorCount: 0,
    quoteCount: 0,
    quotes: [],
    notice_ko: '시세 자료에 없는 조합이라 같은 기종·비슷한 기종의 업체 매입가를 바탕으로 AI가 추정한 값입니다. 실제 매입가와 다를 수 있습니다.',
  };
}

module.exports = { estimate, normalize, contextFor };

// 자체 점검: node part2_price_disposal/lib/price-estimate.js
if (require.main === module) {
  const assert = require('assert');
  const ctx = { sameModel: [{ condition: 'clean', maxKrw: 500000 }], sameBrand: [] };
  assert.deepStrictEqual(normalize({ possible: true, minKrw: 312345, maxKrw: 900000, confidence: 'zz', basis_ko: 'x' }, ctx), { minKrw: 312000, maxKrw: 500000, confidence: 'low', basis_ko: 'x' }, '상한·반올림');
  assert.strictEqual(normalize({ possible: false, minKrw: 1, maxKrw: 2 }, ctx), null);
  assert.strictEqual(normalize({ possible: true, minKrw: null, maxKrw: 2 }, ctx), null);
  const c = contextFor({ brand: 'Apple', modelKey: 'iphone16pro', storage: '256GB', conditionCode: 'clean' });
  assert.ok(c.sameModel.length > 0 && c.sameBrand.length > 0, '근거 행');
  assert.strictEqual(contextFor({ brand: 'Google', modelKey: 'pixel8', storage: '128GB', conditionCode: 'clean' }).sameBrand.length, 0, '근거 없는 제조사');
  (async () => {
    const looked = { status: 'no_data', modelKey: 'pixel8' };
    let called = false;
    const r = await estimate({ looked, input: { brand: 'Google', model: 'Pixel 8', storage: '128GB', conditionCode: 'clean', knownFault: 'none' }, geminiJson: async () => { called = true; return {}; } });
    assert.strictEqual(r.status, 'no_data'); assert.strictEqual(called, false, '근거 없으면 Gemini 안 부름');
    console.log('price-estimate.js OK');
  })();
}
