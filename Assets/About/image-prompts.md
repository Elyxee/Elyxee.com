# Hero photo repair

The earlier full-image derivatives below are archived. The current hero combines
the untouched source photo with a book-corner-only extension; see the final section.

## Skin correction — archived derivative

Built-in imagegen, with the repaired cutout as edit target and the original photo
as the skin reference. Saved as `reading-retouched.png`; both earlier files are
preserved. This is a retouched derivative, not a pixel-identical restoration.

Use case: precise-object-edit, skin retouch correction. Image 1 is the EDIT TARGET, a transparent cutout. Image 2 is the ORIGINAL PHOTO and authoritative reference for the person's skin, identity and photographic softness. The previous edit incorrectly invented excessive rough pores, scratchy wrinkles and leathery texture on the cheek, jaw, neck and hands. Correct ONLY those skin regions in Image 1: restore the smooth clean young skin and softer photographic texture visible in Image 2. Reduce artificial fine wrinkles on the neck and scratchy pores on the cheek; gentle natural beauty retouch, clean subtle gradients with realistic natural detail. Do not add sharpness, clarity, aging or hyperreal texture. Keep exact face geometry, jawline, ear, lips, pose, light/shadow direction and hand anatomy. Keep the ENTIRE rest of Image 1 unchanged: crop, dimensions, scale, book, book lettering, hair, clothing, necklace, all outer silhouette contours. No relighting, new objects, text or background. Maintain transparent alpha with fully opaque subject including black clothing. No gray or colored fringe. User explicitly wants original smooth skin back, not a new face.

Tool: built-in imagegen; transparent background enabled. Source is the original
Figma cutout. First pass restored the truncated right side; second pass removed
background contamination and gave the book and sleeve complete outer contours.
The second result is saved as `reading.png`; original source is unchanged.

## First edit

Use case: identity-preserve / precise-object-edit. Edit target: supplied transparent PNG photo of a young man in black suit holding Beyond Order book in front of his eyes. Create a corrected transparent cutout for a website hero. Preserve the EXACT same identity, face, hair, hand, fingers, pose, necklace, jacket details, photographic lighting and the existing book typography. The source has massive empty transparent space above and left; trim that unused space in the output composition. Restore ONLY the cropped rightmost edge of the book and the missing outside contour of the right sleeve/arm, naturally continuing existing material, anatomy and lighting. Entire book and both outer shoulder/sleeve contours must fit inside canvas with clear transparent padding, with the lower torso cropped only at the bottom. Keep all existing subject pixels visually unchanged, do not redesign the person, book or clothing. Do not add background, haze, stars, text, graphics or extra objects. Real transparent alpha background. Portrait centered horizontally, book near top with a little padding, waist at bottom. High fidelity photorealistic.

## Final edit

Edit target: the supplied portrait transparent PNG. Keep subject photograph, face identity, hand anatomy, suit, pose and all book text the same. OUTPAINT horizontally so ENTIRE book's right edge and ENTIRE right sleeve including elbow fit comfortably INSIDE the canvas. Both objects are currently CUT OFF at the right border: reconstruct the missing tiny book edge and sleeve outer contour. Add 12 percent EMPTY TRANSPARENT padding on left AND right. Subject must not touch either left or right canvas edge. Keep lower torso bottom crop only. Remove ALL gray/brown background glow and halo, especially between arm and book. Every non-subject pixel must have alpha zero; solid skin and clothing should be opaque. Clean transparent cutout ready to layer over typography, not a background photo. Output can be wider landscape aspect if needed to fit all contours, but do NOT shrink the whole subject to a thumbnail. Preserve high detail and photographic fidelity.

## Current hero — book corner only (2026-10-05)

`reading-book-repaired.png` is the current hero. It extends the original canvas
from 2731 to 2891 pixels wide; height remains 4096. Every RGBA pixel within the
original 2731 × 4096 rectangle was copied without modification and verified
byte-for-byte after PNG encoding. Face, hair, hand, suit, and existing book
lettering all retain their source pixels. Only the absent book corner to the
right of the original canvas is added. The original and older derivatives are
preserved. The crop's `layoutWidth: 2250` keeps the original subject scale and
desktop position while allowing the repaired corner to be visible. Narrow screens
shift the photo left only as needed to keep the complete corner on screen.

Built-in imagegen received a 1024 × 1024 transparent close-up of the book,
extracted at source (2119, 1488), with 412 transparent columns on the right.
Only generated columns at x ≥ 612 were retained; their edge registration and
color were matched to the source before copying them into the new strip.

Exact built-in edit prompt:

> Use case: precise-object-edit. EDIT TARGET: the supplied 1024 x 1024 transparent PNG is a close-up of the lower right side of a real black paperback book held by a hand. The book was abruptly clipped along the vertical line x=612; the rightmost 412 columns are transparent padding. Repair ONLY the missing narrow triangular right corner of the book beyond x=612. Continue the existing slanted outer black cover edge down and right, until it meets the existing gently curved cream paper-bottom edge near y=840, with a natural rounded corner and fine paper thickness. The completed book edge should end around x=730, with the remainder transparent. Keep exact pixel registration, 1024x1024 canvas, same scale, position, perspective, subdued photographic lighting, blur, colors and existing lettering. Do not move, enlarge, recrop, brighten, redraw or reinterpret the existing book, text, hand or skin. ALL existing content in columns x=0 through x=611 is a locked reference; only extend the absent corner across that cut. Genuine transparent background throughout outside the book and hand, no black rectangle, no added objects, no new text, no halo. The final asset will be composited only to the right of the original cut so the original photo's people and existing pixels remain untouched.
