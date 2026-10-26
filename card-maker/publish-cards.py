"""Copy a card-maker PNG export into Protosite's local unit-card assets."""
from pathlib import Path
import re
import sys
import zipfile

def publish(archive):
    destination = Path(__file__).resolve().parent.parent / 'images' / 'unit-cards'
    destination.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(archive) as cards:
        for entry in cards.infolist():
            match = re.fullmatch(r'\d+-([a-z0-9-]+-(?:blue|orange)\.png)', entry.filename)
            if not match:
                continue
            (destination / match[1]).write_bytes(cards.read(entry))
            count += 1
    if not count:
        raise ValueError('The ZIP did not contain unit-card PNGs.')
    print(f'Published {count} card images to {destination}')

if __name__ == '__main__':
    publish(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent / 'test-output' / 'all-unit-cards-zero.zip')
