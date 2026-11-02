'use strict';
// 구매자 화면 개발용 데모 보증서 만들기 (폰 없이, 서버 없이)
// 사용: npm run seed              데모 보증서 9장 추가
//       npm run seed -- --reset   store/ 의 데모 보증서·데모 판매자를 지우고 다시 만들기
// sample-result.json 을 바탕으로 기종·상태·테스트 결과를 바꿔 여러 장을 만들고, 일부는 판매·기부 처리까지 합니다.
// 만든 보증서에는 demo: true 가 붙습니다. 실제 보증서와 섞여도 구분할 수 있습니다.

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('../../server.js');
const { createStore } = require('../../common/lib/certificate-store.js');
const { createSellerService } = require('../lib/seller-routes.js');

const ROOT = path.join(__dirname, '..', '..'); // 저장소 루트
const BASE = JSON.parse(fs.readFileSync(path.join(ROOT, 'part1_hardware_test', 'sample-result.json'), 'utf8'));
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

// 판매자 · 기종 · 용량 · 상태 · 기능 이상 · 테스트 결과 바꾸기 · 거래 처리
const DEMOS = [
  { seller: '민지', brand: 'Apple', model: 'iPhone 13', ask: 330000, storage: '128GB', condition: 'clean', fault: 'none' },
  { seller: '민지', brand: 'Apple', model: 'iPhone 14 Pro', ask: 600000, storage: '256GB', condition: 'minor_wear', fault: 'none', outcome: 'sold' },
  { seller: '준호', brand: 'Samsung', model: 'Galaxy S23', ask: 300000, storage: '256GB', condition: 'minor_wear', fault: 'none' },
  { seller: '준호', brand: 'Samsung', model: 'Galaxy Z Flip 5', ask: 190000, storage: '256GB', condition: 'burn_in', fault: 'none' },
  { seller: '서연', brand: 'Apple', model: 'iPhone 11', ask: 150000, storage: '64GB', condition: 'visible_wear', fault: 'none', tests: { microphone: 'fail' } },
  { seller: '서연', brand: 'Samsung', model: 'Galaxy S24 Ultra', ask: 650000, storage: '512GB', condition: 'clean', fault: 'none' },
  { seller: '도윤', brand: 'Apple', model: 'iPhone 12 mini', ask: 70000, storage: '128GB', condition: 'display_fault', fault: 'yes', tests: { touch: 'fail' } },
  { seller: '도윤', brand: 'Samsung', model: 'Galaxy A55', ask: 200000, storage: '128GB', condition: 'clean', fault: 'none', outcome: 'donated' },
  { seller: '하린', brand: 'Google Pixel', model: 'Pixel 8', ask: 380000, storage: '128GB', condition: 'clean', fault: 'unknown', tests: { gyro: 'unsupported' } },
];

function reportFor(d, i) {
  const r = JSON.parse(JSON.stringify(BASE));
  r.sessionId = `demo-${i}-${Date.now().toString(36)}`;
  r.testedAt = new Date(Date.now() - (i + 1) * 3600000).toISOString();
  r.tester = d.seller;
  r.device.declared = { brand: d.brand, model: d.model, source: 'dropdown', matchesUserAgent: true };
  if (d.brand !== 'Apple') {
    r.device.userAgent = ANDROID_UA;
    r.device.platform = 'Linux armv8l';
  }
  for (const [k, status] of Object.entries(d.tests || {})) {
    r.results[k] = { status, error: status === 'fail' ? '데모: 테스트 실패' : '데모: 이 브라우저에서 지원하지 않음' };
    r.summary[k] = status;
  }
  const keys = ['camera', 'microphone', 'speaker', 'touch', 'gyro'];
  r.summary.completed = keys.every((k) => r.results[k].status !== 'pending');
  r.summary.allPassed = keys.every((k) => r.results[k].status === 'pass');
  return r;
}

async function main() {
  loadEnv();
  const store = createStore();
  if (process.argv.includes('--reset')) {
    if (store.kind !== 'local') throw new Error('--reset 은 STORE=local 에서만 지원합니다');
    const dir = path.join(ROOT, 'store');
    for (const f of fs.existsSync(path.join(dir, 'certificates')) ? fs.readdirSync(path.join(dir, 'certificates')) : []) {
      const c = JSON.parse(fs.readFileSync(path.join(dir, 'certificates', f), 'utf8'));
      if (!c.demo) continue;
      fs.rmSync(path.join(dir, 'certificates', f));
      fs.rmSync(path.join(dir, 'photos', c.id), { recursive: true, force: true });
    }
    for (const name of new Set(DEMOS.map((d) => d.seller))) {
      fs.rmSync(path.join(dir, 'users', `${name}.json`), { force: true });
    }
    console.log('데모 보증서와 데모 판매자를 지웠습니다.');
  }

  const httpError = (status, message) => Object.assign(new Error(message), { status });
  // 데모는 Gemini 를 부르지 않습니다 (빠르고 쿼터를 쓰지 않도록). 요약은 규칙 기반으로 만들어집니다.
  const service = createSellerService({ cfg: {}, store, httpError });

  for (const [i, d] of DEMOS.entries()) {
    const cert = await service.createCertificate({
      report: reportFor(d, i),
      storage: d.storage,
      conditionCode: d.condition,
      knownFault: d.fault,
      nickname: d.seller,
      askingPriceKrw: d.ask,
    }, { demo: true });
    if (d.outcome) await service.recordOutcome(cert.id, d.outcome);
  }
  const port = Number(process.env.PORT) || 3000;
  console.log(`\n데모 보증서 ${DEMOS.length}장을 만들었습니다 (저장소: ${store.where}).`);
  console.log(`서버를 켠 뒤 확인: http://localhost:${port}/api/public/certificates`);
}

main().catch((e) => { console.error('✖', e.message); process.exit(1); });
