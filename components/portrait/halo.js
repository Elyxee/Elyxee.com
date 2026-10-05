import { COMPOSITION } from './settings.js';

// Derive the ornamental linework from the exact Figma cutouts at startup.
// This is a runtime effect texture; the portrait images themselves are intact.
export function createHaloTexture(crowned, veiled) {
  const canvas = document.createElement('canvas');
  canvas.width = COMPOSITION.width;
  canvas.height = COMPOSITION.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';

  function trace(image, rect, kind) {
    const sample = document.createElement('canvas');
    const size = 640;
    sample.width = sample.height = size;
    const sc = sample.getContext('2d', { willReadFrequently: true });
    sc.drawImage(image, 0, 0, size, size);
    const pixels = sc.getImageData(0, 0, size, size).data;
    const alpha = (x, y) => pixels[(y * size + x) * 4 + 3] / 255;
    const luma = (x, y) => {
      const i = (y * size + x) * 4;
      return (pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722) / 255;
    };
    const scale = rect[2] / size;
    ctx.save();
    ctx.translate(rect[0], rect[1]);
    ctx.scale(scale, scale);
    for (let y = 3; y < size - 3; y += 2) {
      const v = y / size;
      if (kind === 'crown' ? v < .035 || v > .38 : v < .31 || v > .95) continue;
      for (let x = 3; x < size - 3; x += 2) {
        const a = alpha(x, y);
        const ax = alpha(x + 2, y) - alpha(x - 2, y);
        const ay = alpha(x, y + 2) - alpha(x, y - 2);
        const silhouette = Math.hypot(ax, ay);
        let gx = luma(x + 2, y) - luma(x - 2, y);
        let gy = luma(x, y + 2) - luma(x, y - 2);
        const detail = Math.hypot(gx, gy);
        const onRim = silhouette > .34;
        if (!onRim && (a < .95 || detail < (kind === 'crown' ? .29 : .26))) continue;
        if (kind === 'veil' && !onRim && v < .53) continue;
        if (onRim) { gx = ax; gy = ay; }
        const length = Math.hypot(gx, gy) || 1;
        const tx = -gy / length, ty = gx / length;
        const opacity = onRim ? .8 : kind === 'crown' ? .44 : .19;
        ctx.strokeStyle = kind === 'crown' ? `rgba(255,0,0,${opacity})` : `rgba(0,255,0,${opacity})`;
        ctx.lineWidth = (onRim ? 1.1 : .65) / scale;
        ctx.beginPath();
        ctx.moveTo(x - tx * 1.35, y - ty * 1.35);
        ctx.lineTo(x + tx * 1.35, y + ty * 1.35);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  trace(crowned, COMPOSITION.crown, 'crown');
  trace(veiled, COMPOSITION.veil, 'veil');

  // Fine construction curves follow the cloth's cowl and nose-to-chin folds.
  const [x, y, width] = COMPOSITION.veil;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(width, width);
  ctx.lineWidth = .0008;
  ctx.strokeStyle = 'rgb(0 92 0)';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(.51 + side * (.21 + i * .012), .30);
      ctx.bezierCurveTo(.51 + side * (.32 + i * .01), .49,
        .51 + side * (.31 + i * .013), .77, .51 + side * .10, .90 + i * .012);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = 'rgb(0 0 155)';
  for (let i = 0; i < 6; i++) {
    const top = .525 + i * .034;
    ctx.beginPath();
    ctx.moveTo(.345 - i * .007, top + .017);
    ctx.bezierCurveTo(.43, top - .033, .55, top - .058, .645 + i * .008, top + .025);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgb(0 0 77)';
  for (let i = 0; i < 9; i++) {
    const left = .345 + i * .039;
    ctx.beginPath();
    ctx.moveTo(left, .548 - Math.sin(i / 8 * Math.PI) * .026);
    ctx.bezierCurveTo(left - .018, .61, left + .017, .67, .49 + (left - .49) * .8, .75);
    ctx.stroke();
  }
  ctx.restore();
  return canvas;
}
