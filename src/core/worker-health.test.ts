import test from 'node:test';
import assert from 'node:assert/strict';
import { workerHealthy } from './worker-health';

test('worker health expires after three completed-work intervals', () => {
  assert.equal(workerHealthy(null, 10_000, 1000), false);
  assert.equal(workerHealthy(1000, 4000, 1000), true);
  assert.equal(workerHealthy(1000, 4001, 1000), false);
});
