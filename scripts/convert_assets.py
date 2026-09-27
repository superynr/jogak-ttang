#!/usr/bin/env python3
"""Convert assets recursively, keeping originals. Requires Pillow; videos need FFmpeg."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path,
                        default=Path(__file__).resolve().parents[1] / "assets",
                        help="input directory (default: this project's assets)")
    parser.add_argument("--quality", type=int, default=82, help="WebP quality, 0–100 (default: 82)")
    parser.add_argument("--crf", type=int, default=32, help="VP9 CRF, 0–63; lower is higher quality (default: 32)")
    parser.add_argument("--overwrite", action="store_true", help="replace existing outputs")
    parser.add_argument("--dry-run", action="store_true", help="list actions without converting")
    parser.add_argument("--ffmpeg", default="ffmpeg", help="FFmpeg executable name or full path")
    args = parser.parse_args()
    if not 0 <= args.quality <= 100 or not 0 <= args.crf <= 63:
        parser.error("quality must be 0–100 and CRF must be 0–63")
    root = args.directory.resolve()
    if not root.is_dir():
        parser.error(f"directory not found: {root}")

    sources = sorted(p for p in root.rglob("*")
                     if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".mp4"})
    destinations: dict[Path, list[Path]] = {}
    for source in sources:
        target = source.with_suffix(".webm" if source.suffix.lower() == ".mp4" else ".webp")
        destinations.setdefault(target, []).append(source)

    image_module = image_ops = None
    ffmpeg = shutil.which(args.ffmpeg)
    done = skipped = failed = 0
    for target, inputs in destinations.items():
        # Never arbitrarily choose between e.g. icon.png and icon.jpg.
        if len(inputs) > 1:
            print(f"ERROR: output collision: {target} <- {', '.join(p.name for p in inputs)}")
            failed += len(inputs)
            continue
        source = inputs[0]
        if target.exists() and not args.overwrite:
            print(f"SKIP: {target.relative_to(root)} (already exists)")
            skipped += 1
            continue
        if args.dry_run:
            print(f"PLAN: {source.relative_to(root)} -> {target.relative_to(root)}")
            done += 1
            continue

        temporary: Path | None = None
        try:
            video = source.suffix.lower() == ".mp4"
            if video and ffmpeg is None:
                raise RuntimeError("FFmpeg not found. Install FFmpeg or supply --ffmpeg PATH.")
            if not video and image_module is None:
                try:
                    from PIL import Image, ImageOps
                except ImportError as exc:
                    raise RuntimeError("Pillow is required: python -m pip install Pillow") from exc
                image_module, image_ops = Image, ImageOps
            with tempfile.NamedTemporaryFile(prefix=".convert-", suffix=target.suffix,
                                             dir=target.parent, delete=False) as handle:
                temporary = Path(handle.name)
            if video:
                command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                           "-i", str(source), "-map", "0:v:0", "-map", "0:a:0?",
                           "-c:v", "libvpx-vp9", "-crf", str(args.crf), "-b:v", "0",
                           "-pix_fmt", "yuv420p", "-row-mt", "1",
                           "-c:a", "libopus", "-b:a", "128k", str(temporary)]
                result = subprocess.run(command, capture_output=True, text=True, errors="replace")
                if result.returncode:
                    raise RuntimeError(result.stderr.strip() or f"FFmpeg exited with {result.returncode}")
            else:
                with image_module.open(source) as image:
                    if getattr(image, "is_animated", False):
                        raise RuntimeError("animated PNG requires a separate animation conversion; source preserved")
                    oriented = image_ops.exif_transpose(image)
                    has_alpha = "A" in oriented.getbands() or "transparency" in oriented.info
                    converted = oriented.convert("RGBA" if has_alpha else "RGB")
                    options = {"quality": args.quality, "method": 6}
                    if image.info.get("icc_profile"):
                        options["icc_profile"] = image.info["icc_profile"]
                    converted.save(temporary, "WEBP", **options)
            if temporary.stat().st_size == 0:
                raise RuntimeError("encoder produced an empty file")
            temporary.replace(target)
            print(f"OK: {source.relative_to(root)} -> {target.relative_to(root)}")
            done += 1
        except Exception as exc:
            print(f"ERROR: {source.relative_to(root)}: {exc}")
            failed += 1
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    label = "planned" if args.dry_run else "converted"
    print(f"{label}={done}, skipped={skipped}, failed={failed}; originals preserved")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
