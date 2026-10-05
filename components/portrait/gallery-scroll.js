const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
const SCROLL_SPEED_FACTOR = 1.25;

// Normalize wheel notches, trackpads and page scrolling before applying the
// same gentle, bounded impulse in art pixels. Pinch zoom is filtered by caller.
export function galleryWheelDelta(event, pageHeight) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1;
  return Number.isFinite(event.deltaY) ? clamp(event.deltaY * unit, 180) : 0;
}

export function createGalleryScroll() {
  let target = 0, velocity = 0, direct = 0;
  function reset() { target = 0; velocity = 0; direct = 0; }
  return {
    input(pixels, reduced = false) {
      if (!Number.isFinite(pixels) || pixels === 0) return;
      if (reduced) { direct += clamp(pixels, 180) * .28; return; }
      // A new direction cancels the old impulse, but velocity still eases
      // through the turn instead of snapping or jumping the whole sequence.
      if (pixels * target < 0) target = 0;
      target = clamp(target + clamp(pixels, 180) * .85, 95);
    },
    update(dt, reduced = false) {
      if (reduced) { const distance = direct; reset(); return distance; }
      direct = 0;
      // Exact integration of two exponential filters, stable at 60/120 Hz:
      // target decays, velocity follows it, and distance integrates velocity.
      const follow = 12, decay = 3.5;
      const a = Math.exp(-follow * dt), b = Math.exp(-decay * dt);
      const coupling = target * follow / (follow - decay);
      const distance = velocity * (1 - a) / follow
        + coupling * ((1 - b) / decay - (1 - a) / follow);
      velocity = velocity * a + coupling * (b - a);
      target *= b;
      // Increase manual travel without changing the easing or settling time.
      return distance * SCROLL_SPEED_FACTOR;
    },
    reset,
  };
}
