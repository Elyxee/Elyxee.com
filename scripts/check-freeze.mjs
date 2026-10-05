import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = JSON.parse(await readFile(join(root, 'docs/frozen-files.json'), 'utf8'));
const differences = [];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function walk(directory) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files = await Promise.all(entries.filter(entry => entry.name !== '.DS_Store').map(async entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return files.flat();
}

for (const [path, expected] of Object.entries(baseline.files)) {
  try {
    if (sha256(await readFile(join(root, path))) !== expected) differences.push(`CHANGED ${path}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    differences.push(`MISSING ${path}`);
  }
}

const current = ['index.html', 'styles.css', ...await walk('components'), ...await walk('Assets')];
for (const path of current) {
  const normalized = relative(root, join(root, path)).split('\\').join('/');
  if (!(normalized in baseline.files)) differences.push(`UNRECORDED ${normalized}`);
}
const htmlFiles = (await readdir(root)).filter(name => name.endsWith('.html') && name !== 'index.html');
for (const path of htmlFiles) differences.push(`EXTRA ENTRY ${path}`);

if (differences.length) {
  console.error(differences.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${Object.keys(baseline.files).length} frozen files match ${baseline.date}; index.html is the only page entry.`);
}
