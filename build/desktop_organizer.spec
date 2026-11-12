# PyInstaller specification: one portable executable, no installer, no console window.
# Build with: python build/build.py

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH).resolve().parent  # noqa: F821 - SPECPATH is provided by PyInstaller
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))  # so collect_submodules can import the package
PKG = SRC / "desktop_organizer"
VERSION_FILE = ROOT / "build" / "version_info.txt"

datas = [
    (str(PKG / "resources" / "lang"), "desktop_organizer/resources/lang"),
    (str(PKG / "resources" / "icons"), "desktop_organizer/resources/icons"),
]

excludes = [
    "tkinter",
    "PySide6.Qt3DCore",
    "PySide6.Qt3DRender",
    "PySide6.QtQuick",
    "PySide6.QtQml",
    "PySide6.QtWebEngineCore",
    "PySide6.QtWebEngineWidgets",
    "PySide6.QtMultimedia",
    "PySide6.QtCharts",
    "PySide6.QtDataVisualization",
]

a = Analysis(  # noqa: F821
    [str(PKG / "__main__.py")],
    pathex=[str(SRC)],
    binaries=[],
    datas=datas,
    # Tool pages are loaded by name at run time (see desktop_organizer/tools/__init__.py),
    # so PyInstaller cannot see them. Collect every module of the package.
    hiddenimports=collect_submodules("desktop_organizer") + ["send2trash.plat_win", "send2trash.plat_other"],
    hookspath=[],
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)
pyz = PYZ(a.pure)  # noqa: F821

exe_kwargs = {}
if sys.platform.startswith("win") and VERSION_FILE.exists():
    exe_kwargs["version"] = str(VERSION_FILE)

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="DesktopOrganizer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    icon=str(PKG / "resources" / "icons" / "app.ico"),
    **exe_kwargs,
)
