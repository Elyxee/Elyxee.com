// Each contacted patch warms independently, then cools in place. A new letter
// cannot inherit an already fully lit flame from the previous pointer position.
export function createEmberTrail() {
  const sites = Array.from({ length: 4 }, () => ({ x: -1000, y: -1000, energy: 0, peak: 0, touchedAt: -Infinity }));
  let active = -1;
  return {
    sites,
    update({ x, y, touching, radius, now, dt }) {
      if (touching) {
        if (active < 0 || Math.hypot(x - sites[active].x, y - sites[active].y) > radius * 0.45) {
          active = sites.findIndex(site => Math.hypot(x - site.x, y - site.y) <= radius * 0.35);
          if (active < 0) {
            active = sites.reduce((best, site, index) => site.energy < sites[best].energy ? index : best, 0);
            Object.assign(sites[active], { x, y, energy: 0, peak: 0 });
          }
        }
        const site = sites[active];
        site.energy = Math.min(1, site.energy + dt / 0.75);
        site.peak = site.energy;
        site.touchedAt = now;
      } else {
        active = -1;
      }
      for (let i = 0; i < sites.length; i++) {
        if (touching && i === active) continue;
        const progress = Math.max(0, Math.min(1, (now - sites[i].touchedAt - 220) / 1800));
        const ease = progress * progress * (3 - 2 * progress);
        sites[i].energy = sites[i].peak * (1 - ease);
      }
      return sites;
    },
  };
}
