// Stamps content hashes into index.html, so that after a deploy no browser
// mixes an old file with a new one:
//   - an import map gives every module under components/ a ?v=<hash> URL,
//     which keeps the import statements themselves plain ("./burn.js");
//   - each local stylesheet link and the entry script get the same stamp.
// A file's stamp changes only when its own content changes.
//
// After changing any module or stylesheet:  node scripts/stamp-versions.mjs
// tests/site/versions.test.mjs fails while a stamp is stale.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const HTML = join(ROOT, 'index.html');

const hash = path => createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex').slice(0, 8);
const stamped = path => `/${path}?v=${hash(path)}`;

export function modules(dir = 'components') {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return modules(path);
    return entry.name.endsWith('.js') ? [path] : [];
  }).sort();
}

export function importMap() {
  return { imports: Object.fromEntries(modules().map(path => [`/${path}`, stamped(path)])) };
}

export function stampHtml(html) {
  const json = JSON.stringify(importMap(), null, 2).split('\n').join('\n      ');
  const block = `<script type="importmap">\n      ${json}\n    </script>`;
  if (!/<script type="importmap">[\s\S]*?<\/script>/.test(html)) throw new Error('index.html has no import map block');
  return html
    .replace(/<script type="importmap">[\s\S]*?<\/script>/, block)
    .replace(/(<link rel="stylesheet" href=")\/([^"?]+\.css)(?:\?v=[^"]*)?(")/g,
      (_, before, path, after) => `${before}${stamped(path)}${after}`)
    .replace(/(<script type="module" src=")\/([^"?]+\.js)(?:\?v=[^"]*)?(")/g,
      (_, before, path, after) => `${before}${stamped(path)}${after}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const before = readFileSync(HTML, 'utf8');
  const after = stampHtml(before);
  if (after === before) console.log('index.html stamps are current.');
  else { writeFileSync(HTML, after); console.log('index.html stamps updated.'); }
}
