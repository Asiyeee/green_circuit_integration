'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const crypto = require('node:crypto');
const price = require('../part2_price_disposal/lib/price');
const estimate = require('../part2_price_disposal/lib/price-estimate');
const adjust = require('../part2_price_disposal/lib/fault-adjust');
const { localStore } = require('../common/lib/certificate-store');
const { createSellerService, listItem } = require('../part3_certificate/lib/seller-routes');
const { createMarketService, secret, hash } = require('../part3_certificate/lib/market');
const certLib = require('../part3_certificate/lib/certificate');
const { toListing, recommend } = require('../part4_buyer/lib/buyer');
const { validateReport } = require('../common/scripts/validate');
const { renderPriceReference } = require('../common/assets/price-reference');
const { hardwareDetails } = require('../common/assets/hardware-details');
const sample = require('../part1_hardware_test/sample-result.json');
const old = require('./fixtures/hardware-v1-before-2026-11-03.json');
const livePath = path.resolve(__dirname,'../part2_price_disposal/data/중고폰_시세_통합.csv');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const input = patch => ({ brand:'Apple', model:'iPhone 12', storage:'128GB', conditionCode:'clean', knownFault:'none', ...patch });
const body = patch => ({ ...input(), report:structuredClone(sample), nickname:'통합검증', askingPriceKrw:987654, ...patch });
function environment(t, geminiJson, model = 'test-double') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'gc-main-integration-'));
  t.after(() => { assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'gc-main-integration-')); fs.rmSync(dir,{recursive:true,force:true}); });
  const store = localStore(path.join(dir,'store'),path.join(dir,'results'));
  const service = createSellerService({cfg:{key:geminiJson?'test-double-key':'',model},store,geminiJson,httpError:(status,message)=>Object.assign(new Error(message),{status})});
  return {service,store,market:createMarketService(store)};
}
const aiEstimate = {possible:true,minKrw:300000,maxKrw:400000,confidence:'low',basis_ko:'동일 기종 다른 용량 원문 자료 기반 AI 추정. 대상 조합 업체 자료 없음'};
const aiDeduct = {understood:true,deductionMinKrw:20000,deductionMaxKrw:30000,faultLabel_ko:'충전 단자 접촉 불량 (설명 해석)',severity:'moderate',confidence:'low',basis_ko:'판매자 증상 설명에 대한 불확실한 AI 감가 추정'};

test('이전/새 하드웨어 JSON 저장·보증서·구매자 호환, 가변 터치와 미지원/실패/미완료 구분', async t=>{
  const {service,store}=environment(t);
  for (const report of [old,sample]) {
    assert.deepEqual(validateReport(report),[]);
    const c=await service.createCertificate(body({report:structuredClone(report),knownFault:'unknown'}));
    assert.equal(c.condition.knownFault,'unknown'); assert.equal(c.condition.verified.fault,false);
    assert.equal(c.test.items.touch.cellsTotal,report.results.touch.cellsTotal);
    assert.equal(certLib.verify(c),true);
    assert.equal((await store.getCertificate(c.id)).test.items.touch.cellsTotal, report.results.touch.cellsTotal);
    const listing=toListing(listItem(c)); assert.equal(listing.knownFault,'unknown');
    assert.equal(recommend([listing],'iPhone',['mic','speaker','touch']).length,1);
  }
  const newCert=await service.createCertificate(body());
  assert.equal(newCert.test.items.microphone.quality.snrDb,sample.results.microphone.quality.snrDb);
  assert.equal(newCert.test.items.speaker.loopback.detectedCount,5);
  assert.equal(newCert.test.items.speaker.countTest.played,4);
  assert.match(hardwareDetails('touch',newCert.test.items.touch),/98\/98칸/);
  const report=structuredClone(sample);
  report.results.microphone.status='unsupported'; report.results.speaker.status='fail'; report.results.speaker.loopback={status:'error'};
  report.results.touch={status:'pending',cellsHit:10,cellsTotal:154,missedEdgeCells:6};
  report.results.camera.lowLight=null; report.results.camera.profile.scores.low_light_potential=null;
  report.summary={completed:true,allPassed:true}; // 잘못된 요약이 새 측정 상태를 덮지 않음
  const c=await service.createCertificate(body({report,knownFault:'unknown'}));
  assert.equal(c.test.completed,false); assert.equal(c.test.allPassed,false);
  assert.equal(c.test.items.microphone.status,'unsupported'); assert.equal(c.test.items.speaker.status,'fail'); assert.equal(c.test.items.touch.status,'pending');
  assert.match(hardwareDetails('speaker',c.test.items.speaker),/자동 측정 실패/);
  assert.match(hardwareDetails('camera',c.test.items.camera),/저조도 미측정/);
  assert.equal(c.condition.code,'clean'); assert.equal(c.price.status,'needs_check');
  assert.equal(recommend([toListing(listItem(c))],'iPhone',['mic','speaker','touch']).length,0);
});

