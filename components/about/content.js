// Provisional editorial copy for layout review, not a factual biography.
// Replace these strings when the final About text is available.
export const ABOUT_CONTENT = Object.freeze({
  brand: 'Elyxee',
  title: 'UNDENIABLE',
  paragraphs: [
    'There is always more to a person than what first meets the eye. A thought behind a glance. A story behind an image. A world still taking shape.',
    'This is a space for that in-between — for questions worth staying with, ideas worth following, and the things that refuse to fit neatly into a single frame.',
    'Look around. Take your time. The story is still being written.',
  ],
  email: 'Eliyah@elyxee.com',
  homeHref: './index.html',
  heroSrc: new URL('../../Assets/About/reading-book-repaired.png', import.meta.url).href,
  // Original pixels are intact; only the missing book corner extends right.
  // layoutWidth retains the original person's exact display scale and position.
  heroCrop: { x: 481, y: 1488, width: 2410, height: 2608, sourceWidth: 2891, sourceHeight: 4096, layoutWidth: 2250 },
  portraitSrc: new URL('../../Assets/About/portrait.png', import.meta.url).href,
  textureSrc: new URL('../../Assets/About/fire.png', import.meta.url).href,
});
