'use strict';
// ② Gemini 시세·처분 판단
//  - normalize(): Gemini 출력(외관 사진 → 상태 제안, 배터리 캡처 → 성능 %) 정리. 판매자가 확인 후 확정합니다.
//  - recommend(): 판매자가 확정한 상태 + 시세(price.lookup 결과) + 점검 결과 → 처분 추천 + 처리 매뉴얼 섹션
// 가격은 여기서 만들지 않습니다. 시세는 항상 price.lookup() 결과만 씁니다.

const fs = require('fs');
const path = require('path');
const { CONDITIONS } = require('./price.js');

const PROMPT_DIR = path.join(__dirname, '..', 'prompts');
const MANUAL_PATH = path.join(__dirname, '..', 'data', '스마트폰_처리_매뉴얼.md');
const CODES = CONDITIONS.map((c) => c.code);
const DAMAGED = ['rear_damage', 'display_fault', 'damage_or_fault'];
// ponytail: 팀 합의 전 임시 기준. 업체 매입 최고가가 이보다 낮으면 기부·배출을 먼저 권합니다.
const DONATE_BELOW_KRW = 30000;
// Apple 은 최대 용량 80% 미만을 배터리 성능 저하로 안내합니다. 갤럭시도 같은 기준으로 표시만 합니다.
const BATTERY_LOW_PCT = 80;

const ACTIONS = {
  sell: { label_ko: '판매', manual: ['1. 판매하기'] },
  sell_parts: { label_ko: '파손폰 업체 매입', manual: ['1. 판매하기', '화면이 깨졌거나 전원이 켜지지 않을 때'] },
  donate: { label_ko: '기부·배출', manual: ['2. 폐기: 나눔폰 기부·재활용', '3. 폐기: 지역 수거함에 배출'] },
};
const WIPE = { Apple: '아이폰: 데이터 삭제 방법', Samsung: '삼성 갤럭시' };
// 보증서에서 판매 완료·기부·분리배출을 눌렀을 때 보여 줄 매뉴얼 (데이터 삭제 안내가 먼저)
const OUTCOME_MANUAL = {
  sold: ['1. 판매하기'],
  donated: ['2. 폐기: 나눔폰 기부·재활용'],
  recycled: ['3. 폐기: 지역 수거함에 배출', '4. 폐기: 다른 폐가전과 함께 방문수거 신청'],
};
function manualFor(type, brand) {
  if (!OUTCOME_MANUAL[type]) return [];
  return [...(WIPE[brand] ? [WIPE[brand]] : ['모든 경로에 공통으로 필요한 준비']), ...OUTCOME_MANUAL[type]].map(manualSection).filter(Boolean);
}

function loadPrompt() {
  return {
    system: fs.readFileSync(path.join(PROMPT_DIR, 'assessment.system.md'), 'utf8'),
    schema: JSON.parse(fs.readFileSync(path.join(PROMPT_DIR, 'assessment.schema.json'), 'utf8')),
  };
}

function normalize(o, model) {
  const c = (o && o.condition) || {};
  const b = (o && o.battery) || {};
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const arr = (v, n) => (Array.isArray(v) ? v.map((x) => str(x, 80)).filter(Boolean).slice(0, n) : []);
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const code = CODES.includes(c.code) ? c.code : null; // 'unknown' 이나 이상한 값은 null = 제안 없음
  // 화면 종류: health(성능 상태) 만 배터리 값으로 인정. usage(사용량) 는 최대 용량이 없어 안내만 합니다.
  const screenType = ['health', 'usage', 'other', 'none'].includes(b.screenType) ? b.screenType : (b.isBatteryScreen === true ? 'health' : 'none');
  return {
    by: 'gemini',
    model,
    analyzedAt: new Date().toISOString(),
    condition: {
      code,
      label_ko: code ? CONDITIONS.find((x) => x.code === code).label_ko : null,
      confidence: ['high', 'medium', 'low'].includes(c.confidence) ? c.confidence : 'low',
      damages: arr(c.damages, 6),
      evidence_ko: str(c.evidence_ko, 200),
      caveats_ko: arr(c.caveats_ko, 4),
    },
    batteryScreen: screenType,
    battery: screenType === 'health'
      ? {
        source: 'seller_screenshot',
        healthPct: int(b.healthPct, 0, 100),
        statusLabel: str(b.statusLabel, 40) || null,
        cycleCount: int(b.cycleCount, 0, 10000),
        osHint: ['ios', 'android'].includes(b.osHint) ? b.osHint : 'unknown',
        low: int(b.healthPct, 0, 100) !== null && b.healthPct < BATTERY_LOW_PCT,
      }
      : null,
  };
}

