const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const mix = (a, b, t) => a + (b - a) * t;
const range = (random, a, b) => mix(a, b, random());

// Maximin sampling avoids a grid while leaving enough openings across the
// viewport to complete the transition. Each switch gets a fresh arrangement.
export function createPortalSeeds(aspect, random = Math.random) {
  const points = [];
  for (let i = 0; i < 7; i++) {
    let best, separation = -1;
    for (let attempt = 0; attempt < (i ? 5 : 1); attempt++) {
      const point = [range(random, .035, .965), range(random, .035, .965)];
      const distance = points.length ? Math.min(...points.map(p => Math.hypot((p[0] - point[0]) * aspect, p[1] - point[1]))) : 1;
      if (distance > separation) { best = point; separation = distance; }
    }
    points.push([...best, i ? range(random, .03, .26) : 0, range(random, .76, 1.28)]);
  }
  return new Float32Array(points.flat());
}

function bezier(points, t) {
  const u = 1 - t;
  return [0, 1].map(axis => u ** 3 * points[0][axis] + 3 * u * u * t * points[1][axis]
    + 3 * u * t * t * points[2][axis] + t ** 3 * points[3][axis]);
}

function edgePoint(edge, random) {
  const along = range(random, .03, .97);
  return [[-.12, along], [along, -.12], [1.12, along], [along, 1.12]][edge];
}

function backgroundPoint(x, y, width, height, scale) {
  if (x < .015 || x > .985 || y < .015 || y > .985) return false;
  // A conservative head envelope: paths can disappear behind the portrait,
  // but should have a visible portion on either side of it.
  return ((x - .5) * width / (355 * scale)) ** 2
    + ((y - .53) * height / (535 * scale)) ** 2 > 1;
}

export function createUfoFlight(width, height, scale, random = Math.random) {
  let points, bestScore = -1;
  for (let attempt = 0; attempt < 12; attempt++) {
    const entry = Math.floor(random() * 4);
    const exit = (entry + 1 + Math.floor(random() * 3)) % 4;
    const start = edgePoint(entry, random), end = edgePoint(exit, random);
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const length = Math.max(Math.hypot(dx, dy), .01);
    const normal = [-dy / length, dx / length];
    const bends = [range(random, -.55, .55), range(random, -.55, .55)];
    const controls = [.24, .72].map((t, i) => [0, 1].map(axis =>
      clamp(mix(start[axis], end[axis], t) + normal[axis] * bends[i], -.08, 1.08)));
    const candidate = [start, ...controls, end];
    let score = 0;
    for (let j = 1; j < 20; j++) {
      const [x, y] = bezier(candidate, j / 20);
      if (backgroundPoint(x, y, width, height, scale)) score++;
    }
    if (score > bestScore) { points = candidate; bestScore = score; }
    if (score >= 10) break;
  }
  // Arc length decouples the intended speed changes from Bezier spacing.
  const distances = [0];
  let previous = points[0];
  for (let i = 1; i <= 80; i++) {
    const point = bezier(points, i / 80);
    distances.push(distances.at(-1) + Math.hypot((point[0] - previous[0]) * width, (point[1] - previous[1]) * height));
    previous = point;
  }
  const total = distances.at(-1);
  return { points, distances: distances.map(d => d / total),
    duration: range(random, 2.8, 4.8), size: range(random, 108, 156),
    brake: range(random, .12, .23), launch: range(random, .47, .62),
    cruise: range(random, .9, 1.25), burst: range(random, 2.7, 4.3),
    depth: range(random, .8, 1.1), bank: range(random, -.08, .08) };
}

// Integral of a smooth velocity ramp: speed and acceleration are continuous,
// including the brief slowdown before the departing burst.
function rampIntegral(t, start, end) {
  const u = clamp((t - start) / (end - start));
  return (end - start) * (u ** 3 - .5 * u ** 4) + Math.max(0, t - end);
}

export function sampleUfoFlight(flight, t, width, height) {
  t = clamp(t);
  const travelled = time => flight.cruise * time
    - flight.cruise * .81 * rampIntegral(time, flight.brake, flight.brake + .2)
    + flight.burst * rampIntegral(time, flight.launch, flight.launch + .25);
  const distance = travelled(t) / travelled(1);
  const table = flight.distances;
  let index = 1;
  while (index < table.length - 1 && table[index] < distance) index++;
  const u = (index - 1 + (distance - table[index - 1]) / Math.max(.000001, table[index] - table[index - 1])) / (table.length - 1);
  const [x, y] = bezier(flight.points, u);
  const before = bezier(flight.points, clamp(u - .008)), after = bezier(flight.points, clamp(u + .008));
  const dx = (after[0] - before[0]) * width, dy = (after[1] - before[1]) * height;
  const tilt = Math.atan2(dy, Math.max(Math.abs(dx), .01)) * .28 + flight.bank * Math.sin(u * Math.PI);
  return { x: x * width, y: y * height, tilt, depth: flight.depth * (.93 + Math.sin(u * Math.PI) * .12) };
}

export function createMeteor(width, height, scale, random = Math.random) {
  let best, bestScore = -1;
  for (let attempt = 0; attempt < 12; attempt++) {
    const angle = random() * Math.PI * 2;
    const candidate = { x: range(random, .03, .97) * width, y: range(random, .03, .97) * height,
      angle, speed: range(random, 550, 880) * scale, length: range(random, 210, 335) * scale, life: range(random, 1.05, 1.65) };
    let score = 0;
    for (let i = 0; i < 8; i++) {
      const travel = candidate.speed * candidate.life * i / 8;
      if (backgroundPoint((candidate.x + Math.cos(angle) * travel) / width,
        (candidate.y + Math.sin(angle) * travel) / height, width, height, scale)) score++;
    }
    if (score > bestScore) { best = candidate; bestScore = score; }
    if (score >= 4) break;
  }
  return best;
}