test('별도 AI 추정과 근거·자료 없음 보존, 업체 CSV에 혼입하지 않음', async t=>{
  const before=digest(fs.readFileSync(livePath)); let calls=0;
  const {service}=environment(t,async()=>{calls++;return aiEstimate;},'estimate-source-test');
  const p=await service.priceOf(input({storage:'2TB'}));
  assert.equal(p.status,'ok'); assert.equal(p.estimated,true); assert.equal(p.originalLookup.status,'no_data');
  assert.equal(p.vendorCount,0); assert.deepEqual(p.quotes,[]); assert.ok(p.evidenceRows.length);
  assert.equal(p.model,'iPhone 12'); assert.equal(p.aiModel,'estimate-source-test');
  assert.ok(p.evidenceRows.every(r=>r.referenceId && r.sources.length));
  assert.match(renderPriceReference(p),/이 조합의 업체 원문 가격 자료 없음/);
  assert.equal(digest(fs.readFileSync(livePath)),before);
  await service.priceOf(input({storage:'2TB'})); assert.equal(calls,1);
  const unknown=await service.priceOf(input({storage:'2TB',knownFault:'unknown'}));
  assert.equal(unknown.status,'needs_check'); assert.equal(calls,1,'모름을 정상 전제로 추정하지 않음');
});

test('업체 기준가·AI 해석·AI 감가·희망가 분리와 문의→확인→판매 완료', async t=>{
  const {service,store,market}=environment(t,async ({schema})=> schema.properties.understood ? aiDeduct : {summary_ko:'대역 요약',strengths_ko:[],cautions_ko:[],eco_line_ko:''},'deduct-source-test');
  const owner=secret();
  const c=await service.createCertificate(body({knownFault:'yes',faultDetail:'충전 케이블 접촉이 안 좋아요'}),{ownerHash:hash(owner)});
  const baseline=price.lookup(input());
  assert.equal(c.price.minKrw,baseline.minKrw-aiDeduct.deductionMaxKrw);
  assert.equal(c.price.maxKrw,baseline.maxKrw-aiDeduct.deductionMinKrw);
  assert.deepEqual(c.price.quotes,baseline.quotes); assert.equal(c.price.basePrice.minKrw,baseline.minKrw);
  assert.equal(c.price.knownFault,'yes'); assert.equal(c.condition.faultDetail_ko,'충전 케이블 접촉이 안 좋아요');
  assert.equal(c.price.model,'iPhone 12'); assert.equal(c.price.aiModel,'deduct-source-test');
  assert.equal(c.price.sellerFaultDetail_ko,c.condition.faultDetail_ko); assert.equal(c.askingPriceKrw,987654);
  assert.equal(c.assessment.disposal.action,'sell'); assert.match(renderPriceReference(c.price),/사용자 고장 설명/); assert.match(renderPriceReference(c.price),/검증된 수리비/);
  assert.equal(listItem(c).price.faultAdjusted,true); assert.equal(toListing(listItem(c)).reference.faultAdjusted,true);
  const buyer=secret(); const request=await market.request(c.id,{type:'trade',nickname:'구매',contact:'test@example.invalid',message:'확인 요청'},buyer);
  await market.acknowledge(c.id,request.request.id,owner);
  assert.equal((await store.getCertificate(c.id)).status,'listed');
  await market.outcome(c.id,'sold',owner);
  assert.equal((await store.listCertificates({activeOnly:true})).some(x=>x.id===c.id),false);
  assert.equal(certLib.verify(await store.getCertificate(c.id)),true);
});

test('파손·잔상·화면 불량 기준에는 중복 AI 감가 안 함, AI 기준가에도 별도 감가 표시', async t=>{
  let deductionCalls=0;
  const {service}=environment(t,async ({schema})=>{if(schema.properties.understood){deductionCalls++;return aiDeduct;} return aiEstimate;},'overlap-guard-test');
  for (const conditionCode of ['burn_in','rear_damage','display_fault','damage_or_fault']) {
    const p=await service.priceOf(input({conditionCode,knownFault:'yes',faultDetail_ko:'화면 불량과 충전 불량'}));
    assert.equal(p.faultAdjusted,undefined); assert.ok(p.adjustmentSkipped_ko);
  }
  assert.equal(deductionCalls,0);
  const p=await service.priceOf(input({storage:'2TB',knownFault:'yes',faultDetail_ko:'충전 단자 이상'}));
  assert.equal(p.estimated,true); assert.equal(p.faultAdjusted,true); assert.equal(p.basePrice.estimated,true);
  assert.match(renderPriceReference(p),/AI 추정 기준가/); assert.match(renderPriceReference(p),/해당 조건 업체 자료 없음/);
});

