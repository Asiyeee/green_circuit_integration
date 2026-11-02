'use strict';
// 결과 JSON이 계약(device-hw-test/v1)을 지키는지 검사합니다.
// 사용: npm run validate            (results/latest.json 검사)
//       npm run validate -- 파일경로

const fs = require('fs');
const path = require('path');

const KEYS = ['camera', 'microphone', 'speaker', 'touch', 'gyro'];
const STATUSES = ['pass', 'fail', 'unsupported', 'pending'];

function validateReport(r) {
  const errors = [];
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['최상위가 객체가 아닙니다'];
  if (r.schema !== 'device-hw-test/v1') {
    errors.push(`schema 가 device-hw-test/v1 이 아닙니다 (받은 값: ${JSON.stringify(r.schema)})`);
  }
  if (typeof r.testedAt !== 'string') errors.push('testedAt(문자열) 이 없습니다');
  if (!r.results || typeof r.results !== 'object') {
    errors.push('results 가 없습니다');
    return errors;
  }
  for (const k of KEYS) {
    const item = r.results[k];
    if (!item || typeof item !== 'object') { errors.push(`results.${k} 가 없습니다`); continue; }
    if (!STATUSES.includes(item.status)) {
      errors.push(`results.${k}.status 가 올바르지 않습니다: ${JSON.stringify(item.status)}`);
    }
  }
  if (!r.summary || typeof r.summary !== 'object') errors.push('summary 가 없습니다');
  return errors;
}

module.exports = { validateReport, KEYS, STATUSES };

if (require.main === module) {
  const file = process.argv[2] || path.join(__dirname, '..', '..', 'results', 'latest.json');
  if (!fs.existsSync(file)) {
    console.error(`파일이 없습니다: ${file}`);
    process.exit(2);
  }
  let json;
  try { json = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error('JSON 파싱 실패:', e.message); process.exit(2); }
  const errors = validateReport(json);
  if (errors.length) {
    console.error(`✖ ${file}\n  - ${errors.join('\n  - ')}`);
    process.exit(1);
  }
  const s = json.summary || {};
  console.log(`✔ ${file} 검증 통과`);
  console.log(KEYS.map(k => `${k}:${json.results[k].status}`).join('  '));
  console.log(`completed=${s.completed}  allPassed=${s.allPassed}`);
}
