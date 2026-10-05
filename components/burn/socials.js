/** Social controls are independent of the scene and cursor simulations. */
export function initBurnSocials() {
  const row = document.querySelector('.burn-socials');
  if (!row) return;
  const wechat = row.querySelector('[data-wechat-copy]');
  const wechatIcon = wechat?.querySelector('.burn-social');
  const wechatSrc = wechatIcon?.getAttribute('src');
  const copiedSrc = 'Assets/Elements/Copy.png';
  // Decoded ahead of time so the swap lands without a blank frame.
  const copiedImage = new Image();
  copiedImage.src = copiedSrc;
  copiedImage.decode?.().catch(() => {});
  const status = row.querySelector('.social-status');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const controller = new AbortController();
  const { signal } = controller;
  const timers = new Set();
  const tweens = new Map();
  let copyRun = 0;

  function later(callback, delay) {
    const id = setTimeout(() => { timers.delete(id); callback(); }, delay);
    timers.add(id);
    return id;
  }
  const sleep = ms => new Promise(resolve => later(resolve, ms));
  const easeOut = t => 1 - (1 - t) ** 3;
  const easeIn = t => t ** 3;
  const easeBack = t => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

  // The icons are drawn by the inscription material, not the <img>, so their
  // motion is a pose the material reads when it repaints.
  function pose(icon) {
    return {
      scale: parseFloat(icon.dataset.inscriptionScale ?? '1'),
      alpha: parseFloat(icon.dataset.inscriptionAlpha ?? '1'),
      rotate: parseFloat(icon.dataset.inscriptionRotate ?? '0'),
    };
  }
  function setPose(icon, { scale, alpha, rotate }) {
    icon.dataset.inscriptionScale = scale.toFixed(4);
    icon.dataset.inscriptionAlpha = alpha.toFixed(4);
    icon.dataset.inscriptionRotate = rotate.toFixed(4);
    row.dispatchEvent(new Event('inscription-change'));
  }
  function tween(icon, to, duration, ease = easeOut) {
    tweens.get(icon)?.cancel();
    const from = pose(icon);
    const target = { ...from, ...to };
    if (motion.matches || duration <= 0) {
      setPose(icon, target);
      return Promise.resolve(true);
    }
    return new Promise(resolve => {
      let frame = 0;
      const start = performance.now();
      const step = now => {
        const t = Math.min(1, (now - start) / duration);
        const k = ease(t);
        setPose(icon, {
          scale: from.scale + (target.scale - from.scale) * k,
          alpha: from.alpha + (target.alpha - from.alpha) * k,
          rotate: from.rotate + (target.rotate - from.rotate) * k,
        });
        if (t < 1) frame = requestAnimationFrame(step);
        else { tweens.delete(icon); resolve(true); }
      };
      tweens.set(icon, { cancel() { cancelAnimationFrame(frame); tweens.delete(icon); resolve(false); } });
      frame = requestAnimationFrame(step);
    });
  }
  const REST = { scale: 1, alpha: 1, rotate: 0 };
  // Intent: the carved mark swells gently toward the pointer, nothing more.
  const HOVER = { scale: 1.14, alpha: 1, rotate: 0 };
  const hovered = new Set();
  const restFor = control => (hovered.has(control) ? HOVER : REST);
  async function spring(icon, control) {
    const rest = restFor(control);
    if (await tween(icon, { scale: rest.scale + 0.1, alpha: 1, rotate: 0 }, 130)) {
      await tween(icon, restFor(control), 220);
    }
  }
  const busy = control => control === wechat && wechat.hasAttribute('data-copying');
  function intent(control, on) {
    if (on) hovered.add(control); else hovered.delete(control);
    const icon = control.querySelector('.burn-social');
    if (!icon || busy(control) || control.hasAttribute('data-pressed')) return;
    tween(icon, restFor(control), on ? 280 : 360);
  }
  row.querySelectorAll('.social-control').forEach(control => {
    control.addEventListener('pointerenter', event => {
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') intent(control, true);
    }, { signal });
    control.addEventListener('pointerleave', () => intent(control, false), { signal });
    control.addEventListener('focus', () => {
      if (control.matches(':focus-visible')) intent(control, true);
    }, { signal });
    control.addEventListener('blur', () => intent(control, false), { signal });
  });

  function burst(control, strong = false) {
    control.querySelector('.social-burst')?.remove();
    const flash = document.createElement('span');
    flash.className = strong ? 'social-burst social-burst--strong' : 'social-burst';
    flash.setAttribute('aria-hidden', 'true');
    control.appendChild(flash);
    later(() => flash.remove(), 1000);
  }

  let pressed = null;
  function release() {
    if (!pressed) return;
    const control = pressed;
    pressed = null;
    control.removeAttribute('data-pressed');
    const icon = control.querySelector('.burn-social');
    if (icon && !busy(control)) spring(icon, control);
  }
  row.addEventListener('pointerdown', event => {
    const control = event.target.closest('.social-control');
    if (!control || event.button !== 0) return;
    pressed = control;
    control.setAttribute('data-pressed', '');
    const icon = control.querySelector('.burn-social');
    if (icon && !busy(control)) tween(icon, { scale: 0.8, alpha: 1, rotate: 0 }, 110);
  }, { signal });
  document.addEventListener('pointerup', release, { signal });
  document.addEventListener('pointercancel', release, { signal });
  window.addEventListener('blur', release, { signal });
  row.addEventListener('click', event => {
    const control = event.target.closest('.social-control');
    if (!control || control === wechat) return;
    burst(control);
    // Keyboard activation has no press; give it the same kick.
    const icon = control.querySelector('.burn-social');
    if (event.detail === 0 && icon) {
      tween(icon, { scale: 0.8 }, 90).then(done => done && spring(icon, control));
    }
    // Real anchors keep native new-tab, modifier-click and context-menu behavior.
  }, { signal });

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API can be unavailable (insecure origin, denied permission).
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
      document.body.appendChild(field);
      field.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      field.remove();
      return ok;
    }
  }
  async function swapTo(src) {
    if (wechatIcon.getAttribute('src') === src) return;
    const loaded = new Promise(resolve => {
      wechatIcon.addEventListener('load', resolve, { once: true });
      later(resolve, 400);
    });
    wechatIcon.src = src;
    await loaded;
    await wechatIcon.decode?.().catch(() => {});
  }

  wechat?.addEventListener('click', async () => {
    if (!wechatIcon) return;
    // Started inside the click so the clipboard keeps the user activation;
    // the fold-away runs meanwhile instead of waiting on it.
    const copying = copy(wechat.dataset.wechatId);
    const run = ++copyRun;
    const current = () => run === copyRun && !signal.aborted;
    wechat.setAttribute('data-copying', '');
    const settle = async () => {
      await tween(wechatIcon, { scale: 0.6, alpha: 0, rotate: -0.2 }, 0);
      await tween(wechatIcon, restFor(wechat), 320, easeBack);
      if (!current()) return;
      wechat.removeAttribute('data-copying');
      if (status) status.textContent = '';
    };

    // The WeChat mark folds away, then the copy seal is stamped into its place.
    await tween(wechatIcon, { scale: 0.3, alpha: 0, rotate: -0.5 }, 170, easeIn);
    if (!current()) return;
    const ok = await copying;
    if (!current()) return;
    if (!ok) { await settle(); return; }
    if (status) status.textContent = '已复制微信号。';
    await swapTo(copiedSrc);
    if (!current()) return;
    setPose(wechatIcon, { scale: 1.55, alpha: 0, rotate: 0.3 });
    burst(wechat, true);
    await tween(wechatIcon, restFor(wechat), 380, easeBack);
    if (!current()) return;
    await sleep(1100);
    if (!current()) return;

    await tween(wechatIcon, { scale: 0.55, alpha: 0, rotate: 0.2 }, 180, easeIn);
    if (!current()) return;
    await swapTo(wechatSrc);
    if (!current()) return;
    await settle();
  }, { signal });

  return {
    destroy() {
      controller.abort();
      copyRun++;
      tweens.forEach(t => t.cancel());
      timers.forEach(clearTimeout);
      if (wechatIcon) {
        wechatIcon.src = wechatSrc;
        setPose(wechatIcon, REST);
      }
    },
  };
}
