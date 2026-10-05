export const QUAD_VS = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * .5 + .5;
  gl_Position = vec4(aPosition, 0., 1.);
}`;

const NOISE = `
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + 1.), f.x), f.y);
}
float fbm(vec2 p) {
  float n = noise(p) * .55;
  p = mat2(.8,-.6,.6,.8) * p * 2.03;
  n += noise(p) * .28;
  return n + noise(p * 2.07) * .17;
}
mat2 rotate(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }
`;

// Adapted from Christian Ortiz's mouse-effects/mask-cursor/index.tsx:
// same three-state damped wave equation, swept mouse injection, displacement
// normals and two-image reveal. Native WebGL replaces React Three Fiber.
// Added aspect correction, advected ink, organic injection and leave decay.
export const FLUID_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPrevious;
uniform sampler2D uCurrent;
uniform vec2 uResolution;
uniform vec2 uView;
uniform vec2 uMouse;
uniform vec2 uPrevMouse;
uniform float uRadius;
uniform float uVelocity;
uniform float uActive;
uniform float uTime;
uniform float uViscosity;
uniform float uDecay;
uniform float uIntensity;
${NOISE}
float waveAt(sampler2D s, vec2 p) { return (texture(s, p).r - .5) * 8.; }
void main() {
  vec2 texel = 1. / uResolution;
  float current = waveAt(uCurrent, vUv);
  float prev = waveAt(uPrevious, vUv);
  float neighbors = (waveAt(uCurrent, vUv - vec2(texel.x, 0))
    + waveAt(uCurrent, vUv + vec2(texel.x, 0))
    + waveAt(uCurrent, vUv - vec2(0, texel.y))
    + waveAt(uCurrent, vUv + vec2(0, texel.y))) * .25;
  float wave = mix(current, neighbors * 2. - prev, uViscosity) * uDecay;
  vec2 p = vUv * uView;
  vec2 delta = p - uMouse;
  float distanceToMouse = length(delta);
  float angle = atan(delta.y, delta.x);
  float organic = .87 + .12 * sin(angle * 3. + uTime * 1.1)
    + .09 * sin(angle * 5. - uTime * .8)
    + .15 * (fbm(p * .016 + uTime * .2) - .5);
  float radius = uRadius * organic;
  float ripple = pow(1. - smoothstep(0., radius, distanceToMouse), 1.55);
  for (int i = 0; i < 8; i++) {
    vec2 trailPos = mix(uPrevMouse, uMouse, float(i) / 8.);
    float d = length(p - trailPos);
    ripple = max(ripple, pow(1. - smoothstep(0., radius * .86, d), 1.7));
  }
  float movement = min(uVelocity * .026, 1.);
  wave += ripple * uIntensity * (movement + .05) * uActive;

  vec2 tangent = vec2(-delta.y, delta.x) / max(distanceToMouse, 1.);
  float nearMouse = 1. - smoothstep(radius * .5, radius * 2.4, distanceToMouse);
  vec2 flow = tangent * nearMouse * (1.7 + movement * 2.1);
  flow += vec2(sin(p.y * .026 + uTime), cos(p.x * .023 - uTime)) * .24;
  float ink = texture(uCurrent, vUv - flow / uView).g * .965;
  ink = min(1., ink + ripple * (.15 + movement * .35) * uActive);
  outColor = vec4(.5 + clamp(wave, -3.5, 3.5) * .125, ink, 0., 1.);
}`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uDust;
uniform sampler2D uSpace;
uniform sampler2D uCrown;
uniform sampler2D uVeil;
uniform sampler2D uFluid;
uniform sampler2D uHalo;
uniform sampler2D uDustAtmosphere;
uniform sampler2D uSpaceAtmosphere;
uniform sampler2D uDustGallery;
uniform sampler2D uSpaceGallery;
uniform vec2 uView;
uniform vec2 uSimSize;
uniform vec2 uOrigin;
uniform float uScale;
uniform vec2 uMouse;
uniform vec2 uVelocity;
uniform float uPresence;
uniform float uTime;
uniform float uHaloTime;
uniform float uHaloPeriod;
uniform float uCrownPulse;
uniform float uScene;
uniform float uNextScene;
uniform float uTransition;
uniform vec4 uPortals[7];
uniform float uPortalSeed;
uniform float uBlackHoleRadius;
uniform float uRevealSize;
uniform float uReduced;
${NOISE}
const float TAU = 6.28318530718;

