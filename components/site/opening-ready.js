/** Network speed must never decide whether an incomplete scene is revealed. */
export async function waitForOpening({ scene, curtain, decorations = [], fonts,
  minimumMs = 1500, now = () => performance.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const startedAt = now();
  await Promise.all([scene, curtain, Promise.allSettled(decorations), fonts]);
  await sleep(Math.max(0, minimumMs - (now() - startedAt)));
}