// 매뉴얼에서 제목이 정확히 같은 섹션의 본문(다음 같은·상위 제목 전까지)을 꺼냅니다.
let manualLines = null;
function manualSection(title) {
  if (!manualLines) manualLines = fs.existsSync(MANUAL_PATH) ? fs.readFileSync(MANUAL_PATH, 'utf8').split(/\r?\n/) : [];
  const start = manualLines.findIndex((l) => /^#{2,3} /.test(l) && l.replace(/^#+ /, '').trim() === title);
  if (start < 0) return null;
  const level = manualLines[start].match(/^#+/)[0].length;
  let end = start + 1;
  while (end < manualLines.length && !(manualLines[end].match(/^#+ /) && manualLines[end].match(/^#+/)[0].length <= level)) end++;
  return { title, markdown: manualLines.slice(start + 1, end).join('\n').trim() };
}

// conditionCode: 판매자가 확정한 상태 · price: price.lookup() 결과 · report: device-hw-test/v1
function recommend({ brand, conditionCode: declaredCode, price, report, battery }) {
  const reasons = [];
  // 알려진 고장으로 시세 분류가 '파손 또는 기능 이상'으로 바뀌었으면 그 상태로 판단
  // 고장 차감 시세에서 심한 고장(severe)이면 파손폰으로 봄
  const conditionCode = (price && price.appliedConditionCode)
    || (price && price.faultAdjusted && price.deduction.severity === 'severe' ? 'damage_or_fault' : declaredCode);
  const ok = price && price.status === 'ok';
  const lowPrice = ok && price.maxKrw < DONATE_BELOW_KRW;
  const src = price && price.estimated ? 'AI 추정 시세' : '업체 매입 시세';
  let action;
  if (DAMAGED.includes(conditionCode)) {
    action = ok && !lowPrice ? 'sell_parts' : 'donate';
    reasons.push(ok && !lowPrice ? `파손·고장 상태에도 ${src} 있음` : ok ? `파손 상태 매입 참고가 ${DONATE_BELOW_KRW.toLocaleString('ko-KR')}원 미만` : '파손 상태 시세 정보 없음');
  } else if (lowPrice) {
    action = 'donate';
    reasons.push(`매입 참고가 ${DONATE_BELOW_KRW.toLocaleString('ko-KR')}원 미만`);
  } else {
    action = 'sell';
    reasons.push(ok ? `정상 사용 상태, ${src} 있음` : '시세 정보 없음. 판매는 가능하나 가격은 직접 확인');
  }
  if (price && price.faultAdjusted) reasons.push(`'${price.deduction.faultLabel_ko}' 차감 반영. 판매 시 고장 내용 고지`);
  const s = (report && report.summary) || {};
  if (!s.completed) reasons.push('미완료 점검 항목 있음. 판매글에 미확인으로 표시');
  else if (!s.allPassed) reasons.push('일부 점검 미통과. 권한 문제일 수 있어 고장으로 단정하지 않음');
  if (battery && battery.low) reasons.push(`배터리 최대 용량 ${battery.healthPct}% (판매자 캡처). 매입가가 낮아질 수 있음`);
  if (action === 'donate') reasons.push('나눔폰은 입고 후 반환되지 않음. 판매 원하면 기부하지 않기');

  const sections = [...(WIPE[brand] ? [WIPE[brand]] : []), ...ACTIONS[action].manual];
  return {
    action,
    label_ko: ACTIONS[action].label_ko,
    alternatives: Object.keys(ACTIONS).filter((a) => a !== action), // 강제하지 않고 사용자가 고름 (매뉴얼 원칙)
    reasons_ko: reasons,
    manualSections: sections,
    basis: 'rule',
  };
}

module.exports = { DAMAGED, DONATE_BELOW_KRW, BATTERY_LOW_PCT, ACTIONS, OUTCOME_MANUAL, loadPrompt, normalize, manualSection, manualFor, recommend };

// 자체 점검: node lib/assessment.js
if (require.main === module) {
  const assert = require('assert');
  const rep = { summary: { completed: true, allPassed: true } };
  assert.strictEqual(recommend({ brand: 'Apple', conditionCode: 'clean', price: { status: 'ok', maxKrw: 290000 }, report: rep }).action, 'sell');
  assert.strictEqual(recommend({ brand: 'Apple', conditionCode: 'rear_damage', price: { status: 'ok', maxKrw: 90000 }, report: rep }).action, 'sell_parts');
  assert.strictEqual(recommend({ brand: 'Apple', conditionCode: 'display_fault', price: { status: 'no_data' }, report: rep }).action, 'donate');
  assert.strictEqual(recommend({ brand: 'Samsung', conditionCode: 'minor_wear', price: { status: 'ok', maxKrw: 20000 }, report: rep }).action, 'donate');
  assert.strictEqual(recommend({ brand: 'X', conditionCode: 'clean', price: { status: 'needs_check' }, report: rep }).action, 'sell');
  assert.strictEqual(recommend({ brand: 'Apple', conditionCode: 'clean', price: { status: 'ok', maxKrw: 500000, appliedConditionCode: 'damage_or_fault' }, report: rep }).action, 'sell_parts', '고장 있으면 파손폰 매입');
  const pr = require('./price.js');
  const yes = pr.lookup({ brand: 'Apple', model: 'iPhone 16 Pro', storage: '256GB', conditionCode: 'clean', knownFault: 'yes' });
  assert.strictEqual(yes.status, 'ok', '알려진 고장 있음 → 파손·기능 이상 시세');
  assert.strictEqual(yes.appliedConditionCode, 'damage_or_fault');
  const noRow = pr.lookup({ brand: 'Apple', model: 'iPhone 11', storage: '128GB', conditionCode: 'burn_in', knownFault: 'yes' });
  assert.strictEqual(noRow.status, 'ok', '고른 상태 행이 없어도 고장 행으로 조회'); assert.strictEqual(noRow.estimated, undefined);
  assert.strictEqual(pr.lookup({ brand: 'Apple', model: 'iPhone 16 Pro', storage: '256GB', conditionCode: 'clean', knownFault: 'unknown' }).status, 'needs_check');
  assert.strictEqual(pr.lookup({ brand: 'Apple', model: 'iPhone 16 Pro', storage: '256GB', conditionCode: 'clean', knownFault: 'none' }).appliedConditionCode, undefined);
  const n = normalize({ condition: { code: 'unknown', confidence: 'zzz' }, battery: { isBatteryScreen: true, healthPct: 76, osHint: 'ios' } }, 'm');
  assert.strictEqual(n.condition.code, null);
  assert.strictEqual(n.condition.confidence, 'low');
  assert.strictEqual(n.battery.low, true);
  assert.strictEqual(normalize({ battery: { isBatteryScreen: true, healthPct: 140 } }).battery.healthPct, null);
  assert.strictEqual(normalize({ battery: { isBatteryScreen: false, healthPct: 90 } }).battery, null);
  const usage = normalize({ battery: { screenType: 'usage', isBatteryScreen: false, healthPct: null } });
  assert.strictEqual(usage.battery, null);
  assert.strictEqual(usage.batteryScreen, 'usage');
  for (const t of [...Object.values(WIPE), ...Object.values(ACTIONS).flatMap((a) => a.manual), ...Object.values(OUTCOME_MANUAL).flat(), '모든 경로에 공통으로 필요한 준비']) assert.ok(manualSection(t), `매뉴얼 섹션 없음: ${t}`);
  assert.strictEqual(manualFor('recycled', 'Apple').length, 3, '분리배출: 삭제 안내 + 수거함 + 방문수거');
  assert.strictEqual(manualFor('donated', 'Google')[0].title, '모든 경로에 공통으로 필요한 준비');
  console.log('assessment.js OK');
}
