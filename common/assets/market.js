'use strict';
// 브라우저별 익명 키 기반 데모. 관리키/구매키는 URL·공개 보증서에 넣지 않음.
window.renderMarketControls = async ({ certificate: c, expired, token, reload }) => {
  const box = document.getElementById('market-controls');
  const escape = (v) => String(v ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
  const getKey = (key) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
  const saveKey = (key, value) => { localStorage.setItem(key, value); };
  let ownerKey = getKey('gc-owner-' + c.id);
  const api = async (url, { method = 'GET', body, buyerKey } = {}) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'x-access-token': token, 'x-owner-token': ownerKey, ...(buyerKey ? { 'x-buyer-token': buyerKey } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    return j;
  };
  const endpoint = '/api/certificates/' + encodeURIComponent(c.id);
  const publicEndpoint = '/api/public/certificates/' + encodeURIComponent(c.id);
  box.innerHTML = `<h2 class="section-label">구매 문의 · 거래 요청</h2>
    <p class="small">요청은 저장되어 판매자가 확인합니다. 요청·확인만으로 거래가 성사되거나 판매 완료로 바뀌지 않습니다. 연락 방법은 판매자에게만 표시됩니다. 결제·에스크로·배송·실시간 채팅은 제공하지 않습니다.</p>
    <p class="muted">데모: 구글 로그인 대신 브라우저별 익명 구매키와 매물별 관리키를 사용합니다. 닉네임·연락처의 실제 신원은 인증하지 않습니다. 브라우저 저장소 삭제 시 키를 잃을 수 있습니다.</p>
    ${c.status === 'listed' && !expired ? `<form id="request-form"><label class="field-label" for="request-type">요청 종류</label><select class="select" id="request-type"><option value="inquiry">구매 문의</option><option value="trade">거래 요청</option></select>
      <label class="field-label" for="buyer-name">닉네임</label><input class="input" id="buyer-name" maxlength="20" required>
      <label class="field-label" for="buyer-contact">판매자가 답변할 연락 방법</label><input class="input" id="buyer-contact" maxlength="120" required placeholder="이메일 등 필요한 연락 방법만 입력">
      <label class="field-label" for="buyer-message">문의 내용</label><textarea class="input" id="buyer-message" maxlength="1000" required></textarea>
      <button class="btn btn-primary" type="submit">요청 저장</button></form>` : '<p>판매 종료 또는 유효기간 만료로 새 요청을 받지 않습니다.</p>'}
    <p id="request-message" role="status"></p><div id="my-requests"></div>
    <details style="margin-top:20px"><summary>판매 전 데이터 삭제 · 기부·배출 대안 안내</summary><p>안내 열람은 완료 처리가 아닙니다. 실제로 판매·기부·배출을 마친 뒤 아래 판매자 관리에서 기록하세요.</p><div id="manual-guide">불러오는 중</div></details>
    <details style="margin-top:20px" id="owner-panel"><summary>판매자 관리 · 받은 요청 · 완료 처리</summary>
      <p class="muted">이 매물의 관리키와 서버 접속 토큰이 필요합니다. 기존 매물에 관리키가 없으면 서버 운영자의 소유권 확인이 필요합니다.</p>
      <label class="field-label" for="manage-key">매물 관리키</label><input class="input" type="password" id="manage-key" autocomplete="off" value="${escape(ownerKey)}">
      <label class="field-label" for="access-key">서버 접속 토큰</label><input class="input" type="password" id="access-key" autocomplete="off" value="${escape(token)}">
      <button class="btn btn-secondary" id="load-inbox">관리키 저장 · 받은 요청 확인</button><div id="inbox"></div>
      ${c.status === 'listed' ? `<div class="field"><label class="field-label" for="outcome-type">실제로 완료한 처리</label><select class="select" id="outcome-type"><option value="sold">판매 완료</option><option value="donated">기부 완료</option><option value="recycled">재활용·배출 완료</option></select>
      <label><input type="checkbox" id="outcome-confirm"> 실제 처리를 마쳤으며 판매 목록에서 제외됨을 확인합니다.</label><button class="btn btn-primary" id="record-outcome">선택한 완료 결과 기록</button></div>` : `<p>이미 완료 처리됨: ${escape(c.status)}</p>`}
      <p class="err" id="owner-message" role="status"></p></details>`;
  const el = (id) => box.querySelector('#' + id);
  // 토큰 입력 시 closure에 반영. URL에 관리키를 붙이지 않음.
  const credentials = () => {
    ownerKey = el('manage-key').value.trim(); token = el('access-key').value.trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(ownerKey)) throw new Error('43자 매물 관리키를 입력하세요');
    if (!token) throw new Error('서버 접속 토큰을 입력하세요');
  };
  const buyerKey = () => {
    let value = getKey('gc-buyer');
    if (!value) {
      value = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      saveKey('gc-buyer', value); // 저장 실패 시 요청을 보내지 않아 고아 요청 방지
    }
    return value;
  };
  const showMine = async () => {
    const key = getKey('gc-buyer');
    if (!key) return;
    try {
      const j = await api(publicEndpoint + '/requests/mine', { buyerKey: key });
      el('my-requests').innerHTML = j.items.map(r => `<p>${r.type === 'trade' ? '거래 요청' : '문의'} · ${r.status === 'acknowledged' ? '판매자 확인 완료' : '판매자 확인 대기'} · ${escape(r.createdAt)}</p>`).join('');
    } catch (e) { el('request-message').textContent = e.message; }
  };
  el('request-form')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
    try {
      const j = await api(publicEndpoint + '/requests', { method: 'POST', buyerKey: buyerKey(), body: { type: el('request-type').value, nickname: el('buyer-name').value, contact: el('buyer-contact').value, message: el('buyer-message').value } });
      el('request-message').textContent = j.duplicate ? '이미 저장한 같은 종류의 요청입니다. 판매자의 확인을 기다려 주세요.' : '요청이 저장됐습니다. 판매자의 확인을 기다려 주세요. 판매 완료 처리는 되지 않았습니다.';
      await showMine();
    } catch (e) { el('request-message').textContent = e.message; }
    finally { button.disabled = false; }
  });
  const inbox = async () => {
    credentials();
    const j = await api(endpoint + '/requests');
    saveKey('gc-owner-' + c.id, ownerKey);
    el('inbox').innerHTML = j.items.length ? j.items.map(r => `<article class="result-card"><div><b>${escape(r.nickname)} · ${r.type === 'trade' ? '거래 요청' : '구매 문의'}</b><p>${escape(r.message)}</p><p>연락 방법: ${escape(r.contact)}</p><p>${r.status === 'pending' ? '확인 대기' : '판매자 확인 완료'}</p>${r.status === 'pending' && c.status === 'listed' && !expired ? `<button class="btn btn-secondary" data-request="${r.id}">요청 확인 처리</button>` : ''}</div></article>`).join('') : '<p>받은 요청이 없습니다.</p>';
    el('inbox').querySelectorAll('[data-request]').forEach(button => button.onclick = async () => {
      button.disabled = true;
      try { credentials(); await api(endpoint + '/requests/' + button.dataset.request + '/acknowledge', { method: 'POST', body: {} }); await inbox(); }
      catch (e) { el('owner-message').textContent = e.message; button.disabled = false; }
    });
  };
  el('load-inbox').onclick = async () => {
    try { await inbox(); el('owner-message').textContent = '요청 확인은 판매 완료와 별개입니다.'; }
    catch (e) { el('owner-message').textContent = e.message; }
  };
  el('record-outcome')?.addEventListener('click', async (event) => {
    if (!el('outcome-confirm').checked) { el('owner-message').textContent = '실제 완료 여부 확인에 체크하세요.'; return; }
    event.target.disabled = true;
    try { credentials(); await api(endpoint + '/outcome', { method: 'POST', body: { type: el('outcome-type').value } }); await reload(); }
    catch (e) { el('owner-message').textContent = e.message; event.target.disabled = false; }
  });
  if (ownerKey && token) { el('owner-panel').open = true; inbox().catch(e => { el('owner-message').textContent = e.message; }); }
  showMine();
  try {
    const j = await api('/api/public/manual?brand=' + encodeURIComponent(c.device.brand));
    const markdown = (s) => escape(s).replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    el('manual-guide').innerHTML = j.items.map(m => `<details><summary>${escape(m.title)}</summary><p style="white-space:pre-wrap">${markdown(m.markdown)}</p></details>`).join('');
  } catch (e) { el('manual-guide').textContent = e.message; }
};
