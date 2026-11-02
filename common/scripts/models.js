'use strict';
// 내 키로 쓸 수 있는 Gemini 모델 목록을 출력합니다.
// 사용: npm run models   →  원하는 이름(models/ 는 뺀 것)을 .env 의 GEMINI_MODEL 에 넣으세요.

const { loadEnv } = require('../../server.js');

(async () => {
  loadEnv();
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) {
    console.error('.env 에 GEMINI_API_KEY 가 없습니다. (.env.example 을 복사해서 .env 를 만드세요)');
    process.exit(1);
  }
  const names = [];
  let pageToken = '';
  try {
    do {
      const u = new URL('https://generativelanguage.googleapis.com/v1beta/models');
      u.searchParams.set('pageSize', '200');
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const r = await fetch(u, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) {
        console.error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
        console.error('키가 틀렸거나 제한이 걸려 있을 수 있습니다.');
        process.exit(1);
      }
      const j = await r.json();
      for (const m of j.models || []) {
        if ((m.supportedGenerationMethods || []).includes('generateContent')) {
          names.push(String(m.name).replace(/^models\//, ''));
        }
      }
      pageToken = j.nextPageToken || '';
    } while (pageToken);
  } catch (e) {
    console.error('Gemini 에 연결하지 못했습니다:', e.message);
    process.exit(1);
  }
  console.log('generateContent 를 지원하는 모델 (이미지 입력 가능 여부는 모델 문서 확인):\n');
  names.sort().forEach((n) => console.log('  ' + n));
  console.log(`\n현재 설정: ${(process.env.GEMINI_MODEL || 'gemini-flash-lite-latest')}`);
})();
