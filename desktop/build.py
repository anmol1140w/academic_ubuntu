#!/usr/bin/env python3
"""Whitelist and assemble the desktop payload. No package downloads or compilation."""
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
APP_ID = 'com.anmol.academicplanner'
FILES = ['index.html', 'app.js', 'styles.css', 'icon.svg', 'manifest.webmanifest',
         'desktop/planner.py', 'desktop/theme.css']


def make_icons():
    import gi
    gi.require_version('Rsvg', '2.0')
    from gi.repository import Rsvg
    import cairo
    handle = Rsvg.Handle.new_from_file(str(ROOT / 'icon.svg'))
    for size in (32, 48, 64, 128, 256, 512):
        output = ROOT / f'desktop/icons/hicolor/{size}x{size}/apps/{APP_ID}.png'
        output.parent.mkdir(parents=True, exist_ok=True)
        surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
        viewport = Rsvg.Rectangle()
        viewport.x, viewport.y, viewport.width, viewport.height = 0, 0, size, size
        handle.render_document(cairo.Context(surface), viewport)
        surface.write_to_png(str(output))
    output = ROOT / f'desktop/icons/hicolor/scalable/apps/{APP_ID}.svg'
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / 'icon.svg', output)


def build():
    make_icons()
    stage = ROOT / 'build/snap'
    if stage.exists():
        shutil.rmtree(stage)
    payload = stage / 'share/academic-planner'
    for name in FILES:
        destination = payload / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, destination)
    shutil.copytree(ROOT / 'desktop/icons', payload / 'desktop/icons')
    shutil.copytree(ROOT / 'desktop/icons', stage / 'usr/share/icons')
    (stage / 'meta/gui').mkdir(parents=True)
    (stage / 'bin').mkdir()
    shutil.copy2(ROOT / 'snap/snap.yaml', stage / 'meta/snap.yaml')
    shutil.copy2(ROOT / f'snap/gui/{APP_ID}.desktop', stage / f'meta/gui/{APP_ID}.desktop')
    shutil.copy2(ROOT / 'icon.svg', stage / f'meta/gui/{APP_ID}.svg')
    shutil.copy2(ROOT / 'snap/launcher', stage / 'bin/academic-planner')
    (stage / 'bin/academic-planner').chmod(0o755)
    for mount in ['gnome-platform', 'gpu-2404', 'data-dir/themes', 'data-dir/icons']:
        (stage / mount).mkdir(parents=True, exist_ok=True)
    # snapd expands ${SNAP} when installing the desktop entry; validate that form.
    check_entry = ROOT / 'build/desktop-entry-check.desktop'
    check_entry.write_text((stage / f'meta/gui/{APP_ID}.desktop').read_text().replace('${SNAP}', '/snap/academic-planner/current'))
    subprocess.run(['desktop-file-validate', str(check_entry)], check=True)
    check_entry.unlink()
    print(f'Desktop payload assembled: {payload}')
    print(f'Snap staging directory: {stage}')
    return stage


if __name__ == '__main__':
    build()
