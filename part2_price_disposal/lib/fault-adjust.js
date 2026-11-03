'use strict';
// ② 알려진 기능 고장 차감: '기능 정상' 기준 시세에서 판매자가 적은 그 고장만큼만 Gemini 가 판단해 뺍니다.
//  기준 시세 = 고른 외관 상태 그대로의 시세 (CSV, 없으면 price-estimate 의 AI 추정)
//  최종     = 기준 − 차감 (차감은 그 부품의 국내 수리비 수준이 기준, 같은 기종 파손·고장 실제 시세를 참고로 줌)
//  고장 내용이 없거나 Gemini 가 고장으로 이해하지 못하면 null → 기존 '파손 또는 기능 이상' 분류 시세를 씁니다.

const fs = require('fs');
const path = require('path');
const price = require('./price.js');

const PROMPT_DIR = path.join(__dirname, '..', 'prompts');
const MIN_RESULT_KRW = 1000;
// ponytail: 서버 메모리 캐시. 서버를 여러 대로 늘리면 저장소에 캐시
const cache = new Map();

function loadPrompt() {
  return {
    system: fs.readFileSync(path.join(PROMPT_DIR, 'fault-deduction.system.md'), 'utf8'),
    schema: JSON.parse(fs.readFileSync(path.join(PROMPT_DIR, 'fault-deduction.schema.json'), 'utf8')),
  };
}

const round1000 = (n) => Math.round(n / 1000) * 1000;

// Gemini 출력 검증 + 최종 범위 계산
function apply(base, o) {
  if (!o || o.understood !== true) return null;
  let dMin = o.deductionMinKrw, dMax = o.deductionMaxKrw;
  if (!Number.isSafeInteger(dMin) || !Number.isSafeInteger(dMax) || dMin < 0 || dMax < 0 || typeof o.basis_ko !== 'string' || !o.basis_ko.trim() || typeof o.faultLabel_ko !== 'string' || !o.faultLabel_ko.trim()) return null;
  if (dMin > dMax) [dMin, dMax] = [dMax, dMin];
  dMin = Math.min(round1000(dMin), base.maxKrw);
  dMax = Math.min(round1000(dMax), base.maxKrw);
  // 기준 범위의 아래쪽엔 큰 차감, 위쪽엔 작은 차감
  const min = Math.max(MIN_RESULT_KRW, base.minKrw - dMax);
  const max = Math.max(min, base.maxKrw - dMin);
  return {
    minKrw: min,
    maxKrw: max,
    deduction: {
      minKrw: dMin,
      maxKrw: dMax,
      faultLabel_ko: typeof o.faultLabel_ko === 'string' ? o.faultLabel_ko.trim().slice(0, 40) : '',
      severity: ['minor', 'moderate', 'severe'].includes(o.severity) ? o.severity : 'moderate',
      confidence: ['high', 'medium', 'low'].includes(o.confidence) ? o.confidence : 'low',
      basis_ko: typeof o.basis_ko === 'string' ? o.basis_ko.trim().slice(0, 160) : '',
    },
  };
}