vec4 portrait(sampler2D tex, vec2 p, vec4 rect) {
  vec2 uv = (p - rect.xy) / rect.zw;
  if (min(uv.x, uv.y) < 0. || max(uv.x, uv.y) > 1.) return vec4(0);
  return texture(tex, uv);
}
vec4 crown(vec2 p) { return portrait(uCrown, p, vec4(256., -24., 1048., 1048.)); }
vec4 veil(vec2 p) { return portrait(uVeil, p, vec4(216., 51., 1104., 1104.)); }
vec2 coverUv(vec2 uv) {
  float aspect = uView.x / uView.y;
  vec2 ratio = vec2(min(aspect / 1.5, 1.), min(1.5 / aspect, 1.));
  return (uv - .5) * ratio + .5;
}
vec4 galleryLayer(vec2 uv, float scene) {
  if (min(uv.x, uv.y) < 0. || max(uv.x, uv.y) > 1.) return vec4(0);
  return scene < .5 ? texture(uDustGallery, uv) : texture(uSpaceGallery, uv);
}
vec3 background(vec2 uv, float scene) {
  vec2 texUv = coverUv(uv);
  vec3 color;
  if (scene < .5) {
    // Low rolling gusts carry the fine source-image grain; the separately
    // simulated foreground sand has inertia and receives cursor impulses.
    vec2 wind = vec2(sin(uv.y * 6. + uTime * .3) * .0045 + sin(uTime * .12) * .006,
      cos(uv.x * 7. - uTime * .24) * .0028);
    float border = min(min(texUv.x, texUv.y), min(1. - texUv.x, 1. - texUv.y));
    wind *= smoothstep(0., .035, border);
    color = texture(uDust, clamp(texUv + wind * (1. - uReduced), .001, .999)).rgb;
    color += texture(uDustAtmosphere, clamp(uv, .001, .999)).rgb;
  } else {
    color = texture(uSpace, clamp(texUv, .001, .999)).rgb;
    float light = dot(color, vec3(.2126,.7152,.0722));
    float phase = noise(floor(texUv * 650.)) * TAU;
    float period = mix(.65, 1.13, noise(floor(texUv * 37.)));
    float twinkle = .66 + .34 * sin(uTime * period + phase);
    color *= 1. - smoothstep(.2, .75, light) * (1. - twinkle) * (1. - uReduced);
    color += texture(uSpaceAtmosphere, clamp(uv, .001, .999)).rgb;
  }
  vec4 frame = galleryLayer(uv, scene);
  return color * (1. - frame.a) + frame.rgb;
}
float fluidHeight(vec2 uv) { return (texture(uFluid, uv).r - .5) * 8.; }

// Sample the actual opaque portrait/sky together. Accretion inherits their
// colours and occlusion, instead of drawing bright synthetic lines on skin.
vec3 spaceMaterial(vec2 uv, vec2 headUv) {
  vec4 head = crown((headUv * uView - uOrigin) / uScale);
  return mix(background(uv, 1.), head.rgb, head.a);
}

