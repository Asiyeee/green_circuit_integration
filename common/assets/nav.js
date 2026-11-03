// 모든 화면 위의 판매자 / 구매자 탭. 각 페이지 </body> 앞에서 <script src="/assets/nav.js"></script> 로 불러옵니다.
// 판매자 화면은 접속 토큰(?t=)이 필요해서, 한 번 받은 토큰을 이 브라우저에 기억해 탭 링크에 붙입니다.
(() => {
  let t = new URLSearchParams(location.search).get('t');
  try { if (t) localStorage.setItem('gc-token', t); else t = localStorage.getItem('gc-token'); } catch {}
  const q = t ? '?t=' + encodeURIComponent(t) : '';
  const p = location.pathname;
  const active = p.startsWith('/buyer') ? 'buyer' : (p === '/' || p.startsWith('/my') || p.startsWith('/index') || p.startsWith('/seller')) ? 'seller' : '';
  const tabs = [
    ['seller', '판매자', '/' + q],
    ['buyer', '구매자', '/buyer' + q],
  ];
  const css = document.createElement('style');
  css.textContent = `
    .gc-tabs{position:sticky;top:0;z-index:20;display:flex;justify-content:center;gap:4px;padding:8px 16px;background:var(--bg);border-bottom:1px solid var(--line)}
    .gc-tabs a{flex:0 1 160px;text-align:center;padding:8px 0;border-radius:999px;font-weight:700;font-size:14px;color:var(--ink-2);text-decoration:none}
    .gc-tabs a[aria-current=page]{background:var(--primary);color:var(--on-primary)}
    .gc-tabs a:not([aria-current=page]):not(.gc-home):hover{background:var(--surface-2)}
    .gc-tabs .gc-home{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:36px;height:36px;padding:0;display:grid;place-items:center;border-radius:10px}
    .gc-tabs .gc-home img{width:22px;height:22px}
    .gc-tabs{padding-left:56px;padding-right:56px}`;
  const nav = document.createElement('nav');
  nav.className = 'gc-tabs';
  nav.setAttribute('aria-label', '화면 전환');
  const logo = matchMedia('(prefers-color-scheme: dark)').matches ? '/assets/logo-dark.svg' : '/assets/logo.svg';
  nav.innerHTML = `<a class="gc-home" href="/start" aria-label="Green Circuit 홈"><img src="${logo}" alt=""></a>` + tabs.map(([k, label, href]) => `<a href="${href}"${k === active ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  document.head.append(css);
  document.body.prepend(nav);
})();
