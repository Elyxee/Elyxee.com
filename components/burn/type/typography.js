import { TYPE_VERTEX, TYPE_FRAGMENT } from "./material.js?v=76";
import { createEmberTrail } from "./embers.js?v=74";

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const ease = x => x * x * (3 - 2 * x);
const PADDING = 68;

/** Independent, glyph-masked material layer; DOM text remains the fallback. */
export async function initBurnTypography({ settings = {}, selector = ".burn-mark", artwork = false, tinted = false,
  measureRect = element => element.getBoundingClientRect() } = {}) {
  const mark = document.querySelector(selector);
  if (!mark) return;
  const lines = [...mark.querySelectorAll("[data-inscription-line]")];
  const icons = [...mark.querySelectorAll("[data-inscription-icon]")];
  const canvas = document.createElement("canvas");
  canvas.className = "burn-mark__material";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl", {
    alpha: true, premultipliedAlpha: true, antialias: false,
    depth: false, stencil: false, powerPreference: "low-power",
  });
  if (!gl) return;

  const shaders = [];
  let program;
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, TYPE_VERTEX], [gl.FRAGMENT_SHADER, TYPE_FRAGMENT]]) {
      const shader = gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    }
    program = gl.createProgram();
    shaders.forEach(shader => gl.attachShader(program, shader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  } catch (error) {
    shaders.forEach(shader => gl.deleteShader(shader));
    if (program) gl.deleteProgram(program);
    console.warn("burn typography: using readable DOM fallback", error);
    return;
  }
  shaders.forEach(shader => gl.deleteShader(shader));
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries([
    "uMask", "uSize", "uPointer", "uTime", "uCold", "uContact", "uRadius", "uVortexRadius", "uMotion", "uArtwork", "uTinted", "uFireSites[0]",
  ].map(name => [name, gl.getUniformLocation(program, name)]));
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(uniforms.uMask, 0);
  gl.uniform1f(uniforms.uArtwork, artwork ? 1 : 0);
  gl.uniform1f(uniforms.uTinted, tinted ? 1 : 0);

  const mask = document.createElement("canvas");
  const ink = mask.getContext("2d", { willReadFrequently: true });
  if (!ink) return;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const forcedColors = matchMedia("(forced-colors: active)");
  const finePointer = matchMedia("(any-pointer: fine)");
  let rect, width = 1, height = 1, ratio = 1;
  let hitAreas = [];
  let radius = 30;
  let pointer = { x: -100, y: -100, active: false };
  let contact = 0, contactX = -100, contactY = -100;
  let lastTouchAt = -Infinity;
  const embers = createEmberTrail();
  const fireSites = new Float32Array(12);
  // This blend chooses the hover response only. With no contact, the shader
  // renders exactly the same ivory regardless of the scene/cursor phase.
  let cold = document.documentElement.dataset.burnPhase === "recovering" ? 1 : 0;
  let coldTarget = cold, coldFrom = cold, transitionAt = performance.now();
  let previous = performance.now(), clock = 0, lastDraw = 0, frame;
  let dirty = true, destroyed = false, motionUntil = 0;

  // Fonts are rasterised once on load/resize, not once per frame. The canvas is
  // kept small (only the mark + flame padding), with a capped backing scale.
  function layout() {
    rect = measureRect(mark);
    width = Math.ceil(rect.width + PADDING * 2);
    height = Math.ceil(rect.height + PADDING * 2);
    ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = mask.width = Math.ceil(width * ratio);
    canvas.height = mask.height = Math.ceil(height * ratio);
    Object.assign(canvas.style, {
      position: "fixed", zIndex: "10000",
      width: `${width}px`, height: `${height}px`,
      left: `${rect.left - PADDING}px`, top: `${rect.top - PADDING}px`,
    });
    paint();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniforms.uSize, width, height);
    gl.uniform1f(uniforms.uRadius, radius);
    // Match the scene's cold aura (0.30 of viewport height), not the flame's
    // small ignition footprint. Air reaching the letters must move them too.
    gl.uniform1f(uniforms.uVortexRadius, innerHeight * 0.30);
  }

  // Source artwork is ~1254px; resampling it every animated frame stalls the
  // main thread. Each source is reduced once to its on-screen device size.
  const bitmaps = new Map();
  function iconBitmap(icon, box) {
    const w = Math.max(1, Math.round(box.width * ratio));
    const h = Math.max(1, Math.round(box.height * ratio));
    const key = `${icon.currentSrc || icon.src}|${w}x${h}`;
    let bitmap = bitmaps.get(key);
    if (!bitmap) {
      bitmap = document.createElement("canvas");
      bitmap.width = w;
      bitmap.height = h;
      const context = bitmap.getContext("2d");
      context.imageSmoothingQuality = "high";
      context.drawImage(icon, 0, 0, w, h);
      bitmaps.set(key, bitmap);
    }
    return bitmap;
  }

  // Redraws the mask in place. Icons may carry a transient pose
  // (data-inscription-scale / -alpha / -rotate) for press and swap motion.
  function paint() {
    motionUntil = performance.now() + 150;
    ink.setTransform(1, 0, 0, 1, 0, 0);
    ink.clearRect(0, 0, mask.width, mask.height);
    ink.setTransform(ratio, 0, 0, ratio, 0, 0);
    ink.fillStyle = "white";
    hitAreas = [];
    for (const line of lines) {
      const style = getComputedStyle(line);
      const box = measureRect(line);
      ink.fillStyle = style.getPropertyValue("--inscription-tint").trim() || "white";
      ink.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      ink.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
      ink.direction = style.direction;
      ink.textAlign = style.textAlign === "right" ? "right" : "left";
      ink.textBaseline = "alphabetic";
      const metrics = ink.measureText(line.textContent);
      const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
      const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
      const leading = (parseFloat(style.lineHeight) - ascent - descent) / 2;
      const x = (ink.textAlign === "right" ? box.right : box.left) - rect.left + PADDING;
      const y = box.top - rect.top + PADDING + leading + ascent;
      ink.fillText(line.textContent, x, y);
      const left = ink.textAlign === "right" ? x - metrics.width : x;
      const margin = clamp(parseFloat(style.fontSize) * 0.12, 6, 12);
      hitAreas.push({
        left: left - margin, right: left + metrics.width + margin,
        top: y - metrics.actualBoundingBoxAscent - margin,
        bottom: y + metrics.actualBoundingBoxDescent + margin,
      });
    }
    for (const icon of icons) {
      const box = measureRect(icon);
      const x = box.left - rect.left + PADDING, y = box.top - rect.top + PADDING;
      const scale = parseFloat(icon.dataset.inscriptionScale ?? "1");
      const alpha = parseFloat(icon.dataset.inscriptionAlpha ?? "1");
      const turn = parseFloat(icon.dataset.inscriptionRotate ?? "0");
      if (alpha > 0.001 && scale > 0.001) {
        ink.save();
        ink.globalAlpha = clamp(alpha, 0, 1);
        ink.translate(x + box.width / 2, y + box.height / 2);
        ink.rotate(turn);
        ink.scale(scale, scale);
        ink.drawImage(iconBitmap(icon, box), -box.width / 2, -box.height / 2, box.width, box.height);
        ink.restore();
      }
      hitAreas.push({ left: x - 6, right: x + box.width + 6,
        top: y - 6, bottom: y + box.height + 6 });
    }
    radius = artwork ? clamp(rect.height, 26, 40)
      : clamp(parseFloat(getComputedStyle(lines[0]).fontSize) * 0.58, 26, 54);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    dirty = true;
  }

  // Include counters and inter-letter gaps in each line's actual text bounds.
  // Ignition still uses the glyph mask, so only nearby ink grows flames.
  function touchesInk(x, y) {
    return hitAreas.some(area => x >= area.left && x <= area.right
      && y >= area.top && y <= area.bottom);
  }

  function pointerMove(event) {
    if (event.pointerType === "touch" || !finePointer.matches) return;
    pointer = { x: event.clientX, y: event.clientY, active: true };
    dirty = true;
  }
  function leave() { pointer.active = false; dirty = true; }
  function pointerOut(event) { if (!event.relatedTarget) leave(); }
  function visibility() { if (document.hidden) leave(); else dirty = true; }
  function phaseChange() {
    const next = document.documentElement.dataset.burnPhase === "recovering" ? 1 : 0;
    if (next === coldTarget) return;
    coldFrom = cold;
    coldTarget = next;
    transitionAt = performance.now();
    dirty = true;
  }
  function preferences() {
    canvas.hidden = forcedColors.matches;
    mark.toggleAttribute("data-material-ready", !forcedColors.matches);
    leave();
  }

  function draw(now) {
    if (destroyed) return;
    frame = requestAnimationFrame(draw);
    // Idle material is capped at 30fps; posed icon motion runs every frame.
    const interval = now < motionUntil ? 0 : 1000 / 30;
    if (document.hidden || forcedColors.matches || now - lastDraw < interval) return;
    const dt = clamp((now - previous) / 1000, 0, 0.06);
    previous = now;
    lastDraw = now;
    const x = pointer.x - rect.left + PADDING;
    const y = pointer.y - rect.top + PADDING;
    const touching = pointer.active && touchesInk(x, y);
    const sites = embers.update({ x, y, touching, radius, now, dt });
    let glowing = false;
    sites.forEach((site, i) => {
      if (fireSites[i * 3 + 2] !== site.energy) dirty = true;
      fireSites.set([site.x, site.y, site.energy], i * 3);
      glowing ||= site.energy > 0;
    });
    const nearby = pointer.active && hitAreas.some(area => {
      const dx = Math.max(area.left - x, 0, x - area.right);
      const dy = Math.max(area.top - y, 0, y - area.bottom);
      return Math.hypot(dx, dy) < innerHeight * 0.30;
    });
    const affecting = coldTarget ? nearby : touching;
    if (affecting) { contactX = x; contactY = y; lastTouchAt = now; }
    // Briefly bridge gaps, then let the flame shrink into embers over ~1.5s.
    // Retain the last ignition point rather than dragging the dying fire away.
    const lingering = now - lastTouchAt < 180;
    const target = affecting || lingering ? 1 : 0;
    const release = cold > 0.5 ? 5 : 2.6;
    const nextContact = contact + (target - contact) * (1 - Math.exp(-dt * (target ? 9 : release)));
    if (Math.abs(nextContact - contact) > 0.0001) dirty = true;
    contact = nextContact < 0.001 ? 0 : nextContact;
    const seconds = coldTarget ? settings.quenchSeconds ?? 1.4 : settings.reigniteSeconds ?? 0.9;
    const progress = clamp((now - transitionAt) / (seconds * 1000), 0, 1);
    const nextCold = coldFrom + (coldTarget - coldFrom) * ease(progress);
    if (nextCold !== cold) dirty = true;
    cold = nextCold;
    if (!dirty && !glowing && (contact === 0 || motion.matches)) return;
    if (!motion.matches) clock += dt;
    gl.uniform2f(uniforms.uPointer, contactX, contactY);
    gl.uniform1f(uniforms.uTime, clock);
    gl.uniform1f(uniforms.uCold, cold);
    gl.uniform1f(uniforms.uContact, contact);
    gl.uniform1f(uniforms.uMotion, motion.matches ? 0 : 1);
    gl.uniform3fv(uniforms["uFireSites[0]"], fireSites);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    dirty = false;
  }

  await document.fonts.ready;
  try {
    await Promise.all(icons.map(icon => icon.decode()));
  } catch (error) {
    console.warn("burn icons: using image fallback", error);
    gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program);
    return;
  }
  if (destroyed) return;
  // Ink and its flames must sit above the cursor's opaque coal halo. Keeping
  // this canvas outside the scene stacking context leaves the cursor intact.
  document.body.appendChild(canvas);
  layout();
  const resize = new ResizeObserver(layout);
  resize.observe(mark);
  icons.forEach(icon => icon.addEventListener("load", paint));
  mark.addEventListener("inscription-change", paint);
  const phases = new MutationObserver(phaseChange);
  phases.observe(document.documentElement, { attributes: true, attributeFilter: ["data-burn-phase"] });
  document.addEventListener("pointermove", pointerMove, { passive: true });
  document.addEventListener("pointerout", pointerOut, { passive: true });
  document.addEventListener("visibilitychange", visibility);
  document.fonts.addEventListener("loadingdone", layout);
  window.addEventListener("resize", layout, { passive: true });
  window.addEventListener("scroll", layout, { passive: true });
  window.addEventListener("blur", leave);
  motion.addEventListener("change", preferences);
  forcedColors.addEventListener("change", preferences);
  finePointer.addEventListener("change", leave);
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    destroy(); // Immediately restore legible DOM text, even mid-transition.
  }, { once: true });
  phaseChange();
  preferences();
  draw(performance.now());

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    icons.forEach(icon => icon.removeEventListener("load", paint));
    mark.removeEventListener("inscription-change", paint);
    phases.disconnect();
    document.removeEventListener("pointermove", pointerMove);
    document.removeEventListener("pointerout", pointerOut);
    document.removeEventListener("visibilitychange", visibility);
    document.fonts.removeEventListener("loadingdone", layout);
    window.removeEventListener("resize", layout);
    window.removeEventListener("scroll", layout);
    window.removeEventListener("blur", leave);
    motion.removeEventListener("change", preferences);
    forcedColors.removeEventListener("change", preferences);
    finePointer.removeEventListener("change", leave);
    delete mark.dataset.materialReady;
    canvas.remove();
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  }
  return { destroy, getState: () => ({ contact, cold, contactX, contactY, embers: embers.sites.map(site => ({ ...site })) }) };
}
