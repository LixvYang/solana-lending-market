import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deskIsShort } from './stock';

test('库存不足只在买入数量超过兑换台可用量时触发', () => {
  assert.equal(deskIsShort(101n, '100'), true);
  assert.equal(deskIsShort(100n, '100'), false);
  assert.equal(deskIsShort(99n, '100'), false);
  assert.equal(deskIsShort(null, '100'), false);
  // 库存未知时不拦截。
  assert.equal(deskIsShort(101n, null), false);
  assert.equal(deskIsShort(101n, undefined), false);
});
