const SETTINGS = Object.freeze({
  followRate: 92,
  maxLag: 0.95,
  dprCap: 2,
  flameWidth: 19,
  flameHeight: 50,
  flameCells: 100,
  ionSpecks: 22,
  maxParticles: 36,
  sparkStartSpeed: 95,
  smokeStartSpeed: 180,
  burnSpeed: 760,
  fullSpeed: 980,
});

export function initCursor(options = {}) {
const root = options.root || document;
let fxCanvas = options.canvas || root.querySelector("#cursor-fx");
if (!fxCanvas) {
  fxCanvas = document.createElement("canvas");
  fxCanvas.id = "cursor-fx";
  fxCanvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(fxCanvas);
}

const motionState = root.querySelector("#motion-state");
const testButton = root.querySelector("#test-button");
const testButtonLabel = testButton
  ? testButton.querySelector(".test-button__label")
  : null;

const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const forcedColors = window.matchMedia("(forced-colors: active)");

let fx = null;
try {
  fx = fxCanvas.getContext("2d", { alpha: true, desynchronized: true });
} catch {
  fx = null;
}

const pointer = {
  x: window.innerWidth / 2,
  y: window.innerHeight / 2,
  previousX: window.innerWidth / 2,
  previousY: window.innerHeight / 2,
  lastEventAt: performance.now(),
  lastMovedAt: 0,
  lastInstantSpeed: 0,
  vx: 0,
  vy: 0,
  speed: 0,
  directionX: 0,
  directionY: -1,
  initialized: false,
  visible: false,
};

const rendered = {
  x: pointer.x,
  y: pointer.y,
};

// Volumetric ion flame — built from many soft convecting cells, never a drawn icon.
const ion = {
  pulse: 0.55,
  flare: 0,
  phase: Math.random() * Math.PI * 2,
  micro: Math.random() * Math.PI * 2,
  time: 0,
  nextFlareAt: 360,
  cells: [],
  specks: [],
};

const particles = {
  spark: [],
  smoke: [],
};

const particleCaps = Object.freeze({
  spark: 28,
  smoke: 12,
});

const particlePool = [];
const pendingTrail = [];

let canvasWidth = window.innerWidth;
let canvasHeight = window.innerHeight;
let canvasDpr = 1;
let previousFrameAt = performance.now();
let displayedState = "IDLE";
let trailDistanceRemainder = 0;
let pendingBurst = 0;
let lastBurstAt = -Infinity;
let buttonResetTimer;
let idleSmokeCooldown = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function smoothstep(edge0, edge1, value) {
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function activeParticleCount() {
  return particles.spark.length + particles.smoke.length;
}

function recycleParticle(particle) {
  if (particlePool.length < SETTINGS.maxParticles) particlePool.push(particle);
}

function recycleOldest(group) {
  const particle = group.shift();
  if (particle) recycleParticle(particle);
}

function makeParticle(type, values) {
  const group = particles[type];
  if (!group || !fx) return null;

  if (group.length >= particleCaps[type]) recycleOldest(group);
  if (activeParticleCount() >= SETTINGS.maxParticles) {
    const fallback = particles.smoke.length ? particles.smoke : particles.spark;
    recycleOldest(fallback);
  }

  const particle = particlePool.pop() || {};
  Object.assign(particle, values, { type, age: 0 });
  group.push(particle);
  return particle;
}

function resizeFxCanvas() {
  if (!fx) return;

  canvasWidth = window.innerWidth;
  canvasHeight = window.innerHeight;
  canvasDpr = Math.min(window.devicePixelRatio || 1, SETTINGS.dprCap);

  fxCanvas.width = Math.round(canvasWidth * canvasDpr);
  fxCanvas.height = Math.round(canvasHeight * canvasDpr);
  fxCanvas.style.width = `${canvasWidth}px`;
  fxCanvas.style.height = `${canvasHeight}px`;
  fx.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
  fx.imageSmoothingEnabled = true;
}

function clearFx() {
  if (!fx) return;
  fx.clearRect(0, 0, canvasWidth, canvasHeight);
  for (const group of Object.values(particles)) {
    while (group.length) recycleParticle(group.pop());
  }
  pendingTrail.length = 0;
  trailDistanceRemainder = 0;
  pendingBurst = 0;
}

function sparkHeatColor(heat) {
  // White-hot → amber → ember → dark red as the spark cools.
  if (heat > 0.88) return [255, 236, 205];
  if (heat > 0.7) return [255, 186, 98];
  if (heat > 0.48) return [255, 112, 38];
  if (heat > 0.28) return [210, 52, 22];
  if (heat > 0.12) return [140, 28, 14];
  return [72, 14, 8];
}

function spawnSpark(x, y, motion, directionX, directionY) {
  const side = randomBetween(-1, 1) < 0 ? -1 : 1;
  // Flint/ember splash: mostly backward, with upward loft and sideways scatter.
  const kick = randomBetween(48, 110) * (0.4 + motion * 0.7);
  const lateral = randomBetween(14, 46) * side;
  const loft = randomBetween(28, 72);
  makeParticle("spark", {
    x: x + randomBetween(-1.2, 1.2),
    y: y + randomBetween(-1.2, 1.2),
    vx: -directionX * kick - directionY * lateral + randomBetween(-10, 10),
    vy: -directionY * kick + directionX * lateral - loft,
    life: randomBetween(0.22, 0.48),
    size: randomBetween(1.15, 2.1),
    alpha: randomBetween(0.88, 1),
    gravity: randomBetween(58, 105),
    drag: randomBetween(1.8, 3.1),
    heat: randomBetween(0.88, 1),
    coolRate: randomBetween(1.3, 2.3),
  });
}

function spawnSmoke(x, y, motion, directionX = 0, directionY = 0) {
  const drift = 1 + motion * 1.2;
  const windX = clamp(-pointer.vx * 0.14, -120, 120);
  const windY = clamp(-pointer.vy * 0.08, -60, 60);
  makeParticle("smoke", {
    x: x + randomBetween(-1.6, 1.6) - directionX * randomBetween(0, 2.5),
    y: y + randomBetween(-1, 1) - directionY * randomBetween(0, 2),
    vx:
      randomBetween(-8, 8) * drift
      - directionX * randomBetween(2, 10)
      + windX,
    vy:
      randomBetween(-28, -12)
      - directionY * randomBetween(0, 5)
      + windY,
    life: randomBetween(0.75, 1.35),
    startSize: randomBetween(2.9, 4.5),
    endSize: randomBetween(9.5, 17),
    alpha: randomBetween(0.1, 0.18) * (0.85 + motion * 0.4),
    phase: Math.random() * Math.PI * 2,
    spin: randomBetween(-0.9, 0.9),
    rotation: Math.random() * Math.PI * 2,
  });
}

function enqueueTrailSamples(fromX, fromY, toX, toY, speed) {
  // Sparks can start at gentle motion; smoke keeps the old higher bar.
  if (speed < SETTINGS.sparkStartSpeed || reducedMotion.matches) return;

  const deltaX = toX - fromX;
  const deltaY = toY - fromY;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < 0.35) return;

  const directionX = deltaX / distance;
  const directionY = deltaY / distance;
  const sparkMotion = smoothstep(SETTINGS.sparkStartSpeed, SETTINGS.fullSpeed, speed);
  const smokeMotion = smoothstep(SETTINGS.smokeStartSpeed, SETTINGS.fullSpeed, speed);
  const spacing = lerp(24, 13, sparkMotion);
  const available = trailDistanceRemainder + distance;
  const count = Math.min(5, Math.floor(available / spacing));

  for (let index = count; index >= 1; index -= 1) {
    const along = Math.min(index * spacing, distance);
    pendingTrail.push({
      x: toX - directionX * along,
      y: toY - directionY * along,
      directionX,
      directionY,
      motion: sparkMotion,
      smokeMotion,
      allowSmoke: speed >= SETTINGS.smokeStartSpeed,
    });
  }

  trailDistanceRemainder = available % spacing;
  if (pendingTrail.length > 9) pendingTrail.splice(0, pendingTrail.length - 9);
}

function consumeTrailSamples() {
  let emitted = 0;
  while (pendingTrail.length && emitted < 3) {
    const sample = pendingTrail.shift();

    // Sparks: more present + occasional splash burst.
    if (Math.random() < 0.55 + sample.motion * 0.4) {
      spawnSpark(
        sample.x,
        sample.y,
        sample.motion,
        sample.directionX,
        sample.directionY,
      );
      if (sample.motion > 0.35 && Math.random() < 0.45) {
        spawnSpark(
          sample.x + randomBetween(-2, 2),
          sample.y + randomBetween(-2, 2),
          sample.motion,
          sample.directionX,
          sample.directionY,
        );
      }
    }

    // Smoke unchanged threshold / feel.
    if (sample.allowSmoke && Math.random() < 0.28 + sample.smokeMotion * 0.32) {
      spawnSmoke(
        sample.x,
        sample.y,
        sample.smokeMotion,
        sample.directionX,
        sample.directionY,
      );
    }

    emitted += 1;
  }
}

function updateParticleGroup(group, deltaSeconds, windX = 0, windY = 0) {
  for (let index = group.length - 1; index >= 0; index -= 1) {
    const particle = group[index];
    particle.age += deltaSeconds;

    if (particle.age >= particle.life) {
      recycleParticle(particle);
      group[index] = group[group.length - 1];
      group.pop();
      continue;
    }

    if (particle.type === "smoke") {
      // Keep receiving ambient wind so smoke doesn't freeze into a sticker.
      particle.vx += windX * 0.55 * deltaSeconds;
      particle.vy += windY * 0.25 * deltaSeconds;
      particle.x += (particle.vx + Math.sin(particle.age * 3.2 + particle.phase) * 3) * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;
      particle.vx *= Math.exp(-0.45 * deltaSeconds);
      particle.rotation += particle.spin * deltaSeconds;
    } else {
      // Ember flight: air drag + gravity, heat cools in air.
      const drag = Math.exp(-(particle.drag || 2.5) * deltaSeconds);
      particle.vx *= drag;
      particle.vy = particle.vy * drag + particle.gravity * deltaSeconds;
      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;
      if (particle.heat != null) {
        particle.heat = Math.max(0, particle.heat - particle.coolRate * deltaSeconds);
      }
    }
  }
}

function updateParticles(deltaSeconds, windX = 0, windY = 0) {
  updateParticleGroup(particles.smoke, deltaSeconds, windX, windY);
  updateParticleGroup(particles.spark, deltaSeconds);
}

function drawSmoke() {
  if (!particles.smoke.length) return;

  fx.save();
  fx.globalCompositeOperation = "source-over";

  for (const particle of particles.smoke) {
    const progress = particle.age / particle.life;
    const fadeIn = clamp(progress / 0.14, 0, 1);
    const fadeOut = Math.pow(1 - progress, 1.35);
    const size = lerp(particle.startSize, particle.endSize, 1 - Math.pow(1 - progress, 1.8));

    fx.save();
    fx.translate(particle.x, particle.y);
    fx.rotate(particle.rotation);
    fx.filter = `blur(${Math.max(1.1, size * 0.2).toFixed(2)}px)`;
    fx.globalAlpha = particle.alpha * fadeIn * fadeOut;
    fx.fillStyle = "#7a716b";
    fx.beginPath();
    fx.ellipse(0, 0, size * 0.5, size * 0.34, 0, 0, Math.PI * 2);
    fx.fill();
    fx.globalAlpha *= 0.62;
    fx.fillStyle = "#524843";
    fx.beginPath();
    fx.ellipse(size * 0.14, -size * 0.08, size * 0.32, size * 0.24, 0, 0, Math.PI * 2);
    fx.fill();
    fx.restore();
  }

  fx.restore();
}

function drawSparks() {
  if (!particles.spark.length) return;

  fx.save();
  fx.globalCompositeOperation = "lighter";
  fx.lineCap = "round";

  for (const spark of particles.spark) {
    const progress = spark.age / spark.life;
    const fade = Math.pow(1 - progress, 1.4);
    const heat = clamp((spark.heat ?? 1) * (1 - progress * 0.3), 0, 1);
    const [r, g, b] = sparkHeatColor(heat);
    const speed = Math.hypot(spark.vx, spark.vy);
    const streak = clamp(speed * 0.02, 0.8, 5.2) * (1 - progress * 0.3);
    const nx = speed > 0.01 ? spark.vx / speed : 0;
    const ny = speed > 0.01 ? spark.vy / speed : -1;

    fx.globalAlpha = spark.alpha * fade;
    fx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
    fx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.9)`;
    fx.shadowBlur = 2.4 + heat * 3.4;
    fx.lineWidth = spark.size * (0.75 + heat * 0.55) * (1 - progress * 0.3);
    fx.beginPath();
    fx.moveTo(spark.x - nx * streak, spark.y - ny * streak);
    fx.lineTo(spark.x, spark.y);
    fx.stroke();

    if (heat > 0.22) {
      fx.shadowBlur = 1.6;
      fx.fillStyle = `rgba(255, 232, 195, ${(0.32 + heat * 0.5) * fade})`;
      fx.beginPath();
      fx.arc(spark.x, spark.y, spark.size * 0.38 * (0.65 + heat * 0.5), 0, Math.PI * 2);
      fx.fill();
    }
  }

  fx.shadowBlur = 0;
  fx.restore();
}

function seedFlameCell(cell, originX, originY, stagger) {
  const settle = clamp(1 - pointer.speed / 420, 0, 1);
  // Idle: wider, lower cluster around the tip so it reads plump, not a rising column.
  const spread = SETTINGS.flameWidth * lerp(0.52, 0.72, settle);
  const offset = (Math.random() + Math.random() - 1) * spread;

  cell.x = originX + offset;
  cell.y = originY + randomBetween(lerp(-1.2, -2.2, settle), lerp(5, 2.2, settle));
  cell.birthX = originX;
  cell.birthY = originY;
  cell.vx = randomBetween(-8, 8) - pointer.vx * 0.06;
  cell.vy = -randomBetween(lerp(8, 16, 1 - settle), lerp(18, 36, 1 - settle)) - pointer.vy * 0.04;
  cell.life = randomBetween(0.55, 1.15);
  cell.age = stagger ? Math.random() * cell.life : 0;
  cell.size = randomBetween(4.3, 8.6) * lerp(1, 1.12, settle);
  cell.seed = Math.random() * Math.PI * 2;
  cell.swirl = randomBetween(2.2, 5.8);
  cell.amp = randomBetween(10, 28);
  cell.buoyancy = randomBetween(22, 52);
  cell.kind = Math.random() < lerp(0.4, 0.52, settle) ? "heat" : "char";
  cell.aspect = randomBetween(0.55, 1.85);
  cell.tilt = randomBetween(-0.9, 0.9);
  cell.tint = randomBetween(-0.18, 0.22);
  cell.wake = false;
  cell.dissipate = false;
  cell.stretch = randomBetween(0.7, 1.35);
  return cell;
}

function seedIonSpeck(speck, originX, originY, stagger) {
  speck.x = originX + randomBetween(-SETTINGS.flameWidth * 0.6, SETTINGS.flameWidth * 0.6);
  speck.y = originY + randomBetween(-6, 6);
  speck.birthY = originY;
  speck.vx = randomBetween(-22, 22) - pointer.vx * 0.12;
  speck.vy = -randomBetween(28, 72) - pointer.vy * 0.05;
  speck.life = randomBetween(0.18, 0.42);
  speck.age = stagger ? Math.random() * speck.life : 0;
  speck.size = randomBetween(0.85, 1.8);
  speck.seed = Math.random() * Math.PI * 2;
  return speck;
}

function initFlame() {
  const originX = rendered.x;
  const originY = rendered.y;
  ion.cells = Array.from({ length: SETTINGS.flameCells }, () =>
    seedFlameCell({}, originX, originY, true),
  );
  ion.specks = Array.from({ length: SETTINGS.ionSpecks }, () =>
    seedIonSpeck({}, originX, originY, true),
  );
}

function advectFlame(deltaSeconds, originX, originY, windX, windY) {
  const motion = clamp(pointer.speed / 900, 0, 1);
  const settle = clamp(1 - pointer.speed / 380, 0, 1);

  for (const cell of ion.cells) {
    const ageRate = cell.dissipate ? 1.35 + motion * 0.4 : 1;
    cell.age += deltaSeconds * ageRate;
    if (cell.age >= cell.life) {
      seedFlameCell(cell, originX, originY, false);
      continue;
    }

    const progress = cell.age / cell.life;
    const dist = Math.hypot(cell.x - originX, cell.y - originY);
    const rise = clamp((cell.birthY - cell.y) / SETTINGS.flameHeight, 0, 1);

    // Idle keeps mass at the tip longer; moving still sheds realistic wake.
    const wakeAge = lerp(0.38, 0.18, motion);
    const wakeDist = SETTINGS.flameHeight * lerp(0.85, 0.5, motion);
    if (!cell.wake && (progress > wakeAge || dist > wakeDist || motion > 0.45 && progress > 0.12)) {
      cell.wake = true;
      cell.life = Math.max(cell.life, cell.age + randomBetween(0.4, 0.85));
      cell.vx -= pointer.vx * randomBetween(0.04, 0.12);
      cell.vy -= pointer.vy * randomBetween(0.02, 0.08);
      cell.targetAspect = randomBetween(1.35, 2.8);
      cell.targetStretch = randomBetween(1.3, 2.4);
    }

    if (dist > SETTINGS.flameHeight * 1.15) {
      cell.dissipate = true;
    }

    // Idle: stronger tip cohesion so the core stays plump instead of drifting up.
    if (!cell.wake && progress < lerp(0.42, 0.2, motion)) {
      const rootPull = Math.pow(1 - progress / lerp(0.42, 0.2, motion), 2) * (22 + settle * 28);
      cell.vx += (originX - cell.x) * rootPull * deltaSeconds;
      cell.vy += (originY - cell.y) * rootPull * (0.55 + settle * 0.45) * deltaSeconds;
    }

    const windScale = cell.wake ? 0.75 + progress * 0.5 : 1;
    cell.vx += windX * windScale * deltaSeconds;
    cell.vy += windY * 0.4 * windScale * deltaSeconds;

    const turbulence =
      Math.sin(ion.time * cell.swirl + cell.seed) * cell.amp
      + Math.sin(ion.time * cell.swirl * 1.7 + cell.seed * 2.1) * cell.amp * 0.35;
    // Idle fills sideways volume; moving keeps vertical fire tongue.
    cell.vx += turbulence * (cell.wake ? 1.25 : 1) * (1 + settle * 0.55) * deltaSeconds;
    const buoyancyScale = cell.wake ? 1 : lerp(0.28, 1, motion);
    cell.vy -= cell.buoyancy * buoyancyScale * deltaSeconds * (1 - progress * 0.62) * (1 - rise * 0.25);
    cell.vx *= Math.exp(-(cell.wake ? 1.15 : 1.55) * deltaSeconds);

    if (cell.wake) {
      cell.size *= 1 + deltaSeconds * (0.55 + progress * 0.8);
      cell.aspect = lerp(cell.aspect, cell.targetAspect || 1.8, 1 - Math.exp(-deltaSeconds * 1.8));
      cell.stretch = lerp(cell.stretch, cell.targetStretch || 1.6, 1 - Math.exp(-deltaSeconds * 2.2));
      const travelAngle = Math.atan2(cell.vy, cell.vx || 0.001);
      cell.tilt = lerp(cell.tilt, travelAngle + Math.sin(ion.time * 2.4 + cell.seed) * 0.35, 1 - Math.exp(-deltaSeconds * 3));
    } else {
      cell.size *= 1 + deltaSeconds * 0.35 * (1 - progress);
    }

    cell.x += cell.vx * deltaSeconds;
    cell.y += cell.vy * deltaSeconds;
  }

  for (const speck of ion.specks) {
    speck.age += deltaSeconds;
    if (speck.age >= speck.life) {
      seedIonSpeck(speck, originX, originY, false);
      continue;
    }

    speck.vx += windX * 1.1 * deltaSeconds;
    speck.vy += windY * 0.35 * deltaSeconds;
    speck.vx += Math.sin(ion.time * 8.5 + speck.seed) * 32 * deltaSeconds;
    speck.vy -= 42 * deltaSeconds;
    speck.x += speck.vx * deltaSeconds;
    speck.y += speck.vy * deltaSeconds;
  }
}

function updateIon(now, deltaSeconds, motion, originX, originY, windX, windY) {
  if (reducedMotion.matches) {
    ion.pulse = 0.5;
    ion.flare = 0;
    return;
  }

  ion.time += deltaSeconds;
  ion.phase += deltaSeconds * randomBetween(2.1, 2.9);
  ion.micro += deltaSeconds * randomBetween(8, 12);

  const breath =
    0.5
    + Math.sin(ion.phase) * 0.24
    + Math.sin(ion.phase * 2.35 + 0.4) * 0.14
    + Math.sin(ion.micro) * 0.12;
  ion.pulse = clamp(breath + motion * 0.1 + ion.flare * 0.3, 0, 1);

  if (now >= ion.nextFlareAt) {
    ion.flare = Math.max(ion.flare, randomBetween(0.3, 0.85));
    ion.nextFlareAt = now + randomBetween(320, 1_100);
  }
  ion.flare = Math.max(0, ion.flare - deltaSeconds * 2.3);

  advectFlame(deltaSeconds, originX, originY, windX, windY);
}

function flameColor(temperature, kind, tint = 0) {
  // Black-red ionized palette — charcoal body, deep crimson heat, no anime yellow.
  let r;
  let g;
  let b;
  if (kind === "char") {
    if (temperature > 0.7) [r, g, b] = [42, 14, 12];
    else if (temperature > 0.4) [r, g, b] = [22, 8, 7];
    else [r, g, b] = [10, 4, 4];
  } else if (temperature > 0.85) [r, g, b] = [190, 48, 32];
  else if (temperature > 0.65) [r, g, b] = [148, 28, 20];
  else if (temperature > 0.4) [r, g, b] = [96, 16, 12];
  else if (temperature > 0.2) [r, g, b] = [58, 10, 8];
  else [r, g, b] = [28, 6, 5];

  // Tiny per-cell drift so wake never looks uniformly stamped.
  r = clamp(Math.round(r * (1 + tint * 0.35)), 0, 255);
  g = clamp(Math.round(g * (1 + tint * 0.12)), 0, 255);
  b = clamp(Math.round(b * (1 - tint * 0.08)), 0, 255);
  return [r, g, b];
}

function drawFlameCellBlob(cell, kind, intensity, heat) {
  const progress = clamp(cell.age / cell.life, 0, 1);
  const height = clamp((cell.birthY - cell.y) / SETTINGS.flameHeight, 0, 1);
  const temperature = clamp(
    (1 - progress) * (kind === "heat" ? 0.7 : 0.55)
      + (1 - height) * (kind === "heat" ? 0.45 : 0.5)
      + (kind === "heat" ? ion.flare * 0.15 : 0)
      - (cell.wake ? progress * 0.2 : 0),
    0,
    1,
  );
  const [r, g, b] = flameColor(temperature, kind, cell.tint || 0);

  const base = cell.size * (kind === "heat" ? 0.72 + progress * 1.05 : 0.9 + progress * 1.25)
    * (0.92 + heat * 0.15)
    * (cell.wake ? cell.stretch || 1 : 1);
  const aspect = cell.aspect || 1;
  const radiusX = base * Math.sqrt(aspect);
  const radiusY = base / Math.sqrt(aspect) * (cell.wake ? 0.72 : 1.1 + height * 0.35);
  const fadeIn = clamp(progress / 0.08, 0, 1);
  const fadeOut = Math.pow(1 - progress, cell.dissipate ? 1.55 : cell.wake ? 1.25 : 1.05);
  const alpha =
    (kind === "heat" ? 0.62 : 0.78)
    * fadeIn
    * fadeOut
    * intensity
    * (cell.wake ? 0.78 : 1);
  if (alpha <= 0.008) return;

  const angle = cell.wake
    ? (cell.tilt || 0)
    : Math.sin(ion.time * 1.3 + (cell.seed || 0)) * 0.2;
  const lobes = cell.wake ? 3 : 1;

  for (let lobe = 0; lobe < lobes; lobe += 1) {
    const lobePhase = cell.seed + lobe * 2.1;
    const ox = cell.wake ? Math.cos(lobePhase) * radiusX * (0.18 + lobe * 0.12) : 0;
    const oy = cell.wake ? Math.sin(lobePhase * 1.3) * radiusY * (0.14 + lobe * 0.1) : 0;
    const cx = cell.x + ox;
    const cy = cell.y + oy;
    const rx = radiusX * (cell.wake ? 0.55 + lobe * 0.22 : 1);
    const ry = radiusY * (cell.wake ? 0.48 + lobe * 0.2 : 1);
    const lobeAlpha = alpha * (cell.wake ? 0.55 + (1 - lobe / lobes) * 0.45 : 1);

    const blob = fx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    blob.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${lobeAlpha.toFixed(3)})`);
    blob.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, ${(lobeAlpha * 0.5).toFixed(3)})`);
    blob.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    fx.fillStyle = blob;
    fx.beginPath();
    fx.ellipse(cx, cy, rx, ry, angle + lobe * 0.35, 0, Math.PI * 2);
    fx.fill();
  }
}

function drawIonCore(motion) {
  const heat = ion.pulse;
  const intensity = 0.95 + heat * 0.3 + ion.flare * 0.3 + motion * 0.08;

  fx.save();

  fx.globalCompositeOperation = "source-over";
  for (const cell of ion.cells) {
    if (cell.kind === "char") drawFlameCellBlob(cell, "char", intensity, heat);
  }

  fx.globalCompositeOperation = "lighter";
  for (const cell of ion.cells) {
    if (cell.kind === "heat") drawFlameCellBlob(cell, "heat", intensity, heat);
  }

  for (const speck of ion.specks) {
    const progress = clamp(speck.age / speck.life, 0, 1);
    const alpha = 0.8 * Math.pow(1 - progress, 1.1) * intensity;
    if (alpha <= 0.01) continue;

    const [r, g, b] = flameColor(0.9 - progress * 0.35, "heat");
    fx.globalAlpha = alpha;
    fx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    fx.beginPath();
    fx.arc(speck.x, speck.y, speck.size * (1.05 - progress * 0.28), 0, Math.PI * 2);
    fx.fill();
  }

  fx.globalAlpha = 1;
  fx.restore();
}

function setCursorVisibility(requested) {
  const active = Boolean(
    requested
      && fx
      && pointer.initialized
      && finePointer.matches
      && !forcedColors.matches
      && !document.hidden,
  );

  pointer.visible = active;
  document.documentElement.classList.toggle("cursor-ready", active);
  fxCanvas.classList.toggle("is-active", active);
  if (!active) clearFx();
}

function updateMotionLabel(speed) {
  let nextState = "IDLE";
  if (!reducedMotion.matches && speed >= SETTINGS.burnSpeed) nextState = "STRIKE";
  else if (!reducedMotion.matches && speed >= SETTINGS.sparkStartSpeed) {
    nextState = "FRICTION";
  }

  if (nextState !== displayedState) {
    displayedState = nextState;
    if (motionState) motionState.value = nextState;
    document.body.dataset.motion = nextState.toLowerCase();
  }
}

function onPointerMove(event) {
  if (!finePointer.matches || forcedColors.matches || event.pointerType === "touch") {
    return;
  }

  const now = performance.now();
  const elapsedSeconds = clamp((now - pointer.lastEventAt) / 1000, 0.008, 0.08);

  if (!pointer.initialized) {
    // Seed the flame here — never at the assumed centre on load — so the first
    // visible frame cannot paint a flash at mid-screen.
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.previousX = event.clientX;
    pointer.previousY = event.clientY;
    rendered.x = event.clientX;
    rendered.y = event.clientY;
    pointer.initialized = true;
    initFlame();
    clearFx();
  }

  const fromX = pointer.previousX;
  const fromY = pointer.previousY;
  const deltaX = event.clientX - fromX;
  const deltaY = event.clientY - fromY;
  const distance = Math.hypot(deltaX, deltaY);
  const instantSpeed = clamp(distance / elapsedSeconds, 0, 2_200);

  if (distance > 0.01) {
    pointer.directionX = deltaX / distance;
    pointer.directionY = deltaY / distance;
  }

  pointer.vx = lerp(pointer.vx, deltaX / elapsedSeconds, 0.32);
  pointer.vy = lerp(pointer.vy, deltaY / elapsedSeconds, 0.32);
  pointer.speed = lerp(pointer.speed, instantSpeed, 0.36);

  const acceleration = Math.abs(instantSpeed - pointer.lastInstantSpeed) / elapsedSeconds;
  if (
    instantSpeed >= 880
    && pointer.lastInstantSpeed < 880
    && acceleration > 4_200
    && now - lastBurstAt > 150
  ) {
    pendingBurst = 3;
    lastBurstAt = now;
  }

  enqueueTrailSamples(fromX, fromY, event.clientX, event.clientY, instantSpeed);

  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.previousX = event.clientX;
  pointer.previousY = event.clientY;
  pointer.lastInstantSpeed = instantSpeed;
  pointer.lastEventAt = now;
  pointer.lastMovedAt = now;
  setCursorVisibility(true);
}

function animate(now) {
  const deltaSeconds = clamp((now - previousFrameAt) / 1000, 0.001, 0.04);
  previousFrameAt = now;

  if (!pointer.initialized) {
    requestAnimationFrame(animate);
    return;
  }

  if (now - pointer.lastMovedAt > 18) {
    const velocityDecay = Math.exp(-deltaSeconds / 0.058);
    pointer.vx *= velocityDecay;
    pointer.vy *= velocityDecay;
    pointer.speed *= velocityDecay;
    pointer.lastInstantSpeed *= velocityDecay;
  }

  if (reducedMotion.matches) {
    rendered.x = pointer.x;
    rendered.y = pointer.y;
  } else {
    const followAmount = 1 - Math.exp(-SETTINGS.followRate * deltaSeconds);
    rendered.x = lerp(rendered.x, pointer.x, followAmount);
    rendered.y = lerp(rendered.y, pointer.y, followAmount);

    const lagX = pointer.x - rendered.x;
    const lagY = pointer.y - rendered.y;
    const lagDistance = Math.hypot(lagX, lagY);
    if (lagDistance > SETTINGS.maxLag) {
      const correction = SETTINGS.maxLag / lagDistance;
      rendered.x = pointer.x - lagX * correction;
      rendered.y = pointer.y - lagY * correction;
    }
  }

  // Tip tracks the real pointer for smoother feel; wake still leans with wind.
  const originX = pointer.x;
  const originY = pointer.y;
  const windX = clamp(-pointer.vx * 0.18, -160, 160);
  const windY = clamp(-pointer.vy * 0.1, -80, 80);

  const motion = smoothstep(SETTINGS.sparkStartSpeed, SETTINGS.fullSpeed, pointer.speed);
  updateIon(now, deltaSeconds, motion, originX, originY, windX, windY);
  updateMotionLabel(pointer.speed);

  if (!pointer.visible || !fx) {
    requestAnimationFrame(animate);
    return;
  }

  fx.clearRect(0, 0, canvasWidth, canvasHeight);

  if (!reducedMotion.matches) {
    consumeTrailSamples();

    // Idle: thin smoke released from random points across the flame body.
    idleSmokeCooldown -= deltaSeconds;
    if (pointer.speed < 50 && idleSmokeCooldown <= 0 && Math.random() < 0.1) {
      const angle = Math.random() * Math.PI * 2;
      const reach = randomBetween(0, SETTINGS.flameWidth * 1.1);
      spawnSmoke(
        rendered.x + Math.cos(angle) * reach,
        rendered.y + Math.sin(angle) * reach - randomBetween(0, SETTINGS.flameHeight * 0.5),
        0.2,
        randomBetween(-0.6, 0.6),
        randomBetween(-0.4, 0.4),
      );
      idleSmokeCooldown = randomBetween(0.18, 0.5);
    }

    if (pendingBurst > 0) {
      for (let index = 0; index < pendingBurst; index += 1) {
        spawnSpark(
          rendered.x,
          rendered.y,
          Math.max(motion, 0.7),
          pointer.directionX,
          pointer.directionY,
        );
      }
      spawnSmoke(
        rendered.x,
        rendered.y,
        Math.max(motion, 0.65),
        pointer.directionX,
        pointer.directionY,
      );
      if (Math.random() < 0.55) {
        spawnSmoke(
          rendered.x + randomBetween(-2, 2),
          rendered.y + randomBetween(-2, 2),
          Math.max(motion, 0.5),
          pointer.directionX,
          pointer.directionY,
        );
      }
      pendingBurst = 0;
    }

    updateParticles(deltaSeconds, windX, windY);
    drawSmoke();
    drawSparks();
  }

  drawIonCore(motion);
  requestAnimationFrame(animate);
}

document.addEventListener("pointermove", onPointerMove, { passive: true });
document.addEventListener("pointerover", (event) => {
  if (event.pointerType !== "touch" && pointer.initialized) setCursorVisibility(true);
});
document.addEventListener("pointerout", (event) => {
  if (!event.relatedTarget) setCursorVisibility(false);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) setCursorVisibility(false);
});
window.addEventListener("blur", () => setCursorVisibility(false));
window.addEventListener("resize", resizeFxCanvas, { passive: true });

if (testButton && testButtonLabel) {
  testButton.addEventListener("click", () => {
    window.clearTimeout(buttonResetTimer);
    testButtonLabel.textContent = "CLICK RECEIVED";
    buttonResetTimer = window.setTimeout(() => {
      testButtonLabel.textContent = "CLICK TEST";
    }, 1_100);
  });
}

finePointer.addEventListener("change", () => setCursorVisibility(false));
forcedColors.addEventListener("change", () => setCursorVisibility(false));
reducedMotion.addEventListener("change", () => {
  clearFx();
  setCursorVisibility(pointer.initialized);
});

resizeFxCanvas();
requestAnimationFrame(animate);

return {
  canvas: fxCanvas,
  destroy() {
    setCursorVisibility(false);
  },
};
}
