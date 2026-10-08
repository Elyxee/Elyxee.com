"""Export web delivery assets; keep the original artwork untouched.

Requires Pillow with WebP support. Full-screen textures retain every RGBA pixel.
Only small UI icons, the favicon, and the temporary loading preview are resized.
"""
from pathlib import Path
from PIL import Image
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'Assets/optimized'
OUT.mkdir(exist_ok=True)
exports = []


def export(source, name, size=None, png=False):
    source = ROOT / source
    original = Image.open(source)
    image = original.convert('RGBA')
    if size:
        image.thumbnail(size, Image.Resampling.LANCZOS)
    target = OUT / name
    if png:
        image.save(target, 'PNG', optimize=True)
    else:
        image.save(target, 'WEBP', lossless=True, quality=100, method=6, exact=True,
                   icc_profile=original.info.get('icc_profile', b''))
    decoded = Image.open(target).convert('RGBA')
    assert image.tobytes() == decoded.tobytes(), f'Pixel mismatch: {name}'
    exports.append({'source': str(source.relative_to(ROOT)), 'output': str(target.relative_to(ROOT)),
                    'sourceBytes': source.stat().st_size, 'bytes': target.stat().st_size,
                    'size': list(image.size), 'fullResolutionLossless': size is None})


for source, name in [
    ('Assets/background/Fire-clean.png', 'home-fire.webp'),
    ('Assets/background/Ice.png', 'home-ice.webp'),
    ('Assets/Transitions/combustion-cloud.png', 'combustion.webp'),
]:
    export(source, name)

# The material renders these at <= 68 device pixels, including its existing
# hover scaling. 256px keeps ample detail for the image fallback and zoom too.
for name in ['Snapchat', 'Instagram', 'X', 'Wechat', 'Weibo', 'Bilibili', 'Copy']:
    export(f'Assets/Elements/{name}.png', f'{name.lower()}.webp', (256, 256))

export('Assets/Transitions/combustion-cloud.png', 'combustion-preview.webp', (384, 216))
export('Assets/Elements/Favicon #1.PNG', 'favicon-64.png', (64, 64), png=True)
export('Assets/Elements/Favicon #1.PNG', 'apple-touch-icon.png', (180, 180), png=True)
(ROOT / 'docs/loading-assets.json').write_text(json.dumps(exports, indent=2) + '\n')
for entry in exports:
    print(f"{entry['output']}: {entry['sourceBytes']:,} -> {entry['bytes']:,} bytes")
