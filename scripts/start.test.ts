import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedService } from './service';

test('service entry accepts only the four supported workers', () => {
  for (const name of ['api', 'faucet', 'keeper', 'ingest']) assert.equal(selectedService(name), name);
  for (const name of [undefined, '', 'worker', 'API']) assert.throws(() => selectedService(name), /SERVICE/);
});
