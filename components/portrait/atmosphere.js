// Screen-space particles render into two transparent layers, composited behind
// the portraits. The source images and their registered geometry stay intact.
import { createMeteor, createUfoFlight, sampleUfoFlight } from './motion.js';

const VS = `#version 300 es
precision highp float;
in vec4 aRect;
in vec4 aColor;
in vec2 aShape;
uniform vec2 uView;
out vec2 vPoint;
out vec4 vColor;
out float vKind;
const vec2 corners[6] = vec2[6](vec2(-1,-1),vec2(1,-1),vec2(-1,1),vec2(-1,1),vec2(1,-1),vec2(1,1));
void main() {
  vec2 corner = corners[gl_VertexID];
  vec2 offset = corner * aRect.zw * .5;
  float c = cos(aShape.x), s = sin(aShape.x);
  offset = mat2(c,s,-s,c) * offset;
  gl_Position = vec4((aRect.xy + offset) / uView * 2. - 1., 0., 1.);
  vPoint = corner;
  vColor = aColor;
  vKind = aShape.y;
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vPoint;
in vec4 vColor;
in float vKind;
uniform sampler2D uUfo;
out vec4 outColor;
void main() {
  if (vKind > 1.5) {
    vec2 uv = vPoint * .5 + .5;
    // Mipmapped source plus a small optical blur keeps the distant ship soft.
    vec4 ship = texture(uUfo, uv) * .4;
    ship += texture(uUfo, uv + vec2(.007, 0)) * .15;
    ship += texture(uUfo, uv - vec2(.007, 0)) * .15;
    ship += texture(uUfo, uv + vec2(0, .018)) * .15;
    ship += texture(uUfo, uv - vec2(0, .018)) * .15;
    float alpha = ship.a * vColor.a;
    outColor = vec4(ship.rgb * vColor.rgb * alpha, alpha);
    return;
  }
  float alpha;
  if (vKind > .5) {
    float along = vPoint.x * .5 + .5;
    alpha = pow(along, 1.65) * (1. - smoothstep(.1, 1., abs(vPoint.y)));
    alpha *= smoothstep(0., .03, along) * (1. - smoothstep(.985, 1., along));
  } else {
    float d = length(vPoint);
    alpha = (1. - smoothstep(.06, 1., d));
    alpha *= alpha;
  }
  alpha *= vColor.a;
  outColor = vec4(vColor.rgb * alpha, alpha);
}`;

function starAnchors(image) {
  const c = document.createElement('canvas');
  c.width = 1344; c.height = 896;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, c.width, c.height);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const cells = new Map();
  for (let y = 2; y < c.height - 2; y += 2) {
    for (let x = 2; x < c.width - 2; x += 2) {
      const i = (y * c.width + x) * 4;
      const light = (data[i] + data[i + 1] + data[i + 2]) / 765;
      if (light < .66) continue;
      const key = `${Math.floor(x / 22)},${Math.floor(y / 22)}`;
      if ((cells.get(key)?.light || 0) < light) cells.set(key, { x: x / c.width, y: y / c.height, light });
    }
  }
  return [...cells.values()].sort((a, b) => b.light - a.light).slice(0, 260);
}

