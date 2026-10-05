// Only the seven image fills from Figma's Presentation - Eng (47:1684).
// Links read from the captions in Presentation - Eng, alongside each cover.
const artwork = (id, name, title, video) => ({ id, title,
  url: `https://www.bilibili.com/video/${video}/`,
  src: new URL(`../../Assets/Portrait/artworks/${name}.png`, import.meta.url).href });
export const DUST_ARTWORKS = [
  artwork('50:1716', 'digital-nations', 'Border, Sovereignty & Digital Nations', 'BV1URQ7BFE1e'),
  artwork('50:1715', 'longevity', 'Cancer, Longevity, and Decision-Making in the AI Era', 'BV191Q7BKE8P'),
];
export const SPACE_ARTWORKS = [
  artwork('50:1718', 'equality', 'Equality of Outcome / Equality of Opportunity', 'BV1gfiqYREst'),
  artwork('50:1722', 'mental-shackles', 'In the Era of Mental Shackles', 'BV1atHjeLEM3'),
  artwork('47:1691', 'matrix', 'Matrix', 'BV1UP2mYBEi8'),
  artwork('47:1694', 'solved', 'Solved', 'BV1FK42187k7'),
  artwork('47:1697', 'portal', 'Portal', 'BV116DoYzEz6'),
];

export function artworkFor(item) {
  if (item.scene === 0) {
    // These two landscape slots fit the interview covers; keep the other slots intact.
    return item.frameId === '24:588' ? DUST_ARTWORKS[0]
      : item.frameId === '24:598' ? DUST_ARTWORKS[1] : null;
  }
  // A finite exhibition repeats independently of the sequence's unique entry IDs.
  const index = item.contentIndex ?? 0;
  return SPACE_ARTWORKS[((index % SPACE_ARTWORKS.length) + SPACE_ARTWORKS.length) % SPACE_ARTWORKS.length];
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
  // Flood only the enclosed center. Decorative gaps outside the frame stay clear.
  while (head < tail) {
    const p = queue[head++], x = p % width, y = Math.floor(p / width);
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
    for (const n of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1,
      y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) {
      if (n < 0 || inside[n] || pixels.data[n * 4 + 3] >= 128) continue;
      inside[n] = 1; queue[tail++] = n;
    }
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

export function mountArtwork(frame, image, item) {
  const key = `${item.frameId ?? item.id}:${image.src}`;
  if (mounted.has(key)) return mounted.get(key);
  const hole = apertureFor(frame);
  const { width, height, left, top, right, bottom, inside } = hole;
  const canvas = canvasFor(width, height), ctx = canvas.getContext('2d');
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
  // Protect the actual titles and credits, rather than shrinking every
  // cover to clear decorative corners that only overlap its background.
  const name = new URL(image.src).pathname.split('/').pop();
  const safeAreas = {
    'digital-nations.png': [[.025, .16, .98, .95]],
    'longevity.png': [[.025, .16, .98, .94]],
    'mental-shackles.png': [[.05, .16, .23, .87], [.69, .22, .99, .61]],
    'equality.png': [[.003, .21, .32, .47], [.70, .20, .997, .46]],
    'solved.png': [[.055, .12, .62, .62]],
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
  while (!fits()) {
    w *= .99;
    // Flowers protrude on all four sides; reserve vertical clearance as well.
    if (item.material === 'flower') h *= .99;
  }
  const ratio = image.naturalWidth / image.naturalHeight;
  const printW = Math.min(w, h * ratio), printH = printW / ratio;
  const x = cx - printW / 2, y = cy - printH / 2;

  // Resize the opening around the complete print, retaining the native frame
  // corners and rim thickness. Keep the original canvas/slot dimensions so the
  // gallery's placement, travel, hover and occlusion continue unchanged.
  const sx = [0, cx - w / 2, cx + w / 2, width];
  const sy = [0, cy - h / 2, cy + h / 2, height];
  const dx = [(w - printW) / 2, x, x + printW, width - (w - printW) / 2];
  const dy = [(h - printH) / 2, y, y + printH, height - (h - printH) / 2];
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
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    ctx.drawImage(image, sourceX[col], sourceY[row], sourceW[col], sourceH[row],
      destX[col], destY[row], destW[col], destH[row]);
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
  return art ? mountArtwork(frame, await loadGalleryImage(art.src), item) : frame;
}
