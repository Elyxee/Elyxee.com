// Two small tapered strokes, like a pen cut; scoped to this component only.
// No document-wide cursor override, canvas, particle trail or continuous loop.
export function mountAboutCursor(root) {
  const controller = new AbortController();
  const { signal } = controller;
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const forced = matchMedia('(forced-colors: active)');
  const cursor = document.createElement('span');
  cursor.className = 'about-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  root.append(cursor);
  let enabled = true;
  function hide() {
    root.classList.remove('about--cursor');
    cursor.classList.remove('is-visible');
  }
  function move(event) {
    if (!enabled || !fine.matches || reduced.matches || forced.matches || event.pointerType === 'touch') return hide();
    // Preserve the native I-beam and text selection in the newsletter field.
    if (event.target.closest('input, textarea, [contenteditable]')) return hide();
    const box = root.getBoundingClientRect();
    cursor.style.left = `${event.clientX - box.left}px`;
    cursor.style.top = `${event.clientY - box.top}px`;
    cursor.classList.toggle('is-link', !!event.target.closest('a, button'));
    cursor.classList.add('is-visible');
    root.classList.add('about--cursor');
  }
  root.addEventListener('pointermove', move, { signal, passive: true });
  root.addEventListener('pointerleave', hide, { signal });
  root.addEventListener('pointerdown', () => cursor.classList.add('is-pressed'), { signal });
  window.addEventListener('pointerup', () => cursor.classList.remove('is-pressed'), { signal });
  window.addEventListener('blur', hide, { signal });
  window.addEventListener('scroll', hide, { signal, passive: true, capture: true });
  document.addEventListener('visibilitychange', hide, { signal });
  for (const media of [fine, reduced, forced]) media.addEventListener('change', hide, { signal });
  return {
    setActive(value) { enabled = !!value; if (!enabled) hide(); },
    destroy() { controller.abort(); hide(); cursor.remove(); },
  };
}
