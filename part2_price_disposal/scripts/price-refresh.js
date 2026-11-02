'use strict';
// 오프라인 후보 검증/승격. 네트워크 수집·Gemini 가격 생성·스케줄 실행은 하지 않음.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseCsv, modelKey, CONDITIONS } = require('../lib/price');
const LIVE = path.resolve(__dirname, '../data/중고폰_시세_통합.csv');
const HOSTS = new Set(['phonesam.com', 'rediva.ai', 'retemz.com', 'kspeinc.com', 'mintit.co.kr', 'moa.must-pick.com', 'uzphone.co.kr']);
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
function validate(text) {
  const errors = [], rows = [], keys = new Set(), ids = new Set();
  const [headers = [], ...lines] = parseCsv(text.replace(/^\uFEFF/, ''));
  const required = ['schema_version', 'reference_id', 'brand', 'model', 'model_key', 'storage', 'condition_code', 'condition_label_ko', 'condition_description_ko', 'requires_no_known_function_fault', 'reference_min_krw', 'reference_max_krw', 'vendor_count', 'quote_count', 'reference_kind', 'checked_on', 'mapping_version', 'notice_ko', 'source_quotes_json'];
  for (const h of required) if (!headers.includes(h)) errors.push(`필수 열 누락: ${h}`);
  if (new Set(headers).size !== headers.length) errors.push('중복 헤더');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d && d <= today;
  const amount = (n) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
  const urlOk = (s) => { try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password && HOSTS.has(u.hostname.replace(/^www\./, '')); } catch { return false; } };
  for (const [i, line] of lines.entries()) {
    const row = Object.fromEntries(headers.map((h, j) => [h, line[j]])); rows.push(row);
    const bad = (m) => errors.push(`행 ${i + 2}: ${m}`);
    if (line.length !== headers.length) bad('열 수 불일치');
    if (row.schema_version !== 'phone-price-reference/v1' || row.mapping_version !== 'service-condition-map/v1') bad('알 수 없는 버전');
    if (!['Apple', 'Samsung'].includes(row.brand) || !row.model || modelKey(row.model) !== row.model_key) bad('제조사·모델키 불일치');
    if (!/^(?:\d+GB|[12]TB)$/.test(row.storage)) bad('저장 용량 형식 오류');
    if (!CONDITIONS.some(c => c.code === row.condition_code)) bad('상태 코드 오류');
    if (!['true', 'false'].includes(row.requires_no_known_function_fault)) bad('기능 조건 오류');
    if (['clean', 'minor_wear', 'visible_wear', 'burn_in'].includes(row.condition_code) && row.requires_no_known_function_fault !== 'true') bad('정상 기능 전제 상태의 조건 누락');
    if (!row.condition_label_ko || !row.condition_description_ko || !row.notice_ko) bad('조건 설명·주의사항 누락');
    if (!date(row.checked_on)) bad('자료 확인일 오류 또는 미래 날짜');
    const key = [row.brand, row.model_key, row.storage, row.condition_code].join('|');
    if (keys.has(key)) bad('중복·충돌 조회 키 (마지막 행으로 덮어쓰기 금지)'); keys.add(key);
    if (!row.reference_id || ids.has(row.reference_id)) bad('중복·누락 reference_id'); ids.add(row.reference_id);
    let quotes;
    try { quotes = JSON.parse(row.source_quotes_json); } catch { bad('원문 견적 JSON 오류'); continue; }
    if (!Array.isArray(quotes) || !quotes.length) { bad('원문 견적 없음'); continue; }
    for (const q of quotes) {
      if (!q.vendor || !q.vendor_name || !q.grade || !q.conditions_ko || !q.verification_method) bad('업체·등급·조건·검증방법 누락');
      if (!amount(q.min_krw) || !amount(q.max_krw) || q.min_krw > q.max_krw) bad('원문 금액 오류');
      if (!urlOk(q.source_url) || !urlOk(q.condition_source_url)) bad('허용된 업체의 HTTPS 출처·조건 링크 필요');
      if (q.price_date && !date(q.price_date)) bad('원문 가격 기준일 오류');
      if (!q.price_date && !q.price_date_source) bad('원문 가격 기준일 미표시 사유 누락');
    }
    const vendors = new Set(quotes.map(q => q.vendor));
    if (+row.vendor_count !== vendors.size || +row.quote_count !== quotes.length) bad('업체 수·견적 수 불일치');
    if (row.reference_kind !== (vendors.size === 1 ? 'single_vendor_reference' : 'multi_vendor_reference')) bad('참고가 종류 불일치');
    if (!amount(+row.reference_min_krw) || !amount(+row.reference_max_krw) || +row.reference_min_krw !== Math.min(...quotes.map(q => q.min_krw)) || +row.reference_max_krw !== Math.max(...quotes.map(q => q.max_krw))) bad('집계 범위·원문 금액 불일치');
  }
  if (!rows.length) errors.push('빈 시세 파일');
  return { errors, rows };
}
function promote(candidate, reviewPath, live = LIVE) {
  const bytes = fs.readFileSync(candidate), text = bytes.toString('utf8');
  const { errors, rows } = validate(text);
  if (errors.length) throw new Error(errors.join('\n'));
  const current = fs.readFileSync(live), review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  if (review.candidateSha256 !== sha(bytes) || review.baseSha256 !== sha(current)) throw new Error('검토 대상 또는 기존 파일 해시 불일치 (충돌 재검토 필요)');
  if (!review.reviewer || !review.reviewedAt || !Number.isFinite(Date.parse(review.reviewedAt)) || Date.parse(review.reviewedAt) > Date.now()) throw new Error('검토자·검토일 필요');
  if (review.fullSnapshotConfirmed !== true || review.modelStorageGradeAmountsConfirmed !== true) throw new Error('전체 스냅샷·기종/용량/등급/금액 확인 필요');
  // 바뀐 모든 출처에 사람이 검토한 실제 원문 증빙 파일 필요. 메타데이터만 믿고 가격을 생성하지 않음.
  const requiredUrls = new Set(rows.flatMap(r => JSON.parse(r.source_quotes_json).flatMap(q => [q.source_url, q.condition_source_url])));
  const verified = new Set();
  for (const s of review.sources || []) {
    if (!requiredUrls.has(s.url) || s.verified !== true || !s.evidenceFile || !s.evidenceSha256) throw new Error('출처 검증 기록 오류');
    const base = path.dirname(path.resolve(reviewPath)), evidence = path.resolve(base, s.evidenceFile);
    if (s.evidenceFile === '' || !evidence.startsWith(base + path.sep) || sha(fs.readFileSync(evidence)) !== s.evidenceSha256) throw new Error('출처 증빙 파일 경로·해시 불일치');
    verified.add(s.url);
  }
  if ([...requiredUrls].some(url => !verified.has(url))) throw new Error('미검증 출처가 있어 승격하지 않음');
  const folder = path.join(path.dirname(live), 'refresh-backups');
  fs.mkdirSync(folder, { recursive: true });
  const tag = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(folder, `${tag}.csv`), current, { flag: 'wx' });
  fs.writeFileSync(path.join(folder, `${tag}.review.json`), JSON.stringify(review, null, 2), { flag: 'wx' });
  // 검토 중 다른 갱신이 있으면 기존 자료 보존. 스케줄러도 단일 writer로 실행할 것.
  const lock = `${live}.lock`; const fd = fs.openSync(lock, 'wx');
  try {
    if (sha(fs.readFileSync(live)) !== review.baseSha256) throw new Error('승격 직전 자료 변경 감지');
    fs.writeFileSync(`${live}.next`, bytes);
    fs.renameSync(`${live}.next`, live);
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  return { rows: rows.length, candidateSha256: sha(bytes), restartRequired: true };
}
if (require.main === module) {
  try {
    const [mode = 'validate', file = LIVE, review] = process.argv.slice(2);
    if (mode === 'promote') { if (!review) throw new Error('검토 JSON 파일 필요'); console.log(JSON.stringify(promote(file, review))); }
    else if (mode === 'validate') { const result = validate(fs.readFileSync(file, 'utf8')); console.log(JSON.stringify({ rows: result.rows.length, errors: result.errors }, null, 2)); if (result.errors.length) process.exitCode = 1; }
    else throw new Error('사용: node price-refresh.js validate [후보.csv] | promote 후보.csv 검토.json');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { validate, promote, sha };
