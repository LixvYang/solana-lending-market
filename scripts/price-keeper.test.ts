import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('keeper 缺少专用钱包时明确报错且不回退管理员钱包', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/price-keeper.ts'], {
    encoding: 'utf8', env: { ...process.env, KEEPER_KEYPAIR: '', ANCHOR_WALLET: '/unused/admin.json', RPC_URL: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺少 KEEPER_KEYPAIR/);
  assert.doesNotMatch(result.stderr, /ANCHOR_WALLET/);
});
