# python3 tools/montage.py <dir> <id> -> <dir>/<id>-strip.png (5 frames side by side, cropped to board)
import sys
from PIL import Image
d, lid = sys.argv[1], sys.argv[2]
frames = [Image.open(f"{d}/{lid}-{i}.png") for i in range(5)]
w, h = frames[0].size
crop = (0, int(h * 0.07), w, int(h * 0.93))
fr = [f.crop(crop).resize((int(w * 0.42), int((crop[3] - crop[1]) * 0.42))) for f in frames]
W = sum(f.size[0] for f in fr) + 8 * 4
out = Image.new('RGB', (W, fr[0].size[1]), (0, 0, 0))
x = 0
for f in fr:
    out.paste(f, (x, 0)); x += f.size[0] + 8
out.save(f"{d}/{lid}-strip.png")
