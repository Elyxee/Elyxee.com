import { FRAME_ITEMS } from './gallery-items.js';
import { COMPOSITION } from './settings.js';
import { createGallerySequence } from './gallery-sequence.js';
import { isNearGalleryFrame, isNearGalleryTrack } from './gallery-region.js';
import { artworkFor, DUST_ARTWORKS, SPACE_ARTWORKS, loadGalleryImage, mountArtwork } from './artworks.js?v=2';
import { createGallerySelection } from './gallery-interaction.js';

const VS = `#version 300 es
precision highp float;
uniform vec2 uView, uCenter, uSize;
uniform vec4 uAxes;
out vec2 vUv;
const vec2 corners[6] = vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
void main() {
  vUv = mix(vec2(-.09), vec2(1.09), corners[gl_VertexID]);
  vec2 pixel = uCenter + mat2(uAxes.xy, uAxes.zw) * ((vUv - .5) * uSize);
  gl_Position = vec4(pixel / uView * 2. - 1., 0., 1.);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform vec2 uSize, uPointer, uShadow;
uniform float uTime, uPhase, uKind, uHover, uScene, uMotion;
in vec2 vUv;
out vec4 outColor;
vec4 source(vec2 uv) {
  // Sample before masking: implicit mip derivatives inside a pixel-dependent
  // branch can leave a dotted rectangle around the transparent image on Metal.
  vec4 sampled = texture(uImage, uv);
  float inside = step(0., min(uv.x, uv.y)) * step(max(uv.x, uv.y), 1.);
  return sampled * inside;
}
float shadowAlpha(vec2 uv) {
  if (min(uv.x, uv.y) < 0. || max(uv.x, uv.y) > 1.) return 0.;
  // Filter the silhouette before offsetting it: sparse sharp samples leave
  // duplicate cutout edges, particularly visible when a frame crosses skin.
  vec2 texelsPerArtPixel = vec2(textureSize(uImage, 0)) / uSize;
  float lod = log2(max(texelsPerArtPixel.x, texelsPerArtPixel.y) * 4.);
  return textureLod(uImage, uv, max(lod, 0.)).a;
}
void main() {
  vec2 uv = vUv;
  float time = uTime;
  float wind = sin(time * 1.1 + uPhase);
  if (uKind == 4.) { // Flowers: a small, flexible sway within the original cutout.
    uv.x += sin(uv.y * 8. + time * 1.2 + uPhase) * .003 * uMotion;
    uv.y += cos(uv.x * 9. - time * .8 + uPhase) * .002 * uMotion;
  } else if (uKind == 3.) { // Liquid metal: slower surface undulation.
    uv += vec2(sin(uv.y * 13. + time), cos(uv.x * 11. - time * .8)) * .0025 * uMotion;
  } else if (uKind == 5.) { // Existing flame tongues rise and flutter.
    float flicker = sin(uv.y * 24. + time * 5. + sin(uv.x * 17. - time * 2.));
    uv.x += flicker * .005 * uMotion;
    uv.y += sin(uv.x * 26. - time * 6.) * .004 * uMotion;
  }
  vec4 frame = source(uv);
  vec2 shadowUv = uv - uShadow;
  float shadow = shadowAlpha(shadowUv) * .36;
  shadow += (shadowAlpha(shadowUv + vec2(.009,0)) + shadowAlpha(shadowUv - vec2(.009,0))
    + shadowAlpha(shadowUv + vec2(0,.009)) + shadowAlpha(shadowUv - vec2(0,.009))) * .16;
  shadow *= mix(.34, .42, uScene);
  vec3 color = frame.rgb * mix(vec3(1.01,.985,.95), vec3(.965,.985,1.), uScene);
  float light = dot(frame.rgb, vec3(.2126,.7152,.0722));
  float sweep = fract(time * .045 + uPhase * .13) * 1.9 - .4;
  float sheen = exp(-pow((uv.x * .7 + uv.y * .6 - sweep) / .095, 2.));
  float metal = uKind > .5 && uKind < 4. ? 1. : .24;
  color += mix(vec3(.8,.65,.4), vec3(.57,.75,1.), uScene) * sheen * light * metal * .20 * uMotion;
  float proximity = exp(-dot((uv - uPointer) * uSize / 125., (uv - uPointer) * uSize / 125.));
  color *= 1. + uHover * (.055 + proximity * .13);
  if (uKind == 2.) color += vec3(.32,.53,.7) * light * (.5 + .5 * wind) * .07 * uMotion;
  if (uKind == 5.) {
    float ember = smoothstep(.03, .38, frame.r - frame.b);
    color *= 1. + ember * (sin(time * 7. + uv.x * 28.) * .16 + sin(time * 4.3 - uv.y * 20.) * .10) * uMotion;
    color += vec3(.55,.16,.025) * ember * (.08 + .09 * sin(time * 4. + uv.x * 12.)) * uMotion;
  }
  float alpha = frame.a + shadow * (1. - frame.a);
  outColor = vec4(color * frame.a, alpha);
}`;

