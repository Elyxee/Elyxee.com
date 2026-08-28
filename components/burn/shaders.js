// GLSL ES 1.00 — runs unmodified on both WebGL1 and WebGL2 contexts.

export const QUAD_VS = `
attribute vec2 aPos;
varying vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Baked once into a tileable RGBA texture so the per-frame passes never run fbm.
//   R organic  — domain-warped mid frequency, drives the ragged burn contour
//   G mid      — secondary contour break-up
//   B fuel     — low frequency material density, makes burning uneven
//   A grain    — high frequency fibre / carbon speckle
export const NOISE_BAKE_FS = `
precision highp float;
varying vec2 vUv;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Value noise on a lattice wrapped to \`period\` so the result tiles seamlessly.
float pnoise(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 i0 = mod(i, period);
  vec2 i1 = mod(i + 1.0, period);
  float a = hash21(i0);
  float b = hash21(vec2(i1.x, i0.y));
  float c = hash21(vec2(i0.x, i1.y));
  float d = hash21(i1);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float pfbm(vec2 uv, float period, int octaves) {
  float value = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  float per = period;
  vec2 p = uv * period;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    value += amp * pnoise(p, per);
    norm += amp;
    p *= 2.0;
    per *= 2.0;
    amp *= 0.5;
  }
  return value / max(norm, 1e-5);
}

float contrast(float v, float amount) {
  return clamp((v - 0.5) * amount + 0.5, 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;

  vec2 warp = vec2(
    pfbm(uv + vec2(0.13, 0.71), 6.0, 3),
    pfbm(uv + vec2(0.77, 0.29), 6.0, 3)
  ) - 0.5;

  float organic = pfbm(uv + warp * 0.42, 6.0, 5);
  float mid = pfbm(uv + warp * 0.20, 13.0, 4);
  float fuel = pfbm(uv + warp * 0.55, 3.0, 3);
  float grain = pfbm(uv, 29.0, 3);

  gl_FragColor = vec4(
    contrast(organic, 1.75),
    contrast(mid, 1.55),
    contrast(fuel, 1.35),
    contrast(grain, 1.20)
  );
}
`;

