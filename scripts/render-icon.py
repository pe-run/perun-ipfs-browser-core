#!/usr/bin/env python3
"""Refresh committed Linux PNG icons from branding SVGs (python3-gi, gir1.2-rsvg-2.0)."""
from pathlib import Path
import gi

gi.require_version('GdkPixbuf', '2.0')
from gi.repository import GdkPixbuf

root = Path(__file__).resolve().parent.parent
source = root / 'resources/branding/perun.svg'
target = source.with_suffix('.png')
image = GdkPixbuf.Pixbuf.new_from_file(str(source)).scale_simple(512, 512, GdkPixbuf.InterpType.HYPER)
image.savev(str(target), 'png', [], [])
print(target)
for source in (root / 'resources/branding').glob('site-*.svg'):
    image = GdkPixbuf.Pixbuf.new_from_file(str(source)).scale_simple(16, 16, GdkPixbuf.InterpType.HYPER)
    image.savev(str(source.with_suffix('.png')), 'png', [], [])
    print(source.with_suffix('.png'))
