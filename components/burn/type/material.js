// This shader shades only the inscription's glyph mask. It never reads or
// writes the scene simulation, so touching type cannot change scene timing.
export const TYPE_VERTEX = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

export const TYPE_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uMask;
uniform vec2 uSize;
uniform vec2 uPointer;
uniform float uTime;
uniform float uCold;
uniform float uContact;
uniform float uRadius;
uniform float uVortexRadius;
uniform float uArtwork;
uniform float uTinted;
uniform float uMotion;
uniform vec3 uFireSites[4];

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x),
    mix(hash(i + vec2(0., 1.)), hash(i + vec2(1.)), f.x), f.y);
}
float maskAt(vec2 p) {
  return texture2D(uMask, vec2(p.x / uSize.x, 1.0 - p.y / uSize.y)).a;
}
float fireAt(vec2 p, bool flaming) {
  float strength = 0.0;
  for (int i = 0; i < 4; i++) {
    float energy = uFireSites[i].z;
    if (flaming) energy = smoothstep(0.25, 0.95, energy);
    float falloff = 1.0 - smoothstep(uRadius * 0.20, uRadius, length(p - uFireSites[i].xy));
    strength = max(strength, falloff * energy);
  }
  return strength * (1.0 - uCold);
}

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  vec2 fromPointer = p - uPointer;
  float distance = length(fromPointer);
  float touch = (1.0 - smoothstep(uVortexRadius / 15.0, uVortexRadius, distance)) * uContact;
  float wet = touch * uCold;
  float heat = fireAt(p, false);

  // The ink is pulled around the same cold eye as the scene. A turning swell
  // carries the carved strokes, followed by smaller refractive ripples.
  vec2 radial = fromPointer / max(distance, 0.001);
  vec2 tangent = vec2(-radial.y, radial.x);
  float angle = atan(fromPointer.y, fromPointer.x);
  float spiral = distance * 0.19 - angle * 2.0 - uTime * 2.2;
  float ripple = sin(spiral);
  float eye = smoothstep(0.0, uVortexRadius * 0.30, distance);
  vec2 flow = tangent * (4.0 + 1.8 * ripple)
    + radial * sin(distance * 0.29 - uTime * 3.1) * 2.0;
  vec2 q = p + flow * wet * eye * uMotion;
  float glyph = maskAt(q);
  float raised = maskAt(q + vec2(0.55, 0.7));
  float recessed = maskAt(q - vec2(0.55, 0.7));

  // A single aged-ivory surface in every scene. Static pores, mineral layers
  // and rubbed edges belong to the inscription, not to the cursor phase.
  float grain = hash(floor(q * 1.7));
  float mottling = noise(q * 0.12);
  float fibre = noise(vec2(q.x * 0.15, q.y * 1.45) + noise(q * 0.045) * 3.0);
  float pores = smoothstep(0.71, 0.91, noise(q * 0.82));
  float mineral = noise(q * 0.095 + noise(q * 0.027) * 4.0);
  // For supplied icon artwork, its luminance carries the original engraving
  // and filigree. Recolour the relief instead of flattening it into a solid mask.
  vec3 source = texture2D(uMask, vec2(q.x / uSize.x, 1.0 - q.y / uSize.y)).rgb;
  float relief = mix(1.0, 0.20 + 0.80 * smoothstep(0.035, 0.66,
    dot(source, vec3(0.299, 0.587, 0.114))), uArtwork);
  vec3 ivory = mix(vec3(0.67, 0.63, 0.53), vec3(0.88, 0.85, 0.77),
    0.40 + mineral * 0.42 + mottling * 0.18);
  ivory += (grain - 0.5) * 0.10;
  ivory -= pores * 0.045;
  ivory *= relief;
  // White masks preserve existing inscriptions; navigation may tint its own ink.
  ivory *= mix(vec3(1.0), source, uTinted);

  // Wood is revealed only around the flame's contact point.
  vec3 wood = mix(vec3(0.40, 0.28, 0.18), vec3(0.79, 0.67, 0.49),
    0.48 + 0.29 * fibre + 0.23 * mottling);
  wood += (grain - 0.5) * 0.18;
  wood -= pores * 0.10;
  wood *= relief;

  // The vortex temporarily wets the same ivory, revealing cool mineral veins.
  float vein = pow(1.0 - abs(noise(q * 0.31) * 2.0 - 1.0), 15.0);
  vec3 ice = mix(vec3(0.18, 0.34, 0.39), vec3(0.69, 0.81, 0.80), mineral);
  ice += (grain - 0.5) * 0.10 + vein * 0.16;
  ice *= mix(0.38, 1.0, relief);

  float timber = smoothstep(0.025, 0.30, heat);
  vec3 pigment = mix(ivory, wood, timber);
  pigment = mix(pigment, ice, wet * 0.92);
  pigment += (glyph - recessed) * 0.12;
  pigment -= (glyph - raised) * 0.24;

  // Tiny hot fissures open where the flame touches the carved surface.
  float flicker = 0.80 + 0.12 * sin(uTime * 10.7 + q.x * 0.4)
    + 0.08 * sin(uTime * 17.3 + q.y * 0.7);
  flicker = mix(0.86, flicker, uMotion);
  float ember = smoothstep(0.32, 0.78, fibre + noise(q * 0.43) * 0.28);
  vec3 coal = mix(vec3(0.12, 0.045, 0.018), vec3(1.0, 0.47, 0.065), ember);
  pigment = mix(pigment, coal, heat * flicker * 0.9);
  float hotEdge = clamp(glyph - min(raised, recessed), 0.0, 1.0);
  pigment += vec3(0.65, 0.31, 0.065) * heat * (ember * 0.7 + hotEdge) * flicker;
  // Moving caustics catch the wet bevel; darker troughs make their passage
  // visible without turning the whole inscription into a luminous overlay.
  float caustic = pow(0.5 + 0.5 * ripple, 7.0);
  pigment += vec3(0.36, 0.52, 0.53) * wet * caustic;
  pigment += vec3(0.28, 0.40, 0.42) * wet * hotEdge;
  pigment -= vec3(0.07, 0.08, 0.07) * wet * (1.0 - caustic);

  // Trace rising, wind-bent tongues back down to real burning ink. Contact is
  // measured at each root, not the flame tip: tips can rise beyond the cursor
  // without igniting distant letters or painting a circular cursor halo.
  float plume = 0.0;
  float fireEnergy = fireAt(p + vec2(0.0, 18.0), true);
  float rise = clamp(uRadius * 1.35, 44.0, 60.0) * mix(0.22, 1.0, sqrt(fireEnergy));
  float turbulence = noise(vec2(p.x * 0.16, p.y * 0.085 + uTime * 2.7));
  float tongues = noise(vec2(p.x * 0.30, p.y * 0.065 + uTime * 3.6));
  for (int i = 1; i <= 16; i++) {
    float h = float(i) / 16.0;
    float sway = (sin(p.y * 0.11 - uTime * 4.1) * 2.2
      + (turbulence - 0.5) * 9.0) * h;
    vec2 root = p + vec2(sway, h * rise);
    float rootHeat = fireAt(root, true);
    float ink = maskAt(root);
    if (uArtwork > 0.5) {
      // Icons have very fine strokes. Give each burning root a small, soft
      // shoulder so its rising flame has a body, then narrow toward the tip.
      float shoulder = mix(2.6, 0.65, h) * (0.85 + turbulence * 0.3);
      float sides = max(maskAt(root + vec2(shoulder, 0.0)),
        maskAt(root - vec2(shoulder, 0.0)));
      float nearSides = max(maskAt(root + vec2(shoulder * 0.45, 0.0)),
        maskAt(root - vec2(shoulder * 0.45, 0.0)));
      ink = max(ink, max(nearSides * 0.86, sides * 0.48));
    }
    float fuel = ink * rootHeat;
    float taper = 1.0 - smoothstep(0.18 + tongues * 0.32, 0.55 + tongues * 0.45, h);
    plume = max(plume, fuel * taper);
  }
  plume *= uMotion;
  float flame = smoothstep(0.04, 0.66, plume) * (0.84 + grain * 0.16);
  vec3 fire = mix(vec3(0.95, 0.14, 0.012), vec3(1.0, 0.62, 0.08),
    smoothstep(0.12, 0.56, plume));
  fire = mix(fire, vec3(1.0, 0.92, 0.57), smoothstep(0.56, 0.95, plume));

  float alpha = glyph * (0.89 + grain * 0.11);
  vec3 color = pigment * alpha + fire * flame * (1.0 - alpha);
  alpha += flame * (1.0 - alpha);
  // A shallow carved shadow keeps fine copy readable over bright paint. It is
  // attached to the glyph edges, not a glow or a panel behind the inscription.
  float shade = (maskAt(p - vec2(0.5, 0.75)) * 0.35
    + maskAt(p - vec2(0.9, 1.15)) * 0.22) * (1.0 - alpha);
  color += mix(vec3(0.065, 0.049, 0.030), vec3(0.025, 0.049, 0.055), wet) * shade;
  alpha += shade;
  gl_FragColor = vec4(color, alpha);
}`;
