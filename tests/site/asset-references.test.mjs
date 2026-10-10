import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DUST_ARTWORKS, SPACE_ARTWORKS } from '../../components/portrait/artworks.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

function sources(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(js|css)$/.test(entry.name) ? [path] : [];
  });
}

test('every literal asset path resolves to a file', () => {
  const missing = [];
  let checked = 0;
  for (const file of ['index.html', 'styles.css', ...sources('components')]) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const [, path] of text.matchAll(/["'(]((?:\.\.?\/)*Assets\/[^"'()$]+)["')]/g)) {
      // ./ and ../ resolve from the source file; bare paths from the page.
      const resolved = path.startsWith('.') ? join(root, dirname(file), path) : join(root, path);
      checked++;
      if (!existsSync(resolved)) missing.push(`${file}: ${path}`);
    }
  }
  assert.ok(checked > 30, `only ${checked} references found`);
  assert.deepEqual(missing, []);
});

test('every artwork cover resolves to a file', () => {
  for (const art of [...DUST_ARTWORKS, ...SPACE_ARTWORKS]) {
    const path = fileURLToPath(art.src);
    assert.ok(existsSync(path), relative(root, path));
  }
});
