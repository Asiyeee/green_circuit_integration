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
// 과거 export 호환용. 금액으로 판매/폐기를 자동 분기하지 않습니다.
const DONATE_BELOW_KRW = 30000; // 이전 소비자와의 export 호환용. 분기에는 사용하지 않음.
// Apple 은 최대 용량 80% 미만을 배터리 성능 저하로 안내합니다. 갤럭시도 같은 기준으로 표시만 합니다.
const BATTERY_LOW_PCT = 80;

const ACTIONS = {
  sell: { label_ko: '우리 플랫폼에 상태를 공개하고 판매 등록', manual: ['1. 판매하기'] },
  sell_parts: { label_ko: '파손폰 업체 매입', manual: ['1. 판매하기', '화면이 깨졌거나 전원이 켜지지 않을 때'] },
  donate: { label_ko: '기부·배출', manual: ['2. 폐기: 나눔폰 기부·재활용', '3. 폐기: 지역 수거함에 배출'] },
};
const WIPE = { Apple: '아이폰: 데이터 삭제 방법', Samsung: '삼성 갤럭시' };

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
function recommend({ brand, conditionCode, price, report, battery }) {
  const reasons = [];
  const ok = price && price.status === 'ok';
  const action = 'sell';
  if (DAMAGED.includes(conditionCode)) {
    reasons.push('파손·화면 이상과 미확인 기능을 공개하고 판매 희망가를 정해 등록할 수 있음');
  }
  reasons.push(ok ? '업체 매입 참고가이며 개인 거래 적정가·보장 판매가가 아님' : '시세 자료 부족은 가치 없음·매입 불가를 뜻하지 않음. 희망가 직접 입력 가능');
  const s = (report && report.summary) || {};
  if (!s.completed) reasons.push('미완료 점검 항목 있음. 판매글에 미확인으로 표시');
  else if (!s.allPassed) reasons.push('일부 점검 미통과. 권한 문제일 수 있어 고장으로 단정하지 않음');
  if (battery && battery.healthPct !== null) reasons.push(`배터리 최대 용량 ${battery.healthPct}% (판매자 캡처 판독, 직접 측정 아님). 참고가는 배터리별 보정 가격이 아님`);
  if (action === 'donate') reasons.push('나눔폰은 입고 후 반환되지 않음. 판매 원하면 기부하지 않기');

  const sections = [...(WIPE[brand] ? [WIPE[brand]] : []), ...ACTIONS[action].manual,
    ...(DAMAGED.includes(conditionCode) ? ['화면이 깨졌거나 전원이 켜지지 않을 때'] : []), ...ACTIONS.donate.manual];
  return {
    action,
    registrationUrl: '/seller',
    label_ko: ACTIONS[action].label_ko,
    alternatives: ['donate', 'recycle'],
    reasons_ko: reasons,
    manualSections: sections,
    basis: 'rule',
  };
}

module.exports = { DAMAGED, DONATE_BELOW_KRW, BATTERY_LOW_PCT, ACTIONS, loadPrompt, normalize, manualSection, recommend };

// 자체 점검: node lib/assessment.js
if (require.main === module) {
  const assert = require('assert');
  const rep = { summary: { completed: true, allPassed: true } };
  assert.strictEqual(recommend({ brand: 'Apple', conditionCode: 'clean', price: { status: 'ok', maxKrw: 290000 }, report: rep }).action, 'sell');
  assert.strictEqual(recommend({ brand: 'Apple', conditionCode: 'rear_damage', price: { status: 'ok', maxKrw: 90000 }, report: rep }).action, 'sell');
  assert.strictEqual(recommend({ brand: 'Apple', conditionCode: 'display_fault', price: { status: 'no_data' }, report: rep }).action, 'sell');
  assert.strictEqual(recommend({ brand: 'Samsung', conditionCode: 'minor_wear', price: { status: 'ok', maxKrw: 20000 }, report: rep }).action, 'sell');
  assert.strictEqual(recommend({ brand: 'X', conditionCode: 'clean', price: { status: 'needs_check' }, report: rep }).action, 'sell');
  const n = normalize({ condition: { code: 'unknown', confidence: 'zzz' }, battery: { isBatteryScreen: true, healthPct: 76, osHint: 'ios' } }, 'm');
  assert.strictEqual(n.condition.code, null);
  assert.strictEqual(n.condition.confidence, 'low');
  assert.strictEqual(n.battery.low, true);
  assert.strictEqual(normalize({ battery: { isBatteryScreen: true, healthPct: 140 } }).battery.healthPct, null);
  assert.strictEqual(normalize({ battery: { isBatteryScreen: false, healthPct: 90 } }).battery, null);
  const usage = normalize({ battery: { screenType: 'usage', isBatteryScreen: false, healthPct: null } });
  assert.strictEqual(usage.battery, null);
  assert.strictEqual(usage.batteryScreen, 'usage');
  for (const t of [...Object.values(WIPE), ...Object.values(ACTIONS).flatMap((a) => a.manual)]) assert.ok(manualSection(t), `매뉴얼 섹션 없음: ${t}`);
  console.log('assessment.js OK');
}
