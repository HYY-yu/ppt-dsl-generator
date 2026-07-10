#!/usr/bin/env python3
"""Render a PPTX to PNG, preferring native macOS PowerPoint when available."""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


POWERPOINT_ID = "com.microsoft.Powerpoint"
APPLE_SCRIPT = r'''
on run argv
  set inputFile to POSIX file (item 1 of argv)
  set outputFile to POSIX file (item 2 of argv)
  tell application id "com.microsoft.Powerpoint"
    activate
    open inputFile
    save active presentation in outputFile as save as PDF
    close active presentation saving no
  end tell
end run
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_path", help="PPTX or PDF to render")
    parser.add_argument("--output-dir", required=True, help="Directory for slide-N.png files")
    parser.add_argument("--renderer", choices=["auto", "powerpoint", "fallback"], default="auto")
    parser.add_argument("--dpi", type=int, default=150)
    args = parser.parse_args()

    source = Path(args.input_path).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    if not source.is_file():
        raise RuntimeError(f"Input does not exist: {source}")
    output_dir.mkdir(parents=True, exist_ok=True)

    attempts: list[dict[str, str]] = []
    with tempfile.TemporaryDirectory(prefix="ppt-dsl-render-") as temp:
        temp_dir = Path(temp)
        pdf_path: Path | None = source if source.suffix.lower() == ".pdf" else None
        renderer = "pdf"

        if pdf_path is None and args.renderer in ("auto", "powerpoint"):
            try:
                pdf_path = export_with_powerpoint(source, temp_dir / "powerpoint.pdf")
                renderer = "powerpoint"
                attempts.append({"renderer": "powerpoint", "status": "success"})
            except Exception as error:
                attempts.append({"renderer": "powerpoint", "status": f"failed: {error}"})
                if args.renderer == "powerpoint":
                    raise RuntimeError(f"PowerPoint renderer failed: {error}") from error

        if pdf_path is None:
            try:
                pdf_path = export_with_libreoffice(source, temp_dir)
                renderer = "fallback-libreoffice"
                attempts.append({"renderer": "fallback-libreoffice", "status": "success"})
            except Exception as error:
                attempts.append({"renderer": "fallback-libreoffice", "status": f"failed: {error}"})
                raise RuntimeError(
                    "No usable renderer. Install Microsoft PowerPoint on macOS, or install LibreOffice for fallback rendering. "
                    "Also install requirements-qa.txt so PDF pages can be rasterized. "
                    + json.dumps(attempts, ensure_ascii=False)
                ) from error

        slide_paths = rasterize_pdf(pdf_path, output_dir, args.dpi)

    report = {
        "renderer": renderer,
        "slideCount": len(slide_paths),
        "slides": [str(path) for path in slide_paths],
        "attempts": attempts,
    }
    (output_dir / "render-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


def export_with_powerpoint(source: Path, output_pdf: Path) -> Path:
    if platform.system() != "Darwin":
        raise RuntimeError("PowerPoint AppleScript rendering is only available on macOS")
    if not shutil.which("osascript"):
        raise RuntimeError("osascript is unavailable")
    probe = subprocess.run(
        ["osascript", "-e", f'tell application id "{POWERPOINT_ID}" to get version'],
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )
    if probe.returncode != 0:
        raise RuntimeError((probe.stderr or probe.stdout or "PowerPoint is not controllable").strip())

    result = subprocess.run(
        ["osascript", "-", str(source), str(output_pdf)],
        input=APPLE_SCRIPT,
        capture_output=True,
        text=True,
        check=False,
        timeout=180,
    )
    if result.returncode != 0 or not output_pdf.is_file() or output_pdf.stat().st_size == 0:
        detail = (result.stderr or result.stdout or "PowerPoint did not write a PDF").strip()
        raise RuntimeError(detail)
    return output_pdf


def export_with_libreoffice(source: Path, temp_dir: Path) -> Path:
    executable = os.environ.get("PPT_DSL_SOFFICE") or shutil.which("soffice") or shutil.which("libreoffice")
    if not executable:
        raise RuntimeError("LibreOffice/soffice is unavailable")
    output_dir = temp_dir / "libreoffice-output"
    profile_dir = temp_dir / "libreoffice-profile"
    output_dir.mkdir()
    profile_uri = profile_dir.resolve().as_uri()
    result = subprocess.run(
        [
            executable,
            "--headless",
            f"-env:UserInstallation={profile_uri}",
            "--convert-to",
            "pdf",
            "--outdir",
            str(output_dir),
            str(source),
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=180,
    )
    pdf_path = output_dir / f"{source.stem}.pdf"
    if result.returncode != 0 or not pdf_path.is_file():
        detail = (result.stderr or result.stdout or "LibreOffice did not write a PDF").strip()
        raise RuntimeError(detail)
    return pdf_path


def rasterize_pdf(pdf_path: Path, output_dir: Path, dpi: int) -> list[Path]:
    try:
        import pypdfium2 as pdfium
    except ImportError as error:
        raise RuntimeError("pypdfium2 is required; run: python -m pip install -r requirements-qa.txt") from error

    for stale in output_dir.glob("slide-*.png"):
        stale.unlink()
    document = pdfium.PdfDocument(str(pdf_path))
    try:
        scale = dpi / 72
        result: list[Path] = []
        for index, page in enumerate(document, start=1):
            try:
                bitmap = page.render(scale=scale)
                try:
                    target = output_dir / f"slide-{index}.png"
                    bitmap.to_pil().save(target, "PNG")
                    result.append(target)
                finally:
                    bitmap.close()
            finally:
                page.close()
        if not result:
            raise RuntimeError("The exported PDF has no pages")
        return result
    finally:
        document.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
