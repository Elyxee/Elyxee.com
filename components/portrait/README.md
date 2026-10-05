# Dust & Space portrait study

Open `/portrait.html` (Space by default, or `/portrait.html?scene=dust`) through a
local HTTP server. `mount.js` is the shared bootstrap: `index.js` uses it for this
standalone page and `components/site/` embeds the same DOM below the `/` burn scene,
reached by scrolling. The lower-right button only switches the two scenes.

## Design coordinates

Figma file `Fk8rAd4QpmBbzl5sgjaHMl`, Main section `2:3531`.
The common artboard is 1536 × 1024. Crown: `(256, -24, 1048, 1048)`;
veil: `(216, 51, 1104, 1104)`. The second background is 1535 pixels wide in Figma;
the one-pixel export difference is normalized so the portrait registration is shared.

The transparent `Assets/Portrait/crowned.png` and `veiled.png` are Figma exports
from nodes `7:4645` / `7:4646` (same images as `16:4658` / `16:4659`). The existing
Dust and Space background files were checked byte-for-byte against their Figma assets.
Original local head files have opaque backgrounds and are intentionally untouched.

## Floating frame gallery

`gallery-items.js` records the eight initial frame slots from Main's Dust 2 / Space 2,
including their original affine transforms (the Chinese frame is reflected) and
sizes. Wood is offset 70 art pixels left and 38 up to balance its clearances to
fire and the Chinese frame. All frames render behind both portraits. Six
images use the original `Assets/Frame` files. `Assets/Portrait/frames/gilded.png`
and `european.png` are the updated transparent image fills from Figma nodes
`24:590` and `24:591`; the local originals are preserved.

`gallery-sequence.js` moves a continuous sequence of independent entries. Dust
uses five frame styles (the initial four plus fire), moving down and right;
Space uses its four existing styles, moving up and right. Adjacent arrangements
wait offscreen, preserving the same gaps on every pass.
Mean travel speed is 5% above the original slow drift: about 21.8 art pixels/s
in Dust and 17.1 in Space (about 118 / 125 seconds per complete arrangement).
A shared clock varies speed by just +/- 7%. Each new appearance has a seeded
2–6 degree tilt, alternating sides with a random amplitude and initial direction.
The tilt is stable for that entry, including after resizing or offscreen culling.
Small bounded sway adds local movement without changing the gaps over time.
Recycling never depends on individual frame bounds, hover duration or viewport
dimensions.

Vertical wheel/trackpad scrolling nudges the whole visible trail: down advances,
up rewinds, and releasing eases back to the original drift. `gallery-scroll.js`
normalizes wheel units and integrates a bounded, damped impulse independently
of frame rate. Touch swipes use the same control alongside portrait reveal.
Only travel reverses; material animation and entry age keep moving forward.
Scene changes and focus loss clear residual inertia. Reduced motion accepts
direct manual movement without automatic travel or an inertial tail.

Each occurrence has a stable scene/content index and its own hover state and
`content` slot. Subsequent occurrences reuse the frame texture but receive new
entry IDs and the next article/video data, without cycling the content index.
`createGallery` accepts optional content arrays per scene; article/video actions
are not yet wired. Only visible entries are retained, while textures are shared
across all occurrences.

`artworks.js` mounts the seven original image fills from Presentation - Eng
(`47:1684`), saved under `Assets/Portrait/artworks`. Dust's two green interview
covers occupy the wood and Chinese landscape frames; other Dust frames retain
their original appearance. Space's five covers follow the existing four-slot
sequence, with the fifth appearing in the next incoming frame. This finite
exhibition repeats independently of the sequence's unique entry/content IDs.
Equality and Matrix exchange their original positions: Equality starts in the
ice frame, while the text-free Matrix cover starts in the steeper liquid frame.
The enclosed alpha opening of each frame defines the mount. Its opening adapts
to the complete image aspect ratio using nine-slice frame resizing, preserving
rim thickness and corners. Title and credit regions determine safe clearance from inward decoration;
the print keeps its aspect ratio, with its own edge pixels bleeding beneath
the inner lip instead of a dark mat. An inner-lip contact shadow seats the print in the frame; the original
canvas size and gallery slot geometry stay unchanged. Chinese-frame artwork is counter-reflected to
preserve readable text. Frame and artwork share one cached texture and all the
existing material, hover, occlusion, cursor and transition effects. The static
fallback uses the same mounted sources.

