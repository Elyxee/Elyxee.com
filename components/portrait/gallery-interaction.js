// Selection belongs to a live entry, not its reusable frame style or cover.
export function createGallerySelection() {
  let selected = null;
  return {
    get selected() { return selected; },
    clear() { selected = null; },
    activate(item, artwork) {
      if (!item || !artwork?.url) { selected = null; return null; }
      if (selected?.id === item.id) return selected.artwork.url;
      selected = { id: item.id, scene: item.scene, artwork };
      return null;
    },
  };
}

// A drag that returns to its starting point is still a drag, never a tap.
export function createGalleryTap() {
  let press = null;
  return {
    start(id, x, y, itemId) { press = { id, x, y, itemId, moved: false }; },
    move(id, x, y) {
      if (press?.id === id && Math.hypot(x-press.x, y-press.y) > 8) press.moved = true;
    },
    cancel() { press = null; },
    finish(itemId) {
      const valid = !!press && !press.moved && press.itemId === itemId;
      press = null;
      return valid;
    },
  };
}

export function bindGalleryInteraction(root, gallery, context, signal) {
  const tap = createGalleryTap();
  const status = document.createElement('span');
  status.className = 'sr-only';
  status.setAttribute('role', 'status');
  root.append(status);
  const options = { passive: true, signal };
  const excluded = event => event.target.closest?.('button, a, input, textarea, select');
  function hit(event) {
    const view = context(), rect = root.getBoundingClientRect();
    if (view.transition || !rect.width || !rect.height || root.closest('[inert]')) return null;
    return gallery.hitTest(view.scene,
      (event.clientX-rect.left)*view.width/rect.width,
      (event.clientY-rect.top)*view.height/rect.height, view);
  }
  function clear() {
    gallery.clearSelection();
    delete root.dataset.gallerySelected;
    status.textContent = '';
  }
  root.addEventListener('pointerdown', event => {
    tap.cancel();
    if (!event.isPrimary || event.button !== 0 || excluded(event)) return;
    tap.start(event.pointerId, event.clientX, event.clientY, hit(event)?.id ?? null);
  }, options);
  root.addEventListener('pointermove', event => tap.move(event.pointerId, event.clientX, event.clientY), options);
  root.addEventListener('pointerup', event => tap.move(event.pointerId, event.clientX, event.clientY), options);
  root.addEventListener('pointercancel', () => tap.cancel(), options);
  root.addEventListener('pointerleave', () => {
    tap.cancel();
    if (root.closest('[inert]')) clear();
  }, options);
  root.addEventListener('click', event => {
    if (excluded(event) || context().transition) { tap.cancel(); return; }
    const item = hit(event);
    if (!tap.finish(item?.id ?? null)) return;
    const url = gallery.activate(item);
    const selection = gallery.selection;
    if (selection) {
      root.dataset.gallerySelected = selection.artwork.id;
      status.textContent = `${selection.artwork.title}。已选中，再次点击打开视频；点击空白处或按 Escape 恢复轨道。`;
    } else clear();
    // Stay inside the user's click so browsers permit the new video tab.
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }, options);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') clear(); }, options);
  window.addEventListener('blur', () => tap.cancel(), options);
  signal.addEventListener('abort', () => { status.remove(); delete root.dataset.gallerySelected; }, { once: true });
  return { clear };
}
