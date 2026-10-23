import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowOrigin } from './http-body';

// 2026-10-23 实测:5173 被占用时 Vite 换到 5174,兑换台只回显 5173,浏览器拦下汇率请求，兑换页一直"读取汇率中…"。
test('本机开发的任意端口都放行;配置的部署域名放行;其他来源不回显', () => {
  const before = process.env.ALLOWED_ORIGINS;
  try {
    delete process.env.ALLOWED_ORIGINS;
    for (const origin of ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:4173'])
      assert.equal(allowOrigin(origin), origin);
    for (const origin of ['https://evil.example', 'http://localhost.evil.example:5174', 'http://localhost'])
      assert.notEqual(allowOrigin(origin), origin);
    process.env.ALLOWED_ORIGINS = 'https://app.example.com, https://preview.example.com';
    assert.equal(allowOrigin('https://app.example.com'), 'https://app.example.com');
    assert.equal(allowOrigin('http://localhost:5174'), 'http://localhost:5174');
    assert.notEqual(allowOrigin('https://evil.example'), 'https://evil.example');
  } finally {
    if (before === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = before;
  }
});