test('키 부재·호출 실패·근거 부족·잘못된 금액 후 수동 플랫폼 등록 유지', async t=>{
  const none=environment(t);
  assert.equal((await none.service.priceOf(input({storage:'2TB'}))).status,'no_data');
  const failed=environment(t,async()=>{throw Error('테스트 대역 호출 실패');},'failure-test');
  const c=await failed.service.createCertificate(body({storage:'2TB',knownFault:'yes',faultDetail:'충전 불량'}));
  assert.equal(c.status,'listed'); assert.equal(c.askingPriceKrw,987654); assert.equal(c.price.status,'no_data'); assert.equal(c.summary.by,'rule');
  let calls=0;const noEvidence=environment(t,async()=>{calls++;return aiEstimate;},'no-evidence-test');
  assert.equal((await noEvidence.service.priceOf(input({brand:'Google',model:'Unknown Pixel',storage:'2TB'}))).status,'no_data'); assert.equal(calls,0);
  const ctx={sameModel:[],sameBrand:[]};
  for(const n of [null,'12000',NaN,-1000,0,1.5]) assert.equal(estimate.normalize({...aiEstimate,minKrw:n},ctx),null);
  for(const n of [null,'12000',NaN,-1000,1.5]) assert.equal(adjust.apply({minKrw:100000,maxKrw:200000},{...aiDeduct,deductionMinKrw:n}),null);
});

test('외관 AI 대역 제안은 사용자 선택을 덮지 않고 불일치·배터리 미측정을 보증서에 보존', async t=>{
  const {service}=environment(t,async ({schema})=>schema.properties.condition ? {condition:{code:'rear_damage',confidence:'low',damages:['후면 파손 제안'],evidence_ko:'분기 검증용 대역',caveats_ko:['실제 사진 정확도 검증 아님']},battery:null} : {summary_ko:'대역',strengths_ko:[],cautions_ko:[],eco_line_ko:''},'exterior-test-double');
  // 이미지 내용은 분석하지 않는 대역. 기기 사진으로 사용하지 않는 1px PNG입니다.
  const dataUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5HkAAAAASUVORK5CYII=';
  const a=await service.analyzePhotos({brand:'Apple',model:'iPhone 12',photos:[{kind:'back',dataUrl}]});
  const c=await service.createCertificate(body({assessId:a.assessId,knownFault:'unknown',conditionCode:'clean'}));
  assert.equal(c.condition.code,'clean');assert.equal(c.assessment.ai.condition.code,'rear_damage');assert.equal(c.assessment.sellerAgreesWithAi,false);assert.equal(c.assessment.battery,null);assert.equal(c.condition.knownFault,'unknown');
  assert.ok(c.trust.reasons.some(x=>x.includes('다름')||x.includes('불일치')));
});

test('시세 갱신 후 추정·감가 캐시 무효화, 처리 중 갱신과 일시 실패도 오래된 결과 사용 금지', async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gc-ai-cache-'));const file=path.join(dir,'prices.csv');
  const oldPath=process.env.PRICE_CSV_PATH;
  t.after(()=>{if(oldPath===undefined)delete process.env.PRICE_CSV_PATH;else process.env.PRICE_CSV_PATH=oldPath;price.datasetInfo();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'gc-ai-cache-'));fs.rmSync(dir,{recursive:true,force:true});});
  const original=fs.readFileSync(livePath,'utf8');fs.writeFileSync(file,original);process.env.PRICE_CSV_PATH=file;
  let version=0;
  const bump=()=>{version++; const next=original.replaceAll('실제 매입가','실제 검수 매입가'+version); fs.writeFileSync(file+'.next',next);fs.renameSync(file+'.next',file);assert.notEqual(price.datasetInfo().revision,digest(original));};
  // 원문 가격 범위가 같아도 다른 행/조건/출처 갱신이면 캐시 무효화
  const {service}=environment(t,async ({schema})=>{if(schema.properties.understood){deductCalls++;return aiDeduct;} estimateCalls++;return aiEstimate;},'cache-revision-test');
  let estimateCalls=0,deductCalls=0;
  const target=input({storage:'2TB'}), fault=input({knownFault:'yes',faultDetail_ko:'버튼 미작동'});
  await service.priceOf(target);await service.priceOf(fault);await service.priceOf(target);await service.priceOf(fault);
  assert.equal(estimateCalls,1);assert.equal(deductCalls,1);
  bump();await service.priceOf(target);await service.priceOf(fault);assert.equal(estimateCalls,2);assert.equal(deductCalls,2);
  const race=environment(t,async()=>{bump();return aiEstimate;},'race-test');
  const stale=await race.service.priceOf(target); assert.equal(stale.status,'no_data'); assert.match(stale.aiUnavailable_ko,/갱신/);
  let retry=0;const transient=environment(t,async()=>{if(++retry===1)throw Error('temporary');return aiEstimate;},'retry-test');
  assert.equal((await transient.service.priceOf(target)).status,'no_data');assert.equal((await transient.service.priceOf(target)).estimated,true);assert.equal(retry,2);
});
