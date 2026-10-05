import { mountAbout } from './mount.js?v=2';

const page = mountAbout({ root: document.querySelector('#about-root') });
window.addEventListener('pagehide', () => page.destroy(), { once: true });
window.addEventListener('pageshow', event => {
  if (event.persisted) location.reload();
});
