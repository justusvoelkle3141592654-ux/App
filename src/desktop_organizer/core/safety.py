"""Protected locations. The app never scans or changes these folders."""

from __future__ import annotations

import os
import sys
from pathlib import Path

_POSIX_PROTECTED = (
    "/bin",
    "/boot",
    "/dev",
    "/etc",
    "/lib",
    "/lib64",
    "/proc",
    "/root",
    "/sbin",
    "/sys",
    "/usr",
    "/var",
)
_WINDOWS_ENV_ROOTS = ("SYSTEMROOT", "WINDIR", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "PROGRAMDATA")


class ProtectedPathError(PermissionError):
    """Raised when a folder is a system location or belongs to another user."""


def _is_windows() -> bool:
    return sys.platform.startswith("win")


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def is_protected(path: Path, home: Path | None = None) -> bool:
    """True for filesystem roots, Windows/Program Files, other users' profiles and system dirs."""
    resolved = path.resolve()
    if resolved.parent == resolved:  # drive root such as C:\ or /
        return True
    home_dir = (home or Path.home()).resolve()

    if _is_windows():
        if any(_under_env_path(resolved, var) for var in _WINDOWS_ENV_ROOTS):
            return True
        drive = os.environ.get("SYSTEMDRIVE", resolved.anchor.rstrip("\\") or "C:")
        users_dir = Path(drive + "\\Users").resolve()
        return _is_relative_to(resolved, users_dir) and not _is_relative_to(resolved, home_dir)

    for root in _POSIX_PROTECTED:
        if _is_relative_to(resolved, Path(root)):
            # The user's own home folder stays usable even if it sits under /home or /root.
            return not _is_relative_to(resolved, home_dir)
    return False


def _under_env_path(path: Path, variable: str) -> bool:
    value = os.environ.get(variable)
    if not value:
        return False
    return _is_relative_to(path, Path(value).resolve())


def ensure_allowed(path: Path, home: Path | None = None) -> Path:
    if is_protected(path, home):
        raise ProtectedPathError(f"Protected location, not allowed: {path}")
    return path
