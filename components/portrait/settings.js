// Figma Main: coordinates relative to Dust 1 / Space 1, not image centres.
// Both scenes share these slots so eyes, crown and veil never jump on switch.
export const COMPOSITION = Object.freeze({
  width: 1536,
  height: 1024,
  crown: Object.freeze([256, -24, 1048, 1048]),
  veil: Object.freeze([216, 51, 1104, 1104]),
});

export const PORTRAIT_SETTINGS = Object.freeze({
  dprCap: 1.75,
  simLongSide: 512,
  followRate: 18,
  liquidRadius: 210,
  liquidViscosity: 0.67,
  liquidDecay: 0.971,
  liquidIntensity: 0.73,
  liquidRevealSize: 1.9,
  blackHoleRadius: 184,
  haloPeriod: 2.7,
  crownMorseUnit: 0.085,
  dustToSpaceSeconds: 2.4,
  spaceToDustSeconds: 2.65,
});
