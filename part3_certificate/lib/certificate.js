'use strict';
// 성능 보증서 (seller-certificate/v1) 만들기
// 입력: ① 테스트 결과 JSON(device-hw-test/v1) + 판매자 입력(용량·상태·기능 이상·사진·닉네임)
// 출력: 구매자 화면이 그대로 읽어 비교할 수 있는 보증서 JSON
// 필드는 추가만 합니다. 이름을 바꾸거나 지우려면 schema 를 v2 로 올리세요.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CONDITIONS } = require('../../part2_price_disposal/lib/price.js');

const SCHEMA = 'seller-certificate/v1';
const VALID_DAYS = 30;
const KEYS = ['camera', 'microphone', 'speaker', 'touch', 'gyro'];
const TEST_LABEL = { camera: '카메라', microphone: '마이크', speaker: '스피커', touch: '터치', gyro: '자이로' };
const FAULT_LABEL = { none: '없음', yes: '있음', unknown: '모름' }; // 알려진 기능 고장

const newId = () => crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, '').slice(0, 10);

// 구매자가 비교할 핵심 수치만 평평하게 뽑아냅니다. 원본 전체는 test.raw 에 남지 않습니다(용량·개인정보).
function summarizeTest(report) {
  const r = report.results || {};
  const cam = r.camera || {};
  const prof = cam.profile || null;
  const items = {
    camera: {
      status: cam.status || 'pending',
      photoGrade: prof ? prof.grade : null,
      photoGradeNote_ko: '촬영 사진 1장 기준 화질 등급. 외관·시세 등급과 무관',
      scores: prof ? prof.scores : null,
      styleTags: prof && prof.look ? prof.look.style_tags : null,
      aiSummary_ko: prof ? prof.summary_ko : null,
      confidence: prof ? prof.confidence : null,
      megapixels: cam.photo ? cam.photo.megapixels ?? null : null,
      lensLabel: cam.stream ? cam.stream.label ?? null : null,
      verdictBasis: cam.verdictBasis || null,
    },
    microphone: { status: (r.microphone || {}).status || 'pending', peakDb: r.microphone?.peakDb ?? null, noiseFloorDb: r.microphone?.noiseFloorDb ?? null },
    speaker: { status: (r.speaker || {}).status || 'pending', userConfirmed: r.speaker?.userConfirmed ?? null },
    touch: {
      status: (r.touch || {}).status || 'pending',
      cellsHit: r.touch?.cellsHit ?? null,
      cellsTotal: r.touch?.cellsTotal ?? null,
      maxSimultaneousTouches: r.touch?.maxSimultaneousTouches ?? null,
    },
    gyro: { status: (r.gyro || {}).status || 'pending', maxOrientationRangeDeg: r.gyro?.maxOrientationRangeDeg ?? null },
  };
  const passed = KEYS.filter((k) => items[k].status === 'pass').length;
  return {
    schema: report.schema,
    sessionId: report.sessionId,
    testedAt: report.testedAt,
    completed: !!(report.summary && report.summary.completed),
    allPassed: !!(report.summary && report.summary.allPassed),
    passedCount: passed,
    totalCount: KEYS.length,
    batteryTested: false,
    items,
  };
}

// 판매자 입력이 다른 근거로 확인됐는가
function verifiedOf(input, test) {
  return {
    exterior: !!(input.assessment && input.assessment.sellerAgreesWithAi === true), // AI 사진 판별과 일치
    fault: input.knownFault === 'none' && test.completed && test.allPassed,         // 하드웨어 점검 5/5 정상
  };
}