// Persistent burn state, ping-ponged every frame.
//   R burn    — 0 intact ... 1 fully consumed
//   G heat    — thermal energy, drives combustion + the glowing front
//   B char    — highest burn reached, heals slower so char trails the closing hole
//   A spent   — this patch has burnt through once already, and never unsets
export const SIM_FS = `
precision highp float;
varying vec2 vUv;

uniform sampler2D uState;
uniform sampler2D uNoise;
uniform vec2 uTexel;
uniform float uAspect;
uniform vec2 uPointerPrev;
uniform vec2 uPointer;
uniform float uPointerActive;
uniform float uDt;
uniform float uRadius;
uniform float uInject;
uniform float uScorchRate;
uniform float uBurnRate;
uniform float uSpreadRate;
uniform float uSpreadDrop;
uniform float uCombustion;
uniform float uDiffuse;
uniform float uHeatDecay;
uniform float uHealBurn;
uniform float uHealChar;
uniform float uDepthMax;
// Ash in an open hole metabolizes in ~5s (1/rate seconds).
uniform float uAshFade;
// 0 while recoveryHold is counting down — freezes knit-back so the burn reads.
uniform float uHealScale;
// Extra carbon fade during the mid-recovery ash plateau only.
uniform float uAshMidFade;
// 1 = first-pass diffusion (fast spread while the source is working).
// 0 = after a full recovery: burn only where the pointer is.
uniform float uSpreadMode;

// Below this the sheet only browns; it is the lowest temperature that can turn
// material to carbon.
const float IGNITE_FLOOR = 0.045;

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 uv = vUv;
  vec2 ap = vec2(uv.x * uAspect, uv.y);

  vec4 state = texture2D(uState, uv);
  float burn = state.r;
  float heat = state.g;
  float charred = state.b;
  float spent = state.a;

  // Material density. The low frequency band is the important one: it decides
  // which directions the fire runs in, and is what stops the opening from
  // growing as a disc.
  float fuelLow = texture2D(uNoise, ap * 0.55 + vec2(0.21, 0.63)).b;
  float fuelMid = texture2D(uNoise, ap * 1.60 - vec2(0.44, 0.12)).b;
  float fuel = 0.50 + 1.05 * mix(fuelLow, fuelMid, 0.35);
  float grain = texture2D(uNoise, ap * 2.3 + vec2(0.31, 0.77)).r;
  float grainFine = texture2D(uNoise, ap * 6.1 - vec2(0.19, 0.53)).a;

  // Heat source is swept along the segment travelled this frame, so a fast
  // pointer still leaves a continuous scorch instead of dotted stamps.
  vec2 pa = vec2(uPointerPrev.x * uAspect, uPointerPrev.y);
  vec2 pb = vec2(uPointer.x * uAspect, uPointer.y);
  float dist = sdSegment(ap, pa, pb);
  float radius = uRadius * (0.62 + 0.76 * grain);
  float shape = 1.0 - smoothstep(0.0, radius, dist);
  shape *= shape;

  // Heat only heats material that can actually burn. Lingering in a cleared hole
  // was bathing loose ash in temperature and immediately re-lighting it.
  float sheetFuel = 1.0 - smoothstep(0.52, 0.68, burn);
  heat += shape * uPointerActive * uInject * fuel * uDt * sheetFuel;
  // Direct scorch only lands on sheet that is still present. Dumping damage into
  // an already open hole is what re-seeded black ash flakes inside it whenever
  // the cursor lingered there.
  float intact = 1.0 - smoothstep(0.42, 0.58, burn);
  burn += shape * uPointerActive * uScorchRate * fuel * uDt * intact;

  vec4 n0 = texture2D(uState, uv + vec2(uTexel.x, 0.0));
  vec4 n1 = texture2D(uState, uv - vec2(uTexel.x, 0.0));
  vec4 n2 = texture2D(uState, uv + vec2(0.0, uTexel.y));
  vec4 n3 = texture2D(uState, uv - vec2(0.0, uTexel.y));
  vec4 n4 = texture2D(uState, uv + uTexel);
  vec4 n5 = texture2D(uState, uv - uTexel);
  vec4 n6 = texture2D(uState, uv + vec2(uTexel.x, -uTexel.y));
  vec4 n7 = texture2D(uState, uv + vec2(-uTexel.x, uTexel.y));

  float burnOrtho = max(max(n0.r, n1.r), max(n2.r, n3.r));
  float burnDiag = max(max(n4.r, n5.r), max(n6.r, n7.r));
  float burnMax = max(burnOrtho, burnDiag);
  // Averaged, not maxed: a max would march outwards one texel per frame in
  // every axis equally and grow the front into a square.
  float heatAvg =
    (n0.g + n1.g + n2.g + n3.g) * 0.16 +
    (n4.g + n5.g + n6.g + n7.g) * 0.09;

  heat = mix(heat, heatAvg, clamp(uDt * uDiffuse, 0.0, 0.6));

  // Reach of the heat source — same falloff the first-pass fire always used.
  float reach = 1.0 - smoothstep(uRadius * 1.2, uRadius * 3.6, dist);
  float underSource = reach * uPointerActive;

  // Combustion. First pass (uSpreadMode = 1): full self-sustain on virgin
  // sheet — identical to the previous fast diffusion feel. Spent sheet (already
  // opened) never self-lights, which is what stopped recovery from completing:
  // a half-healed rim was dropping back into the charring band and reigniting.
  // After a full recovery uSpreadMode goes to 0 and only underSource remains —
  // mouse to where it burns, no diffusion.
  float alive = smoothstep(0.010, 0.055, max(heat, heatAvg));
  float front = smoothstep(0.18, 0.42, burn) * (1.0 - smoothstep(0.62, 0.88, burn));
  // First pass: full self-sustain on virgin sheet. Pinpoint pass (spreadMode = 0):
  // no neighbour spread, but the charring band under the source still runs hot so
  // the rim gets ember — without this the edge is only black crust (spent legacy
  // or a steep cliff) and reads as an inked outline instead of fire.
  float selfSustain = uSpreadMode * (1.0 - spent) * sheetFuel * alive;
  float pinpointFront = (1.0 - uSpreadMode) * front * alive * underSource;
  float driven = max(underSource, max(selfSustain, pinpointFront));
  heat += front * driven * uCombustion * fuel * uDt;
  heat = min(heat, 1.6);

  // Damage needs a real temperature behind it. The faint heat that diffuses out
  // past the front browns the sheet, but must not be allowed to carbonise it, or
  // a source held in one place would keep widening a ring of black around itself
  // for as long as it sits there. Material that has already charred takes far
  // less to consume, so passing back over an old scorch opens it up instead of
  // blackening it further. Spent (already opened) sheet only takes more damage
  // under the source — ambient heat there was re-laying ash flakes in the hole.
  float precharred = smoothstep(0.30, 1.10, charred);
  float ignition = max(heat - IGNITE_FLOOR, 0.0);
  ignition *= mix(1.0, underSource, smoothstep(0.45, 0.95, spent));
  ignition *= sheetFuel;
  burn += ignition * uBurnRate * fuel * (1.0 + 1.60 * precharred) * uDt;

  // Front propagation as a descending distance field: neighbours can only pull
  // this texel up to (neighbour - drop), so the burn stays a cone rather than a
  // plateau. The uneven drop is what keeps the boundary irregular, and the
  // diagonal step costs sqrt(2) so the front does not grow into a square.
  //
  // First pass: bare alive gate — same fast diffusion as before. Spent texels
  // refuse neighbour pull unless the source is on them, so a recovering hole
  // cannot be eaten again by a front still running elsewhere. Pinpoint mode:
  // only underSource advances the field.
  float drop = uSpreadDrop * (0.18 + 1.90 * mix(fuelLow, mix(grain, grainFine, 0.45), 0.45));
  float target = max(burnOrtho - drop, burnDiag - drop * 1.4142);
  float spreadGate = mix(
    underSource,
    alive * sheetFuel * mix(1.0, underSource, smoothstep(0.45, 0.95, spent)),
    uSpreadMode
  );
  burn = max(burn, mix(burn, target, clamp(uDt * uSpreadRate, 0.0, 1.0) * spreadGate));

  // Damage keeps accumulating past burn-through, so a spot that was held under
  // the source ends up deeper than the rim. That dome is what lets a constant
  // heal rate walk the opening shut from its edge inwards instead of dropping
  // the whole plateau under the threshold at once. The slope limit keeps the
  // dome from spiking and sets how far the char and ember bands can read.
  burn = min(burn, max(burnMax + drop, shape * uPointerActive));
  burn = clamp(burn, 0.0, uDepthMax);

  heat *= exp(-uHeatDecay * uDt);

  // Once cold, the sheet knits back together. The rate is deliberately close to
  // uniform: healing deep damage faster would flatten the dome, and the whole
  // plateau would then drop under the threshold at once instead of the rim
  // walking inwards. A near-constant rate keeps the dome's shape as it sinks.
  float cold = 1.0 - smoothstep(0.010, 0.080, heat);
  // Only a slight spread in rate. It keeps the closing rim from being a perfect
  // curve, but a wide spread over a recovery this long would let parts of the
  // opening knit shut well ahead of the rest and leave black patches stranded
  // inside it, since the carbon there outlives the sheet that closed over.
  float healJitter = 0.92 + 0.16 * grain;
  burn -= uDt * uHealBurn * cold * healJitter * (0.85 + 0.15 * burn) * uHealScale;
  burn = clamp(burn, 0.0, uDepthMax);

  // Carbon clears slower than the opening so the rim and ash crust outlast the
  // hole briefly — viewers get time to read the ice before paper knits over.
  charred = max(charred, burn * smoothstep(0.30, 0.62, burn));
  charred -= uDt * uHealChar * cold * healJitter * (0.85 + 0.15 * charred) * uHealScale;
  charred = clamp(charred, burn, uDepthMax);

  // Loose ash in an open hole, or carbon left over after burn-through, fades when
  // healing runs — held during recoveryHold so a cleared hole stays readable.
  float opened = smoothstep(0.50, 0.64, burn);
  float ashLoose = spent * smoothstep(0.06, 0.20, charred - burn);
  charred -= uDt * uAshFade * max(opened, ashLoose) * charred * uHealScale;
  charred = clamp(charred, burn, uDepthMax);

  // Mid-recovery: the hole is knitting shut but carbon still blankets the sheet
  // — the long all-ash phase. Nudge char down faster here only; hold and tail
  // are untouched because this window needs burn in (0.26, 0.52) and char high.
  float midPlateau = smoothstep(0.22, 0.50, charred) * smoothstep(0.52, 0.26, burn);
  charred -= uDt * uAshMidFade * midPlateau * charred * uHealScale;
  charred = clamp(charred, burn, uDepthMax);

  // Spent marks sheet that has opened and never clears on its own. Clearing it
  // as the hole healed was letting a still-living front elsewhere walk back in
  // and eat the recovery — the "just healed a little then burned again" bug.
  // Latch on burn-through as well as deep char so ash in a cleared hole cannot
  // keep self-sustaining before charred reaches the old high threshold.
  // Clears once the patch has fully knitted — second-pass burns then dress like
  // the first instead of inheriting a permanent spent stain.
  spent = max(spent, smoothstep(0.52, 0.66, burn));
  spent = max(spent, smoothstep(0.80, 1.05, charred));
  spent *= smoothstep(0.0, 0.04, max(burn, charred));

  gl_FragColor = vec4(burn, heat, charred, spent);
}
`;