vec3 renderScene(vec2 uv, float scene) {
  vec2 screen = uv * uView;
  float reveal = 0., liquidMask = 0., grain = 0.;
  float holeRim = 0., infall = 0.;
  vec2 materialDrift = vec2(0);
  vec2 normal = vec2(0), liquidOffset = vec2(0), displacement = vec2(0);
  // Uniform branches skip the unused cursor model and all refraction work
  // when the pointer is absent. A transition only shades its visible pixels.
  if (uPresence > .001) {
    if (scene > .5) {
      vec2 delta = screen - uMouse;
      float radius = uBlackHoleRadius * uScale;
      float distanceToMouse = length(delta);
      float d = distanceToMouse / max(radius, 1.);
      float angle = atan(delta.y, delta.x);
      vec2 radial = delta / max(distanceToMouse, 1.);
      float speed = length(uVelocity);
      float motion = min(speed / max(850. * uScale, 1.), 1.);
      float wake = dot(radial, uVelocity / max(speed, 1.));
      if (d < 2.2) {
        // Noise is sampled on the direction vector to stay seamless at +/- pi.
        float edgeNoise = fbm(radial * 2.8 + vec2(uTime * .09, -uTime * .07));
        float contour = 1. + .035 * sin(angle * 2. + uTime * .55)
          + .022 * sin(angle * 3. - uTime * .37) + (edgeNoise - .5) * .065 - wake * motion * .09;
        float edge = d - contour;
        reveal = (1. - smoothstep(-.055, .035, edge)) * uPresence;
        infall = exp(-pow((edge - .075) / .31, 2.)) * uPresence * (1. - uReduced);
        holeRim = exp(-pow((edge - .015) / .085, 2.)) * uPresence;
        // Backward sampling from farther out draws real material inward. The
        // moving broad shear curls it into the opening without periodic stripes.
        float current = sin(angle * 2. + log(max(d, .2)) * 4. + uTime * .85);
        float pull = infall * radius * (.22 + current * .025);
        float swirl = infall * (.24 + current * .035);
        displacement = (rotate(swirl) * (delta + radial * pull) - delta) / uView;
        vec2 tangent = vec2(-radial.y, radial.x);
        materialDrift = (tangent * .014 + radial * .008) * radius * infall / uView;
      }
    } else {
      vec2 texel = 1.5 / uSimSize;
      normal = vec2(fluidHeight(uv - vec2(texel.x,0)) - fluidHeight(uv + vec2(texel.x,0)),
        fluidHeight(uv - vec2(0,texel.y)) - fluidHeight(uv + vec2(0,texel.y)));
      liquidOffset = normal * .072 * uPresence * (1. - uReduced);
      float refractLength = length(liquidOffset * uView);
      liquidOffset *= min(1., 27. * uScale / max(refractLength, .001));
      float height = fluidHeight(uv);
      float ink = texture(uFluid, uv).g;
      grain = hash(floor(screen * 1.3));
      liquidMask = smoothstep(.052, .14, max(height, 0.) * uRevealSize + ink * .15 - grain * .015) * uPresence;
      reveal = liquidMask;
      displacement = liquidOffset;
    }
  }
  vec2 shiftedUv = uv + displacement;
  // Keep the portrait's lens shallower than the distant star field, so the
  // same inward flow doesn't stretch an eye into a long ribbon at the edge.
  vec2 portraitUv = uv + displacement * mix(.55, .62, scene);
  vec2 art = (portraitUv * uView - uOrigin) / uScale;
  // The revealed portrait keeps the same design slot; refraction is confined
  // to the boundary so the eyes and nose remain registered inside the opening.
  vec2 revealArt = (screen - uOrigin) / uScale;
  revealArt += liquidOffset * uView / uScale * (1. - scene) * .12;
  vec4 baseHead = scene < .5 ? veil(art) : crown(art);
  vec3 bg = background(shiftedUv, scene);

  // A static texture contains only extracted/constructed linework. Timing,
  // particle dashes, occlusion and scan envelopes are evaluated here.
  vec2 haloUv = art / vec2(1536., 1024.);
  vec3 halo = texture(uHalo, clamp(haloUv, 0., 1.)).rgb;
  float inArt = step(0., min(haloUv.x, haloUv.y)) * step(max(haloUv.x, haloUv.y), 1.);
  float cycle = mod(uHaloTime, uHaloPeriod);
  float dashes = .25 + .75 * smoothstep(.25, .65, noise(art * .24 + vec2(cycle * 9., 0)));
  float crownHalo = halo.r * uCrownPulse * dashes * .72;
  float scanProgress = clamp((cycle - .22) / 1.65, 0., 1.);
  float scanY = mix(260., 1080., scanProgress);
  float scan = exp(-pow((art.y - scanY) / 95., 2.));
  scan *= smoothstep(.18, .4, cycle) * (1. - smoothstep(1.83, 2.08, cycle));
  float veilHalo = halo.g * scan * .59;
  float haloBack = mix(crownHalo, veilHalo, scene) * inArt * (1. - reveal) * (1. - uReduced);
  vec3 haloColor = mix(vec3(.93,.77,.43), vec3(.66,.73,.78), scene);
  bg = mix(bg, haloColor, haloBack);
  vec3 baseColor = mix(bg, baseHead.rgb, baseHead.a);
  float frontLines = halo.b * scan * scene * .24 * (1. - reveal) * (1. - uReduced);
  baseColor = mix(baseColor, haloColor, frontLines);
  if (scene > .5 && infall > .01 && reveal < .999) {
    // A short, continuous material smear softens the lens. Subpixel-spaced
    // taps avoid the dashed star trails produced by long sparse blur kernels.
    vec3 dragged = baseColor * .46;
    dragged += spaceMaterial(shiftedUv + materialDrift * .33, portraitUv + materialDrift * .205) * .27;
    dragged += spaceMaterial(shiftedUv + materialDrift * .67, portraitUv + materialDrift * .415) * .17;
    dragged += spaceMaterial(shiftedUv + materialDrift, portraitUv + materialDrift * .62) * .10;
    baseColor = mix(baseColor, dragged, infall);
    // A soft absorption trough adds depth; it carries no painted highlight.
    baseColor *= 1. - holeRim * .27 * (1. - uReduced);
  }
  vec3 color = baseColor;
  if (reveal > .001) {
    vec4 revealedHead = scene < .5 ? crown(revealArt) : veil(revealArt);
    vec3 underneath = background(uv + displacement * .35, scene);
    color = mix(baseColor, mix(underneath, revealedHead.rgb, revealedHead.a), reveal);
  }

  if (uPresence > .001 && scene < .5) {
  // Discrete liquid edge grain; keep the original image's palette.
  float liquidEdge = liquidMask * (1. - liquidMask) * 4.;
  color += vec3(.09,.055,.016) * liquidEdge * grain * (1. - scene);
  vec3 waterNormal = normalize(vec3(normal * 18., 1.));
  vec3 lightDirection = normalize(vec3(-.45, -.65, 1.));
  float rippleLight = pow(max(dot(waterNormal, lightDirection), 0.), 22.);
  float slopeMask = smoothstep(.012, .13, length(normal));
  float wetEdge = (rippleLight * .22 + liquidEdge * .045) * slopeMask;
  color += vec3(1., .85, .62) * wetEdge * (1. - scene) * uPresence * (1. - uReduced);
  }
  return color;
}

