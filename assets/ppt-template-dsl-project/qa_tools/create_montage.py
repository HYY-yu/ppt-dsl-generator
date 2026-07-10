#!/usr/bin/env python3
"""Create a labelled montage from rendered slide PNG files."""

from __future__ import annotations

import argparse
import math
import re
from pathlib import Path


def natural_key(path: Path) -> list[object]:
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", path.name)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output-file", required=True)
    parser.add_argument("--columns", type=int, default=5)
    parser.add_argument("--cell-width", type=int, default=400)
    parser.add_argument("--cell-height", type=int, default=225)
    args = parser.parse_args()

    from PIL import Image, ImageDraw, ImageOps

    input_dir = Path(args.input_dir).expanduser().resolve()
    files = sorted(input_dir.glob("slide-*.png"), key=natural_key)
    if not files:
        raise RuntimeError(f"No rendered slide PNG files in {input_dir}")
    columns = max(args.columns, 1)
    gap = 16
    label_height = 24
    rows = math.ceil(len(files) / columns)
    canvas = Image.new(
        "RGB",
        (columns * args.cell_width + (columns + 1) * gap, rows * (args.cell_height + label_height) + (rows + 1) * gap),
        "#f2f2f2",
    )
    draw = ImageDraw.Draw(canvas)

    for index, file_path in enumerate(files, start=1):
        with Image.open(file_path) as image:
            tile = ImageOps.contain(image.convert("RGB"), (args.cell_width, args.cell_height), Image.Resampling.LANCZOS)
        column = (index - 1) % columns
        row = (index - 1) // columns
        x = gap + column * (args.cell_width + gap) + (args.cell_width - tile.width) // 2
        y = gap + row * (args.cell_height + label_height + gap) + (args.cell_height - tile.height) // 2
        canvas.paste(tile, (x, y))
        draw.rectangle((x - 1, y - 1, x + tile.width, y + tile.height), outline="#9a9a9a", width=1)
        draw.text((gap + column * (args.cell_width + gap) + args.cell_width // 2 - 4, y + args.cell_height + 4), str(index), fill="black")

    output = Path(args.output_file).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output)
    print(f"Montage saved to {output}")


if __name__ == "__main__":
    main()
