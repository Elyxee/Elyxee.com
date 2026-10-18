// The seven image fills from Figma's Presentation - Eng (47:1684), plus Connect 4Live.
// Video links come from the Figma captions; projects can link directly to their sites.
// WebP copies of the covers; Portal is already JPEG data and stays as it is.
const JPEG_COVERS = new Set(['portal']);
const coverUrl = name => new URL(JPEG_COVERS.has(name) ? `../../Assets/Portrait/artworks/${name}.png`
  : `../../Assets/optimized/Portrait/artworks/${name}.webp`, import.meta.url).href;
// A cover may also come laid out for the other orientation (`tall`, `wide`),
// so a frame never has to be reshaped far around it.
const artwork = (id, name, title, link, { tall, wide } = {}) => ({ id, title,
  url: link.startsWith('https://') ? link : `https://www.bilibili.com/video/${link}/`,
  src: coverUrl(name), ...(tall && { tall: coverUrl(tall) }), ...(wide && { wide: coverUrl(wide) }) });

/** The version of a cover a frame shows: portrait in a tall frame, landscape in a wide one. */
export function coverFor(art, item) {
  const [width, height] = item.size ?? [1, 1];
  return (height > width ? art.tall : art.wide) ?? art.src;
}
/** Every image a cover may draw. */
export const coverSources = art => [art.src, art.tall, art.wide].filter(Boolean);
export const DUST_ARTWORKS = [
  artwork('50:1716', 'digital-nations', 'Border, Sovereignty & Digital Nations', 'BV1URQ7BFE1e', { tall: 'digital-nations-tall' }),
  artwork('50:1715', 'longevity', 'Cancer, Longevity, and Decision-Making in the AI Era', 'BV191Q7BKE8P', { tall: 'longevity-tall' }),
  artwork('ib-biology', 'yeast-sugar', 'Study on The Effect of Different Sugar Sources on Sugar Utilization in Yeasts',
    'https://www.papermark.com/view/cmvdbn0pw0001jm08isq1g8hc', { wide: 'yeast-sugar-wide' }),
  artwork('ib-math', 'pad-texture', 'Discover the underlying reason for the rich-texture of pads in electronic music',
    'https://www.papermark.com/view/cmvdce32i0003l3072ec6nv05', { wide: 'pad-texture-wide' }),
  artwork('ib-business', 'be-fine-tea', 'Social Media Marketing for Be Fine Tea in Suzhou',
    'https://www.papermark.com/view/cmvdc0ygy0003i307kqc2dgkv', { wide: 'be-fine-tea-wide' }),
];
export const SPACE_ARTWORKS = [
  artwork('50:1718', 'equality', 'Equality of Outcome / Equality of Opportunity', 'BV1gfiqYREst'),
  artwork('50:1722', 'mental-shackles', 'In the Era of Mental Shackles', 'BV1atHjeLEM3'),
  artwork('47:1691', 'matrix', 'Matrix', 'BV1UP2mYBEi8'),
  artwork('47:1694', 'solved', 'Solved', 'BV1FK42187k7'),
  artwork('47:1697', 'portal', 'Portal', 'BV116DoYzEz6'),
  artwork('connect4', 'connect4', 'Connect 4Live', 'https://connect4.elyxee.com/', { wide: 'connect4-wide' }),
];