export function createAtmosphere(gl, spaceImage, ufoImage) {
  let seed = 84913;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  let width = 1, height = 1, lastWidth = 0, lastHeight = 0;
  const grains = Array.from({ length: 1450 }, (_, i) => ({
    x: random(), y: random(), vx: 0, vy: 0, seed: random(),
    depth: i < 1180 ? .35 + random() * .5 : .9 + random() * .6,
    size: i < 1180 ? .8 + random() * 1.7 : 2 + random() * 2.1,
  }));
  const stars = starAnchors(spaceImage).map(s => ({ ...s, phase: random() * Math.PI * 2, period: 4.5 + random() * 5.5 }));
  grains.forEach(g => { g.color = [1, .65 + g.seed * .15, .30 + g.seed * .18]; });
  const meteors = [];
  // Event clocks advance only while Space is visible, including transitions.
  let spaceTime = 0, nextMeteor = 2.6 + Math.random() * 4.5, nextUfo = 7 + Math.random() * 8, flight = null;
  const capacity = 2600;
  const data = new Float32Array(capacity * 10);
  let count = 0;
  const shaders = [];
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    shaders.push(shader); gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  shaders.forEach(s => gl.deleteShader(s));
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const viewLocation = gl.getUniformLocation(program, 'uView');
  const ufoLocation = gl.getUniformLocation(program, 'uUfo');
  const ufoTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, ufoTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ufoImage);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const vao = gl.createVertexArray(), buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
  for (const [name, size, offset] of [['aRect', 4, 0], ['aColor', 4, 4], ['aShape', 2, 8]]) {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 40, offset * 4);
    gl.vertexAttribDivisor(location, 1);
  }
  const targets = Array.from({ length: 2 }, () => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { texture, framebuffer: gl.createFramebuffer() };
  });

  function resize(w, h) {
    width = Math.round(w); height = Math.round(h);
    for (const g of grains) {
      g.x = lastWidth ? g.x / lastWidth * width : g.x * width;
      g.y = lastHeight ? g.y / lastHeight * height : g.y * height;
    }
    lastWidth = width; lastHeight = height;
    for (const target of targets) {
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Particle framebuffer unavailable');
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function sprite(x, y, w, h, color, alpha, angle = 0, kind = 0) {
    if (alpha <= .002 || count >= capacity) return;
    const i = count++ * 10;
    data[i] = x; data[i + 1] = y; data[i + 2] = w; data[i + 3] = h;
    data[i + 4] = color[0]; data[i + 5] = color[1]; data[i + 6] = color[2];
    data[i + 7] = alpha; data[i + 8] = angle; data[i + 9] = kind;
  }
  function draw(index) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets[index].framebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (!count) return;
    gl.useProgram(program); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * 10));
    gl.uniform2f(viewLocation, width, height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ufoTexture);
    gl.uniform1i(ufoLocation, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    gl.disable(gl.BLEND);
  }

  function update(dt, time, pointer, scale, reduced, transition, scene, render = true) {
    const progress = transition ? Math.min(transition.elapsed / transition.duration, 1) : 0;
    const lift = transition?.to === 1 ? Math.sin(progress * Math.PI) : 0;
    const settle = transition?.to === 0 ? Math.sin(progress * Math.PI) : 0;
    count = 0;
    const dustVisible = scene === 0 || Boolean(transition);
    const spaceVisible = scene === 1 || Boolean(transition);
    if (spaceVisible && !reduced) spaceTime += dt;
    if (!reduced && dustVisible) {
      const reach = 285 * scale;
      for (const g of grains) {
        const windX = (22 + Math.sin(g.y * .006 + time * .48) * 14 + lift * 340) * g.depth * scale;
        const windY = (-5 + Math.cos(g.x * .004 - time * .33) * 8 - lift * 190 + settle * 95) * g.depth * scale;
        const relax = 1 - Math.exp(-dt * 1.45);
        g.vx += (windX - g.vx) * relax;
        g.vy += (windY - g.vy) * relax;
        const dx = g.x - pointer.x, dy = g.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (pointer.presence > .01 && distance < reach && distance > 1) {
          const force = (1 - distance / reach) ** 2 * pointer.presence * dt;
          g.vx += (dx / distance * 640 * scale + pointer.vx * .9) * force * g.depth;
          g.vy += (dy / distance * 640 * scale + pointer.vy * .9) * force * g.depth;
        }
        g.x = ((g.x + g.vx * dt + 24) % (width + 48) + width + 48) % (width + 48) - 24;
        g.y = ((g.y + g.vy * dt + 24) % (height + 48) + height + 48) % (height + 48) - 24;
        const speed = Math.hypot(g.vx, g.vy);
        const size = g.size * Math.max(.65, scale);
        const length = size + Math.min(speed * .022, 13 * scale);
        const alpha = (.27 + g.depth * .32) * (.8 + .2 * Math.sin(time * .8 + g.seed * 50));
        sprite(g.x, g.y, length, size, g.color, alpha, Math.atan2(g.vy, g.vx));
      }
    }
    if (render && (dustVisible || reduced)) draw(0);

    count = 0;
    if (!reduced && spaceVisible) {
      const coverScale = Math.max(width / 1344, height / 896);
      for (const s of stars) {
        const pulse = Math.pow(.5 + .5 * Math.sin(spaceTime * Math.PI * 2 / s.period + s.phase), 3);
        const x = (s.x - .5) * 1344 * coverScale + width / 2;
        const y = (s.y - .5) * 896 * coverScale + height / 2;
        const size = (4.5 + s.light * 4) * Math.max(.6, scale);
        const color = [.78, .88, 1];
        sprite(x, y, size * 3.2, size * 3.2, color, pulse * .16);
        sprite(x, y, size, size, color, pulse * 1.1);
        if (pulse > .55) {
          sprite(x, y, size * 2.5, 1.2 * Math.max(.7, scale), color, (pulse - .55) * .8);
          sprite(x, y, 1.1 * Math.max(.7, scale), size * 1.7, color, (pulse - .55) * .45);
        }
      }
      if (spaceTime >= nextMeteor) {
        meteors.push({ start: spaceTime, ...createMeteor(width, height, scale) });
        nextMeteor = spaceTime + 7 + Math.random() * 8;
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i], age = spaceTime - m.start;
        if (age > m.life) { meteors.splice(i, 1); continue; }
        const envelope = Math.min(age / .12, 1) * Math.min((m.life - age) / .4, 1);
        const dx = Math.cos(m.angle), dy = Math.sin(m.angle);
        const x = m.x + dx * m.speed * age, y = m.y + dy * m.speed * age;
        const tailX = x - dx * m.length * .5, tailY = y - dy * m.length * .5;
        sprite(tailX, tailY, m.length, 13 * scale, [.48,.66,1], envelope * .22, m.angle, 1);
        sprite(tailX, tailY, m.length, 3.7 * scale, [.75,.86,1], envelope, m.angle, 1);
        sprite(x, y, 20 * scale, 20 * scale, [.6,.77,1], envelope * .32);
        sprite(x, y, 6.5 * scale, 6.5 * scale, [.95,.98,1], envelope);
      }
      if (!flight && spaceTime >= nextUfo) {
        flight = { start: spaceTime, ...createUfoFlight(width, height, scale) };
      }
      if (flight) {
        const t = Math.min((spaceTime - flight.start) / flight.duration, 1);
        const { x, y, tilt, depth } = sampleUfoFlight(flight, t, width, height);
        const size = flight.size * Math.max(.65, scale) * depth;
        const fade = Math.min(t / .08, 1) * Math.min((1 - t) / .08, 1);
        sprite(x, y, size * 1.15, size * .24, [.55,.7,.85], fade * .055, tilt);
        sprite(x, y, size, size / 3, [.75,.85,.94], fade * .33, tilt, 2);
        if (t === 1) { flight = null; nextUfo = spaceTime + 18 + Math.random() * 20; }
      }
    }
    if (render && (spaceVisible || reduced)) draw(1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  return {
    textures: targets.map(t => t.texture), resize, update,
    destroy() {
      targets.forEach(t => { gl.deleteFramebuffer(t.framebuffer); gl.deleteTexture(t.texture); });
      gl.deleteBuffer(buffer); gl.deleteVertexArray(vao); gl.deleteProgram(program);
      gl.deleteTexture(ufoTexture);
    },
  };
}
