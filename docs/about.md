# About page

The final site has one entry: `/` (`index.html`). About is mounted by
`components/site/page-passage.js`; the standalone preview was removed during the
2026-10-05 freeze. Plain HTML, CSS and ES modules; no build step or new dependencies.

## Integration

Load `components/about/about.css` once and mount into an empty section:

```js
import { mountAbout } from './components/about/mount.js';

const about = mountAbout({
  root: document.querySelector('[data-about]'),
  content: {
    // All fields in content.js can be overridden.
    paragraphs: ['Your approved biography…'],
    homeHref: '/',
  },
  lighting: true, // Independent of the cursor; false disables photo relighting.
  onNavigate({ destination, href, event }) {
    // Return false to cancel browser navigation if your router handles it.
  },
  async onSubscribe(email, { signal }) {
    // Connect your subscription provider here. Resolve after acceptance only;
    // reject on failure. Pass signal to fetch to abort on component teardown.
    throw new Error('Connect the subscription provider before enabling this callback.');
  },
});

about.setActive(false); // Pauses animation and lighting.
about.setActive(true);
about.setLightPosition({ x: 600, y: 400 }); // Optional host light position, viewport CSS pixels.
about.setLightPosition({ visible: false });
about.destroy(); // Aborts pending request; removes listeners, observers and DOM.
```

Omit `onSubscribe` until a real backend is connected. The component explains
that subscriptions are not open and directs visitors to the contact email. It
never stores addresses locally or pretends to subscribe them. Pending submissions
are deduplicated; failures allow retry; successful callbacks reset the form.

Native scrolling is the default. For an overflow container pass `scrollRoot: element`.
For a host-controlled scene pass `observeScroll: false`, then call
`about.setProgress(0..1)` to drive the hero's exit. `setActive` pauses effects;
the host remains responsible for its section's visibility and `inert` state.
There are no wheel/touch interception handlers or global cursor/body style changes.
Multiple instances receive independent accessible label IDs. Each instance owns
only its appended wrapper, leaving any host siblings untouched on teardown.

## Content and art direction

`content.js` contains **provisional layout copy**, not a factual biography.
Gabriela is used for editorial text; Narri for UNDENIABLE and the existing wordmark.
Fonts are local. Color/gutter tokens are scoped under `.about` in `about.css`.

Figma source: file `Fk8rAd4QpmBbzl5sgjaHMl`, section `130:596`.
Hero: `130:597`; story: `130:595`. Annotation rings and Chinese instruction text
are design notes, not UI. The screenshot email form is replaced with a real form
as requested. The second portrait retains the original square, center-cropped slot.
A shared, desaturated fire texture gradually fades in beneath the hero and
continues into the story; its low-opacity opening keeps the seam understated.
A directional veil preserves copy contrast while keeping the texture visible.

Assets in `Assets/About/`:

- `reading-book-repaired.png`: **current hero**. All original RGBA pixels are
  preserved exactly; only a narrow strip beyond the source's right edge contains
  the repaired book corner. `layoutWidth: 2250` preserves the subject's display
  scale and desktop position while the crop includes the extension. Narrow
  screens offset the photo left only as needed to keep the book inside the viewport.
- The original photo and earlier generated derivatives are recoverable from Git
  checkpoint `3af42f9`; they are no longer shipped in the working folder. The
  final repaired hero retains the original subject pixels.
- `portrait.png`: original Figma image fill, node `130:605`.
- `fire.png`: original Figma image fill, node `134:614`.
- Generation/edit provenance is preserved in `docs/image-provenance.md`.

For a different `heroSrc`, the original crop is automatically disabled unless a
`heroCrop` override is also provided. Its fields are `x`, `y`, `width`, `height`,
`sourceWidth`, and `sourceHeight`; optional `layoutWidth` preserves the original
display scale when a repaired image extends beyond that crop. Use `heroCrop: null`
for a full image.

The hero uses the main site's deep black and ivory palette, without the earlier
star layer, drifting fog, decorative labels or portrait outline. Visible hero
control is the Elyxee wordmark, which links home. All arrow glyphs and decorative separator
rules are removed. Subscription uses a filled panel, inset input and solid button.
UNDENIABLE uses a seamless right-to-left marquee, slowed to a 90-second cycle.
The system cursor is retained; no custom cursor is mounted. The whole component
respects reduced motion and retains native scrolling. The hero fades as a
composite so the title does not show through the person during the transition.

## Mouse light

`lighting.js` renders the exact original photo in one WebGL pass. It preserves
source alpha, avoiding duplicated semi-transparent cutout edges. A broad,
inverse-square light falloff lifts existing tones; low-frequency image gradients
provide a restrained directional response. This is an approximation on a flat
photograph, not reconstructed 3D geometry. No face/head pixels are regenerated.
The same pointer drives a soft warm light across the shared background.

The light follows the pointer with a short eased response and fades on leave or
blur. Scroll and resize update its coordinates; visibility changes suspend it.
There is no idle render loop. Touch, reduced-motion and forced-colors modes use
static lighting. When WebGL is unavailable or lost, the original image remains
visible with a mild brightness lift. The host can drive `setLightPosition` in
viewport CSS pixels. Destroy cleans up GPU resources, listeners and observers.

## Verification

Checked in Chromium at 320, 390, 768, 1440 and 1920px: no horizontal overflow;
local fonts and all three image slots load. Desktop/mobile layouts were visually
reviewed. Browser checks also covered scoped pointer behavior, reduced-motion
changes, external scroll progress, navigation interception,
subscription pending/success/failure, request abort and repeated mount/destroy.
The latest lighting/background revision was visually checked at 1440px and
390px: original-photo alignment, native cursor, pointer/background response,
90-second leftward marquee, shared section transition, and no horizontal overflow.
No browser errors or warnings were reported during these checks.

## Shared-site passage

The main site's About link mounts this same component inside a scrolling layer
through `components/site/page-passage.js`, passing that layer as `scrollRoot`.
Home and About stay painted simultaneously. Clicking navigation plays the
existing 3.2-second fire passage, without a black interstitial or second document
load. Wheel and touch input reuse `createTransitionMotion`, including the same
620px travel, spring response, reversible progress, flick continuation and idle
settling as Home ↔ Portfolio. A held touch stays under the finger. An upward wheel gesture / downward touch pull
at the top of About returns through the same reverse seam as Portfolio → Home.
The About wordmark uses that same return direction to Home. A downward gesture
over empty space in either Portrait scene enters About; gestures owned by the
gallery continue moving its frames. The departing
wheel tail is consumed before the existing Portfolio → Home scrolling resumes.
Reduced motion and unavailable WebGL use opacity between the live layers.
Fresh loads and reloads always finish the opening on Home, clearing stale `view`
parameters. Browser back/forward within the mounted site can still revisit scenes.