// An advected, asymmetric distance field. Exponential blending rounds the
// necks between openings; it does not leave the sharp cusps of touching circles.
// The weighted surface normal also keeps refraction continuous while they join.
vec3 wormholes(vec2 uv, float progress) {
  vec2 aspect = uView / min(uView.x, uView.y);
  vec2 point = uv * aspect;
  float phase = uPortalSeed + progress * 2.3;
  vec2 drift = vec2(
    sin(point.y * 4.4 + phase) * .08 + sin(point.x * 5.3 + point.y * 3.1 - phase * .7) * .046,
    cos(point.x * 4. - phase) * .085 + sin(point.y * 5.8 - point.x * 2.4 + phase * .7) * .035);
  point += drift * sin(progress * 3.14159265);
  float sum = 0.;
  vec2 normal = vec2(0);
  float growth = length(aspect) * .38;
  float softness = mix(19., 10., smoothstep(.22, .72, progress));
  for (int i = 0; i < 7; i++) {
    vec4 seed = uPortals[i];
    float id = float(i) * 3.71 + uPortalSeed;
    float local = clamp((progress - seed.z) / (1. - seed.z), 0., 1.);
    float born = smoothstep(0., .11, local);
    vec2 origin = seed.xy * aspect;
    origin += vec2(sin(id + progress * 2.), cos(id * 1.3 - progress)) * .035 * sin(progress * 3.14159265);
    float rotation = id + progress * mix(-.8, .8, fract(seed.w * 7.));
    float stretch = mix(.77, 1.26, fract(seed.w * 13.));
    vec2 axes = vec2(stretch, 1. / stretch);
    vec2 offset = rotate(rotation) * (point - origin);
    vec2 shaped = offset * axes;
    float angle = atan(shaped.y, shaped.x);
    float radius = born * (.007 + pow(local, mix(1.8, 2.5, fract(seed.w * 5.))) * growth * seed.w);
    float lobes = sin(angle + id + local * 1.9) * .13
      + sin(angle * 2. - id * .6 - local) * .08 + sin(angle * 3. + id * .7) * .035;
    radius *= 1. + lobes * (1. - smoothstep(.72, 1., progress));
    radius += length(aspect) * smoothstep(.80, 1., progress);
    float distance = length(shaped) - radius + (1. - born) * 3.;
    float weight = exp(clamp(-distance * softness, -70., 60.));
    sum += weight;
    normal += rotate(-rotation) * (shaped * axes / max(length(shaped), .0001)) * weight;
  }
  float field = -log(max(sum, 1e-30)) / softness;
  normal /= max(sum, 1e-30);
  return vec3(field, normal / max(length(normal), 1e-30));
}

