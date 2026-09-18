import { QUAD_VS, NOISE_BAKE_FS, SIM_FS, COMPOSITE_FS } from "./shaders.js?v=33";

// Every rate is per second so behaviour is frame-rate independent.
export const BURN_SETTINGS = {
  // Heat source
  radius: 0.082, // in screen-height units
  inject: 7.5, // heat added per second at the core of the source
  scorchRate: 3.2, // direct surface damage — makes a fast pass leave a mark

  // Combustion. First pass: full self-sustain on virgin sheet (unchanged feel).
  // After a full recovery uSpreadMode drops to 0 and only the pointer burns.
  burnRate: 2.7, // damage from accumulated heat
  // Heat released by the charring band. This is what makes the front self
  // sustaining, and it is the knob for how fast a fire travels: the hotter the
  // front, the further ahead of it the sheet is warm enough to catch. It has a
  // floor — below about 0.9 the coolest, least combustible material can no
  // longer hold a front and fires start guttering out and stranding char.
  combustion: 1.85,
  spreadRate: 9.5, // how quickly the front pulls neighbours along
  // Damage lost per texel of spread. It keeps the burn a cone rather than a
  // plateau, and since the cone has to descend from the depth cap to the
  // burn-through threshold, it is what sets how deep the burning band is.
  spreadDrop: 0.025,
  diffuse: 7.0,
  heatDecay: 6.5,

  // Recovery — the opening retreats from its rim, the carbon clears ahead of it.
  // Seconds from a fully developed burn back to an untouched sheet.
  recoverySeconds: 180,
  // After the heat source goes away, hold this long before any healing starts so
  // the audience can read the burn before ashes knit back or the hole closes.
  recoveryHoldSeconds: 3,
  // Char fades slower than the opening (ratio < 1) so the carbon rim outlasts
  // the hole briefly and ashes do not rush in while the ice is still visible.
  charHealRatio: 0.82,

  // Loose ash in an open hole metabolizes when healing runs (1/rate seconds).
  ashFade: 0.07,
  // Mid-recovery plateau: burn has sunk but char still blankets the sheet.
  // Extra fade here shortens the all-ash phase without touching the hold or tail.
  ashMidFade: 0.16,
  // Once the sheet has closed over a spot, the dark ash veil left on top clears
  // this much faster than the base heal rate (5.0 = six times as fast). Only
  // the all-ash "cloud" phase is affected: neither how the opening knits shut
  // nor how the paper finally grows back changes.
  veilHeal: 5.0,
  // Cursor-scale transitions: the flame guttering out into the cold presence,
  // and the cold presence bursting back into flame.
  quenchSeconds: 1.4,
  reigniteSeconds: 0.9,
  // The cold presence hands back to the flame once the sheet is this far
  // recovered (probe-wide max and mean of remaining damage), rather than
  // waiting for the last trace of scorch to fade.
  reigniteMax: 0.07,
  reigniteMean: 0.03,

  // Once the first fire has taken most of the sheet, the source stops being a
  // flame and becomes a cold presence that parts the ash without touching the
  // state — so a cursor left on the page cannot re-burn what is growing back.
  // Fraction of the sheet that must be open, with no front still running, to
  // enter that phase. Past `recoverCoverageDone` the fire counts as finished
  // even if a few embers are still reading on the probes.
  recoverCoverage: 0.55,
  recoverCoverageDone: 0.93,
  // Heat above this counts as "still burning": under the pointer it pauses the
  // recovery hold (a pointer parked over an open hole no longer does), and
  // anywhere on the sheet it keeps the first fire in its flame phase.
  burningHeat: 0.03,

  // Appearance
  edgeChaos: 1.0,
  flicker: 1.0,

  // Resources
  simLongSide: 512,
  noiseSize: 512,
  dprCap: 2,
};

const DEFAULT_FIRE = new URL("../../Assets/background/Fire.jpg", import.meta.url).href;
const DEFAULT_ICE = new URL("../../Assets/background/Ice.png", import.meta.url).href;
const STYLE_HREF = new URL("./burn.css?v=33", import.meta.url).href;

