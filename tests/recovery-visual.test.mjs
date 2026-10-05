import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { RECOVERY_COMPOSITE_FS } from '../components/burn/recovery-visual.js';

// Pin the requested original rendering, allowing only the healed-rim fix.
export function withoutRimCleanup(source) {
  return source
    .replace(/uniform float u(?:TailBlend|TailCeiling);/g, '')
    .replace(/(?:burn|charState|charSoft|charWide) = mix\((?:burn|charState|charSoft|charWide), min\((?:burn|charState|charSoft|charWide), uTailCeiling\), uTailBlend\);/g, '')
    .replace('holeDist = mix(holeDist, max(holeDist, 14.0 * px), smoothstep(0.535, 0.56, burn));', '')
    .replace('holeDist = mix(min(holeDist, -2.0 * px), holeDist, smoothstep(0.44, 0.485, burn));', '')
    .replace('float rimMemory = smoothstep(0.05, 0.18, max(burn, charState));', '')
    .replace('spentHold * rimMemory', 'spentHold')
    .replace('shoulder *= rimMemory;', '')
    .replace('lip *= mix(smoothstep(-0.8 * px, 0.8 * px, holeDist), 1.0, rimMemory);', '');
}
const normalize = source => source.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
test('c90860d recovery is preserved apart from consumed/closed material mask corrections', async () => {
  const source = execFileSync('git', ['show', 'c90860d:components/burn/shaders.js'], {encoding:'utf8'});
  const reference = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  assert.equal(normalize(withoutRimCleanup(RECOVERY_COMPOSITE_FS)), normalize(reference.COMPOSITE_FS));
});
