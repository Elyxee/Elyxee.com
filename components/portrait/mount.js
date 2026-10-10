import { initPortrait } from './portrait.js?v=6';
import { FRAME_ITEMS } from './gallery-items.js';
import { GALLERY_SEQUENCES } from './gallery-sequence.js';
import { gallerySource } from './artworks.js?v=3';

// Page bootstrap for the Dust & Space study, shared by portrait.html and the
// merged site. It only wires the existing DOM (scene switch, static fallback
// frames) to initPortrait; every effect lives untouched in portrait.js.
export async function mountPortrait({ root, scene = 1, onHome }) {
  // The fallback heads stay unrequested until now, leaving the opening's
  // bandwidth to Home. They are the same files the effect loads below.
  root.querySelectorAll('img[data-src]').forEach(image => { image.src = image.dataset.src; });
  const home = document.createElement('a');
  home.className = 'portrait-home';
  home.href = './index.html';
  home.textContent = 'Elyxee';
  home.setAttribute('aria-label', 'Elyxee home');
  home.addEventListener('click', event => {
    if (!onHome || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onHome();
  });
  root.append(home);
  const button = root.querySelector('.scene-switch');
  const label = button.querySelector('.scene-switch__label');
  const status = root.querySelector('#scene-status');
  // Scene-specific linework cradles the caption, rather than framing a button.
  const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mark.classList.add('scene-switch__mark');
  mark.setAttribute('viewBox', '0 0 210 76');
  mark.setAttribute('aria-hidden', 'true');
  mark.setAttribute('focusable', 'false');
  mark.innerHTML = `
    <g class="scene-switch__dunes" fill="none" stroke="currentColor" stroke-linecap="round">
      <path d="M4 49C21 49 29 24 48 21C66 18 71 31 84 33" stroke-width="1.2"/>
      <path d="M9 54C33 53 39 36 57 35M16 59C43 59 50 51 71 53S111 65 143 61S176 50 202 53" stroke-width=".8"/>
      <path d="M31 65C68 57 92 72 125 68S163 58 186 61" stroke-width=".65" opacity=".6"/>
      <path d="M15 42L19 41M91 26L98 27M165 44L169 44M184 37L187 37" stroke-width="1" opacity=".7"/>
      <circle cx="54" cy="15" r="2.8" stroke-width=".8"/>
      <circle cx="106" cy="19" r=".8" fill="currentColor" stroke="none"/>
      <circle cx="193" cy="61" r=".8" fill="currentColor" stroke="none"/>
    </g>
    <g class="scene-switch__orbit" fill="none" stroke="currentColor" stroke-linecap="round">
      <ellipse cx="32" cy="34" rx="23" ry="12" transform="rotate(-32 32 34)" stroke-width=".75"/>
      <path d="M23 13C8 24 17 53 40 58C73 67 85 56 107 60S156 68 191 59" stroke-width=".7" opacity=".55"/>
      <path d="M26 29V39M32 24V44M38 30V38" stroke-width="1"/>
      <path d="M68 22L94 16L126 24L154 19" stroke-width=".55" opacity=".35"/>
      <g fill="currentColor" stroke="none">
        <circle cx="51" cy="21" r="1.7"/><circle cx="68" cy="22" r="1"/>
        <circle cx="94" cy="16" r="1.35"/><circle cx="126" cy="24" r=".8"/>
        <circle cx="154" cy="19" r=".7"/><circle cx="191" cy="59" r=".8"/>
      </g>
    </g>`;
  button.prepend(mark);
  // Tiny grains emerge from the lettering only while the Dust link is hovered.
  const sand = document.createElement('span');
  sand.className = 'scene-switch__sand';
  sand.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 28; i++) {
    const grain = document.createElement('span');
    grain.className = 'scene-switch__grain';
    grain.style.cssText = `--grain-x:${7 + (i * 31 % 86)}%;--grain-y:${40 + (i * 13 % 23)}%;
      --grain-size:${1 + (i % 3) * .35}px;--grain-dx:${24 + (i * 17 % 67)}px;
      --grain-dy:${-14 - (i * 11 % 35)}px;--grain-duration:${.9 + (i % 7) * .12}s;
      --grain-delay:${(i % 11) * .075}s;`;
    sand.appendChild(grain);
  }
  button.appendChild(sand);
  let current = scene;

  function showScene(next) {
    current = next;
    root.dataset.scene = next ? 'space' : 'dust';
    label.textContent = next ? 'Podcast & Essay' : 'Updates & Video';
    button.setAttribute('aria-label', next ? 'Podcast & Essay，切换到沙尘场景' : 'Updates & Video，切换到星空场景');
    status.textContent = next
      ? '星空肖像。移动鼠标或在屏幕上拖动，揭露面纱肖像。'
      : '沙尘肖像。移动鼠标或在屏幕上拖动，揭露皇冠肖像。';
  }
  showScene(current);

  // Keep the same frame composition available during loading and without WebGL.
  const composition = root.querySelector('.portrait__composition');
  const backFrames = document.createDocumentFragment();
  for (const item of FRAME_ITEMS) {
    if (item.initial === false) continue;
    const image = new Image();
    image.src = new URL(item.src, import.meta.url).href;
    image.alt = '';
    image.className = 'portrait__gallery-frame';
    image.dataset.scene = item.scene ? 'space' : 'dust';
    image.style.width = `${item.size[0]}px`;
    image.style.height = `${item.size[1]}px`;
    image.style.transform = `matrix(${item.matrix.join(',')})`;
    backFrames.appendChild(image);
    const entry = { ...item, frameId: item.id,
      contentIndex: GALLERY_SEQUENCES[item.scene].frames.indexOf(item.id) };
    gallerySource(entry).then(source => {
      if (!(source instanceof HTMLCanvasElement)) return;
      const canvas = document.createElement('canvas');
      canvas.width = source.width; canvas.height = source.height;
      canvas.getContext('2d').drawImage(source, 0, 0);
      canvas.className = image.className;
      canvas.dataset.scene = image.dataset.scene;
      canvas.style.cssText = image.style.cssText;
      image.replaceWith(canvas);
    }).catch(error => console.error('Frame artwork:', error));
  }
  composition.prepend(backFrames);

  let effect = null;
  try {
    effect = await initPortrait({ root, scene: current, onSceneChange: showScene });
    button.disabled = false;
    button.addEventListener('click', async () => {
      button.disabled = true;
      home.hidden = true;
      try { await effect.switchScene(1 - current); }
      finally { button.disabled = false; home.hidden = false; }
    });
  } catch (error) {
    // Keep the exact static composition and scene switch available without GL.
    console.error('Portrait effect:', error);
    button.disabled = false;
    button.addEventListener('click', () => showScene(1 - current));
  }

  return {
    root,
    effect,
    get scene() { return current; },
    destroy() { home.remove(); effect?.destroy(); },
  };
}
