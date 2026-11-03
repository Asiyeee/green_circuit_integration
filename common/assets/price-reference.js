(function (root) {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const won = n => Number(n).toLocaleString('ko-KR') + '원';
  const range = p => p.minKrw === p.maxKrw ? won(p.minKrw) : won(p.minKrw) + ' ~ ' + won(p.maxKrw);
  const confidence = c => ({high:'높음',medium:'보통',low:'낮음'}[c] || '미확인');
  const link = (url, label) => /^https:\/\//.test(url || '') ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>` : esc(label);
  function renderPriceReference(p) {
    if (p.status !== 'ok') return `<div class="k">업체 원문 참고가: 자료 없음·미확정</div><p>${esc(p.message_ko)}</p><p>${esc(p.aiUnavailable_ko || '')} 상태를 공개하고 판매 희망가를 직접 입력해 등록할 수 있습니다.</p>`;
    const ai = !!p.estimated, adjusted = !!p.faultAdjusted;
    const header = adjusted ? 'AI 감가 후 참고가' : ai ? 'AI 추정 참고가' : '업체 원문 참고가';
    let html = `<div class="k">${header}</div><div class="price v">${range(p)}</div>`;
    if (ai) html += `<p class="price-sub s">이 조합의 업체 원문 가격 자료 없음. AI 추정 제공 · 확신 ${confidence(p.confidence)}. ${esc(p.basis_ko)}</p>`;
    else html += `<p class="price-sub s">${esc(p.label_ko)} · 업체 ${p.vendorCount}곳 · 견적 ${p.quoteCount}건</p>`;
    if (p.reclassified_ko) html += `<p>${esc(p.reclassified_ko)}</p>`;
    if (adjusted) html += `<p><b>${p.basePrice.estimated ? 'AI 추정 기준가 (해당 조건 업체 자료 없음)' : '업체 원문 기준가 (기능 정상 전제)'}</b>: ${range(p.basePrice)}<br><b>사용자 고장 설명</b>: ${esc(p.sellerFaultDetail_ko)}<br><b>AI 해석</b>: ${esc(p.deduction.faultLabel_ko)}<br><b>AI 감가 추정</b>: ${range(p.deduction)} · 확신 ${confidence(p.deduction.confidence)}<br>${esc(p.deduction.basis_ko)}</p><p class="notice">감가액은 AI 추정이며 검증된 수리비·기기 직접 진단·업체 확인 가격이 아닙니다.</p>`;
    html += `<p class="price-sub s">${esc(p.notice_ko)} 개인 간 실거래가·보장 판매가가 아닙니다. 판매 희망가는 판매자가 별도로 정합니다.</p>`;
    if (p.adjustmentSkipped_ko) html += `<p>${esc(p.adjustmentSkipped_ko)}</p>`;
    if (p.aiUnavailable_ko) html += `<p>${esc(p.aiUnavailable_ko)}</p>`;
    if (p.dataWarning) html += `<p class="notice">${esc(p.dataWarning)}</p>`;
    if (p.quotes?.length) html += `<details><summary>업체별 원문 견적${adjusted ? ' (감가 전 기준가)' : ''}</summary><p class="s">자료 확인일 ${esc(p.checkedOn)} · 실시간 가격 아님. 업체 등급·조건은 서로 다르며 배터리별 정밀 보정 가격이 아닙니다.</p>${p.quotes.map(q=>`<p class="s">${link(q.url,q.vendor)} · ${esc(q.sourceModel || p.displayModel || p.model)} · ${esc(p.storage)} · 원래 등급 ${esc(q.sourceGrade || q.grade)} · ${range(q)}<br>${esc(q.conditions_ko)}<br>수집 원문 조건: ${esc(q.sourceConditions_ko || q.conditions_ko)}<br>원문 가격 기준일: ${esc(q.priceDate || q.priceDateSource || '미표시')} · 수집: ${esc(q.collectedAt || '이전 자료 유지')}</p>`).join('')}</details>`;
    if (p.evidenceRows?.length) html += `<details><summary>AI 추정 근거 업체 자료 ${p.evidenceRows.length}행 (대상 조합의 실제 가격 아님)</summary>${p.evidenceRows.map(r=>`<p class="s">${esc(r.model)} ${esc(r.storage)} · ${esc(r.condition)} · ${range(r)} · 확인일 ${esc(r.checkedOn)}<br>${(r.sources || []).map(q=>link(q.url, q.vendor + ' / ' + q.grade)).join(' · ')}</p>`).join('')}</details>`;
    if (p.latestCollectedAt) html += `<p class="s">최근 공개 출처 수집: ${esc(p.latestCollectedAt)} (원문 기준일과 별도). ${p.partiallyRefreshed ? '일부 출처는 이전 자료 유지.' : ''}</p>`;
    return html;
  }
  if (typeof module !== 'undefined') module.exports = { renderPriceReference };
  else root.renderPriceReference = renderPriceReference;
})(globalThis);
