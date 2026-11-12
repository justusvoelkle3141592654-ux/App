"""Translations. All UI text lives in resources/lang/<code>.json.

Lookup order: current language, then English, then the key itself. The key itself is
shown only as a last resort, and the test suite checks that both languages have the same keys.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

LANG_DIR = Path(__file__).resolve().parent.parent / "resources" / "lang"
FALLBACK = "en"


@cache
def load_catalog(lang: str) -> dict[str, str]:
    path = LANG_DIR / f"{lang}.json"
    data: Any = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return {str(key): str(value) for key, value in data.items()}


class Translator:
    def __init__(self, language: str = "de") -> None:
        self._language = language

    @property
    def language(self) -> str:
        return self._language

    def set_language(self, language: str) -> None:
        self._language = language

    def t(self, key: str, **kwargs: object) -> str:
        text = load_catalog(self._language).get(key)
        if text is None:
            text = load_catalog(FALLBACK).get(key, key)
        return text.format(**kwargs) if kwargs else text


translator = Translator()


def t(key: str, **kwargs: object) -> str:
    return translator.t(key, **kwargs)
