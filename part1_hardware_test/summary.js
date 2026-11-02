'use strict';
// 결과 JSON 을 사람이 읽기 쉽게 한 화면으로 보여줍니다.
// 사용: npm run summary                 (results/latest.json)
//       npm run summary -- 파일경로

const fs = require('fs');
const path = require('path');
const { validateReport } = require('../common/scripts/validate.js');

const file = process.argv[2] || path.join(__dirname, '..', 'results', 'latest.json');
if (!fs.existsSync(file)) {
  console.error(`파일이 없습니다: ${file}\n먼저 폰에서 테스트를 끝내 주세요 (5개 항목이 모두 끝나면 자동 저장됩니다).`);
  process.exit(2);
}
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
const errs = validateReport(r);
const icon = { pass: '✅', fail: '❌', unsupported: '🚫', pending: '⏳' };
const line = (k, v) => console.log(`  ${k.padEnd(14)} ${v}`);

console.log(`\n파일: ${file}`);
console.log(`형식 검사: ${errs.length ? '❌ ' + errs.join(' / ') : '✅ 통과'}\n`);
const d = r.device || {};
const decl = d.declared;
line('테스터', r.tester || '(이름 없음)');
line('선택한 기종', decl && decl.model ? `${decl.brand ? decl.brand + ' ' : ''}${decl.model}` : '(선택 안 함)');
line('접속 기기', (d.userAgent || '').slice(0, 70));
line('시각', r.testedAt);
console.log('\n[항목별 결과]');
for (const k of ['camera', 'microphone', 'speaker', 'touch', 'gyro']) {
  line(k, `${icon[r.results?.[k]?.status] || '?'} ${r.results?.[k]?.status}`);
}
const s = r.summary || {};
console.log(`\n  전체 완료: ${s.completed ? '예' : '아니오'} · 전부 통과: ${s.allPassed ? '예' : '아니오'}`);

const cam = r.results?.camera;
const p = cam?.profile;
if (p) {
  console.log('\n[카메라 프로필]');
  line('등급', `${p.grade ?? '-'} (신뢰도: ${p.confidence})`);
  line('요약', p.summary_ko);
  const sc = p.scores || {};
  line('점수', `선명 ${sc.sharpness ?? '-'} · 노이즈억제 ${sc.noise_cleanliness ?? '-'} · 다이나믹 ${sc.dynamic_range ?? '-'} · 노출 ${sc.exposure_accuracy ?? '-'} · 색 ${sc.color_accuracy ?? '-'} · 저조도 ${sc.low_light_potential ?? '-'}`);
  const lk = p.look || {};
  line('느낌', `${(lk.style_tags || []).join(', ') || '-'} · 빈티지 ${lk.vintage_score ?? '-'}/10 · 색온도 ${lk.warmth ?? '-'}`);
  line('잘 맞는 용도', (p.best_for || []).map((b) => b.use).join(', ') || '-');
  line('결함', (p.defects || []).join(', '));
  const o = p.optics || {};
  line('광학(EXIF)', o.iso == null && o.aperture_f == null ? '없음 (iOS 는 웹으로 EXIF 를 주지 않습니다)' : `f/${o.aperture_f} · ISO ${o.iso} · ${o.shutter_s}s · ${o.focal_length_35mm_equiv}mm`);
  if ((p.caveats_ko || []).length) line('주의', p.caveats_ko.join(' / '));
  const w = cam.checks?.warnings || [];
  if (w.length) line('⚠ 검사 경고', w.join(' / '));
} else if (cam) {
  console.log('\n[카메라 프로필] 없음 — ' + (cam.photo?.geminiError || cam.photo?.geminiSkipped || '아직 사진 분석 전'));
}
console.log('');
