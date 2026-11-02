'use strict';
// 결과 JSON 을 읽어서 쓰는 가장 기본적인 예제 (Node 20+, 설치할 것 없음)
// 실행:  node examples/read-result.js            (results/latest.json)
//        node examples/read-result.js sample-result.json

const fs = require('fs');
const path = require('path');
const file = process.argv[2] || path.join(__dirname, '..', 'results', 'latest.json');
const r = JSON.parse(fs.readFileSync(file, 'utf8'));

// 1) 이 결과를 믿고 써도 되는지 (형식 약속을 지키는지)
if (r.schema !== 'device-hw-test/v1') throw new Error('지원하지 않는 schema 버전: ' + r.schema);
if (!r.summary.completed) console.warn('아직 끝나지 않은 테스트입니다 (pending 항목 있음)');

// 2) 어떤 폰인지 — 사용자가 드롭다운에서 고른 값 (검증되지 않음)
const phone = r.device.declared;
console.log('기종:', phone?.model ? `${phone.brand ?? ''} ${phone.model}`.trim() : '(선택 안 함)');

// 3) 하드웨어 통과 여부
for (const k of ['camera', 'microphone', 'speaker', 'touch', 'gyro']) {
  console.log(k.padEnd(10), r.results[k].status);
}

// 4) 카메라 프로필 사용 예: "빈티지한 느낌 + 선명도 7 이상"인 카메라인가?
const p = r.results.camera.profile;      // 분석 실패하면 null — 항상 확인
if (p) {
  const vintage = p.look.vintage_score >= 6 || p.look.style_tags.includes('vintage');
  const sharpEnough = (p.scores.sharpness ?? 0) >= 7;
  console.log('빈티지 카메라 후보?', vintage && sharpEnough, `(등급 ${p.grade}, 신뢰도 ${p.confidence})`);
  // 점수가 null 일 수 있으니 ?? 로 기본값을 주세요 (예: 저조도는 사진 1장으로 판단 불가 → null)
}
