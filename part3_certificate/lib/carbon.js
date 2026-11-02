'use strict';
// 탄소 영수증 계산 (data/device-carbon.json)
// 중고 기기 1대가 재사용되면 새 기기 1대의 '생산 단계' 배출을 피한다고 보고 그 값을 회피량으로 씁니다.
// 공식 값이 없는 기종은 같은 제조사 공식 값의 중앙값으로 추정하고 basis: 'estimate' 로 표시합니다.

const fs = require('fs');
const path = require('path');
const { modelKey } = require('../../part2_price_disposal/lib/price.js');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'device-carbon.json'), 'utf8'));

const round1 = (n) => Math.round(n * 10) / 10;
const storageOrder = (s) => (/TB$/.test(s) ? parseFloat(s) * 1024 : parseFloat(s));
// '5G', 한글 별칭(퀀텀5, 점프3 등)을 떼어낸 느슨한 키. 정확한 키로 못 찾았을 때만 씁니다.
const looseKey = (m) => modelKey(m).replace(/5g/g, '').replace(/[가-힣]+\d*/g, '');

function productionKg(d, storage) {
  if (d.production_kg != null) return { kg: d.production_kg, storageUsed: null, lifecycleKg: d.lifecycle_kg.default };
  const configs = Object.keys(d.lifecycle_kg);
  if (configs.length === 1 && configs[0] === 'default') {
    const lc = d.lifecycle_kg.default;
    return { kg: lc * d.production_share, storageUsed: null, lifecycleKg: lc };
  }
  // 용량별 값이 있으면 그 용량을, 없으면 가장 작은(기본) 용량을 씁니다.
  const used = d.lifecycle_kg[storage] != null
    ? storage
    : configs.sort((a, b) => storageOrder(a) - storageOrder(b))[0];
  const lc = d.lifecycle_kg[used];
  return { kg: lc * d.production_share, storageUsed: used, lifecycleKg: lc };
}

const entries = DATA.devices.map((d) => ({
  d,
  keys: [d.model, ...(d.aliases || [])].map(modelKey),
  loose: [d.model, ...(d.aliases || [])].map(looseKey),
}));

function find(brand, model) {
  const k = modelKey(model);
  const exact = entries.find((e) => e.d.brand === brand && e.keys.includes(k));
  if (exact) return exact.d;
  const lk = looseKey(model);
  const loose = entries.find((e) => e.d.brand === brand && e.loose.includes(lk));
  return loose ? loose.d : null;
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function estimateFor(brand) {
  const same = DATA.devices.filter((d) => d.brand === brand);
  const pool = same.length ? same : DATA.devices;
  return median(pool.map((d) => productionKg(d, null).kg));
}

function receipt({ brand, model, storage }) {
  const eq = DATA.equivalences;
  const d = find(brand, model);
  let avoided;
  let out;
  if (d) {
    const p = productionKg(d, storage);
    const src = DATA.sources[d.source];
    avoided = p.kg;
    out = {
      basis: 'official',
      matchedModel: d.model,
      storageUsed: p.storageUsed,
      storageNote_ko: p.storageUsed && storage && p.storageUsed !== storage
        ? `${storage} 공식 값 없음. ${p.storageUsed} 값 적용` : null,
      lifecycleKg: round1(p.lifecycleKg),
      productionShare: d.production_kg != null ? round1(d.production_kg / p.lifecycleKg * 100) / 100 : d.production_share,
      region: d.region || 'US',
      source: { name: src.name, url: src.url, report: d.report || null },
    };
  } else {
    avoided = estimateFor(brand);
    out = {
      basis: 'estimate',
      matchedModel: null,
      storageUsed: null,
      storageNote_ko: null,
      lifecycleKg: null,
      productionShare: null,
      region: null,
      source: {
        name: `${DATA.devices.some((x) => x.brand === brand) ? brand : '전체'} 공식 값 중앙값 (추정)`,
        url: null,
        report: null,
      },
    };
  }
  return {
    schema: DATA.schema,
    avoidedKg: round1(avoided),
    ...out,
    method_ko: '재사용 1대가 신규 생산 1대를 대체한다고 가정한 최대 추정치',
    equivalence: {
      oakTreesYear: round1(avoided / eq.oak_tree_year_kg),
      label_ko: eq.oak_tree_year_label_ko,
      perTreeKg: eq.oak_tree_year_kg,
      source: eq.oak_tree_year_source,
    },
    checkedOn: DATA.checked_on,
  };
}

module.exports = { receipt, DATA };
