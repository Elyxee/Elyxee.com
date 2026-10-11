import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HTML, ROOT, modules, stampHtml } from '../../scripts/stamp-versions.mjs';

test('index.html stamps match the current files (run: node scripts/stamp-versions.mjs)', () => {
  const html = readFileSync(HTML, 'utf8');
  assert.equal(stampHtml(html), html);
});

test('import specifiers stay plain, so every module is versioned by the import map alone', () => {
  // A ?v= in one specifier and not another would load two copies of a module.
  const offenders = modules().filter(path =>
    /(?:from\s*|import\s*\()\s*["'][^"']*\?v=/.test(readFileSync(join(ROOT, path), 'utf8')));
  assert.deepEqual(offenders, []);
});