void main() {
  float p = uTransition;
  vec2 screenUv = vec2(vUv.x, 1. - vUv.y);
  if (p <= 0.) {
    outColor = vec4(renderScene(screenUv, uScene), 1.);
    return;
  }
  if (uReduced > .5) {
    outColor = vec4(mix(renderScene(screenUv, uScene), renderScene(screenUv, uNextScene), p), 1.);
    return;
  }
  vec2 screen = screenUv * uView;
  float energy = sin(p * 3.14159265);
  float granular = hash(floor(screen * .7));
  float reveal, suspended = 0., eddies = 0.;
  float apertureDistance = 1., orbit = 0.;
  vec2 spaceUv = screenUv;
  if (uNextScene > .5) {
    // Dust -> Space retains the original oblique gust and granular dissolve.
    vec2 windUv = screenUv + vec2(-p * .36, p * .16);
    eddies = fbm(windUv * vec2(4.5, 8.));
    float field = (1. - screenUv.x) * .52 + screenUv.y * .19 + eddies * .29;
    float front = mix(-.13, 1.19, smoothstep(.06, .94, p));
    reveal = 1. - smoothstep(front - .07, front + .07, field + granular * .045);
    suspended = exp(-pow((field - front) / .12, 2.)) * energy;
  } else {
    vec3 aperture = wormholes(screenUv, p);
    apertureDistance = aperture.x;
    vec2 radial = aperture.yz;
    orbit = atan(radial.y, radial.x);
    float rim = exp(-pow(apertureDistance / .048, 2.)) * energy;
    vec2 tangent = vec2(-radial.y, radial.x);
    // The sky shears around the event horizons while Dust keeps its alignment.
    spaceUv += (radial * .019 + tangent * .024) * rim * min(uView.x, uView.y) / uView;
    reveal = 1. - smoothstep(-.019, .019, apertureDistance + (granular - .5) * .002);
  }
  // Fully revealed pixels shade one scene, not two full-screen compositions.
  float portalLight = uNextScene > .5 ? 1. : smoothstep(.24, .62, p);
  vec3 portalDark = vec3(.004,.006,.009);
  vec3 color;
  if (reveal > .999) color = mix(portalDark, renderScene(screenUv, uNextScene), portalLight);
  else {
    color = renderScene(spaceUv, uScene);
    if (uNextScene < .5) {
      float shadow = exp(-pow((apertureDistance - .011) / .026, 2.));
      color *= 1. - shadow * .78 * energy;
    }
    if (reveal > .001) color = mix(color, mix(portalDark, renderScene(screenUv, uNextScene), portalLight), reveal);
  }
  if (uNextScene > .5) {
    float grains = pow(hash(floor((screenUv - vec2(p * .25, -p * .11)) * uView * .55)), 26.);
    color += vec3(.72,.4,.12) * grains * suspended * .85;
    color = mix(color, vec3(.32,.17,.055), suspended * eddies * .18);
  } else {
    float ring = exp(-pow(apertureDistance / .0045, 2.));
    float corona = exp(-pow((apertureDistance - .014) / .023, 2.));
    float threads = pow(max(0., sin(orbit * 19. - p * 28. + apertureDistance * 340.)), 22.);
    float fragments = smoothstep(.3, .76, noise(vec2(orbit * 27. - p * 9., apertureDistance * 160.)));
    vec3 metal = mix(vec3(.48,.64,.74), vec3(.84,.60,.28), smoothstep(.25, .84, p));
    float brokenRim = .25 + .75 * noise(screenUv * 16. + vec2(p * 1.8, -p));
    color += metal * (ring * .24 * brokenRim + corona * threads * fragments * .36) * energy;
  }
  outColor = vec4(color, 1.);
}`;