// base: 기능 정상 기준 시세 (status ok) · input: { brand, model, storage, conditionCode, faultDetail_ko }
async function adjust({ base, input, geminiJson, model }) {
  if (!base || base.status !== 'ok' || base.faultAdjusted || base.appliedConditionCode || !['clean', 'minor_wear', 'visible_wear'].includes(input.conditionCode) || base.conditionCode && base.conditionCode !== input.conditionCode || !input.faultDetail_ko || !geminiJson) return null;
  const revision = price.datasetInfo().revision;
  if (base.datasetRevision && base.datasetRevision !== revision) return null;
  const prompt = loadPrompt();
  const promptHash = require('crypto').createHash('sha256').update(JSON.stringify(prompt)).digest('hex');
  const key = JSON.stringify([revision, promptHash, model, input.brand, base.modelKey, input.storage, input.conditionCode, base.estimated, base.minKrw, base.maxKrw, input.faultDetail_ko]);
  if (cache.size > 200) cache.clear();
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const damaged = price.allRows()
        .filter((r) => r.brand === input.brand && r.modelKey === base.modelKey && ['damage_or_fault', 'display_fault'].includes(r.conditionCode))
        .map((r) => ({ storage: r.storage, condition: r.conditionCode, minKrw: r.min, maxKrw: r.max }));
      const cond = price.CONDITIONS.find((c) => c.code === input.conditionCode) || {};
      const device = { brand: input.brand, model: input.model, storage: input.storage, exterior_ko: cond.label_ko || input.conditionCode };
      const basePrice = { minKrw: base.minKrw, maxKrw: base.maxKrw, source: base.estimated ? 'ai_estimate' : 'shop_data' };
      const { system, schema } = prompt;
      const out = await geminiJson({ system, schema, text: `DEVICE (JSON):\n${JSON.stringify(device)}\n\nBASE_PRICE (JSON):\n${JSON.stringify(basePrice)}\n\nFAULT_DETAIL_KO:\n${input.faultDetail_ko}\n\nDAMAGED_REFERENCE_ROWS (JSON):\n${JSON.stringify(damaged)}` });
      return apply(base, out);
    })().catch((e) => { cache.delete(key); console.log(`  고장 차감 AI 실패 (${e.message})`); return null; }));
  }
  const r = await cache.get(key);
  if (!r) { cache.delete(key); return null; }
  if (price.datasetInfo().revision !== revision) { cache.delete(key); return null; }
  return {
    ...base,
    minKrw: r.minKrw,
    maxKrw: r.maxKrw,
    singleAmount: r.minKrw === r.maxKrw,
    faultAdjusted: true,
    sourceKind: 'ai_fault_adjusted',
    datasetRevision: revision,
    sellerFaultDetail_ko: input.faultDetail_ko,
    adjustedAt: new Date().toISOString(),
    basePrice: { minKrw: base.minKrw, maxKrw: base.maxKrw, label_ko: base.label_ko, estimated: !!base.estimated, conditionCode: base.conditionCode, referenceId: base.referenceId || null },
    deduction: r.deduction,
    label_ko: base.estimated ? 'AI 추정가에 AI 감가 반영한 참고가' : '업체 원문 참고가에 AI 감가 반영한 참고가',
    by: 'gemini',
    model: input.model,
    aiModel: model || null,
    notice_ko: `기능 정상 전제 ${base.estimated ? 'AI 추정가 (해당 조건 업체 자료 없음)' : '업체 원문 참고가'}에서 판매자의 고장 설명을 AI가 해석해 감가한 추정 참고가입니다. AI의 직접 기기 진단·검증된 수리비·업체 확인 가격이 아닙니다. 실제 검수 결과에 따라 달라질 수 있습니다.`,
  };
}

module.exports = { adjust, apply };

// 자체 점검: node part2_price_disposal/lib/fault-adjust.js
if (require.main === module) {
  const assert = require('assert');
  const base = { status: 'ok', minKrw: 600000, maxKrw: 850000, modelKey: 'x' };
  assert.deepStrictEqual(
    (({ minKrw, maxKrw }) => ({ minKrw, maxKrw }))(apply(base, { understood: true, faultLabel_ko: '충전 단자', basis_ko: '검증되지 않은 AI 감가 추정', deductionMinKrw: 50400, deductionMaxKrw: 90000, severity: 'moderate' })),
    { minKrw: 510000, maxKrw: 800000 }, '기준 − 차감');
  assert.strictEqual(apply(base, { understood: false }), null, '고장으로 이해 못 하면 없음');
  assert.strictEqual(apply(base, { understood: true, faultLabel_ko: '충전 단자', basis_ko: '검증되지 않은 AI 감가 추정', deductionMinKrw: 9e9, deductionMaxKrw: 9e9 }).minKrw, MIN_RESULT_KRW, '0원 아래로 안 감');
  assert.strictEqual(apply(base, { understood: true, faultLabel_ko: '충전 단자', basis_ko: '검증되지 않은 AI 감가 추정', deductionMinKrw: 90000, deductionMaxKrw: 50000 }).deduction.minKrw, 50000, '뒤바뀐 범위 정리');
  (async () => {
    let calls = 0;
    const g = async () => { calls++; return { understood: true, faultLabel_ko: '충전 단자', severity: 'moderate', deductionMinKrw: 50000, deductionMaxKrw: 90000, confidence: 'medium', basis_ko: 'x' }; };
    const input = { brand: 'Apple', model: 'iPhone 16 Pro', storage: '256GB', conditionCode: 'clean', faultDetail_ko: '충전 단자 접촉 불량' };
    const a = await adjust({ base, input, geminiJson: g });
    await adjust({ base, input, geminiJson: g });
    assert.strictEqual(a.faultAdjusted, true); assert.strictEqual(a.maxKrw, 800000); assert.strictEqual(calls, 1, '같은 조합은 캐시');
    assert.strictEqual(await adjust({ base, input: { ...input, faultDetail_ko: null }, geminiJson: g }), null, '고장 내용 없으면 안 함');
    console.log('fault-adjust.js OK');
  })();
}
