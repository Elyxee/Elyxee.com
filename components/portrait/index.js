import { mountPortrait } from './mount.js?v=8';

// Space is the default scene; `?scene=dust` opens the sand portrait first.
const scene = new URLSearchParams(location.search).get('scene') === 'dust' ? 0 : 1;
const portrait = await mountPortrait({ root: document.querySelector('.portrait'), scene });
window.addEventListener('pagehide', () => portrait.destroy(), { once: true });
window.addEventListener('pageshow', event => {
  if (event.persisted) location.reload();
});