function trustOf(report, test, input) {
  const reasons = [];
  const v = verifiedOf(input, test);
  const declared = report.device && report.device.declared;
  if (!declared) reasons.push('점검 시 기종 미선택');
  else if (declared.matchesUserAgent === false) reasons.push('선택 기종과 접속 기기 정보 불일치');
  if (!test.completed) reasons.push('미완료 점검 항목 있음');
  else if (!test.allPassed) reasons.push(`이상·미지원 점검 항목 ${test.totalCount - test.passedCount}개`);
  if (input.knownFault !== 'none') reasons.push(`알려진 기능 고장: ${FAULT_LABEL[input.knownFault]}${input.faultDetail_ko ? ` (${input.faultDetail_ko})` : ''} (판매자 입력)`);
  const camWarn = report.results?.camera?.checks?.warnings || [];
  if (camWarn.length) reasons.push('카메라 AI 판정과 실측값 불일치');
  if (!v.exterior && !v.fault) reasons.push('외관 상태·고장 여부는 판매자 입력값');
  else if (!v.exterior) reasons.push('외관 상태는 판매자 입력값');
  else if (!v.fault) reasons.push('고장 여부는 판매자 입력값');
  const ai = input.assessment && input.assessment.ai;
  if (ai && ai.condition.code && input.assessment.sellerAgreesWithAi === false) reasons.push(`AI 외관 판별(${ai.condition.label_ko})과 판매자 선택 다름`);
  const bat = input.assessment && input.assessment.battery;
  if (!bat || bat.healthPct === null) reasons.push('배터리 상태 미점검');
  else if (bat.low) reasons.push(`배터리 최대 용량 ${bat.healthPct}% (80% 미만)`);

  let level = 'medium';
  if (declared && declared.matchesUserAgent !== false && test.completed && test.allPassed && input.knownFault === 'none' && !camWarn.length) level = 'high';
  if (!declared || declared.matchesUserAgent === false || !test.completed) level = 'low';
  return { level, reasons };
}

// 키 순서와 무관하게 같은 값이면 같은 해시가 나오도록 정렬해서 직렬화합니다.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

// 상태(status)·요약문처럼 발급 뒤 바뀔 수 있는 값은 빼고, 발급 시점의 사실만 해시합니다.
function hashCore(cert) {
  const { integrity, status, outcome, summary, ...core } = cert;
  return crypto.createHash('sha256').update(canonical(core)).digest('hex');
}

function verify(cert) {
  return !!(cert && cert.integrity && cert.integrity.sha256 === hashCore(cert));
}

function build({ id, demo, report, input, price, carbon, photos, sellerTemperature, preview }) {
  const now = new Date();
  const declared = report.device?.declared || null;
  const test = summarizeTest(report);
  const cert = {
    schema: SCHEMA,
    id: id || newId(),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + VALID_DAYS * 86400000).toISOString(),
    seller: { nickname: input.nickname, temperatureAtIssue: sellerTemperature },
    device: {
      brand: input.brand,
      model: input.model,
      modelKey: price.modelKey,
      storage: input.storage,
      declaredSource: declared ? declared.source : null,
      matchesUserAgent: declared ? declared.matchesUserAgent ?? null : null,
      platform: report.device?.platform || null,
      screen: report.device?.screen ? { width: report.device.screen.width, height: report.device.screen.height, dpr: report.device.screen.devicePixelRatio } : null,
    },
    condition: {
      code: input.conditionCode,
      // 시세가 없어도 상태 이름은 보여야 하므로 시세 행이 아니라 상태 목록에서 가져옵니다.
      label_ko: (CONDITIONS.find((c) => c.code === input.conditionCode) || {}).label_ko || null,
      knownFault: input.knownFault,
      knownFaultLabel_ko: FAULT_LABEL[input.knownFault] + (input.knownFaultSource === 'hardware_test' ? ' (하드웨어 점검 5/5 정상)' : ''),
      knownFaultSource: input.knownFaultSource || 'seller_declared', // hardware_test = '모름'이었지만 점검 결과로 판단
      faultDetail_ko: input.faultDetail_ko || null, // 판매자가 적은 기능 고장 내용
      source: 'seller_declared',
      verified: verifiedOf(input, test), // { exterior: AI 판별 일치, fault: 점검 5/5 정상 }
    },
    test,
    askingPriceKrw: input.askingPriceKrw ?? null,
    price,
    carbon,
    ecoPreview: preview,
    photos,
    assessment: input.assessment || null, // ② { ai: 외관·배터리 Gemini 판별 | null, sellerAgreesWithAi, battery, disposal: 처분 추천 } (lib/assessment.js)
    status: 'listed',
    outcome: null,
  };
  if (demo) cert.demo = true; // scripts/seed-demo.js 로 만든 데모 보증서
  cert.trust = trustOf(report, test, input);
  cert.summary = null;
  cert.integrity = { algorithm: 'sha256', sha256: hashCore(cert), note_ko: '발급 시점 내용으로 계산한 값. 내용이 바뀌면 불일치' };
  return cert;
}

