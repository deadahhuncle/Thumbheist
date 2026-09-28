# python3 tools/sheet.py <dir> <out> ids...  -> rows of 5 frames per level
import sys
from PIL import Image
d, out, ids = sys.argv[1], sys.argv[2], sys.argv[3:]
rows = []
for lid in ids:
    fr = [Image.open(f"{d}/{lid}-{i}.png") for i in range(5)]
    w, h = fr[0].size
    crop = (int(w*0.02), int(h * 0.075), int(w*0.98), int(h * 0.89))
    fr = [f.crop(crop) for f in fr]
    s = 0.28
    fr = [f.resize((int(f.size[0]*s), int(f.size[1]*s))) for f in fr]
    row = Image.new('RGB', (sum(f.size[0] for f in fr) + 6*4, fr[0].size[1]), (20,20,20))
    x = 0
    for f in fr: row.paste(f, (x, 0)); x += f.size[0] + 6
    rows.append(row)
W = max(r.size[0] for r in rows); H = sum(r.size[1] for r in rows) + 8*(len(rows)-1)
sheet = Image.new('RGB', (W, H), (0,0,0))
y = 0
for r in rows: sheet.paste(r, (0, y)); y += r.size[1] + 8
sheet.save(out)
