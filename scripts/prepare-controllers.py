# Turns the controller photos in assets/controllers/source into the overlay images:
# the studio background is made transparent (flood fill from the edges, so white
# parts of a controller stay), the result is cropped to the controller, and the
# crop box is printed so pad.js can line up its button highlights.
# Run with:  python scripts/prepare-controllers.py
import json
import os
from collections import deque
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'assets', 'controllers', 'source')
OUT = os.path.join(HERE, '..', 'assets', 'controllers')
FILES = {'ps5': 'ps5.png', 'ps4': 'ps4.jpg', 'xbox': 'xbox.jpg'}


def cut_out(img, tolerance=26):
    img = img.convert('RGBA')
    w, h = img.size
    px = img.load()
    if all(px[x, y][3] < 10 for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]):
        return img  # already transparent
    bg = px[0, 0][:3]
    near = lambda c: sum(abs(c[i] - bg[i]) for i in range(3)) <= tolerance
    seen = bytearray(w * h)
    queue = deque([(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])
    while queue:
        x, y = queue.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y * w + x]:
            continue
        seen[y * w + x] = 1
        if not near(px[x, y]):
            continue
        px[x, y] = (0, 0, 0, 0)
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    # soften the cut edge a little so it does not look jagged over the game
    alpha = img.getchannel('A').filter(ImageFilter.GaussianBlur(0.8))
    img.putalpha(alpha)
    return img


boxes = {}
for name, file in FILES.items():
    path = os.path.join(SRC, file)
    if not os.path.exists(path):
        print(f'skip {name}: {file} not found')
        continue
    try:
        img = cut_out(Image.open(path))
    except OSError:
        print(f'skip {name}: {file} is not an image (yet)')
        continue
    x0, y0, x1, y1 = img.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    pad = 6
    x0, y0, x1, y1 = max(0, x0 - pad), max(0, y0 - pad), min(img.width, x1 + pad), min(img.height, y1 + pad)
    img.crop((x0, y0, x1, y1)).save(os.path.join(OUT, f'{name}.png'), optimize=True)
    boxes[name] = [x0, y0, x1 - x0, y1 - y0]
    print(f'{name}: {x1 - x0}x{y1 - y0} from {img.width}x{img.height}')
print(json.dumps(boxes))
