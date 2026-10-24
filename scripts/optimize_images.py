#!/usr/bin/env python3
"""Optimizador de imágenes: convierte a WebP y genera thumbnails."""

import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow no está instalado. Instalando...")
    os.system(f"{sys.executable} -m pip install Pillow")
    from PIL import Image

# Configuración
INPUT_DIR = Path(__file__).parent.parent / "public" / "assets" / "img" / "productos"
OUTPUT_DIR = Path(__file__).parent.parent / "public" / "assets" / "img" / "productos-webp"
THUMB_DIR = Path(__file__).parent.parent / "public" / "assets" / "img" / "thumbnails"

QUALITY_WEBP = 80
THUMB_SIZE = 200
MEDIUM_SIZE = 400


def ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)


def convert_image(input_path: Path, output_path: Path, size: int = None, quality: int = 80) -> bool:
    try:
        with Image.open(input_path) as img:
            if size:
                img.thumbnail((size, size), Image.Resampling.LANCZOS)
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            img.save(output_path, "WEBP", quality=quality, method=6)
        return True
    except Exception as e:
        print(f"  Error procesando {input_path.name}: {e}")
        return False


def main():
    print("=== Optimizador de imágenes ===\n")

    ensure_dir(OUTPUT_DIR)
    ensure_dir(THUMB_DIR)

    files = [f for f in INPUT_DIR.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png")]
    total = len(files)
    print(f"📁 {total} imágenes encontradas\n")

    webp_count = 0
    thumb_count = 0
    medium_count = 0
    error_count = 0

    for i, file in enumerate(files, 1):
        base = file.stem

        # WebP versión completa
        webp_path = OUTPUT_DIR / f"{base}.webp"
        if convert_image(file, webp_path, quality=QUALITY_WEBP):
            webp_count += 1

        # Thumbnail 200x200
        thumb_path = THUMB_DIR / f"{base}.webp"
        if convert_image(file, thumb_path, size=THUMB_SIZE, quality=QUALITY_WEBP):
            thumb_count += 1

        # Medium 400x400
        medium_path = OUTPUT_DIR / f"{base}-400.webp"
        if convert_image(file, medium_path, size=MEDIUM_SIZE, quality=QUALITY_WEBP):
            medium_count += 1

        if i % 100 == 0 or i == total:
            print(f"  Procesadas: {i}/{total}")

    print(f"\n=== Resumen ===")
    print(f"  WebP completos: {webp_count}")
    print(f"  Thumbnails: {thumb_count}")
    print(f"  Medium (400px): {medium_count}")
    print(f"  Errores: {error_count}")
    print(f"\n✅ Optimización completada")


if __name__ == "__main__":
    main()
