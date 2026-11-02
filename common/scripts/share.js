'use strict';
// 서버 시작 + cloudflared HTTPS 터널 + 터미널 QR 출력
// 사용: npm run share

const { spawn } = require('child_process');
const { start } = require('../../server.js');

let qrcode = null;
try { qrcode = require('qrcode-terminal'); } catch { /* npm install 안 한 경우 */ }

(async () => {
  let ctx;
  try { ctx = await start(); } catch { process.exit(1); }
  const { cfg } = ctx;
  const target = `http://127.0.0.1:${cfg.port}`;

  const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', target], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let tunnelUrl = null;
  let shown = false;
  const show = () => {
    if (shown || !tunnelUrl) return;
    shown = true;
    const full = `${tunnelUrl}/?t=${cfg.token}`;
    console.log('\n📱 폰으로 아래 QR 을 스캔하세요 (HTTPS)\n');
    if (qrcode) qrcode.generate(full, { small: true });
    else console.log('(QR 라이브러리가 없습니다. `npm install` 을 먼저 실행하세요)');
    console.log(`\n${full}\n`);
    console.log('열리지 않으면 10초쯤 기다렸다가 다시 시도하세요. 종료: Ctrl+C\n');
  };

  const onData = (d) => {
    const text = String(d);
    const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !tunnelUrl) {
      tunnelUrl = m[0];
      setTimeout(show, 8000); // 연결 완료 로그를 못 잡았을 때의 대비
    }
    if (tunnelUrl && /Registered tunnel connection/i.test(text)) show();
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('error', (e) => {
    if (e.code === 'ENOENT') {
      console.error('\n✖ cloudflared 가 설치되어 있지 않습니다. 하나만 설치하면 됩니다:');
      console.error('   macOS   : brew install cloudflared');
      console.error('   Windows : winget install Cloudflare.cloudflared');
      console.error('   Linux   : https://github.com/cloudflare/cloudflared/releases 에서 받거나 패키지 매니저 사용');
      console.error('   (서버만 쓰려면 `npm start` 후 노트북 브라우저에서 확인할 수 있습니다)');
    } else {
      console.error('터널 실행 오류:', e.message);
    }
    process.exit(1);
  });
  child.on('exit', (code) => {
    console.log('터널이 종료되었습니다.');
    process.exit(code == null ? 0 : code);
  });
  process.on('SIGINT', () => { child.kill(); process.exit(0); });
})();
