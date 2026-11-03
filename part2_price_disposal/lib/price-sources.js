'use strict';
// 공개 표 전용 파서. 기종·용량·등급 셀이 명확한 경우만 원자료로 채택한다.
const { modelKey } = require('./price');
const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex');
const normalizeText = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
function text(html) {
  return normalizeText(String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ')
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
}
function tables(html) {
  return [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(table => {
    const grid = [], spans = [];
    for (const [i, row] of [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].entries()) {
      const cells = []; let col = 0;
      const fill = () => { while (spans[col]?.until >= i) { cells[col] = spans[col].value; col++; } };
      for (const cell of row[1].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
        fill(); const value = text(cell[3]);
        const rowspan = Number(cell[2].match(/rowspan=["']?(\d+)/i)?.[1] || 1);
        const colspan = Number(cell[2].match(/colspan=["']?(\d+)/i)?.[1] || 1);
        if (rowspan > 100 || colspan > 20) throw new Error('표 병합 범위 초과');
        for (let n = 0; n < colspan; n++) { cells[col] = value; if (rowspan > 1) spans[col] = { value, until: i + rowspan - 1 }; col++; }
      }
      fill(); if (cells.length) grid.push(cells);
    }
    return grid;
  });
}
// 번역만 수행. LTE/5G/s/세대/지역 접미사를 제거하는 유사 모델 병합은 하지 않는다.
function sourceModelKey(s) {
  const key = modelKey(String(s).replace(/아이폰/g, 'iPhone').replace(/갤럭시/g, 'Galaxy').replace(/프로/g, 'Pro').replace(/맥스/g, 'Max').replace(/미니/g, 'mini').replace(/플러스/g, 'plus').replace(/울트라/g, 'Ultra').replace(/폴드/g, 'Fold').replace(/플립/g, 'Flip').replace(/노트/g, 'Note').replace(/엣지/g, 'Edge').replace(/에어/g, 'Air').replace(/\bSE\s*([23])세대/gi, 'SE ($1세대)'));
  // 기존 조사 매뉴얼에 이미 확인·명시된 두 모델만. A52/5G/s 등에는 적용하지 않음.
  return ({ galaxya335g: 'galaxya33', galaxya345g: 'galaxya34' })[key] || key;
}
function amount(raw) {
  const s = normalizeText(raw).replace(/,/g, '').replace(/\s/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)(?:[~～](\d+(?:\.\d+)?))?(만)?(?:원)?$/);
  if (!m) return null; // '-'·별도 문의·0원·감가액은 정상 가격으로 사용하지 않음
  const scale = m[3] ? 10000 : 1, min = +m[1] * scale, max = +(m[2] || m[1]) * scale;
  return min > 0 && max >= min && Number.isSafeInteger(min) && Number.isSafeInteger(max) ? { minKrw: min, maxKrw: max } : null;
}
function section(html, heading) {
  const matches = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const i = matches.findIndex(m => text(m[2]) === heading);
  if (i < 0) throw new Error('조건 섹션 누락: ' + heading);
  const start = matches[i].index + matches[i][0].length;
  const next = matches.slice(i + 1).find(m => +m[1] <= +matches[i][1]);
  return text(html.slice(start, next?.index || html.length));
}
const gradeKey = (s, vendor) => {
  const key = normalizeText(s).replace(/\s+/g, '');
  // 동일 리템즈 그룹의 긴/짧은 원문 표기만 연결. 다른 업체나 그룹 간 대응은 하지 않음.
  return vendor === 'retemz' ? key.replace(/^([ABCD])그룹(?:새제품급|양호|사용감|파손·고장)?$/, '$1그룹') : key;
};
function sourceDate(html, vendor) {
  const plain = text(html);
  if (vendor === 'rediva') {
    const around = plain.slice(plain.indexOf('전체 모델 매입 단가표'), plain.indexOf('전체 모델 매입 단가표') + 300);
    const date = around.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
    return { priceDate: date || null, priceDateText: date || '원문 기준일 미표시' };
  }
  if (vendor === 'uzphone') {
    const m = plain.match(/\b(20\d{2})\.(\d{2})\.(\d{2})\s*기준/);
    return { priceDate: m ? `${m[1]}-${m[2]}-${m[3]}` : null, priceDateText: m?.[0] || '원문 기준일 미표시' };
  }
  const m = vendor === 'retemz' && plain.match(/(\d{1,2}월\s*\d{1,2}일)\s*기준/);
  return { priceDate: null, priceDateText: m ? m[1] + ' (연도 미표시)' : vendor === 'moa' ? '오늘 기준 문구; 날짜 미표시' : '원문 기준일 미표시' };
}
function parseHtml(vendor, html, { url, conditionHtml = html, conditionUrl = url } = {}) {
  const grids = tables(html), plain = text(html), conditions = {}, offers = [], widgetUnconfirmed = new Set();
  let conditionDocument;
  if (vendor === 'phonesam') {
    const grades = ['S급', 'A급', 'B급', 'C급', 'LCD불량'];
    for (const [i, grade] of grades.entries()) {
      const next = grades[i + 1] || '검수후 안내';
      const m = plain.match(new RegExp(`(?:^|\\s)${grade}\\s+([\\d,]+\\s*원|문의)\\s+(.*?)\\s+${next}`));
      if (!m) throw new Error('폰삼 등급 조건 누락: ' + grade);
      conditions[grade] = m[2];
      if (m[1] === '문의') widgetUnconfirmed.add(grade);
    }
    conditionDocument = JSON.stringify(conditions);
  } else if (vendor === 'retemz') {
    conditionDocument = section(html, '등급 기준');
    if (!/A그룹.*B그룹.*C그룹.*D그룹/.test(conditionDocument)) throw new Error('리템즈 등급 정의 누락');
    for (const grade of ['A그룹 새제품급', 'B그룹 양호', 'C그룹 사용감', 'D그룹 파손·고장']) conditions[grade] = conditionDocument;
  } else if (vendor === 'rediva') {
    const policy = tables(conditionHtml).find(g => g[0].join('|') === '대분류|세부구분|A|A-|B+|B|C|F');
    if (!policy || policy.some(r => r.length !== 8)) throw new Error('Rediva 검수표 구조 변경');
    conditionDocument = JSON.stringify(policy);
    for (const grade of ['A급', 'A-급', 'B+급', 'B급']) {
      const column = policy[0].indexOf(grade.replace(/급$/, ''));
      conditions[grade] = policy.slice(1).map(r => `${r[0]}/${r[1]}: ${r[column]}`).join('; ');
    }
  } else if (vendor === 'kspe') {
    const m = html.slice(html.indexOf('</h1>') + 5).match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    if (!m) throw new Error('한국스마트폰거래소 표 설명 누락');
    conditionDocument = text(m[1]);
    for (const grade of ['미개봉/새상품', 'A급', 'B급', 'LCD 파손', '후면 파손']) conditions[grade] = grade + '. ' + conditionDocument + ' 세부 기능·배터리 허용 조건은 미표시';
  } else if (vendor === 'moa') {
    const definitions = tables(conditionHtml).find(g => g[0].join('|') === '등급|외관|기능');
    if (!definitions || definitions.length !== 4) throw new Error('모아 등급 표 구조 변경');
    conditionDocument = JSON.stringify(definitions);
    for (const row of definitions.slice(1)) conditions[row[0] + '등급'] = row.slice(1).join('; ');
  } else if (vendor === 'uzphone') {
    const definitions = grids.find(g => g[0].join('|') === '등급|기준|매입가');
    if (!definitions) throw new Error('유즈폰 등급 정의 누락');
    for (const row of definitions.slice(1)) { if (row.length !== 3) throw new Error('유즈폰 조건 표 구조 변경'); conditions[row[0]] = row[1]; }
    conditionDocument = JSON.stringify(conditions);
  } else throw new Error('지원하지 않는 HTML 업체');
  const date = sourceDate(html, vendor);
  const singleModel = ['phonesam', 'retemz', 'uzphone'].includes(vendor) ? text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '').replace(/\s*(?:중고 매입 시세|매입|중고 시세).*$/, '').trim() : null;
  if (singleModel === '') throw new Error('페이지 기종 제목 누락');
  const emit = (sourceModel, storage, grade, raw, brand) => {
    const price = amount(raw);
    const widgetConflict = !!price && widgetUnconfirmed.has(grade);
    if (!/^(?:\d+GB|[12]TB)$/.test(storage)) return; // '모름'/전용량/빈 용량 제외
    offers.push({ vendor, brand: brand || (/^iphone/i.test(sourceModelKey(sourceModel)) ? 'Apple' : /^galaxy/i.test(sourceModelKey(sourceModel)) ? 'Samsung' : null), sourceModel, modelKey: sourceModelKey(sourceModel), storage, grade, gradeKey: gradeKey(grade, vendor), rawAmount: raw, ...price, conditionsText: conditions[grade] || null, conditionSignature: digest(conditionDocument), conditionDocument, sourceUrl: url, conditionSourceUrl: conditionUrl, ...date, eligible: !!price && !!conditions[grade] && !widgetConflict, rejection: !price ? '금액 없음/형식 불명확' : !conditions[grade] ? '등급 조건 미검증' : widgetConflict ? '동일 페이지 상태 선택은 문의인데 용량 표에는 숫자가 있어 반영 보류' : null });
  };
  for (const grid of grids) {
    const header = grid[0]; let kind;
    if (['phonesam', 'retemz', 'uzphone'].includes(vendor) && header[0] === '용량') kind = 'single';
    if (vendor === 'rediva' && header.join('|') === '모델|용량|A급|A-급|B+급|B급') kind = 'multi';
    if (vendor === 'kspe' && header.join('|') === '제조사|모델명|용량|미개봉/새상품|A급|B급|LCD 파손|후면 파손') kind = 'kspe';
    if (vendor === 'moa' && header.join('|') === '기종 (자급제·공기계 기준)|A등급|B등급|C등급') kind = 'moa';
    if (!kind) continue;
    for (const row of grid.slice(1)) {
      if (row.length !== header.length) throw new Error('가격 표 열 수 불일치');
      let model, storage, begin, brand;
      if (kind === 'single') { model = singleModel; storage = row[0].replace(/\s*팔기$/, ''); begin = 1; }
      if (kind === 'multi') { [model, storage] = row; begin = 2; }
      if (kind === 'kspe') { brand = ({ 애플: 'Apple', 삼성: 'Samsung' })[row[0]]; if (!brand) continue; model = row[1]; storage = row[2]; begin = 3; }
      if (kind === 'moa') { const m = row[0].match(/^(.*?)\s+(\d+GB|[12]TB)$/); if (!m) continue; model = m[1]; storage = m[2]; begin = 1; }
      for (let col = begin; col < row.length; col++) emit(model, storage, header[col], row[col], brand);
    }
  }
  if (!offers.length) throw new Error('명시적인 기종·용량·등급별 가격 표 없음');
  return { offers, conditionSignature: digest(conditionDocument), conditionDocument, warnings: [...new Set(offers.filter(o => o.rejection?.includes('동일 페이지')).map(o => o.rejection))] };
}
function parseMintit(result, grades, { url, conditionUrl, modelCode }) {
  if (result.code !== 'APP_0000' || grades.code !== 'APP_0000') throw new Error('민팃 공개 API 오류');
  const data = result.dataset;
  if (data.model_no !== modelCode || data.model !== modelCode) throw new Error('민팃 응답 기종 코드 불일치');
  const storage = modelCode.match(/-(\d+)G$/)?.[1];
  const brand = modelCode.startsWith('AIP') ? 'Apple' : 'Samsung';
  const definitions = grades.dataset[brand === 'Apple' ? 'ios' : 'android'];
  if (!storage || !Array.isArray(definitions)) throw new Error('민팃 용량/등급 미확인');
  const conditionDocument = JSON.stringify(definitions), conditionSignature = digest(conditionDocument);
  return { conditionDocument, conditionSignature, offers: data.price_list.map(p => {
    const def = definitions.find(g => g.code === p.code), readable = def && /[가-힣]/.test(def.description) && !/[?�]{2}/.test(JSON.stringify(def));
    return { vendor: 'mintit', brand, sourceModel: data.generation, modelKey: sourceModelKey(data.generation), storage: storage + 'GB', grade: p.code + '등급', gradeKey: p.code + '등급', rawAmount: String(p.price), minKrw: p.price, maxKrw: p.price, sourceUrl: url, conditionSourceUrl: conditionUrl, conditionsText: def ? JSON.stringify(def) : null, conditionDocument, conditionSignature, priceDate: data.price_reg_date?.slice(0, 10) || null, priceDateText: data.price_reg_date || '원문 기준일 미표시', eligible: !!readable && Number.isSafeInteger(p.price) && p.price > 0, rejection: readable ? null : '민팃 등급 조건 응답이 물음표/깨진 문자여서 조건 검증 불가' };
  }) };
}
module.exports = { text, tables, amount, section, sourceModelKey, gradeKey, digest, parseHtml, parseMintit };