// Gemini 에 보내는 사실 묶음 (사진·원본 수치 없이 요약에 필요한 것만)
function factsFor(cert) {
  return {
    device: { brand: cert.device.brand, model: cert.device.model, storage: cert.device.storage, matchesUserAgent: cert.device.matchesUserAgent },
    test: Object.fromEntries(KEYS.map((k) => [k, cert.test.items[k].status])),
    camera: { photoGrade: cert.test.items.camera.photoGrade, scores: cert.test.items.camera.scores, aiSummary_ko: cert.test.items.camera.aiSummary_ko },
    condition: {
      label_ko: cert.condition.label_ko,
      knownFault: cert.condition.knownFaultLabel_ko,
      exteriorSource: cert.condition.verified && cert.condition.verified.exterior ? 'AI 사진 판별과 판매자 선택 일치 (확인됨)' : '판매자 선택',
      faultSource: cert.condition.verified && cert.condition.verified.fault ? '하드웨어 점검 5/5 정상 (확인됨)' : '판매자 입력',
      faultDetail_ko: cert.condition.faultDetail_ko || null,
    },
    aiExterior: cert.assessment && cert.assessment.ai && cert.assessment.ai.condition.code
      ? { label_ko: cert.assessment.ai.condition.label_ko, confidence: cert.assessment.ai.condition.confidence, damages: cert.assessment.ai.condition.damages, agreesWithSeller: cert.assessment.sellerAgreesWithAi }
      : null,
    battery: cert.assessment && cert.assessment.battery ? { healthPct: cert.assessment.battery.healthPct, statusLabel: cert.assessment.battery.statusLabel, cycleCount: cert.assessment.battery.cycleCount, low: cert.assessment.battery.low, source: '기기 배터리 성능 화면에서 AI 판독 (확인됨)' } : null,
    price: cert.price.status === 'ok'
      ? { status: 'ok', label_ko: cert.price.label_ko, minKrw: cert.price.minKrw, maxKrw: cert.price.maxKrw, vendorCount: cert.price.vendorCount, basis_ko: cert.price.reclassified_ko || null, aiEstimate: cert.price.estimated ? { confidence: cert.price.confidence, basis_ko: cert.price.basis_ko } : null, faultDeduction: cert.price.faultAdjusted ? { basePrice: cert.price.basePrice, deduction: cert.price.deduction } : null }
      : { status: cert.price.status, message_ko: cert.price.message_ko },
    carbon: { avoidedKg: cert.carbon.avoidedKg, basis: cert.carbon.basis, oakTreesYear: cert.carbon.equivalence.oakTreesYear },
    trust: cert.trust,
  };
}

const won = (n) => (n >= 10000 ? `${+(n / 10000).toFixed(1)}만원` : `${n.toLocaleString('ko-KR')}원`);

