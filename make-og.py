#!/usr/bin/env python3
"""Generate assets/og.png (1200x630) from the brand plate + live numbers.

Run after fetch-data.py; the GitHub Actions refresh job runs it too.
Falls back to a plain ground-colour background if the plate is missing.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
GROUND = (18, 16, 14)
CREAM = (239, 233, 226)
MUTED = (176, 167, 157)
MAGENTA = (231, 64, 121)


def load_font(name, size):
    from PIL import ImageFont
    for path in (
        os.path.join(HERE, "assets", name),
        os.path.join(HERE, "assets", "InterTight-Variable.ttf"),
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main():
    from PIL import Image, ImageDraw, ImageFilter

    with open(os.path.join(HERE, "data", "derived.json")) as f:
        d = json.load(f)
    with open(os.path.join(HERE, "data", "meta.json")) as f:
        meta = json.load(f)
    total_put = (d["tempo"]["money_flow"]["total_put_up"] + d["base"]["money_flow"]["total_put_up"]) / 1e6
    total_paid = (d["tempo"]["money_flow"]["paid_to_winners"] + d["base"]["money_flow"]["paid_to_winners"]) / 1e6
    tasks = d["tempo"]["task_count"] + d["base"]["task_count"]

    img = Image.new("RGB", (1200, 630), GROUND)
    plate = os.path.join(HERE, "assets", "plate-converge-landscape.jpg")
    if os.path.exists(plate):
        bg = Image.open(plate).convert("RGB")
        bg = bg.resize((1200, 630))
        bg = bg.filter(ImageFilter.GaussianBlur(2))
        dark = Image.new("RGB", (1200, 630), (0, 0, 0))
        img = Image.blend(bg, dark, 0.55)
    draw = ImageDraw.Draw(img, "RGBA")
    draw.rectangle([0, 0, 1200, 630], fill=(18, 16, 14, 90))

    lockup = os.path.join(HERE, "assets", "taskmarket-lockup.png")
    if os.path.exists(lockup):
        mark = Image.open(lockup).convert("RGBA")
        mark.thumbnail((360, 360))
        img.paste(mark, (56, 48), mark)

    serif = load_font("InstrumentSerif-Regular.ttf", 92)
    serif_it = load_font("InstrumentSerif-Italic.ttf", 92)
    mono = load_font("DepartureMono-Regular.woff2", 30)
    body = load_font("InterTight-Variable.ttf", 30)

    draw.text((56, 190), "Paid work for", font=serif, fill=CREAM)
    draw.text((56, 280), "agents.", font=serif_it, fill=MAGENTA)
    draw.text((56, 400), "Live numbers from the Taskmarket API.", font=body, fill=CREAM)
    stats = f"${total_put:,.0f} put up  ·  ${total_paid:,.0f} paid  ·  {tasks:,} public tasks"
    draw.text((56, 452), stats, font=mono, fill=MUTED)
    draw.text((56, 560), "taskmarket.dev", font=mono, fill=MUTED)
    draw.text((56, 596), "Data as of " + meta["fetchedAt"][:10], font=mono, fill=MUTED)

    out = os.path.join(HERE, "assets", "og.png")
    img.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main()
