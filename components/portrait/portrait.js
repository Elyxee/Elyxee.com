import { QUAD_VS, FLUID_FS, COMPOSITE_FS } from './shaders.js';
import { COMPOSITION, PORTRAIT_SETTINGS } from './settings.js';
import { createHaloTexture } from './halo.js';
import { createAtmosphere } from './atmosphere.js?v=2';
import { createMorseSignal } from './morse.js';
import { createPortalSeeds } from './motion.js';
import { createGallery } from './gallery.js?v=5';
import { bindGalleryInteraction } from './gallery-interaction.js';
import { galleryWheelDelta } from './gallery-scroll.js';

const ASSETS = {
  dust: new URL('../../Assets/optimized/background/Dust.webp', import.meta.url).href,
  space: new URL('../../Assets/optimized/background/Space.webp', import.meta.url).href,
  crown: new URL('../../Assets/Portrait/crowned.png', import.meta.url).href,
  veil: new URL('../../Assets/Portrait/veiled.png', import.meta.url).href,
  ufo: new URL('../../Assets/optimized/Elements/ufo.webp', import.meta.url).href,
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load portrait asset: ${url}`));
    image.src = url;
  });
}

export async function initPortrait({ root, scene = 0, onSceneChange = () => {} }) {
  const settings = PORTRAIT_SETTINGS;
  const crownSignal = createMorseSignal('ELYXEE', settings.crownMorseUnit);
  const canvas = root.querySelector('#portrait-fx');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const listeners = new AbortController();
  const gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, stencil: false,
    powerPreference: 'high-performance', preserveDrawingBuffer: false,
  });
  let width = 1, height = 1, scale = 1;
  let originX = 0, originY = 0;

  function measure() {
    width = Math.max(1, root.clientWidth);
    height = Math.max(1, root.clientHeight);
    // Desktop preserves Figma's 1536 × 1024 artboard. Narrow screens fit the
    // portrait itself, keeping its two source images on the same transform.
    scale = Math.min(width / (width < 650 ? 1040 : COMPOSITION.width), height / COMPOSITION.height);
    originX = (width - COMPOSITION.width * scale) / 2;
    originY = (height - COMPOSITION.height * scale) / 2;
    root.style.setProperty('--portrait-scale', scale);
  }
  measure();
  if (!gl) {
    window.addEventListener('resize', measure, { passive: true });
    throw new Error('WebGL 2 is unavailable; showing the static portrait.');
  }

  const resources = { programs: [], textures: [], framebuffers: [] };
  let targets = [];
  let simWidth = 1, simHeight = 1, current = 0;
  let frameHandle = 0, disposed = false, ready = false;
  let elapsed = 0, haloTime = 0, previousTime = 0, accumulator = 0;
  let transition = null;
  let atmosphere, gallery;
  let activeScene = scene;
  // A host can hide the portrait behind another scene. The simulation keeps
  // its clock, but nothing is drawn until the portrait can be seen again.
  let visible = true;
  const pointer = { x: width / 2, y: height / 2, targetX: width / 2, targetY: height / 2,
    lastX: width / 2, lastY: height / 2, vx: 0, vy: 0, active: false, seen: false, presence: 0 };

  function makeProgram(fragmentSource) {
    const program = gl.createProgram();
    const shaders = [];
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, QUAD_VS], [gl.FRAGMENT_SHADER, fragmentSource]]) {
        const shader = gl.createShader(type);
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader);
      }
      gl.bindAttribLocation(program, 0, 'aPosition');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      resources.programs.push(program);
      const locations = new Map();
      return { program, location(name) {
        if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
        return locations.get(name);
      } };
    } catch (error) {
      gl.deleteProgram(program);
      throw error;
    } finally { shaders.forEach(shader => gl.deleteShader(shader)); }
  }

  function texture(source) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    resources.textures.push(tex);
    return tex;
  }

  let useHalfFloat = Boolean(gl.getExtension('EXT_color_buffer_float'));
  function makeTarget() {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, useHalfFloat ? gl.RGBA16F : gl.RGBA8,
      simWidth, simHeight, 0, gl.RGBA, useHalfFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(framebuffer);
      if (useHalfFloat) { useHalfFloat = false; return makeTarget(); }
      throw new Error('Unable to create the liquid simulation buffer.');
    }
    return { texture: tex, framebuffer };
  }

  function clearFluid() {
    for (const target of targets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.clearColor(.5, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    current = 0;
    accumulator = 0;
  }

  function resize() {
    measure();
    const dpr = Math.min(devicePixelRatio || 1, settings.dprCap);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const factor = settings.simLongSide / Math.max(width, height);
    simWidth = Math.max(8, Math.round(width * factor));
    simHeight = Math.max(8, Math.round(height * factor));
    for (const t of targets) { gl.deleteTexture(t.texture); gl.deleteFramebuffer(t.framebuffer); }
    targets = Array.from({ length: 3 }, makeTarget);
    clearFluid();
    atmosphere?.resize(width, height);
    gallery?.resize(width, height);
    pointer.lastX = pointer.x = pointer.targetX = clamp(pointer.targetX, 0, width);
    pointer.lastY = pointer.y = pointer.targetY = clamp(pointer.targetY, 0, height);
  }

  let quad, vao;
  function destroy() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frameHandle);
    listeners.abort();
    atmosphere?.destroy();
    gallery?.destroy();
    for (const t of targets) { gl.deleteTexture(t.texture); gl.deleteFramebuffer(t.framebuffer); }
    resources.textures.forEach(t => gl.deleteTexture(t));
    resources.programs.forEach(p => gl.deleteProgram(p));
    if (quad) gl.deleteBuffer(quad);
    if (vao) gl.deleteVertexArray(vao);
    root.classList.remove('is-ready');
    if (transition) { transition.resolve(); transition = null; }
  }

  try {
    const [dust, space, crowned, veiled, ufo] = await Promise.all(Object.values(ASSETS).map(loadImage));
    const fluidProgram = makeProgram(FLUID_FS);
    const compositeProgram = makeProgram(COMPOSITE_FS);
    const imageTextures = [texture(dust), texture(space), texture(crowned), texture(veiled),
      texture(createHaloTexture(crowned, veiled))];
    atmosphere = createAtmosphere(gl, space, ufo);
    gallery = await createGallery(gl, crowned, veiled);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    resize();

    function bind(program, name, tex, unit) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(program.location(name), unit);
    }
    function one(program, name, value) { gl.uniform1f(program.location(name), value); }
    function two(program, name, x, y) { gl.uniform2f(program.location(name), x, y); }

    function simulate() {
      const prev = (current + 2) % 3, next = (current + 1) % 3;
      const p = fluidProgram;
      gl.bindVertexArray(vao);
      gl.useProgram(p.program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[next].framebuffer);
      gl.viewport(0, 0, simWidth, simHeight);
      bind(p, 'uPrevious', targets[prev].texture, 0);
      bind(p, 'uCurrent', targets[current].texture, 1);
      two(p, 'uResolution', simWidth, simHeight);
      two(p, 'uView', width, height);
      two(p, 'uMouse', pointer.x, pointer.y);
      two(p, 'uPrevMouse', pointer.lastX, pointer.lastY);
      one(p, 'uRadius', settings.liquidRadius * scale);
      one(p, 'uVelocity', Math.hypot(pointer.x - pointer.lastX, pointer.y - pointer.lastY));
      one(p, 'uActive', pointer.active ? 1 : 0);
      one(p, 'uTime', elapsed);
      one(p, 'uViscosity', settings.liquidViscosity);
      one(p, 'uDecay', settings.liquidDecay);
      one(p, 'uIntensity', settings.liquidIntensity);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      current = next;
      pointer.lastX = pointer.x;
      pointer.lastY = pointer.y;
    }

    function composite(progress = 0) {
      const p = compositeProgram;
      gl.bindVertexArray(vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(p.program);
      ['uDust','uSpace','uCrown','uVeil','uHalo'].forEach((name, i) => bind(p, name, imageTextures[i], i));
      bind(p, 'uFluid', targets[current].texture, 5);
      bind(p, 'uDustAtmosphere', atmosphere.textures[0], 6);
      bind(p, 'uSpaceAtmosphere', atmosphere.textures[1], 7);
      ['uDustGallery','uSpaceGallery']
        .forEach((name, i) => bind(p, name, gallery.textures[i], 8 + i));
      two(p, 'uView', width, height);
      two(p, 'uSimSize', simWidth, simHeight);
      two(p, 'uOrigin', originX, originY);
      two(p, 'uMouse', pointer.x, pointer.y);
      two(p, 'uVelocity', pointer.vx, pointer.vy);
      one(p, 'uScale', scale);
      one(p, 'uPresence', pointer.presence);
      one(p, 'uTime', reduced.matches ? 0 : elapsed);
      one(p, 'uHaloTime', haloTime);
      one(p, 'uHaloPeriod', settings.haloPeriod);
      one(p, 'uCrownPulse', reduced.matches ? 0 : crownSignal.valueAt(haloTime));
      one(p, 'uScene', activeScene);
      one(p, 'uNextScene', transition?.to ?? activeScene);
      one(p, 'uTransition', progress);
      if (transition?.portals) {
        gl.uniform4fv(p.location('uPortals[0]'), transition.portals);
        one(p, 'uPortalSeed', transition.seed);
      }
      one(p, 'uBlackHoleRadius', settings.blackHoleRadius);
      one(p, 'uRevealSize', settings.liquidRevealSize);
      one(p, 'uReduced', reduced.matches ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(now) {
      if (disposed) return;
      frameHandle = requestAnimationFrame(frame);
      if (document.hidden) { previousTime = 0; return; }
      const dt = previousTime ? clamp((now - previousTime) / 1000, 0, .05) : 1 / 60;
      previousTime = now;
      elapsed += dt;
      haloTime += dt;
      const follow = reduced.matches ? 1 : 1 - Math.exp(-settings.followRate * dt);
      const oldX = pointer.x, oldY = pointer.y;
      pointer.x += (pointer.targetX - pointer.x) * follow;
      pointer.y += (pointer.targetY - pointer.y) * follow;
      pointer.vx = (pointer.x - oldX) / Math.max(dt, .001);
      pointer.vy = (pointer.y - oldY) / Math.max(dt, .001);
      const targetPresence = pointer.active ? 1 : 0;
      pointer.presence += (targetPresence - pointer.presence) * (1 - Math.exp(-dt * (targetPresence ? 12 : 5.5)));
      if (pointer.presence < .001) pointer.presence = 0;
      // Fixed timestep preserves the reference wave behaviour at 60/120 Hz.
      accumulator = Math.min(accumulator + dt, 3 / 60);
      while (accumulator >= 1 / 60) {
        // Keep water following the pointer even in Space, so the incoming
        // Dust cursor is already warm and never resumes a frozen trail.
        if (activeScene === 0 || transition || pointer.presence > .001) simulate();
        accumulator -= 1 / 60;
      }
      let progress = 0;
      if (transition) {
        transition.elapsed += dt;
        progress = clamp(transition.elapsed / transition.duration, 0, 1);
      }
      const render = visible || !ready;
      atmosphere.update(dt, elapsed, pointer, scale, reduced.matches, transition, activeScene, render);
      gallery.update(dt, pointer, scale, originX, originY, reduced.matches, transition, activeScene, render);
      if (render) composite(progress);
      if (!ready) { ready = true; root.classList.add('is-ready'); }
      if (transition && progress >= 1) {
        const finished = transition;
        activeScene = finished.to;
        transition = null;
        haloTime = 0;
        onSceneChange(activeScene);
        finished.resolve();
      }
    }

    function move(event) {
      if (event.target.closest?.('.scene-switch, .portrait-home')) { pointer.active = false; return; }
      const rect = root.getBoundingClientRect();
      pointer.targetX = event.clientX - rect.left;
      pointer.targetY = event.clientY - rect.top;
      if (!pointer.seen || pointer.presence < .001) {
        pointer.lastX = pointer.x = pointer.targetX;
        pointer.lastY = pointer.y = pointer.targetY;
        pointer.seen = true;
      }
      pointer.active = true;
    }
    function leave() { pointer.active = false; }
    const options = { passive: true, signal: listeners.signal };
    const galleryInteraction = bindGalleryInteraction(root, gallery,
      () => ({ scene: activeScene, transition, width, height, scale, originX, originY }), listeners.signal);
    root.addEventListener('pointermove', move, options);
    root.addEventListener('pointerdown', move, options);
    root.addEventListener('pointerleave', leave, options);
    root.addEventListener('pointercancel', leave, options);
    root.addEventListener('pointerup', event => { if (event.pointerType !== 'mouse') leave(); }, options);
    root.addEventListener('wheel', event => {
      // Preserve browser zoom and leave purely horizontal gestures alone.
      if (event.ctrlKey || event.metaKey || !event.deltaY) return;
      event.preventDefault();
      if (!transition) gallery.scroll(activeScene, galleryWheelDelta(event, height), reduced.matches);
    }, { passive: false, signal: listeners.signal });
    // Touch scrolling shares the same inertia without replacing portrait reveal.
    let touch = null;
    root.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch' && event.isPrimary && !event.target.closest?.('.scene-switch, .portrait-home'))
        touch = { id: event.pointerId, y: event.clientY };
    }, options);
    root.addEventListener('pointermove', event => {
      if (touch?.id !== event.pointerId) return;
      const delta = touch.y - event.clientY;
      touch.y = event.clientY;
      if (!transition) gallery.scroll(activeScene, delta, reduced.matches);
    }, options);
    const endTouch = () => { touch = null; };
    for (const name of ['pointerup', 'pointercancel', 'pointerleave']) root.addEventListener(name, endTouch, options);
    const resetScroll = () => { endTouch(); gallery.resetScroll(); };
    window.addEventListener('blur', resetScroll, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) resetScroll(); }, options);
    reduced.addEventListener('change', resetScroll, { signal: listeners.signal });
    window.addEventListener('blur', leave, options);
    window.addEventListener('resize', resize, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); }, options);
    reduced.addEventListener('change', clearFluid, { signal: listeners.signal });
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      destroy();
    }, { signal: listeners.signal });
    frameHandle = requestAnimationFrame(frame);

    return {
      destroy,
      setVisible(value) { visible = Boolean(value); },
      isGalleryScrollRegion(clientX, clientY) {
        // Let the current Dust/Space switch finish without starting a page exit.
        if (transition) return true;
        const rect = root.getBoundingClientRect();
        if (!rect.width || !rect.height || disposed) return false;
        const x = (clientX-rect.left)*width/rect.width;
        const y = (clientY-rect.top)*height/rect.height;
        return gallery.isScrollRegion(activeScene,x,y,{ scale, originX, originY });
      },
      switchScene(to) {
        if (disposed) { activeScene = to; onSceneChange(to); return Promise.resolve(); }
        if (transition || to === activeScene) return Promise.resolve();
        galleryInteraction.clear();
        resetScroll();
        return new Promise(resolve => {
          const duration = to === 1 ? settings.dustToSpaceSeconds : settings.spaceToDustSeconds;
          transition = { to, elapsed: 0, duration: reduced.matches ? .2 : duration, resolve,
            portals: to === 0 ? createPortalSeeds(width / height) : null, seed: Math.random() * 100 };
        });
      },
    };
  } catch (error) { destroy(); throw error; }
}