const QUAD = new Float32Array([-1, -1, 3, -1, -1, 3]);

function ensureStylesheet() {
  const existing = document.querySelector("link[data-burn-style]");
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_HREF;
  link.dataset.burnStyle = "";
  document.head.appendChild(link);
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`burn: shader compile failed — ${log}`);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`burn: program link failed — ${log}`);
  }

  const cache = new Map();
  return {
    program,
    location(name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
      return cache.get(name);
    },
  };
}

function createTarget(gl, width, height, format) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    format.internalFormat,
    width,
    height,
    0,
    gl.RGBA,
    format.type,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  const complete =
    gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  if (!complete) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    return null;
  }
  return { texture, framebuffer, width, height };
}

// A minute-and-a-half recovery removes less than a thousandth of the damage per
// frame, which is below the resolution of a half float near the top of the
// range — the subtraction would round away and the burn would never close. So
// full float is preferred, and the lower-precision fallbacks carry the smallest
// heal rate they can actually represent along with the depth they can hold.
const BYTE_FORMAT = { precision: "byte", depthMax: 1.0, minHealRate: 0.5 };

function pickStateFormat(gl, isWebGL2) {
  const candidates = [];
  const colorFloat = isWebGL2 && gl.getExtension("EXT_color_buffer_float");
  if (colorFloat && gl.getExtension("OES_texture_float_linear")) {
    candidates.push({
      internalFormat: gl.RGBA32F,
      type: gl.FLOAT,
      precision: "float",
      depthMax: 2.2,
      minHealRate: 1e-4,
    });
  }
  const halfCandidate = { precision: "half", depthMax: 2.2, minHealRate: 0.2 };
  if (colorFloat) {
    candidates.push({
      ...halfCandidate,
      internalFormat: gl.RGBA16F,
      type: gl.HALF_FLOAT,
    });
  }
  const halfFloat = gl.getExtension("OES_texture_half_float");
  if (!isWebGL2 && halfFloat) {
    gl.getExtension("OES_texture_half_float_linear");
    candidates.push({
      ...halfCandidate,
      internalFormat: gl.RGBA,
      type: halfFloat.HALF_FLOAT_OES,
    });
  }
  candidates.push({
    ...BYTE_FORMAT,
    internalFormat: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
  });

  for (const format of candidates) {
    const probe = createTarget(gl, 4, 4, format);
    if (probe) {
      gl.deleteFramebuffer(probe.framebuffer);
      gl.deleteTexture(probe.texture);
      return format;
    }
  }
  return { ...BYTE_FORMAT, internalFormat: gl.RGBA, type: gl.UNSIGNED_BYTE };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`burn: failed to load ${src}`));
    image.src = src;
  });
}

