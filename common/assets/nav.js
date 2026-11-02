// 모든 화면 위의 판매자 / 구매자 탭. 각 페이지 </body> 앞에서 <script src="/assets/nav.js"></script> 로 불러옵니다.
// 판매자 화면은 접속 토큰(?t=)이 필요해서, 한 번 받은 토큰을 이 브라우저에 기억해 탭 링크에 붙입니다.
(() => {
  let t = new URLSearchParams(location.search).get('t');
  try { if (t) localStorage.setItem('gc-token', t); else t = localStorage.getItem('gc-token'); } catch {}
  const q = t ? '?t=' + encodeURIComponent(t) : '';
  const p = location.pathname;
  const active = p.startsWith('/buyer') ? 'buyer' : (p === '/' || p.startsWith('/index') || p.startsWith('/seller')) ? 'seller' : '';
  const tabs = [
    ['seller', '판매자', '/' + q],
    ['buyer', '구매자', '/buyer' + q],
  ];
  const css = document.createElement('style');
  css.textContent = `
    .gc-tabs{position:sticky;top:0;z-index:20;display:flex;justify-content:center;gap:4px;padding:8px 16px;background:var(--bg);border-bottom:1px solid var(--line)}
    .gc-tabs a{flex:0 1 160px;text-align:center;padding:8px 0;border-radius:999px;font-weight:700;font-size:14px;color:var(--ink-2);text-decoration:none}
    .gc-tabs a[aria-current=page]{background:var(--primary);color:var(--on-primary)}
    .gc-tabs a:not([aria-current=page]):hover{background:var(--surface-2)}`;
  const nav = document.createElement('nav');
  nav.className = 'gc-tabs';
  nav.setAttribute('aria-label', '화면 전환');
  nav.innerHTML = tabs.map(([k, label, href]) => `<a href="${href}"${k === active ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  document.head.append(css);
  document.body.prepend(nav);
})();
