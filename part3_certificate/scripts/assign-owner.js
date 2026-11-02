'use strict';
// 서버 운영자가 소유권을 별도로 확인한 기존 매물에만 관리키 발급.
// 공개 API가 아님. 서버 파일/Firestore 관리자 자격증명 접근이 있어야 실행 가능.
const { createStore } = require('../../common/lib/certificate-store');
const { loadEnv } = require('../../server');
const { secret, hash } = require('../lib/market');
async function main() {
  const [id, confirmation] = process.argv.slice(2);
  if (!/^[A-Za-z0-9]+$/.test(id || '') || confirmation !== '--ownership-verified') throw new Error('소유권을 별도 확인한 운영자만 실행: node part3_certificate/scripts/assign-owner.js 보증서ID --ownership-verified');
  loadEnv(); const store = createStore(), token = secret();
  await store.transactMarket(id, ({ cert, market }) => {
    if (!cert) throw new Error('보증서 없음');
    if (market?.ownerHash) throw new Error('이미 관리키가 있음. 임의 재발급하지 않음');
    return { market: { ownerHash: hash(token), requests: market?.requests || [] } };
  });
  console.log('아래 관리키를 소유 판매자에게 비공개 전달하고 안전하게 보관하세요. URL/커밋에 넣지 마세요.');
  console.log(token);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
