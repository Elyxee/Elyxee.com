// The scene contract. Every view the coordinator manages is a scene:
//
//   layer           The scene's full-screen layer element.
//   load()          Mounts on first call (idempotent) and resolves once the
//                   scene can be revealed. Eager scenes are already mounted.
//   setVisible(on)  false while the scene is fully covered: it keeps its own
//                   clock and state, but stops drawing.
//   setActive(on)   Whether the scene receives pointer and keyboard input.
//   destroy()
//
// The adapters below only translate this contract into each module's own
// API. The effects stay in their modules; nothing here changes how a scene
// looks or responds.

function layerInput(layer, on) {
  layer.inert = !on;
  layer.setAttribute('aria-hidden', String(!on));
}

/** Home: the burn scene, mounted with the opening and active from the start. */
export function createHomeScene({ layer, burn }) {
  let visible = true, active = true;
  return {
    id: 'home',
    layer,
    load: () => burn.ready,
    setVisible(on) {
      if (on === visible) return;
      visible = on;
      if (on) burn.resume?.(); else burn.pause?.();
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      layerInput(layer, on);
      // The sheet re-lights on the next real pointer movement, not here.
      if (!on) burn.setPointerActive?.(false);
    },
    destroy() { burn.destroy?.(); },
  };
}

/**
 * Portfolio: the Dust & Space portrait, mounted after the opening. `pointer()`
 * returns the last real pointer ({ x, y, seen, type }) so that the portrait's
 * own presence starts from where the pointer already is when it takes input.
 */
export function createPortfolioScene({ layer, root, mount, pointer }) {
  let mounting = null, view = null, active = false;
  function synthetic(type) {
    const { x, y, seen, type: pointerType } = pointer();
    if (!seen) return;
    try {
      root.dispatchEvent(new PointerEvent(type, {
        bubbles: type !== 'pointerleave', clientX: x, clientY: y, pointerType, isPrimary: true,
      }));
    } catch {
      // PointerEvent construction can fail on very old engines; the portrait
      // then simply waits for the next real movement.
    }
  }
  return {
    id: 'portfolio',
    layer,
    load() {
      mounting ??= mount().then(mounted => (view = mounted));
      return mounting;
    },
    /** Whether a gesture at this point belongs to the gallery, not the page. */
    isScrollRegion(clientX, clientY) {
      return view?.effect?.isGalleryScrollRegion(clientX, clientY) ?? false;
    },
    get coldPointer() { return root.dataset.scene === 'space'; },
    setVisible(on) { view?.effect?.setVisible(on); },
    setActive(on) {
      if (on === active) return;
      active = on;
      layerInput(layer, on);
      synthetic(on ? 'pointermove' : 'pointerleave');
    },
    destroy() { mounting?.then(mounted => mounted.destroy()).catch(() => {}); },
  };
}

/**
 * A page view (About, …): a scrollable layer above the stage, mounted on first
 * use. `view.load()` resolves to the page's mount function, which receives
 * { root, scrollRoot, onNavigate } and returns { ready, setActive, destroy }.
 */
export function createPageScene({ view, onNavigate }) {
  const layer = document.createElement('section');
  layer.className = 'page-layer';
  layer.dataset.view = view.id;
  layer.setAttribute('aria-label', view.label ?? view.id);
  layer.setAttribute('aria-hidden', 'true');
  layer.tabIndex = -1;
  layer.inert = true;
  document.body.append(layer);
  let loading = null, page = null, active = false;
  return {
    id: view.id,
    layer,
    load() {
      loading ??= (async () => {
        const mount = await view.load();
        page = mount({ root: layer, scrollRoot: layer, onNavigate });
        page.setActive(false);
        await page.ready;
      })();
      return loading;
    },
    setVisible(on) { page?.setActive(on); },
    setActive(on) {
      if (on === active) return;
      active = on;
      layerInput(layer, on);
    },
    destroy() { page?.destroy(); layer.remove(); },
  };
}
