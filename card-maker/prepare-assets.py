"""Prepare exact-size working templates; preserve the supplied originals.

Development utility requiring Pillow. The card maker itself needs no packages.
20 pixels/mm = 508 dpi, so both physical dimensions are exact in PNG metadata.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent
target = ROOT / 'assets' / 'templates'
target.mkdir(parents=True, exist_ok=True)
for colour in ('blue', 'orange'):
    for orientation, size in [('vertical', (1260, 1760)), ('horizontal', (1760, 1260))]:
        name = f'{colour}_{orientation}_template.png'
        with Image.open(ROOT.parent / 'images' / name) as image:
            # Correct the source aspect ratio to the requested card footprint.
            image.resize(size, Image.Resampling.LANCZOS).save(target / name, dpi=(508, 508))
        print(name, size, '508 dpi')
