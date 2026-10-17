"""Export web delivery assets; keep the original artwork untouched.

Requires Pillow with WebP support. Home's full-screen textures keep every RGBA
pixel. Portfolio's images are high-quality lossy WebP (quality 90, approved
2026-10-17): colour is compressed, transparency stays exact, so hit masks,
frame openings and cut-out edges are unchanged. Only small UI icons, the
favicon and the loading preview are resized. Re-running the script does not
churn files whose output would be the same.
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
import io
import json
import math

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'Assets/optimized'
OUT.mkdir(exist_ok=True)
exports = []


def psnr(a, b):
    mse = sum(ImageStat.Stat(ImageChops.difference(a, b)).sum2) / (3 * a.width * a.height)
    return math.inf if mse == 0 else 10 * math.log10(255 ** 2 / mse)


def export_lossy(source, name):
    source = ROOT / source
    original = Image.open(source)
    transparent = 'A' in original.getbands() or 'transparency' in original.info
    image = original.convert('RGBA' if transparent else 'RGB')
    target = OUT / name
    target.parent.mkdir(parents=True, exist_ok=True)
    encoded = io.BytesIO()
    image.save(encoded, 'WEBP', quality=90, alpha_quality=100, method=6, exact=True,
               icc_profile=original.info.get('icc_profile', b''))
    if not target.exists() or target.read_bytes() != encoded.getvalue():
        target.write_bytes(encoded.getvalue())
    decoded = Image.open(target)
    assert decoded.size == image.size, f'Size changed: {name}'
    if transparent:
        assert decoded.convert('RGBA').getchannel('A').tobytes() == image.getchannel('A').tobytes(), f'Alpha changed: {name}'
    # A floor against a broken encode, not a target: fine grain such as Dust
    # sits near 32 dB at any quality, since lossy WebP halves colour resolution.
    quality = psnr(image.convert('RGB'), decoded.convert('RGB'))
    assert quality > 30, f'Quality too low ({quality:.1f} dB): {name}'
    exports.append({'source': str(source.relative_to(ROOT)), 'output': str(target.relative_to(ROOT)),
                    'sourceBytes': source.stat().st_size, 'bytes': target.stat().st_size,
                    'size': list(image.size), 'fullResolutionLossless': False, 'lossyQuality': 90,
                    'psnr': round(quality, 1)})


def export(source, name, size=None, png=False):
    source = ROOT / source
    original = Image.open(source)
    image = original.convert('RGBA')
    if size:
        image.thumbnail(size, Image.Resampling.LANCZOS)
    target = OUT / name
    target.parent.mkdir(parents=True, exist_ok=True)
    unchanged = target.exists() and Image.open(target).convert('RGBA').tobytes() == image.tobytes()
    if unchanged:
        pass
    elif png:
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

# Everything Portfolio loads, mirrored under Assets/optimized/. The Portal
# cover is already JPEG data and would only grow as WebP, so it stays as it is.
for source in [
    'Assets/background/Space.png',
    'Assets/background/Dust.png',
    'Assets/Portrait/crowned.png',
    'Assets/Portrait/veiled.png',
    'Assets/Elements/ufo.png',
    'Assets/Portrait/frames/european.png',
    'Assets/Portrait/frames/gilded.png',
    *[f'Assets/Frame/{name}.png' for name in
      ['复古木质相框', '中式相框', '冰相框', '液态边框', '花卉画框', '银框', '火焰相框']],
    *[f'Assets/Portrait/artworks/{name}.png' for name in
      ['digital-nations', 'longevity', 'equality', 'mental-shackles', 'matrix', 'solved']],
]:
    export_lossy(source, source.removeprefix('Assets/').removesuffix('.png') + '.webp')

export('Assets/Transitions/combustion-cloud.png', 'combustion-preview.webp', (384, 216))
export('Assets/Elements/Favicon #1.PNG', 'favicon-64.png', (64, 64), png=True)
export('Assets/Elements/Favicon #1.PNG', 'apple-touch-icon.png', (180, 180), png=True)
(ROOT / 'docs/loading-assets.json').write_text(json.dumps(exports, indent=2) + '\n')
for entry in exports:
    print(f"{entry['output']}: {entry['sourceBytes']:,} -> {entry['bytes']:,} bytes")