const MATERIAL = { wood: 0, stone: 0, gold: 1, ice: 2, liquid: 3, flower: 4, fire: 5, silver: 1 };

function alphaMap(image) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, 128, 128);
  const data = ctx.getImageData(0, 0, 128, 128).data;
  return (x, y) => x < 0 || y < 0 || x >= 1 || y >= 1 ? 0 : data[(Math.floor(y * 128) * 128 + Math.floor(x * 128)) * 4 + 3] / 255;
}

export async function createGallery(gl, crowned, veiled, contentByScene = [[], []]) {
  const frames = new Map(await Promise.all(FRAME_ITEMS.map(async item =>
    [item.id, await loadGalleryImage(new URL(item.src, import.meta.url).href)])));
  const artworks = new Map(await Promise.all([...DUST_ARTWORKS, ...SPACE_ARTWORKS].map(async art =>
    [art.id, await loadGalleryImage(art.src)])));
  const sourceTextures = new Map(), hitMasks = new Map();
  const selection = createGallerySelection();
  function textureFor(item) {
    const art = artworkFor(item), key = `${item.frameId}:${art?.id ?? 'empty'}`;
    if (sourceTextures.has(key)) return sourceTextures.get(key);
    const frame = frames.get(item.frameId);
    const image = art ? mountArtwork(frame, artworks.get(art.id), item) : frame;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    sourceTextures.set(key, texture);
    hitMasks.set(key, alphaMap(image));
    return texture;
  }
  const sequences = [0,1].map(scene => createGallerySequence(scene, contentByScene[scene]));
  const visible = [[], []];
  const heads = [alphaMap(veiled), alphaMap(crowned)];
  const program = gl.createProgram(), shaders = [];
  for (const [type, source] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    shaders.push(shader); gl.attachShader(program, shader);
  }
  gl.linkProgram(program); shaders.forEach(shader => gl.deleteShader(shader));
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const vao = gl.createVertexArray();
  const names = ['uView','uCenter','uSize','uAxes','uImage','uTime','uPhase','uKind','uHover','uScene','uPointer','uShadow','uMotion'];
  const uniforms = Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]));
  const targets = Array.from({ length: 2 }, () => {
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { texture, framebuffer: gl.createFramebuffer() };
  });
  let width = 1, height = 1;

  function resize(w, h) {
    width = Math.round(w); height = Math.round(h);
    for (const target of targets) {
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Gallery framebuffer unavailable');
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function poseFor(item, scale, originX, originY) {
    const [cx,cy] = item.center;
    const cos = Math.cos(item.rotation), sin = Math.sin(item.rotation);
    const factor = scale*(1+item.hover*.018+(item.selection??0)*.045);
    const [a,b,c,d] = item.matrix;
    // Hover offsets are small and reversible. Never slow one entry's travel
    // clock: a stopped frame would cause the following entries to pile up.
    return { center: [originX + (cx-item.hover*4)*scale,
      originY + (cy-item.hover*7)*scale],
      axes: [(cos*a-sin*b)*factor,(sin*a+cos*b)*factor,(cos*c-sin*d)*factor,(sin*c+cos*d)*factor] };
  }

  function localPoint(item, x, y) {
    const [a,b,c,d] = item.pose.axes, det = a*d-b*c;
    const dx = x-item.pose.center[0], dy = y-item.pose.center[1];
    return [((d*dx-c*dy)/det)/item.size[0]+.5, ((a*dy-b*dx)/det)/item.size[1]+.5];
  }

  function update(dt, pointer, scale, originX, originY, reduced, transition, scene) {
    const view = { width, height, scale, originX, originY };
    for (let targetScene=0; targetScene<2; targetScene++) {
      if (targetScene !== scene && !transition) continue;
      // Freeze the entire sequence clock, including any manual inertia. The
      // rest of the portrait keeps rendering and selection eases independently.
      visible[targetScene] = sequences[targetScene].update(selection.selected?.scene === targetScene ? 0 : dt,view,reduced);
      for (const item of visible[targetScene]) {
        const selected = selection.selected?.id === item.id ? 1 : 0;
        item.selection = reduced ? selected : (item.selection??0)+(selected-(item.selection??0))*(1-Math.exp(-dt*10));
        item.pose = poseFor(item,scale,originX,originY);
        const local = localPoint(item,pointer.x,pointer.y);
        const rect = item.scene ? COMPOSITION.crown : COMPOSITION.veil;
        const headX = ((pointer.x-originX)/scale - rect[0])/rect[2];
        const headY = ((pointer.y-originY)/scale - rect[1])/rect[3];
        const occluded = heads[item.scene](headX,headY) > .5;
        const inside = local[0] > .02 && local[0] < .98 && local[1] > .02 && local[1] < .98;
        const hot = pointer.active && !occluded && inside ? 1 : 0;
        item.hover += (hot-item.hover)*(1-Math.exp(-dt*7));
        item.pose = poseFor(item,scale,originX,originY);
      }
    }
    gl.useProgram(program); gl.bindVertexArray(vao);
    gl.viewport(0,0,width,height);
    gl.uniform2f(uniforms.uView,width,height);
    gl.uniform1i(uniforms.uImage,0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    for (let targetScene=0; targetScene<2; targetScene++) {
      if (targetScene !== scene && !transition) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER,targets[targetScene].framebuffer);
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
      for (const item of visible[targetScene]) {
        const [x,y] = item.pose.center, axes = item.pose.axes;
        const local = localPoint(item,pointer.x,pointer.y);
        // Artwork and frame are one texture: drift, hover, refraction, occlusion
        // and scene transitions continue through the existing gallery compositor.
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,textureFor(item));
        gl.uniform2f(uniforms.uCenter,x,y); gl.uniform2fv(uniforms.uSize,item.size);
        gl.uniform4fv(uniforms.uAxes,axes);
        gl.uniform2fv(uniforms.uPointer,local);
        const [a,b,c,d] = axes, det = a*d-b*c;
        gl.uniform2f(uniforms.uShadow,(d*5-c*9)*scale/det/item.size[0],(a*9-b*5)*scale/det/item.size[1]);
        gl.uniform1f(uniforms.uTime,reduced ? 0 : item.age);
        gl.uniform1f(uniforms.uPhase,item.phase);
        gl.uniform1f(uniforms.uKind,MATERIAL[item.material]);
        gl.uniform1f(uniforms.uHover,Math.max(item.hover,(item.selection??0)*.65));
        gl.uniform1f(uniforms.uScene,item.scene);
        gl.uniform1f(uniforms.uMotion,reduced ? 0 : Math.min(item.age,1));
        gl.drawArrays(gl.TRIANGLES,0,6);
      }
    }
    gl.disable(gl.BLEND); gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }

  return { textures: targets.map(t=>t.texture), resize, update,
    get selection() { return selection.selected; },
    clearSelection() { selection.clear(); },
    activate(item) {
      const url = selection.activate(item, item ? artworkFor(item) : null);
      if (selection.selected) sequences[selection.selected.scene].resetScroll();
      return url;
    },
    hitTest(scene, x, y, view) {
      const rect = scene ? COMPOSITION.crown : COMPOSITION.veil;
      const hx = ((x-view.originX)/view.scale - rect[0])/rect[2];
      const hy = ((y-view.originY)/view.scale - rect[1])/rect[3];
      if (heads[scene](hx,hy) > .5) return null;
      // Reverse paint order and the mounted texture's alpha keep transparent
      // corners and frames behind the portrait from stealing a click.
      for (let i=visible[scene].length-1; i>=0; i--) {
        const item = visible[scene][i];
        const art = artworkFor(item);
        if (!item.pose) continue;
        const [u,v] = localPoint(item,x,y);
        if (hitMasks.get(`${item.frameId}:${art?.id ?? 'empty'}`)?.(u,v) > .2) return art ? item : null;
      }
      return null;
    },
    isScrollRegion(scene, x, y, view) {
      const rect = scene ? COMPOSITION.crown : COMPOSITION.veil;
      const hx = ((x-view.originX)/view.scale - rect[0])/rect[2];
      const hy = ((y-view.originY)/view.scale - rect[1])/rect[3];
      // A frame hidden behind the portrait must not steal its foreground input.
      if (heads[scene](hx,hy) > .5) return false;
      return visible[scene].some(item => isNearGalleryFrame(item,x,y))
        || isNearGalleryTrack(scene,x,y,view);
    },
    scroll(scene, pixels, reduced) {
      if (selection.selected?.scene !== scene) sequences[scene].scroll(pixels, reduced);
    },
    resetScroll() { sequences.forEach(sequence => sequence.resetScroll()); },
    destroy() {
      sourceTextures.forEach(texture=>gl.deleteTexture(texture));
      targets.forEach(t=>{gl.deleteTexture(t.texture);gl.deleteFramebuffer(t.framebuffer);});
      gl.deleteVertexArray(vao); gl.deleteProgram(program);
    } };
}