Metal and ice catch soft moving highlights; flowers sway gently and the flame
cutout flickers and ripples. Hover lifts a frame slightly and adds a local
highlight. It does not stop the individual frame and squeeze its following gap.
The portrait occludes hover on frames behind it.

`gallery.js` renders one transparent background layer per scene into the existing
WebGL compositor. Water refraction, gravitational displacement and both transitions
include the gallery, with both portraits always composited above it. The targets
use CSS pixel resolution and only the visible scene advances outside transitions.
Reduced motion freezes travel and material animation. The static fallback retains
the eight initial placements, behind the portraits, and the scene switch.

Open `/tests/portrait-artworks.html` to inspect all 22 mounted artwork/frame
combinations and check the original texture dimensions and cache reuse.

Run `node --test components/portrait/gallery-sequence.test.mjs` to verify initial
registration, new content identity on each lap, ten minutes of spacing/continuity,
resizing, reduced motion, drift speed, varied stable angles and balanced wood gaps.
Run `node --test components/portrait/gallery-scroll.test.mjs` for scroll direction,
speed limits, settling, frame-rate consistency, reverse laps and artwork mapping.

## Effect source

The liquid simulator and displacement reveal are adapted from Christian Ortiz:
https://github.com/cortiz2894/mouse-effects/blob/main/src/components/mask-cursor/index.tsx

The original three-buffer damped wave equation, swept source injection, displacement
normal and two-texture reveal are retained in native WebGL 2. Additions: fixed timestep,
aspect-corrected injection, advected ink, noisy boundary, smoothing, leave decay,
aligned transparent image composition, ambient background motion and resource cleanup.
The reference video, not the upstream demo, determines the visual tuning.

The black-hole cursor uses inward sampling and a broad, slowly advecting shear
to pull and curl the actual portrait/sky into its edge. A short material-coloured
smear and soft absorption trough add depth without painted silver strands on
skin. Direction-vector noise keeps the contour seamless around the circle;
the revealed portrait remains aligned inside the opening. The halo texture derives crown/cloth line segments from the exact portrait
cutouts and adds fine cloth construction curves. Crown: ELYXEE in Morse
(`. / .-.. / -.-- / -..- / . / .`), using an 85 ms dot and standard 1/3/7-unit
spacing, repeating every 4.93 seconds. Veil: a descending scan every 2.7 s,
with the rear linework occluded by the head and slightly stronger line contrast.

`atmosphere.js` integrates 1,450 sand grains with wind, inertia and pointer
repulsion. Its two particle layers render behind the portraits; water refraction
also displaces the sand. Stars brighten at source-image star positions over
4.5–10 seconds, with a soft bloom and fine peak glints. Meteors have a white core
and a blue trail. Each independently samples a position across the viewport,
direction, speed and lifetime (first after 2.6–7.1 s, then 7–15 s apart).
The supplied transparent `Assets/Elements/ufo.png` passes behind the portrait
with optical blur, low opacity and a small cool glow. Flights follow fresh cubic
curves entering and leaving any viewport edge; arc-length sampling and integrated
velocity ramps give a smooth brake, brief drift and accelerating departure.
Their 2.8–4.8 s flights include subtle banking and depth changes. The first starts
after 7–15 s in Space; subsequent flights have an 18–38 s quiet interval.
Event randomness is independent of the stable sand layout and changes on reload.
Candidate paths are checked for a visible portion outside the head envelope.
Both event clocks pause while Dust is visible or reduced motion is enabled.

Transitions are directional: Dust -> Space lifts and erodes the image into an
oblique sand gust; Space -> Dust opens seven staggered wormholes. Every switch
samples new positions, sizes, birth times and growth rates. Elliptical fields,
low-frequency contour deformation and advected coordinates make their boundaries
asymmetric and fluid. An exponential smooth union and weighted surface normals
round the joining necks and keep refraction continuous as they reveal Dust. Both retain the shared portrait
coordinates, with no global spin or lens zoom.

The pointer and water state remain live through both transitions. Only visible
atmosphere layers are updated, inactive cursor models are skipped, and fully
revealed transition pixels shade a single scene. Switching never clears the
water buffers or resets the smoothed pointer.

Tuning is centralized in `settings.js`. No bundler, dependencies or build step.
WebGL failure leaves a static composition with a working scene switch. Touch drag
also reveals the second portrait. Reduced-motion mode disables ambient motion,
halo pulses and refraction, and uses a short scene fade.
