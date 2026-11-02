'use strict';
// 환경 온도: 당근 매너온도처럼 36.5°C 에서 시작해 자원 순환 행동을 할 때마다 오릅니다.
// 규칙을 바꾸려면 RULES 만 고치면 됩니다. 보증서 화면과 구매자 화면은 이 값을 그대로 보여 줍니다.

const START = 36.5;
const MAX = 99.9;

const RULES = {
  // 보증서 발급: 기기 상태를 투명하게 공개함
  certificate_issued: { fixed: 0.1, label_ko: '성능 보증서 발급' },
  // 판매로 재사용: 회피한 탄소 10kg 당 +0.1°C
  sold: { perKg: 0.01, label_ko: '판매로 재사용' },
  // 기부로 재사용: 판매와 같은 회피량 + 기부 보너스
  donated: { perKg: 0.01, fixed: 0.2, label_ko: '나눔폰 기부로 재사용' },
  // 올바른 배출: 회피량은 산정하지 않고 자원 회수·유해물질 관리에 대한 고정 보너스
  recycled: { fixed: 0.3, label_ko: '지정 수거함·방문수거로 올바른 배출' },
};

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

// 이 행동으로 오르는 온도와, 이 행동으로 '실제로' 인정되는 탄소 회피량
function delta(type, avoidedKg) {
  const r = RULES[type];
  if (!r) throw new Error(`알 수 없는 행동: ${type}`);
  const kg = r.perKg ? Math.max(0, Number(avoidedKg) || 0) : 0;
  return { delta: round2((r.fixed || 0) + kg * (r.perKg || 0)), creditedKg: round1(kg), label_ko: r.label_ko };
}

function newUser(nickname) {
  return { nickname, temperature: START, totalAvoidedKg: 0, certificates: 0, reused: 0, recycled: 0, actions: [] };
}

// user 를 바꾸지 않고 새 객체를 돌려줍니다 (저장은 store 가 담당)
function apply(user, { type, certificateId, avoidedKg, at }) {
  const d = delta(type, avoidedKg);
  const before = user.temperature;
  const after = Math.min(MAX, round2(before + d.delta));
  return {
    ...user,
    temperature: after,
    totalAvoidedKg: round1(user.totalAvoidedKg + d.creditedKg),
    certificates: user.certificates + (type === 'certificate_issued' ? 1 : 0),
    reused: user.reused + (type === 'sold' || type === 'donated' ? 1 : 0),
    recycled: user.recycled + (type === 'recycled' ? 1 : 0),
    actions: [
      ...user.actions,
      { type, label_ko: d.label_ko, certificateId, creditedKg: d.creditedKg, delta: d.delta, before, after, at: at || new Date().toISOString() },
    ],
  };
}

// 거래가 끝나기 전, 보증서에 '완료되면 이만큼 오른다'를 보여 주는 용도
function preview(type, avoidedKg, current = START) {
  const d = delta(type, avoidedKg);
  return { ...d, before: current, after: Math.min(MAX, round2(current + d.delta)) };
}

module.exports = { START, MAX, RULES, delta, newUser, apply, preview };
