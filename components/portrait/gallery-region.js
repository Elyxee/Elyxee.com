import { FRAME_ITEMS } from './gallery-items.js';
import { GALLERY_SEQUENCES } from './gallery-sequence.js';

// Each frame sweeps a strip along its scene's existing travel direction.
// Projecting onto the perpendicular keeps gaps between frames scrollable too,
// without turning the empty corners into a full-viewport gallery hit target.
const tracks = GALLERY_SEQUENCES.map(({ step, frames }) => {
  const length = Math.hypot(...step);
  const nx = -step[1] / length, ny = step[0] / length;
  return frames.map(id => {
    const { matrix: [a,b,c,d,x,y], size: [w,h] } = FRAME_ITEMS.find(item => item.id === id);
    const center = nx * (x + a*w/2 + c*h/2) + ny * (y + b*w/2 + d*h/2);
    const radius = Math.abs(nx*a + ny*b)*w/2 + Math.abs(nx*c + ny*d)*h/2;
    return { nx, ny, center, radius };
  });
});

export function isNearGalleryTrack(scene, x, y, { scale, originX, originY }, padding = 36) {
  if (!(scale > 0) || !Number.isFinite(x + y)) return false;
  const ax = (x - originX) / scale, ay = (y - originY) / scale;
  return tracks[scene].some(({ nx, ny, center, radius }) =>
    Math.abs(nx*ax + ny*ay - center) <= radius + padding / scale);
}

// Live poses include the small rotations and hover lift around the track.
export function isNearGalleryFrame(item, x, y, padding = 36) {
  if (!item.pose) return false;
  const { center, axes: [a,b,c,d] } = item.pose;
  const det = a*d - b*c;
  if (Math.abs(det) < 1e-8) return false;
  const dx = x - center[0], dy = y - center[1];
  const u = (d*dx - c*dy) / det, v = (a*dy - b*dx) / det;
  return Math.abs(u) <= item.size[0]/2 + padding*Math.hypot(c,d)/Math.abs(det)
    && Math.abs(v) <= item.size[1]/2 + padding*Math.hypot(a,b)/Math.abs(det);
}