function createImageTexture(gl, image) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function initBurn(options = {}) {
  const settings = { ...BURN_SETTINGS, ...(options.settings || {}) };
  const autoPointer = options.autoPointer !== false;

  ensureStylesheet();

  let canvas = options.canvas || document.querySelector("#burn-fx");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "burn-fx";
    canvas.setAttribute("aria-hidden", "true");
    document.body.insertBefore(canvas, document.body.firstChild);
  }

  const contextAttributes = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  };

  let isWebGL2 = true;
  let gl = canvas.getContext("webgl2", contextAttributes);
  if (!gl) {
    isWebGL2 = false;
    gl = canvas.getContext("webgl", contextAttributes)
      || canvas.getContext("experimental-webgl", contextAttributes);
  }
  if (!gl) {
    console.warn("burn: WebGL unavailable, burn effect disabled");
    return { canvas, supported: false, destroy() {} };
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const simProgram = createProgram(gl, QUAD_VS, SIM_FS);
  const compositeProgram = createProgram(gl, QUAD_VS, COMPOSITE_FS);
  const stateFormat = pickStateFormat(gl, isWebGL2);

  function drawQuad() {
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // --- static tileable noise, baked once -----------------------------------
  const noiseTarget = createTarget(gl, settings.noiseSize, settings.noiseSize, {
    internalFormat: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
  });
  {
    const bake = createProgram(gl, QUAD_VS, NOISE_BAKE_FS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, noiseTarget.framebuffer);
    gl.viewport(0, 0, settings.noiseSize, settings.noiseSize);
    gl.useProgram(bake.program);
    drawQuad();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteProgram(bake.program);

    gl.bindTexture(gl.TEXTURE_2D, noiseTarget.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  // --- burn state ping-pong ------------------------------------------------
  let stateA = null;
  let stateB = null;
  let simWidth = 1;
  let simHeight = 1;
  let viewWidth = 1;
  let viewHeight = 1;
  let pixelScale = 1;

  function releaseState() {
    for (const target of [stateA, stateB]) {
      if (!target) continue;
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    stateA = null;
    stateB = null;
  }

  function clearState() {
    // Alpha included: it carries the spent flag, and a sheet that starts out
    // marked as already burnt would never catch fire.
    gl.clearColor(0, 0, 0, 0);
    for (const target of [stateA, stateB]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function resize() {
    const cssWidth = Math.max(1, window.innerWidth);
    const cssHeight = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, settings.dprCap);

    pixelScale = dpr;
    viewWidth = Math.round(cssWidth * dpr);
    viewHeight = Math.round(cssHeight * dpr);
    canvas.width = viewWidth;
    canvas.height = viewHeight;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const long = settings.simLongSide;
    if (cssWidth >= cssHeight) {
      simWidth = long;
      simHeight = Math.max(2, Math.round((long * cssHeight) / cssWidth));
    } else {
      simHeight = long;
      simWidth = Math.max(2, Math.round((long * cssWidth) / cssHeight));
    }

    releaseState();
    stateA = createTarget(gl, simWidth, simHeight, stateFormat);
    stateB = createTarget(gl, simWidth, simHeight, stateFormat);
    clearState();
  }

  resize();

  // --- pointer -------------------------------------------------------------
  const pointer = {
    x: 0.5,
    y: 0.5,
    previousX: 0.5,
    previousY: 0.5,
    active: 0,
    targetActive: 0,
    seen: false,
  };

  function setPointer(clientX, clientY) {
    pointer.x = clamp(clientX / Math.max(window.innerWidth, 1), -0.5, 1.5);
    pointer.y = 1 - clamp(clientY / Math.max(window.innerHeight, 1), -0.5, 1.5);
    if (!pointer.seen) {
      pointer.seen = true;
      pointer.previousX = pointer.x;
      pointer.previousY = pointer.y;
    }
  }

  function setPointerActive(active) {
    pointer.targetActive = active ? 1 : 0;
  }

  function onPointerMove(event) {
    if (event.pointerType === "touch") return;
    setPointer(event.clientX, event.clientY);
    setPointerActive(true);
  }

  function onPointerOut(event) {
    if (!event.relatedTarget) setPointerActive(false);
  }

  function onVisibility() {
    if (document.hidden) setPointerActive(false);
  }

  function onBlur() {
    setPointerActive(false);
  }

  if (autoPointer) {
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerout", onPointerOut, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
  }
  window.addEventListener("resize", resize, { passive: true });

  // --- textures ------------------------------------------------------------
  let fireTexture = null;
  let iceTexture = null;
  const fireSize = [1, 1];
  const iceSize = [1, 1];
  let ready = false;

  Promise.all([
    loadImage(options.fireSrc || DEFAULT_FIRE),
    loadImage(options.iceSrc || DEFAULT_ICE),
  ])
    .then(([fire, ice]) => {
      fireTexture = createImageTexture(gl, fire);
      iceTexture = createImageTexture(gl, ice);
      fireSize[0] = fire.naturalWidth;
      fireSize[1] = fire.naturalHeight;
      iceSize[0] = ice.naturalWidth;
      iceSize[1] = ice.naturalHeight;
      ready = true;
      canvas.classList.add("is-ready");
    })
    .catch((error) => {
      console.warn(error.message);
    });

  // --- frame loop ----------------------------------------------------------
  let running = true;
  let frameHandle = 0;
  let previousFrameAt = performance.now();
  let elapsed = 0;
  // 1 until the sheet has fully recovered from the first burn episode, then 0
  // forever (mouse-only). Sampled off the state texture so it tracks real heal,
  // not a wall-clock guess.
  let spreadMode = 1;
  let sawDamage = false;
  let sampleAccum = 0;
  let recoveryHoldRemaining = 0;
  // "burning"    — first pass, the pointer is a flame and the fire spreads.
  // "recovering" — the sheet is mostly gone; the pointer is a cold presence
  //                that parts the ash but writes nothing to the state.
  // "pinpoint"   — fully healed once; the pointer burns only where it is.
  let phase = "burning";
  // Smoothed 0..1 weight for the recovery-phase presence in the composite.
  let interact = 0;
  // Whether the pointer is actually consuming sheet right now, read off the
  // heat under it. Pointer presence alone no longer pauses recovery.
  let pointerBurning = false;
  const probeW = 8;
  const probeH = 8;
  const sampleBuf =
    stateFormat.precision === "byte"
      ? new Uint8Array(probeW * probeH * 4)
      : new Float32Array(probeW * probeH * 4);

  // Phase-change transition at the cursor: 1 at the change, decays to 0. Kind
  // +1 = flame quenched into the cold presence, -1 = cold presence reignites.
  let pulse = 0;
  let pulseKind = 0;
  // The first fire has taken the sheet; the hold is running and the cold
  // presence follows once healing actually starts.
  let sheetTaken = false;
  // Smoothed pointer velocity (uv per second) — rises quickly, decays slowly,
  // so the cloud keeps moving for a moment after the pointer stops.
  let velX = 0;
  let velY = 0;

  function setPhase(next) {
    const prev = phase;
    phase = next;
    canvas.classList.toggle("is-recovering", next === "recovering");
    document.documentElement.dataset.burnPhase = next;
    if (prev !== next) {
      if (next === "recovering") {
        // Cold takes the pointer completely: flame canvas is hidden via CSS on
        // data-burn-phase, and the presence is fully on from this frame.
        pulse = 1;
        pulseKind = 1;
        interact = pointer.active > 0.03 ? 1 : 0;
      } else if (prev === "recovering") {
        // Reignite: cold is gone immediately, burst plays, flame canvas returns.
        // The first-fire latch is done — later burns must be able to write heat.
        pulse = 1;
        pulseKind = -1;
        interact = 0;
        sheetTaken = false;
      }
    }
  }
  setPhase(phase);

  function readProbe(ox, oy) {
    gl.readPixels(ox, oy, probeW, probeH, gl.RGBA, stateFormat.type, sampleBuf);
    return gl.getError() === gl.NO_ERROR;
  }

  function sampleSheetDamage() {
    if (!stateA) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, stateA.framebuffer);
    let burn = 0;
    let charred = 0;
    let open = 0;
    let total = 0;
    let heatMax = 0;
    let damageSum = 0;
    const scale = stateFormat.precision === "byte" ? 1 / 255 : 1;
    // A 9x9 grid of small probes, corners and edges included, so coverage is a
    // real estimate of the sheet rather than a vote between a few spots, and a
    // running front — a thin band — has little room to slip between them.
    const cols = 9;
    const rows = 9;
    for (let r = 0; r < rows; r++) {
      const oy = Math.round((simHeight - probeH) * r / (rows - 1));
      for (let c = 0; c < cols; c++) {
        const ox = Math.round((simWidth - probeW) * c / (cols - 1));
        if (!readProbe(ox, oy)) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          return null;
        }
        for (let i = 0; i < probeW * probeH; i++) {
          const b = sampleBuf[i * 4] * scale;
          const c = sampleBuf[i * 4 + 2] * scale;
          burn = Math.max(burn, b);
          heatMax = Math.max(heatMax, sampleBuf[i * 4 + 1] * scale);
          charred = Math.max(charred, c);
          damageSum += Math.max(b, c);
          if (b > 0.5) open++;
          total++;
        }
      }
    }

    // Heat directly under the pointer — the only honest signal for "the source
    // is still eating sheet". Parked over an opening it reads cold.
    let heatAtPointer = 0;
    const px = clamp(Math.round(pointer.x * simWidth - probeW / 2), 0, Math.max(0, simWidth - probeW));
    const py = clamp(Math.round(pointer.y * simHeight - probeH / 2), 0, Math.max(0, simHeight - probeH));
    if (readProbe(px, py)) {
      for (let i = 0; i < probeW * probeH; i++) {
        heatAtPointer = Math.max(heatAtPointer, sampleBuf[i * 4 + 1] * scale);
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {
      burn,
      charred,
      heatMax,
      coverage: open / Math.max(total, 1),
      damageMean: damageSum / Math.max(total, 1),
      heatAtPointer,
    };
  }

  function simulate(deltaSeconds) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, stateB.framebuffer);
    gl.viewport(0, 0, simWidth, simHeight);
    gl.useProgram(simProgram.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateA.texture);
    gl.uniform1i(simProgram.location("uState"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, noiseTarget.texture);
    gl.uniform1i(simProgram.location("uNoise"), 1);

    gl.uniform2f(simProgram.location("uTexel"), 1 / simWidth, 1 / simHeight);
    gl.uniform1f(simProgram.location("uAspect"), simWidth / simHeight);
    gl.uniform2f(simProgram.location("uPointerPrev"), pointer.previousX, pointer.previousY);
    gl.uniform2f(simProgram.location("uPointer"), pointer.x, pointer.y);
    // In the recovery phase the pointer is not a heat source at all.
    gl.uniform1f(
      simProgram.location("uPointerActive"),
      // Mute the source only while the first fire's hold is running, and for the
      // whole cold-presence recovery. Once we hand back to pinpoint (or any
      // later burn), sheetTaken must not keep the pointer dead forever.
      phase === "recovering" || (sheetTaken && phase === "burning")
        ? 0
        : pointer.active,
    );
    gl.uniform1f(simProgram.location("uDt"), deltaSeconds);
    gl.uniform1f(simProgram.location("uRadius"), settings.radius);
    gl.uniform1f(simProgram.location("uInject"), settings.inject);
    gl.uniform1f(simProgram.location("uScorchRate"), settings.scorchRate);
    gl.uniform1f(simProgram.location("uBurnRate"), settings.burnRate);
    gl.uniform1f(simProgram.location("uSpreadRate"), settings.spreadRate);
    gl.uniform1f(simProgram.location("uSpreadDrop"), settings.spreadDrop);
    gl.uniform1f(simProgram.location("uCombustion"), settings.combustion);
    gl.uniform1f(simProgram.location("uDiffuse"), settings.diffuse);
    gl.uniform1f(simProgram.location("uHeatDecay"), settings.heatDecay);
    const recovery = Math.max(0.2, settings.recoverySeconds);
    gl.uniform1f(simProgram.location("uDepthMax"), stateFormat.depthMax);
    gl.uniform1f(
      simProgram.location("uHealBurn"),
      Math.max(2.3 / recovery, stateFormat.minHealRate),
    );
    gl.uniform1f(
      simProgram.location("uHealChar"),
      Math.max(2.3 * settings.charHealRatio / recovery, stateFormat.minHealRate * 0.93),
    );
    gl.uniform1f(simProgram.location("uAshFade"), settings.ashFade);
    gl.uniform1f(simProgram.location("uAshMidFade"), settings.ashMidFade);
    gl.uniform1f(simProgram.location("uVeilHeal"), settings.veilHeal);
    gl.uniform1f(simProgram.location("uHealScale"), recoveryHoldRemaining > 0 ? 0 : 1);
    gl.uniform1f(simProgram.location("uSpreadMode"), spreadMode);

    drawQuad();

    const swap = stateA;
    stateA = stateB;
    stateB = swap;
  }

  function composite() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, viewWidth, viewHeight);
    gl.useProgram(compositeProgram.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateA.texture);
    gl.uniform1i(compositeProgram.location("uState"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, noiseTarget.texture);
    gl.uniform1i(compositeProgram.location("uNoise"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, fireTexture);
    gl.uniform1i(compositeProgram.location("uFire"), 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, iceTexture);
    gl.uniform1i(compositeProgram.location("uIce"), 3);

    gl.uniform2f(compositeProgram.location("uResolution"), viewWidth, viewHeight);
    gl.uniform2f(compositeProgram.location("uSimSize"), simWidth, simHeight);
    gl.uniform1f(compositeProgram.location("uPixelScale"), pixelScale);
    gl.uniform2f(compositeProgram.location("uFireSize"), fireSize[0], fireSize[1]);
    gl.uniform2f(compositeProgram.location("uIceSize"), iceSize[0], iceSize[1]);
    gl.uniform1f(compositeProgram.location("uTime"), elapsed);
    gl.uniform1f(compositeProgram.location("uEdgeChaos"), settings.edgeChaos);
    gl.uniform1f(
      compositeProgram.location("uFlicker"),
      reducedMotion.matches ? 0 : settings.flicker,
    );
    gl.uniform1f(compositeProgram.location("uInteract"), interact);
    gl.uniform2f(compositeProgram.location("uPointerUv"), pointer.x, pointer.y);
    // No ring if the pointer is not on the page: it would fire at a stale spot.
    gl.uniform1f(compositeProgram.location("uPulse"), pulse * pointer.active);
    gl.uniform1f(compositeProgram.location("uPulseKind"), pulseKind);
    gl.uniform2f(
      compositeProgram.location("uPointerVel"),
      velX * (viewWidth / Math.max(viewHeight, 1)),
      velY,
    );

    drawQuad();
  }

  function frame(now) {
    frameHandle = requestAnimationFrame(frame);
    if (!running) return;

    const deltaSeconds = clamp((now - previousFrameAt) / 1000, 0.001, 1 / 30);
    previousFrameAt = now;
    elapsed += deltaSeconds;

    // Releases faster than it engages, so the sheet starts recovering promptly
    // once the source is gone.
    const ramp = pointer.targetActive > pointer.active ? 16 : 34;
    pointer.active += (pointer.targetActive - pointer.active)
      * clamp(deltaSeconds * ramp, 0, 1);
    if (pointer.active < 0.001) pointer.active = 0;

    // Before the sheet is taken, a still-burning pointer keeps pushing the hold
    // back so the audience can finish the fire. Once the sheet is taken the hold
    // must run out even if the cursor stays on the page — otherwise a resting
    // mouse freezes recovery forever via residual heat under the tip.
    if (pointerBurning && !sheetTaken && phase !== "recovering") {
      recoveryHoldRemaining = settings.recoveryHoldSeconds;
    } else if (recoveryHoldRemaining > 0) {
      recoveryHoldRemaining = Math.max(0, recoveryHoldRemaining - deltaSeconds);
    }

    // Healing has started: the flame gives way to the cold presence.
    if (sheetTaken && phase === "burning" && recoveryHoldRemaining <= 0) {
      setPhase("recovering");
    }

    // Outside recovering the presence is hard-off (setPhase already cleared it).
    // Inside, follow the pointer — no soft lag that would leave cold on a flame
    // or flame on cold.
    if (phase === "recovering") {
      const interactTarget = pointer.active > 0.03 ? 1 : 0;
      interact += (interactTarget - interact) * clamp(deltaSeconds * 8, 0, 1);
      if (interact < 0.001) interact = 0;
    } else {
      interact = 0;
    }
    if (pulse > 0) {
      const seconds = pulseKind > 0 ? settings.quenchSeconds : settings.reigniteSeconds;
      pulse = Math.max(0, pulse - deltaSeconds / Math.max(0.2, seconds));
    }

    // Pointer velocity with momentum, for the wind field.
    const instVx = (pointer.x - pointer.previousX) / deltaSeconds;
    const instVy = (pointer.y - pointer.previousY) / deltaSeconds;
    const rising = Math.hypot(instVx, instVy) > Math.hypot(velX, velY);
    const velK = clamp(deltaSeconds * (rising ? 12 : 2.6), 0, 1);
    velX += (instVx - velX) * velK;
    velY += (instVy - velY) * velK;
    const velMag = Math.hypot(velX, velY);
    if (velMag > 3) {
      velX *= 3 / velMag;
      velY *= 3 / velMag;
    }

    simulate(deltaSeconds);

    pointer.previousX = pointer.x;
    pointer.previousY = pointer.y;

    sampleAccum += deltaSeconds;
    if (sampleAccum >= 0.45) {
      sampleAccum = 0;
      const sample = sampleSheetDamage();
      if (sample) {
        pointerBurning =
          !sheetTaken
          && pointer.active > 0.03
          && sample.heatAtPointer > settings.burningHeat;

        if (sample.burn > 0.12 || sample.charred > 0.12) sawDamage = true;

        // Sheet-wide heat only — heat under the resting cursor must not block
        // "the fire is finished", or recovery waits until the mouse leaves.
        const fireOut = sample.heatMax < settings.burningHeat;
        if (
          phase === "burning"
          && spreadMode > 0
          && !sheetTaken
          && (
            sample.coverage >= settings.recoverCoverageDone
            || (sample.coverage >= settings.recoverCoverage && fireOut)
          )
        ) {
          // The first fire has taken the sheet. Start the hold; the pointer
          // stays a flame until it runs out and healing begins, then the cold
          // presence takes over (see the frame loop).
          sheetTaken = true;
          pointerBurning = false;
          recoveryHoldRemaining = settings.recoveryHoldSeconds;
        } else if (
          phase !== "pinpoint"
          && sawDamage
          && Math.max(sample.burn, sample.charred) < settings.reigniteMax
          && sample.damageMean < settings.reigniteMean
        ) {
          // Recovered as good as fully: from now on the pointer burns only
          // where it is. The last traces of scorch fade on their own.
          spreadMode = 0;
          sheetTaken = false;
          setPhase("pinpoint");
        }
      }
    }

    if (ready) composite();
  }

  frameHandle = requestAnimationFrame(frame);

  return {
    canvas,
    gl,
    settings,
    supported: true,

    /** Feed an external heat source, in client pixels (e.g. the cursor). */
    setPointer(clientX, clientY) {
      setPointer(clientX, clientY);
    },
    setPointerActive,
    reset() {
      clearState();
      spreadMode = 1;
      sawDamage = false;
      sampleAccum = 0;
      recoveryHoldRemaining = 0;
      pointerBurning = false;
      interact = 0;
      setPhase("burning");
      pulse = 0;
      sheetTaken = false;
      velX = 0;
      velY = 0;
    },
    pause() {
      running = false;
    },
    resume() {
      previousFrameAt = performance.now();
      running = true;
    },
    destroy() {
      running = false;
      cancelAnimationFrame(frameHandle);
      if (autoPointer) {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerout", onPointerOut);
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("blur", onBlur);
      }
      window.removeEventListener("resize", resize);
      releaseState();
      gl.deleteFramebuffer(noiseTarget.framebuffer);
      gl.deleteTexture(noiseTarget.texture);
      if (fireTexture) gl.deleteTexture(fireTexture);
      if (iceTexture) gl.deleteTexture(iceTexture);
      gl.deleteBuffer(quadBuffer);
      gl.deleteProgram(simProgram.program);
      gl.deleteProgram(compositeProgram.program);
      canvas.classList.remove("is-ready");
    },
  };
}