// Reads the burn state and cuts the upper sheet away from the lower one.
// Layers are measured as a signed distance to the burn contour, in pixels, so
// char and ember widths stay constant no matter how steep the state field is.
// No crossfade anywhere: the sheet is either present or gone.
export const COMPOSITE_FS = `
precision highp float;
varying vec2 vUv;

uniform sampler2D uFire;
uniform sampler2D uIce;
uniform sampler2D uState;
uniform sampler2D uNoise;
uniform vec2 uResolution;
uniform vec2 uSimSize;
uniform vec2 uFireSize;
uniform vec2 uIceSize;
uniform float uPixelScale;
uniform float uTime;
uniform float uEdgeChaos;
uniform float uFlicker;

const float CONTOUR = 0.50;
const float EMBER_WIDTH = 9.0;
const float CHAR_WIDTH = 26.0;

vec2 coverUv(vec2 uv, float canvasAspect, vec2 texSize) {
  float texAspect = texSize.x / max(texSize.y, 1.0);
  vec2 scale = vec2(1.0);
  if (texAspect > canvasAspect) scale.x = canvasAspect / texAspect;
  else scale.y = texAspect / canvasAspect;
  return (uv - 0.5) * scale + 0.5;
}

// Plain bilinear leaves creases on texel borders, and a near-binary threshold
// turns those creases into visible staircases along the rim. Easing the
// fractional coordinate makes the reconstruction smooth across them.
vec4 sampleState(vec2 uv) {
  vec2 p = uv * uSimSize - 0.5;
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return texture2D(uState, (i + 0.5 + f) / uSimSize);
}

void main() {
  vec2 uv = vUv;
  float canvasAspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 ap = vec2(uv.x * canvasAspect, uv.y);

  vec4 state = sampleState(uv);
  float burn = state.r;
  float heat = state.g;
  float charState = state.b;
  float spent = state.a;

  // Central differences on the state field, rescaled from sim texels to screen
  // pixels, turn the raw damage value into a distance we can dress in pixels.
  vec2 texel = 1.0 / uSimSize;
  vec2 pixelsPerTexel = uResolution / uSimSize;
  float px = uPixelScale;
  // Distance comes out of a reciprocal slope, so a field that flattens as it
  // heals would stretch the dressed bands across the whole opening. This is the
  // furthest a band is ever allowed to claim it is from the contour.
  float minSlope = CONTOUR / (110.0 * px);
  float dx = sampleState(uv + vec2(texel.x, 0.0)).r - sampleState(uv - vec2(texel.x, 0.0)).r;
  float dy = sampleState(uv + vec2(0.0, texel.y)).r - sampleState(uv - vec2(0.0, texel.y)).r;
  vec2 gradient = vec2(dx, dy) * 0.5 / pixelsPerTexel;
  // Floored, because the field flattens out as it heals and an unbounded
  // reciprocal would stretch the dressed bands across the whole opening.
  float slope = max(length(gradient), minSlope);

  // The raw field saturates within a few texels of the front, which caps how far
  // out a distance derived from it can reach. The char band therefore reads a
  // softened copy gathered on a wide ring, which stretches the usable range far
  // enough to carry a proper carbonised margin. The ring is rotated per pixel so
  // the sampling pattern never prints its own shape into the boundary.
  const float BASE = 4.0;
  vec4 spin = texture2D(uNoise, ap * 41.0);
  vec4 grit = texture2D(uNoise, ap * 7.50 - vec2(0.23, 0.61));
  float rotation = spin.a * 6.2831853;
  vec2 wide = texel * BASE;
  float charSoft = charState * 0.20;
  vec2 moment = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    float angle = rotation + float(i) * 0.7853982;
    vec2 dir = vec2(cos(angle), sin(angle));
    float value = sampleState(uv + dir * wide).b;
    charSoft += value * 0.10;
    moment += value * dir;
  }
  vec2 charGradient = moment * 0.25 / (pixelsPerTexel * BASE);
  float charSlope = max(length(charGradient), minSlope);

  // The state drops to nothing a texel or two beyond the front, so the long
  // heat-browning halo cannot be read off it at any threshold — it is gathered
  // here instead, on a ring wide enough to reach well out into clean sheet.
  const float WIDE = 13.0;
  float wideRotation = spin.b * 6.2831853;
  float charWide = 0.0;
  for (int i = 0; i < 6; i++) {
    float angle = wideRotation + float(i) * 1.0471976;
    // Plain bilinear: this gather is a blur already, so the eased sampling the
    // rim needs would only cost fetches here.
    charWide += texture2D(uState, uv + vec2(cos(angle), sin(angle)) * texel * WIDE).b;
  }
  charWide *= 0.1667;

  float holeDist = clamp((burn - CONTOUR) / slope, -600.0, 600.0);
  float charDist = clamp((charSoft - CONTOUR) / charSlope, -600.0, 600.0);

  // The contour is displaced, not blurred: every scale pushes the burn line a
  // different number of pixels sideways, which is what makes it look torn.
  // Each octave is fetched once and its four channels — which the bake filled
  // with unrelated patterns — are spread across the rim, the crust edge and the
  // crust width, so the three never trace one another.
  vec2 warp = (texture2D(uNoise, ap * 0.9 + vec2(0.05, 0.37)).rg - 0.5) * 0.20;
  vec4 o1 = texture2D(uNoise, (ap + warp) * 1.70 + vec2(0.13, 0.41));
  vec4 o2 = texture2D(uNoise, (ap + warp) * 4.30 - vec2(0.27, 0.09));
  vec4 o3 = texture2D(uNoise, (ap + warp) * 11.0 + vec2(0.63, 0.22));
  vec4 o4 = texture2D(uNoise, (ap + warp) * 27.0 - vec2(0.41, 0.87));
  float chaos = (
      (o1.r - 0.5) * 17.0
    + (o2.g - 0.5) * 12.0
    + (o3.a - 0.5) * 5.5
    + (o4.g - 0.5) * 2.5
  ) * uEdgeChaos * px;

  // The crust gets its own displacement on top of a fraction of the opening's.
  // Sharing the offset outright would make its outer edge a parallel copy of the
  // rim, which is exactly what reads as an inked outline rather than charring.
  float charChaos = (
      (o1.b - 0.5) * 19.0
    + (o2.r - 0.5) * 11.0
    + (o3.g - 0.5) * 7.0
    + (o4.a - 0.5) * 3.4
  ) * uEdgeChaos * px;

  holeDist += chaos;
  charDist += chaos * 0.55 + charChaos;

  vec3 fire = texture2D(uFire, coverUv(uv, canvasAspect, uFireSize)).rgb;
  vec3 ice = texture2D(uIce, coverUv(uv, canvasAspect, uIceSize)).rgb;

  // Sheet presence — one pixel of softening only, so the rim reads as torn.
  // Spent patches that have not fully knitted shut stay open: a half-healed
  // dome dropping under the contour otherwise flashes as ash islands over ice
  // whenever the cursor keeps heat in an already cleared hole.
  float sheet = 1.0 - smoothstep(-0.8 * px, 0.8 * px, holeDist);
  float spentHold = spent * smoothstep(0.04, 0.18, max(burn, charState));
  sheet *= 1.0 - spentHold;

  vec3 surface = fire;

  // Outermost halo: paper going tan well ahead of anything carbonised, built
  // from the wide gather so it reaches out into clean sheet.
  float haloGrain = 0.66 + 0.68 * o2.a;
  float halo = smoothstep(0.06, 0.95, charWide * haloGrain);
  surface = mix(surface, surface * vec3(0.74, 0.55, 0.36), halo * 0.80);

  // Heat browning, close in. This is the only layer a quick pass ever reaches,
  // so it has to register at low damage.
  float scorch = smoothstep(0.012, 0.20, charSoft);
  float scorchGrain = 0.72 + 0.56 * grit.r;
  surface = mix(surface, surface * vec3(0.58, 0.34, 0.18), scorch * scorchGrain * 0.92);

  // A second, deeper singe sits between that browning and the carbon. Distance
  // from the rim saturates a few pixels out, so this one is driven by the field
  // value, which carries much further and keeps the crust from meeting fresh
  // paper along a hard line. Its own grain keeps the two bands from nesting.
  float singeGrain = 0.70 + 0.60 * o3.b;
  float singeMottle = 0.58 + 0.84 * o4.b;
  float singe = smoothstep(0.18, 0.72, charSoft * singeGrain);
  surface = mix(
    surface,
    surface * vec3(0.56, 0.38, 0.24) * singeMottle + vec3(0.011, 0.005, 0.002),
    singe * 0.90
  );

  // Carbonised crust. Its width swings on the scale of the band itself, so it
  // pinches away to nothing in places and swells into tongues in others rather
  // than tracing the opening at an even thickness like an outline.
  float crustWidth = CHAR_WIDTH * (0.42 + 0.58 * o2.b + 0.52 * o3.r + 0.30 * o4.r);

  float crack = texture2D(uNoise, ap * 21.0 + vec2(0.53, 0.17)).r;
  float flake = grit.g;
  float soot = spin.r;

  // Carbon only forms where a burn actually took hold. A light scorch that never
  // opened anything keeps a lighter brown instead of laying down black flakes,
  // which is what otherwise litters the area around the source.
  float carbonised = smoothstep(0.38, 0.88, charWide);

  float alive = smoothstep(0.001, 0.018, heat);
  float activity = smoothstep(0.008, 0.110, heat);

  // Active charring band — drives ember even when simulated heat is still
  // catching up (pinpoint second pass) so the rim is fire, not a black stroke.
  float rimActive = smoothstep(0.14, 0.40, burn) * (1.0 - smoothstep(0.54, 0.82, burn));
  float emberLife = max(alive * activity, rimActive * (0.42 + 0.58 * activity));
  float carbonGate = carbonised * (1.0 - rimActive * (1.0 - max(alive, activity * 0.85)) * 0.92);

  // Blistered shoulder right against the crust, where the sheet has gone dark
  float shoulder = smoothstep(-crustWidth * 1.90 * px, -crustWidth * 0.75 * px, charDist);
  surface = mix(surface, surface * (0.30 + 0.55 * flake) + vec3(0.010, 0.005, 0.002),
    shoulder * mix(0.45, 0.85, carbonGate));

  vec3 ash = mix(vec3(0.018, 0.013, 0.012), vec3(0.205, 0.172, 0.155), pow(crack * flake, 0.95));
  ash = mix(ash, vec3(0.35, 0.33, 0.315), smoothstep(0.50, 0.92, soot * flake * 1.55) * 0.65);
  float crust = smoothstep(-crustWidth * px, -crustWidth * 0.30 * px, charDist);
  // Left slightly translucent where the crust cracks and flakes, so it keeps a
  // relationship with the sheet underneath instead of sitting on top of it.
  surface = mix(surface, ash, crust * carbonGate * (0.74 + 0.24 * crack));

  float scroll = texture2D(uNoise, ap * 4.2 + vec2(uTime * 0.10, -uTime * 0.07)).r;
  float scrollFine = texture2D(uNoise, ap * 11.0 - vec2(uTime * 0.17, uTime * 0.05)).g;
  // Wide swing so the front glows in patches instead of as an even ring.
  float flicker = mix(1.0, 0.42 + 0.78 * scroll + 0.38 * scrollFine, uFlicker);

  // Narrow incandescent line hugging the opening, only while that front burns.
  float hotness = smoothstep(-EMBER_WIDTH * px, 0.0, holeDist);
  float band = hotness * (1.0 - smoothstep(0.0, 1.2 * px, holeDist));
  float ember = band * emberLife * (0.58 + 0.78 * flicker);

  vec3 emberColor = mix(vec3(0.30, 0.022, 0.004), vec3(0.95, 0.24, 0.02), pow(hotness, 1.45));
  emberColor = mix(emberColor, vec3(1.0, 0.58, 0.20), smoothstep(0.82, 1.0, hotness) * 0.52);
  surface += emberColor * ember * 2.85;

  // Heat bleeding back into the carbon behind the front.
  float glowBand = smoothstep(-CHAR_WIDTH * 0.75 * px, -EMBER_WIDTH * px, holeDist);
  surface += vec3(0.42, 0.11, 0.028) * glowBand * emberLife * 0.62 * flicker;

  // Faint ember memory while char heals out — keeps recovery from snapping to cold.
  float healGlow = smoothstep(0.06, 0.22, charState - burn) * (1.0 - alive) * rimActive;
  surface += vec3(0.24, 0.065, 0.014) * healGlow * smoothstep(0.04, 0.18, charWide) * 0.48 * flicker;

  // Below the sheet: contact shadow from the burnt lip plus a little spill
  // light, so the opening reads as depth rather than a stencil.
  float lip = 1.0 - smoothstep(0.0, 13.0 * px, holeDist);
  vec3 below = ice;
  below *= mix(1.0, 0.24, lip * lip * 0.96);
  below += vec3(0.88, 0.30, 0.06) * lip * lip * emberLife * 0.48 * flicker;

  vec3 color = mix(below, surface, sheet);
  gl_FragColor = vec4(color, 1.0);
}
`;