// Each scene shows its covers in rounds. A round places every cover exactly
// once, in an order shuffled for this visit, into the frames as they appear in
// turn; the next round is shuffled again. A round never opens with the cover
// that closed the one before it. The order depends only on the entry's
// position in the sequence, so every entry keeps its cover while on screen.
const visitSeed = Math.floor(Math.random() * 4294967296);
function shuffled(scene, round, count) {
  let state = (visitSeed ^ Math.imul(scene + 1, 0x85ebca6b) ^ Math.imul(round, 0xc2b2ae35)) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
const rounds = new Map();
function roundOrder(scene, round, count) {
  const key = `${scene}:${round}`;
  if (!rounds.has(key)) {
    const order = shuffled(scene, round, count);
    // Swapping the first two leaves the last in place, so with three or more
    // covers this compares against the previous round's final order.
    if (count > 2 && order[0] === shuffled(scene, round - 1, count)[count - 1]) [order[0], order[1]] = [order[1], order[0]];
    rounds.set(key, order);
  }
  return rounds.get(key);
}

export function artworkFor(item) {
  const covers = item.scene === 0 ? DUST_ARTWORKS : SPACE_ARTWORKS;
  const index = item.contentIndex ?? 0, round = Math.floor(index / covers.length);
  return covers[roundOrder(item.scene, round, covers.length)[index - round * covers.length]];
}

const images = new Map(), apertures = new WeakMap(), mounted = new Map();
export function loadGalleryImage(src) {
  if (!images.has(src)) images.set(src, (async () => {
    const image = new Image(); image.src = src; await image.decode(); return image;
  })());
  return images.get(src);
}

function canvasFor(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

function apertureFor(frame) {
  if (apertures.has(frame)) return apertures.get(frame);
  const width = frame.naturalWidth, height = frame.naturalHeight;
  const mask = canvasFor(width, height), ctx = mask.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(frame, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height);
  const inside = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let head = 0, tail = 1;
  queue[0] = Math.floor(height / 2) * width + Math.floor(width / 2);
  inside[queue[0]] = 1;
  let left = width, top = height, right = 0, bottom = 0;
  const visit = n => {
    if (inside[n] || pixels.data[n * 4 + 3] >= 128) return;
    inside[n] = 1; queue[tail++] = n;
  };
  // Flood only the enclosed center. Decorative gaps outside the frame stay clear.
  while (head < tail) {
    const p = queue[head++], x = p % width, y = Math.floor(p / width);
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
    if (x > 0) visit(p - 1);
    if (x < width - 1) visit(p + 1);
    if (y > 0) visit(p - width);
    if (y < height - 1) visit(p + width);
  }
  if (!left || !top || right === width - 1 || bottom === height - 1) {
    throw new Error('Frame artwork aperture is not enclosed');
  }
  // Extend a couple of pixels under the opaque inner lip to avoid a light seam.
  pixels.data.fill(0);
  for (let i = 0; i < tail; i++) {
    const p = queue[i];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const n = p + dy * width + dx;
      pixels.data[n * 4 + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const result = { mask, inside, width, height, left, top, right, bottom };
  apertures.set(frame, result);
  return result;
}

/** Lets a mounted cover go; asking for it again composes it anew, identically. */
export function releaseArtwork(item, image) {
  mounted.delete(`${item.frameId ?? item.id}:${image.src}`);
}

export function mountArtwork(frame, image, item) {
  const key = `${item.frameId ?? item.id}:${image.src}`;
  if (mounted.has(key)) return mounted.get(key);
  const hole = apertureFor(frame);
  const { width, height, left, top, right, bottom, inside } = hole;
  const canvas = canvasFor(width, height), ctx = canvas.getContext('2d');
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
  // Protect the actual titles and credits, rather than shrinking every
  // cover to clear decorative corners that only overlap its background.
  const name = new URL(image.src).pathname.split('/').pop().replace(/\.\w+$/, '');
  const safeAreas = {
    'digital-nations': [[.025, .16, .98, .95]],
    'longevity': [[.025, .16, .98, .94]],
    'mental-shackles': [[.05, .16, .23, .87], [.69, .22, .99, .61]],
    'equality': [[.003, .21, .32, .47], [.70, .20, .997, .46]],
    'solved': [[.055, .12, .62, .62]],
    'yeast-sugar': [[.08, .06, .92, .94]],
    'pad-texture': [[.08, .06, .92, .94]],
    'be-fine-tea': [[.08, .06, .92, .94]],
  }[name] ?? [];
  let w = right - left, h = bottom - top;
  const fits = () => safeAreas.every(([u0, v0, u1, v1]) => {
    const x0 = Math.floor(cx + (u0 - .5) * w), x1 = Math.ceil(cx + (u1 - .5) * w);
    const y0 = Math.floor(cy + (v0 - .5) * h), y1 = Math.ceil(cy + (v1 - .5) * h);
    for (let y = y0; y <= y1; y++)
      if (!inside[y * width + x0] || !inside[y * width + x1]) return false;
    for (let x = x0; x <= x1; x++)
      if (!inside[y0 * width + x] || !inside[y1 * width + x]) return false;
    return true;
  });
  // An oval cannot be stretched around a print without flattening: such a
  // frame keeps its own shape and the print is fitted inside the opening.
  const keepShape = Boolean(item.keepShape);
  while (!fits()) {
    w *= .99;
    // Flowers protrude on all four sides; reserve vertical clearance as well.
    if (item.material === 'flower' || keepShape) h *= .99;
  }
  const ratio = image.naturalWidth / image.naturalHeight;
  const printW = Math.min(w, h * ratio), printH = printW / ratio;
  const x = cx - printW / 2, y = cy - printH / 2;

  // Resize the opening around the complete print, retaining the native frame
  // corners and rim thickness. Keep the original canvas/slot dimensions so the
  // gallery's placement, travel, hover and occlusion continue unchanged.
  const sx = [0, cx - w / 2, cx + w / 2, width];
  const sy = [0, cy - h / 2, cy + h / 2, height];
  const dx = keepShape ? sx : [(w - printW) / 2, x, x + printW, width - (w - printW) / 2];
  const dy = keepShape ? sy : [(h - printH) / 2, y, y + printH, height - (h - printH) / 2];
  const adapt = source => {
    const result = canvasFor(width, height), target = result.getContext('2d');
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      target.drawImage(source,
        sx[col], sy[row], sx[col + 1] - sx[col], sy[row + 1] - sy[row],
        dx[col], dy[row], dx[col + 1] - dx[col], dy[row + 1] - dy[row]);
    }
    return result;
  };
  const rim = adapt(frame), mask = adapt(hole.mask);
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  const [a, b, c, d] = item.matrix;
  if (a * d - b * c < 0) { ctx.translate(2 * cx, 0); ctx.scale(-1, 1); }
  // Bleed only the source edge beneath irregular decoration. No solid-colour
  // mat, repeated lettering, or cover-crop of the original titles is introduced.
  const iw = image.naturalWidth, ih = image.naturalHeight;
  const sourceX = [0, 0, iw - 1], sourceY = [0, 0, ih - 1];
  const sourceW = [1, iw, 1], sourceH = [1, ih, 1];
  const destX = [0, x, x + printW], destY = [0, y, y + printH];
  const destW = [x, printW, width - x - printW];
  const destH = [y, printH, height - y - printH];
  if (keepShape) {
    // An oval's opening is far from the print's proportions: stretched edge
    // pixels would streak across it, so a softened, enlarged copy of the same
    // cover fills the opening behind the complete print instead.
    const fill = Math.max((right - left) / iw, (bottom - top) / ih);
    ctx.save();
    ctx.filter = `blur(${Math.round(width * .025)}px)`;
    ctx.drawImage(image, cx - iw * fill / 2, cy - ih * fill / 2, iw * fill, ih * fill);
    ctx.restore();
    ctx.drawImage(image, x, y, printW, printH);
  } else {
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      ctx.drawImage(image, sourceX[col], sourceY[row], sourceW[col], sourceH[row],
        destX[col], destY[row], destW[col], destH[row]);
    }
  }
  ctx.restore();
  ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  // The adapted frame casts the same contact shadow onto the mounted print.
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = width * .012;
  ctx.shadowOffsetY = height * .004;
  ctx.drawImage(rim, 0, 0);
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(rim, 0, 0);
  mounted.set(key, canvas);
  return canvas;
}

export async function gallerySource(item) {
  const frame = await loadGalleryImage(new URL(item.src, import.meta.url).href);
  const art = artworkFor(item);
  return art ? mountArtwork(frame, await loadGalleryImage(coverFor(art, item)), item) : frame;
}
