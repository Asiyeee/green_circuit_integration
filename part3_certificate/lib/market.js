'use strict';
const crypto = require('crypto');
const eco = require('./eco-temperature');
const secret = () => crypto.randomBytes(32).toString('base64url');
const hash = (v) => crypto.createHash('sha256').update(String(v || '')).digest('hex');
const validSecret = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const clean = (v, max) => typeof v === 'string' ? v.normalize('NFC').trim().slice(0, max) : '';

function createMarketService(store) {
  const owner = (cert, market, token) => {
    if (!cert) fail(404, '보증서가 없습니다');
    if (!market?.ownerHash) fail(403, '기존 매물은 관리키가 없습니다. 서버 운영자에게 소유권 확인과 관리키 발급을 요청하세요.');
    if (!validSecret(token) || !crypto.timingSafeEqual(Buffer.from(hash(token)), Buffer.from(market.ownerHash))) fail(403, '이 매물의 판매자 관리키가 필요합니다');
  };
  const listed = (cert) => {
    if (!cert) fail(404, '보증서가 없습니다');
    if (cert.status !== 'listed' || Date.now() > Date.parse(cert.expiresAt)) fail(409, '판매 중인 유효 매물이 아닙니다');
  };
  const buyer = (token) => { if (!validSecret(token)) fail(401, '구매 요청용 브라우저 키가 필요합니다'); return hash(token); };
  const publicRequest = ({ buyerHash, ...r }) => r;
  return {
    async request(id, body, buyerToken) {
      const buyerHash = buyer(buyerToken);
      const nickname = clean(body.nickname, 20), contact = clean(body.contact, 120), message = clean(body.message, 1000);
      if (!nickname || !contact || !message || !['inquiry', 'trade'].includes(body.type)) fail(400, '요청 종류·닉네임·연락 방법·내용을 입력하세요');
      const request = { id: crypto.randomBytes(12).toString('hex'), buyerHash, type: body.type, nickname, contact, message, status: 'pending', createdAt: new Date().toISOString(), acknowledgedAt: null };
      return store.transactMarket(id, ({ cert, market }) => {
        listed(cert);
        if (!market) fail(409, '이전 데모 매물은 요청을 받을 관리키가 없습니다');
        const existing = market.requests.find((r) => r.buyerHash === buyerHash && r.type === body.type);
        if (existing) return { result: { request: publicRequest(existing), duplicate: true } };
        if (market.requests.length >= 100) fail(429, '이 매물의 요청 한도에 도달했습니다');
        return { market: { ...market, requests: [...market.requests, request] }, result: { request: publicRequest(request), duplicate: false } };
      });
    },
    async mine(id, token) {
      const buyerHash = buyer(token);
      return store.transactMarket(id, ({ cert, market }) => {
        if (!cert) fail(404, '보증서가 없습니다');
        return { result: (market?.requests || []).filter((r) => r.buyerHash === buyerHash).map(publicRequest) };
      });
    },
    // 관리키만으로 내 매물 찾기 (내 매물 탭)
    async owned(token) {
      if (!validSecret(token)) fail(403, '43자 매물 관리키를 입력하세요');
      const id = await store.findOwned(hash(token));
      if (!id) fail(404, '이 관리키에 해당하는 매물이 없습니다');
      return store.transactMarket(id, ({ cert, market }) => {
        owner(cert, market, token);
        return { result: { cert, requests: market.requests.map(publicRequest) } };
      });
    },
    async inbox(id, token) {
      return store.transactMarket(id, ({ cert, market }) => {
        owner(cert, market, token);
        return { result: market.requests.map(publicRequest) };
      });
    },
    async acknowledge(id, requestId, token) {
      return store.transactMarket(id, ({ cert, market }) => {
        owner(cert, market, token); listed(cert);
        const r = market.requests.find((r) => r.id === requestId);
        if (!r) fail(404, '요청이 없습니다');
        if (r.status !== 'pending') fail(409, '이미 확인한 요청입니다');
        r.status = 'acknowledged'; r.acknowledgedAt = new Date().toISOString();
        return { market, result: publicRequest(r) };
      });
    },
    async outcome(id, type, token) {
      if (!['sold', 'donated', 'recycled'].includes(type)) fail(400, '완료 종류가 올바르지 않습니다');
      return store.transactMarket(id, ({ cert, market, user }) => {
        owner(cert, market, token);
        // 만료된 보증서도 실제 처리 결과를 명시적으로 기록할 수 있음.
        if (cert.status !== 'listed') fail(409, `이미 처리된 보증서입니다 (${cert.status})`);
        user = eco.apply(user || eco.newUser(cert.seller.nickname), { type, certificateId: id, avoidedKg: type === 'recycled' ? 0 : cert.carbon.avoidedKg });
        const last = user.actions.at(-1);
        const updated = { ...cert, status: type, outcome: { type, at: last.at, creditedKg: last.creditedKg, delta: last.delta, temperatureAfter: last.after } };
        return { cert: updated, user, result: { certificate: updated, user } };
      });
    },
  };
}
module.exports = { createMarketService, secret, hash };
