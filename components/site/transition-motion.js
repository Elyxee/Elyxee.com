const clamp = value => Math.max(0, Math.min(1, value));

export function idleDestination(progress, idleMs, held = false, visibleShare = progress) {
  if (held || idleMs <= 1000 || progress <= 0 || progress >= 1) return null;
  return visibleShare < 0.5 ? 0 : 1;
}

// One spring carries both the hand-driven movement and its continuation. There
// is no second easing timeline that has to start from rest after the scroll.
export function createTransitionMotion({ travel = 620 } = {}) {
  let position = 0, velocity = 0, demand = 0, completion = null;
  let lastInputAt = -Infinity, held = false;
  let direction = 0, distance = 0, peak = 0;

  function record(pixels, now) {
    const nextDirection = Math.sign(pixels);
    const fresh = now - lastInputAt > 180 || nextDirection !== direction;
    const interval = fresh ? 50 : Math.max(12, now - lastInputAt);
    if (fresh) { distance = 0; peak = 0; }
    distance += Math.abs(pixels);
    peak = Math.max(peak, Math.abs(pixels) / interval);
    direction = nextDirection;
    lastInputAt = now;
  }
  function interrupt() {
    if (completion) demand = position;
    completion = null;
  }
  function complete(to, reason) {
    demand = to;
    completion = { to, reason };
  }
  return {
    get position() { return position; },
    get input() { return demand; },
    get velocity() { return velocity; },
    get destination() { return completion?.to ?? null; },
    // A momentum tail belongs to the page passage until the gesture ends;
    // it must not spill into the portrait gallery on arrival.
    ownsTail(pixels, now) {
      return completion?.reason === 'momentum' && Math.sign(pixels) === direction && now - lastInputAt < 200;
    },
    scroll(pixels, now) {
      if (!pixels) return;
      if (this.ownsTail(pixels, now)) { lastInputAt = now; return; }
      interrupt();
      record(pixels, now);
      demand = clamp(demand + pixels / travel);
    },
    hold() {
      interrupt(); held = true; distance = 0; peak = 0;
      return demand;
    },
    drag(progress, now) {
      const next = clamp(progress), pixels = (next - demand) * travel;
      if (pixels) record(pixels, now);
      demand = next;
    },
    release(now) {
      held = false;
      // A finger held still in the middle is a deliberate stop, not a flick.
      if (now - lastInputAt > 160) peak = 0;
      lastInputAt = now;
    },
    goTo(to, { omega = 7.5 } = {}) { complete(to, 'navigation'); completion.omega = omega; },
    update(now, elapsed, reduced = false, visibleShare = position) {
      const idle = now - lastInputAt;
      if (!completion && !held && demand > 0 && demand < 1) {
        if (idle >= 120 && distance >= 48 && peak >= .75) {
          complete(direction > 0 ? 1 : 0, 'momentum');
        } else {
          // The overscanned fire can expose a whole page before input reaches
          // its endpoint. Visible area picks the side, not whether to settle.
          const to = idleDestination(demand, idle, false, visibleShare);
          if (to !== null) complete(to, 'idle');
        }
      }
      if (reduced) { position = demand; velocity = 0; }
      else {
        const omega = completion ? (completion.omega ?? (completion.reason === 'idle' ? 9 : 7.5)) : 22;
        const dt = Math.max(0, elapsed), offset = position - demand;
        const decay = Math.exp(-omega * dt), carry = velocity + omega * offset;
        position = clamp(demand + (offset + carry * dt) * decay);
        velocity = (velocity - omega * carry * dt) * decay;
      }
      if (Math.abs(position - demand) < .0005 && Math.abs(velocity) < .01) {
        position = demand; velocity = 0;
        // Keep the completed momentum gesture latched until its tail ends.
        if (idle > 200) completion = null;
      }
      return position;
    },
  };
}
