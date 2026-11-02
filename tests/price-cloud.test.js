'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createCloudSync, checked } = require('../part2_price_disposal/lib/price-cloud');
const { DEFAULT_CSV } = require('../part2_price_disposal/lib/price-collection');
const { sha } = require('../part2_price_disposal/scripts/price-refresh');
test('Cloud Storage 클라이언트 대역: 세대 지정 다운로드/동시 요청 합치기/오염 파일 보존', async () => {
  // 네트워크나 실제 Google 자격증명을 쓰지 않는 회귀 테스트. 실제 Cloud Run 검증으로 계산하지 않음.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-cloud-price-'));
  const live = path.join(dir, 'snapshot.csv'), original = fs.readFileSync(DEFAULT_CSV);
  let bytes = original, generation = '1', metaHash = sha(bytes), metadataCalls = 0, warning;
  const storage = { bucket: () => ({ file: (_object, options) => ({
    getMetadata: async () => { metadataCalls++; return [{ generation, metadata: { csvSha256: metaHash, verification: 'green-circuit-collection/v1' } }]; },
    download: async () => { assert.equal(options.generation, generation); return [bytes]; },
  }) }) };
  try {
    const sync = createCloudSync({ storage, bucketName: 'test-bucket', live, intervalMs: 0, onWarning: value => { warning = value; } });
    await Promise.all([sync.ensure(), sync.ensure()]);
    assert.equal(metadataCalls, 1); assert.equal(warning, null); assert.equal(sha(fs.readFileSync(live)), sha(original));
    generation = '2'; bytes = Buffer.from('corrupt source'); metaHash = sha(bytes);
    await sync.ensure(); assert.ok(warning); assert.equal(sha(fs.readFileSync(live)), sha(original));
    generation = '3'; bytes = original; metaHash = 'incorrect hash';
    await sync.ensure(); assert.ok(warning); assert.equal(sha(fs.readFileSync(live)), sha(original));
    generation = '4'; metaHash = sha(original); await sync.ensure(); assert.equal(warning, null);
    assert.throws(() => checked(Buffer.from('empty')), /검증 실패/);
  } finally { assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'gc-cloud-price-')); fs.rmSync(dir, { recursive: true, force: true }); }
});
