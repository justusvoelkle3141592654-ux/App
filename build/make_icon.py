"""Generate the multi-resolution application icon (build/icon source and resources/icons/app.ico).

The design is deliberately plain: an accent-colored square with three horizontal bars.
Replace this file's output with a finished icon when one exists.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "desktop_organizer" / "resources" / "icons" / "app.ico"
ACCENT = (46, 92, 138, 255)  # matches LIGHT.accent in core/theme.py
WHITE = (255, 255, 255, 255)
SIZES = (16, 24, 32, 48, 64, 128, 256)
MASTER = 1024


def draw(size: int) -> Image.Image:
    scale = size / MASTER
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_ctx = ImageDraw.Draw(image)
    radius = max(1, int(180 * scale))
    draw_ctx.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=ACCENT)
    bar_height = max(1, int(92 * scale))
    left = int(232 * scale)
    right = int(792 * scale)
    for top in (300, 466, 632):
        y = int(top * scale)
        draw_ctx.rounded_rectangle((left, y, right, y + bar_height), radius=max(1, bar_height // 2), fill=WHITE)
    return image


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    images = [draw(size) for size in SIZES]
    images[-1].save(OUT, format="ICO", sizes=[(s, s) for s in SIZES], append_images=images[:-1])
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
