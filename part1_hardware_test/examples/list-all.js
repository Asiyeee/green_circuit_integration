'use strict';
// results/ 폴더의 모든 결과를 한 표로 모읍니다 (여러 폰을 테스트한 뒤 비교할 때).
// 실행:  node examples/list-all.js            → 표 출력
//        node examples/list-all.js --csv > all.csv

const fs = require('fs');
const path = require('path');
const dir = process.argv.find((a) => a.startsWith('--dir='))?.slice(6) || path.join(__dirname, '..', 'results');
const csv = process.argv.includes('--csv');

if (!fs.existsSync(dir)) { console.error(`결과 폴더가 없습니다: ${dir}\n먼저 폰에서 테스트를 끝내 주세요.`); process.exit(2); }

const rows = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f !== 'latest.json')
  .map((f) => {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const p = r.results?.camera?.profile;
    const d = r.device?.declared;
    return {
      file: f,
      phone: d?.model ? `${d.brand ?? ''} ${d.model}`.trim() : '',
      allPassed: r.summary?.allPassed ?? false,
      grade: p?.grade ?? '',
      sharpness: p?.scores?.sharpness ?? '',
      vintage: p?.look?.vintage_score ?? '',
      tags: (p?.look?.style_tags ?? []).join('|'),
      confidence: p?.confidence ?? '',
    };
  });

if (csv) {
  const cols = Object.keys(rows[0] || { file: '' });
  console.log(cols.join(','));
  rows.forEach((r) => console.log(cols.map((c) => JSON.stringify(r[c] ?? '')).join(',')));
} else {
  console.table(rows);
}
