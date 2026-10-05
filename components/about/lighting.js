// Single-pass photographic relighting. Original geometry, RGB detail and alpha
// are sampled once; no stacked cutouts that double the semi-transparent edges.
const VERTEX = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = vec2(aPosition.x * .5 + .5, .5 - aPosition.y * .5);
  gl_Position = vec4(aPosition, 0., 1.);
}`;
const FRAGMENT = `
precision highp float;
uniform sampler2D uImage;
uniform vec4 uCrop;
uniform vec2 uSize;
uniform vec2 uLight;
uniform float uStrength;
varying vec2 vUv;
vec4 source(vec2 p) {
  return texture2D(uImage, uCrop.xy + clamp(p, 0., 1.) * uCrop.zw);
}
float heightAt(vec2 p) {
  vec4 s = source(p);
  vec3 rgb = s.rgb / max(s.a, .001);
  return dot(rgb, vec3(.2126, .7152, .0722)) * smoothstep(.1, .9, s.a);
}
void main() {
  vec4 src = source(vUv);
  if (src.a < .001) { gl_FragColor = vec4(0.); return; }
  vec3 rgb = clamp(src.rgb / src.a, 0., 1.);
  // Only broad image gradients inform surface response: never sharpen pores.
  vec2 stepUv = vec2(16.) / uSize;
  vec2 gradient = vec2(
    heightAt(vUv + vec2(stepUv.x, 0.)) - heightAt(vUv - vec2(stepUv.x, 0.)),
    heightAt(vUv + vec2(0., stepUv.y)) - heightAt(vUv - vec2(0., stepUv.y))
  );
  vec3 normal = normalize(vec3((vUv - vec2(.52, .47)) * vec2(.5, .18) - gradient * .28, 1.));
  vec2 delta = uLight - vUv * uSize;
  float depth = uSize.x * .8;
  vec3 L = normalize(vec3(delta.x, delta.y, depth));
  float diffuse = max(dot(normal, L), 0.);
  // Broad inverse-square falloff has no spotlight disk or visible cutoff.
  vec2 spread = delta / (uSize.x * vec2(.64, .76));
  float falloff = 1. / (1. + dot(spread, spread) * 2.2);
  float energy = uStrength * falloff * (.28 + .72 * diffuse);
  vec3 color = pow(rgb, vec3(.84 - .16 * energy));
  // Subtle broad sheen follows existing highlights; no new facial texture.
  float sheen = pow(max(dot(normal, normalize(L + vec3(0., 0., 1.))), 0.), 18.);
  color += rgb * sheen * energy * .035;
  gl_FragColor = vec4(clamp(color, 0., 1.) * src.a, src.a);
}`;

export function mountPortraitLight(root) {
  const photo = root.querySelector('.about-hero__photo');
  const original = photo.querySelector('img');
  const controller = new AbortController();
  const { signal } = controller;
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const forced = matchMedia('(forced-colors: active)');
  const canvas = document.createElement('canvas');
  canvas.className = 'about-relight';
  canvas.setAttribute('aria-hidden', 'true');
  photo.append(canvas);
  const previousFilter = original.style.filter;
  original.style.filter = 'brightness(1.16)'; // Readable, exact-photo fallback.
  let gl, program, texture, buffer, uniforms;
  let ready = false, destroyed = false, active = true, frame = 0;
  let x = 0, y = 0, targetX = 0, targetY = 0;
  let strength = 0, targetStrength = 0, lastTime = 0, initialized = false;
  let uploadPending = false;
  const allowed = () => active && fine.matches && !reduced.matches && !forced.matches && !document.hidden;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(error);
    }
    return shader;
  }
  function setup() {
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, powerPreference: 'low-power' });
    if (!gl) return;
    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    uniforms = Object.fromEntries(['uImage','uCrop','uSize','uLight','uStrength'].map(name => [name, gl.getUniformLocation(program, name)]));
    gl.uniform1i(uniforms.uImage, 0);
    uploadPending = true;
    schedule();
  }
  function schedule() {
    if (!frame && active && !destroyed && !document.hidden) frame = requestAnimationFrame(render);
  }
  function render(now) {
    frame = 0;
    if (destroyed || !active) return;
    const dt = lastTime ? Math.min(.06, (now - lastTime) / 1000) : 1 / 60;
    lastTime = now;
    const follow = 1 - Math.exp(-18 * dt);
    x += (targetX - x) * follow;
    y += (targetY - y) * follow;
    strength += (targetStrength - strength) * (1 - Math.exp(-9 * dt));
    const bounds = photo.getBoundingClientRect();
    const scene = root.getBoundingClientRect();
    root.style.setProperty('--scene-light-x', `${x - scene.left}px`);
    root.style.setProperty('--scene-light-y', `${y - scene.top}px`);
    root.style.setProperty('--scene-light-strength', String(strength));
    if (gl && program && !gl.isContextLost() && original.complete && original.naturalWidth && bounds.width > 0) {
      try {
        if (uploadPending) {
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, original);
          uploadPending = false;
        }
        const dpr = Math.min(devicePixelRatio || 1, 1.5);
        const width = Math.round(bounds.width * dpr), height = Math.round(bounds.height * dpr);
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        gl.viewport(0, 0, width, height);
        const img = original.getBoundingClientRect();
        gl.uniform4f(uniforms.uCrop, (bounds.left - img.left) / img.width, (bounds.top - img.top) / img.height, bounds.width / img.width, bounds.height / img.height);
        gl.uniform2f(uniforms.uSize, bounds.width, bounds.height);
        gl.uniform2f(uniforms.uLight, x - bounds.left, y - bounds.top);
        gl.uniform1f(uniforms.uStrength, strength);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (!ready) { ready = true; photo.dataset.relight = 'ready'; }
      } catch (error) {
        console.warn('About lighting uses the source-photo fallback:', error.message);
        delete photo.dataset.relight;
        ready = false;
        program = null;
      }
    }
    if (Math.hypot(targetX - x, targetY - y) > .2 || Math.abs(targetStrength - strength) > .003) schedule();
    else lastTime = 0;
  }
  function hide() { targetStrength = 0; schedule(); }
  function setPosition(position) {
    if (!position || position.visible === false || !allowed()) return hide();
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    targetX = position.x; targetY = position.y;
    if (!initialized) { x = targetX; y = targetY; initialized = true; }
    targetStrength = 1;
    schedule();
  }
  root.addEventListener('pointermove', event => {
    if (event.pointerType !== 'touch') setPosition({ x: event.clientX, y: event.clientY });
  }, { signal, passive: true });
  root.addEventListener('pointerleave', hide, { signal });
  window.addEventListener('scroll', schedule, { signal, capture: true, passive: true });
  window.addEventListener('resize', schedule, { signal, passive: true });
  window.addEventListener('blur', hide, { signal });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { targetStrength = strength = 0; cancelAnimationFrame(frame); frame = 0; root.style.setProperty('--scene-light-strength', '0'); }
    else schedule();
  }, { signal });
  for (const media of [fine, reduced, forced]) media.addEventListener('change', hide, { signal });
  original.addEventListener('load', () => { uploadPending = true; schedule(); }, { signal });
  const resize = new ResizeObserver(schedule);
  resize.observe(photo);
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); delete photo.dataset.relight; ready = false; }, { signal });
  canvas.addEventListener('webglcontextrestored', () => { try { setup(); } catch { delete photo.dataset.relight; } }, { signal });
  try { setup(); } catch (error) { console.warn('About lighting unavailable:', error.message); }
  return {
    setPosition,
    setActive(value) {
      active = !!value;
      if (active) schedule();
      else { targetStrength = strength = 0; cancelAnimationFrame(frame); frame = 0; root.style.setProperty('--scene-light-strength', '0'); }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      controller.abort();
      resize.disconnect();
      cancelAnimationFrame(frame);
      delete photo.dataset.relight;
      original.style.filter = previousFilter;
      root.style.removeProperty('--scene-light-strength');
      root.style.removeProperty('--scene-light-x');
      root.style.removeProperty('--scene-light-y');
      if (gl) { gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); }
      canvas.remove();
    },
  };
}
