"""Print the CHANGELOG.md section for the current code version (used by the release workflow)."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def current_version() -> str:
    text = (ROOT / "src" / "desktop_organizer" / "__init__.py").read_text(encoding="utf-8")
    match = re.search(r'__version__\s*=\s*"([^"]+)"', text)
    if not match:
        raise SystemExit("version not found")
    return match.group(1)


def section(changelog: str, version: str) -> str:
    pattern = re.compile(rf"^## \[{re.escape(version)}\].*?$(.*?)(?=^## \[|\Z)", re.MULTILINE | re.DOTALL)
    match = pattern.search(changelog)
    if not match:
        raise SystemExit(f"CHANGELOG.md has no section for version {version}")
    return match.group(1).strip() + "\n"


def main() -> None:
    version = current_version()
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    sys.stdout.write(section(changelog, version))


if __name__ == "__main__":
    main()
