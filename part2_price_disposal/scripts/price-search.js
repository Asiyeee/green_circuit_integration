'use strict';
const fs = require('node:fs'), path = require('node:path');
const { loadEnv, getConfig } = require('../../server');
const { searchPrices } = require('../lib/price-search');
const { DEFAULT_CSV, CONTRACTS, mergeCollection, publish } = require('../lib/price-collection');
const { ROOT, fileLease } = require('./price-daily');
async function main() {
  loadEnv(); const args = process.argv.slice(2);
  const option = name => args.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3);
  if (args.includes('--apply') && process.env.PRICE_BUCKET) throw new Error('검색 --apply는 로컬 전용입니다. Cloud 공유 원본은 일별 수집 Job의 검증 경로로 갱신하세요.');
  const query = { brand: option('brand'), model: option('model'), storage: option('storage'), grade: option('grade') };
  const dir = path.join(process.env.PRICE_JOB_DIR || ROOT, 'searches', new Date().toISOString().replace(/[:.]/g, '-'));
  const result = await searchPrices({ cfg: getConfig(), query, dir });
  if (args.includes('--apply')) {
    const lease = fileLease(process.env.PRICE_JOB_DIR || ROOT);
    try {
      const live = process.env.PRICE_CSV_PATH || DEFAULT_CSV, baseBytes = fs.readFileSync(live);
      const collection = { schema: 'vendor-price-collection/v1', mappingVersion: CONTRACTS.mappingVersion, collectedAt: result.searchedAt, offers: result.verified };
      const merged = mergeCollection(baseBytes.toString('utf8'), collection);
      if (!merged.updatedQuotes) throw new Error('기존 정확한 조회 키와 일치하는 검증 견적 없음. 가격표 유지');
      publish({ live, baseBytes, candidate: merged.text, receipt: { source: 'grounded_price_search', query, ...merged, text: undefined }, dir });
    } finally { await lease.release(); }
  }
  console.log(JSON.stringify({ searchedAt: result.searchedAt, model: result.model, verifiedSourceOffers: result.verified.length, rejected: result.rejected, citationErrors: result.citationErrors, directory: dir }, null, 2));
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { main };
