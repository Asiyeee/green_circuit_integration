'use strict';
// 선택 실행: playwright 패키지 + Chrome 필요. 실제 폰/실제 파손 사진/Gemini 검증 아님.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { start } = require('../server');
const { localStore } = require('../common/lib/certificate-store');
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-browser-'));
  let server, browser;
  const errors = [];
  try {
    ({ server } = await start({ store: localStore(path.join(dir, 'store'), path.join(dir, 'results')), config: { port: 0, key: '', token: 'browser-test-access' } }));
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
    const seller = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const buyer = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    for (const context of [seller, buyer]) {
      await context.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({ body: '', contentType: 'text/javascript' }));
      context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    }
    const s = await seller.newPage(), b = await buyer.newPage();
    await s.goto(base + '/seller?t=browser-test-access');
    await s.locator('#upload').setInputFiles(path.join(__dirname, '../part1_hardware_test/sample-result.json'));
    await s.locator('input[name=cond][value=clean]').waitFor();
    await s.locator('#storage').selectOption('128GB');
    await s.locator('input[name=cond][value=clean]').check();
    await s.waitForFunction(() => document.querySelector('#quote').textContent.includes('미확인'));
    await s.locator('#fault label').filter({ has: s.locator('input[value=none]') }).click();
    await s.waitForFunction(() => document.querySelector('#quote').textContent.includes('자료 확인일'));
    await s.locator('#nickname').fill('브라우저판매자');
    await s.locator('#asking').fill('999999');
    const response = s.waitForResponse(r => r.url().endsWith('/api/certificates') && r.request().method() === 'POST');
    await s.locator('#issue').click();
    const issued = await (await response).json();
    await s.locator('#done').waitFor({ state: 'visible' });
    assert.equal(await s.evaluate(id => localStorage.getItem('gc-owner-' + id), issued.id), issued.ownerToken);
    assert.ok(!(await s.locator('#open').getAttribute('href')).includes(issued.ownerToken));
    await b.goto(base + '/buyer');
    await b.locator(`#all-listings a[href="/c/${issued.id}"]`).waitFor();
    await b.locator('#model').fill('iPhone 12');
    for (const label of ['카메라', '마이크', '터치']) await b.getByRole('button', { name: label, exact: false }).click();
    await b.locator('#go').click();
    await b.locator('#results .result').first().waitFor();
    assert.ok((await b.locator('#results').textContent()).includes('999,999원'));
    assert.ok(!(await b.locator('#results').textContent()).includes('가격 합리성'));
    if (process.env.GC_BROWSER_ARTIFACTS) {
      fs.mkdirSync(process.env.GC_BROWSER_ARTIFACTS, { recursive: true });
      await b.screenshot({ path: path.join(process.env.GC_BROWSER_ARTIFACTS, 'buyer.png'), fullPage: true });
    }
    await b.goto(base + issued.url);
    await b.locator('#request-form').waitFor();
    await b.locator('#buyer-name').fill('브라우저구매자');
    await b.locator('#buyer-contact').fill('browser-test@example.invalid');
    await b.locator('#buyer-message').fill('외관 확인 후 거래하고 싶어요');
    await b.locator('#request-type').selectOption('trade');
    await b.getByRole('button', { name: '요청 저장', exact: true }).click();
    await b.waitForFunction(() => document.querySelector('#my-requests').textContent.includes('확인 대기'));
    await s.goto(base + issued.url + '?t=browser-test-access');
    await s.getByRole('button', { name: '요청 확인 처리', exact: true }).waitFor();
    await s.getByRole('button', { name: '요청 확인 처리', exact: true }).click();
    await s.waitForFunction(() => document.querySelector('#inbox').textContent.includes('판매자 확인 완료'));
    if (process.env.GC_BROWSER_ARTIFACTS) await s.screenshot({ path: path.join(process.env.GC_BROWSER_ARTIFACTS, 'seller-mobile.png'), fullPage: true });
    await b.reload();
    await b.waitForFunction(() => document.querySelector('#my-requests')?.textContent.includes('판매자 확인 완료'));
    await s.locator('#outcome-confirm').check();
    await s.locator('#record-outcome').click();
    await s.waitForFunction(() => document.querySelector('#market-controls').textContent.includes('이미 완료 처리됨: sold'));
    await b.goto(base + '/buyer');
    await b.waitForFunction(() => document.querySelector('#all-listings').textContent.includes('판매 중 매물이 없어요'));
    // 자료 없는 파손폰도 사용자가 직접 선택/희망가 입력 후 등록.
    await s.goto(base + '/seller?t=browser-test-access');
    await s.locator('#upload').setInputFiles(path.join(__dirname, '../part1_hardware_test/sample-result.json'));
    await s.locator('input[name=cond][value=display_fault]').waitFor();
    await s.locator('#brand').fill('Samsung');
    await s.locator('#model').fill('Galaxy A52');
    await s.waitForFunction(() => document.querySelector('#model-note').style.display === 'block');
    await s.locator('#storage').selectOption('2TB');
    await s.locator('input[name=cond][value=display_fault]').check();
    await s.waitForFunction(() => document.querySelector('#quote').textContent.includes('해당 조건의 시세 정보 없음'));
    await s.locator('#asking').fill('1');
    await s.locator('#issue').click();
    await s.locator('#done').waitFor({ state: 'visible' });
    await b.reload();
    await b.waitForFunction(() => document.querySelector('#all-listings').textContent.includes('Galaxy A52'));
    assert.deepEqual(errors, []);
    console.log('Browser flow OK: 등록/추천/상세/요청 저장/판매자 확인/판매 완료/제외/시세 없는 파손폰 수동 등록, desktop + 390px mobile. 실제 파손 사진·실제 Gemini는 미검증.');
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'gc-browser-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