// Gemini 가 없거나 실패했을 때 쓰는 규칙 기반 요약 (보증서 문체: 명사형·개조식, 존댓말 없음)
function ruleSummary(cert) {
  const t = cert.test;
  const bad = KEYS.filter((k) => t.items[k].status !== 'pass').map((k) => TEST_LABEL[k]);
  const p = cert.price;
  const priceText = p.status === 'ok'
    ? (p.faultAdjusted ? `기능 정상 기준가에서 '${p.deduction.faultLabel_ko}' 차감 반영 ${won(p.minKrw)}~${won(p.maxKrw)}.` : p.estimated ? `AI 추정 참고가 ${won(p.minKrw)}~${won(p.maxKrw)} (시세 자료 없음).` : p.singleAmount ? `업체 매입가 ${won(p.minKrw)}.` : `업체 매입 참고 범위 ${won(p.minKrw)}~${won(p.maxKrw)}.`)
    : '해당 조건 시세 정보 없음.';
  const strengths = [];
  if (t.passedCount) strengths.push(`하드웨어 점검 ${t.passedCount}/${t.totalCount} 정상`);
  if (t.items.camera.photoGrade) strengths.push(`카메라 사진 화질 ${t.items.camera.photoGrade}등급`);
  const v = cert.condition.verified || {};
  if (cert.condition.code === 'clean') strengths.push(`흠집·파손·잔상 없음 (${v.exterior ? 'AI 사진 판별 일치' : '판매자 입력'})`);
  const bat = cert.assessment && cert.assessment.battery;
  if (bat && bat.healthPct !== null && !bat.low) strengths.push(`배터리 최대 용량 ${bat.healthPct}%`);
  if ((t.items.touch.maxSimultaneousTouches || 0) > 1) strengths.push('멀티터치 정상 인식');
  const cautions = [];
  if (bad.length) cautions.push(`이상·미점검 항목: ${bad.join(', ')}`);
  if (!bat || bat.healthPct === null) cautions.push('배터리 상태 미점검');
  else if (bat.low) cautions.push(`배터리 최대 용량 ${bat.healthPct}% (80% 미만)`);
  if (!v.exterior) cautions.push('외관 상태는 판매자 입력값');
  if (p.status !== 'ok') cautions.push(p.message_ko);
  const c = cert.carbon;
  return {
    by: 'rule',
    model: null,
    summary_ko: `${cert.device.model} ${cert.device.storage}. 외관 '${cert.condition.label_ko || cert.condition.code}'(${v.exterior ? 'AI 사진 판별 일치' : '판매자 입력'}), 하드웨어 점검 ${t.totalCount}개 중 ${t.passedCount}개 정상. ${priceText}`,
    strengths_ko: strengths.slice(0, 4),
    cautions_ko: cautions.slice(0, 4),
    eco_line_ko: `재사용 시 신규 생산 대비 약 ${c.avoidedKg}kg CO2e 감축${c.basis === 'estimate' ? ' (추정치)' : ''}.`,
  };
}

const PROMPT_DIR = path.join(__dirname, '..', 'prompts');
function loadSummaryPrompt() {
  return {
    system: fs.readFileSync(path.join(PROMPT_DIR, 'certificate-summary.system.md'), 'utf8'),
    schema: JSON.parse(fs.readFileSync(path.join(PROMPT_DIR, 'certificate-summary.schema.json'), 'utf8')),
  };
}

// Gemini 출력 정리: 문자열·배열만 남기고 길이를 제한합니다.
function normalizeSummary(o, model) {
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const arr = (v, n) => (Array.isArray(v) ? v.map((x) => str(x, 80)).filter(Boolean).slice(0, n) : []);
  return {
    by: 'gemini',
    model,
    summary_ko: str(o.summary_ko, 400),
    strengths_ko: arr(o.strengths_ko, 4),
    cautions_ko: arr(o.cautions_ko, 4),
    eco_line_ko: str(o.eco_line_ko, 200),
  };
}

module.exports = { SCHEMA, KEYS, TEST_LABEL, newId, build, verify, hashCore, factsFor, ruleSummary, loadSummaryPrompt, normalizeSummary };
