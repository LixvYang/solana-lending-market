import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { en } from './en';
import { zh } from './zh';

test('Chinese and English dictionaries have matching keys and non-empty messages', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const [key, value] of Object.entries(zh)) {
    const sample = typeof value === 'function' ? (value as (...args: string[]) => string)('5', '5', '5') : value;
    assert.ok(sample.trim(), `zh.${key} is empty`);
    const translated = en[key as keyof typeof en];
    const translatedSample = typeof translated === 'function' ? (translated as (...args: string[]) => string)('5', '5', '5') : translated;
    assert.ok(translatedSample.trim(), `en.${key} is empty`);
  }
});

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(file);
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.test.ts') || entry.name === 'mock.ts' || entry.name === 'mock-xray.json') return [];
    if (file.includes(`${path.sep}i18n${path.sep}`)) return [];
    return [file];
  }));
  return nested.flat();
}

test('UI source has no CJK literals outside dictionaries and tests', async () => {
  const cjk = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;
  const files = await sources(path.resolve(process.cwd(), 'web/src'));
  const hits: string[] = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      const isText = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node);
      if (isText && cjk.test(node.getText(tree))) hits.push(`${path.relative(process.cwd(), file)}: ${node.getText(tree).trim()}`);
      if (ts.isTemplateExpression(node)) {
        if (cjk.test(node.head.text)) hits.push(`${path.relative(process.cwd(), file)}: ${node.head.text.trim()}`);
        for (const span of node.templateSpans) if (cjk.test(span.literal.text)) hits.push(`${path.relative(process.cwd(), file)}: ${span.literal.text.trim()}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  assert.deepEqual(hits, []);
});
