import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PublicKey } from '@solana/web3.js';
import { DISCRIMINATOR, FEED_SIZE, OFFSET, mocksProgram, resultRegion, toFixed18, writeIx } from './mock-feed';

// 链上真实的、从未被 crank 过的 Switchboard 账户(owner 为 Aio4g…，由 M1 剧本用 initIx 创建)。
const real = readFileSync('fixtures/switchboard-pullfeed-uncranked.bin');

test('偏移与链上真实 PullFeedAccountData 对得上', () => {
  assert.equal(real.length, FEED_SIZE);
  assert.deepEqual(real.subarray(0, 8), DISCRIMINATOR);
  assert.equal(new PublicKey(real.subarray(OFFSET.authority, OFFSET.authority + 32)).toBase58(),
    '6LzQJAR4A7KRcSHYhBhXdv4pcUuzAQtAfMMhoGDZ8NL9');
  assert.equal(new PublicKey(real.subarray(OFFSET.queue, OFFSET.queue + 32)).toBase58(),
    'EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7');
  assert.equal(real.subarray(OFFSET.name, OFFSET.name + 8).toString(), 'M1 tUSDC');
  assert.equal(real.readUInt32LE(OFFSET.minResponses), 1);
  assert.equal(real.readUInt32LE(OFFSET.maxStaleness), 150);
});

test('价格区域：值、时间戳与 slot 落在预期位置', () => {
  const region = resultRegion(100, 1_700_000_000, 12345);
  assert.equal(region.length, OFFSET.maxStaleness - OFFSET.sampleSize);
  assert.equal(region.readUInt8(0), 1);
  assert.equal(region.readBigInt64LE(1), 1_700_000_000n);
  const at = OFFSET.result - OFFSET.sampleSize;
  const value = region.readBigUInt64LE(at) + (region.readBigInt64LE(at + 8) << 64n);
  assert.equal(value, 100n * 10n ** 18n);
  assert.equal(region.readBigUInt64LE(at + 6 * 16 + 8), 12345n);
});

test('定点数与 write 指令编码', () => {
  assert.equal(toFixed18(0.5), 5n * 10n ** 17n);
  const ix = writeIx(PublicKey.default, PublicKey.default, 2215, Buffer.from([1, 2, 3]), PublicKey.default);
  assert.equal(ix.data.readBigUInt64LE(8), 2215n);
  assert.equal(ix.data.readUInt32LE(16), 3);
  assert.deepEqual([...ix.data.subarray(20)], [1, 2, 3]);
  assert.equal(ix.keys[0].isSigner, true);
});

test('没有本地 program/out 构建产物时读取入库的公开 devnet mocks 地址', () => {
  assert.equal(mocksProgram('/missing/program-ids.json', 'program/devnet.json').toBase58(),
    '3UNhKQCzvj4ZXRP7BBy25STrRAh8VMtBiKmXimGUWAt7');
});
