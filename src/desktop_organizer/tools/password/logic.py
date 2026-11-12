"""Password and passphrase generation with a cryptographically secure random source.

Passwords are never written to disk or to the log unless the user saves them explicitly.
"""

from __future__ import annotations

import math
import secrets
import string
from dataclasses import dataclass

LOWER = string.ascii_lowercase
UPPER = string.ascii_uppercase
DIGITS = string.digits
SYMBOLS = "!@#$%^&*()-_=+[]{};:,.<>?"
AMBIGUOUS = set("Il1O0o")

# Short, common, lowercase words. Each word adds log2(len(WORDLIST)) bits (about 6.9 bits for this list).
WORDLIST: tuple[str, ...] = (
    "acorn",
    "amber",
    "anchor",
    "apple",
    "arrow",
    "aspen",
    "atlas",
    "autumn",
    "badge",
    "bamboo",
    "basin",
    "beacon",
    "birch",
    "bison",
    "blossom",
    "bridge",
    "bronze",
    "cabin",
    "cactus",
    "candle",
    "canyon",
    "cedar",
    "cherry",
    "cloud",
    "clover",
    "cobalt",
    "comet",
    "coral",
    "cotton",
    "crater",
    "crystal",
    "dawn",
    "delta",
    "desert",
    "dolphin",
    "dune",
    "eagle",
    "ember",
    "fern",
    "field",
    "flame",
    "forest",
    "fossil",
    "frost",
    "galaxy",
    "garden",
    "glacier",
    "granite",
    "harbor",
    "hazel",
    "helix",
    "hollow",
    "horizon",
    "island",
    "ivory",
    "jasper",
    "jungle",
    "kettle",
    "lantern",
    "laurel",
    "lemon",
    "lilac",
    "linen",
    "lotus",
    "maple",
    "meadow",
    "meteor",
    "mirror",
    "mist",
    "monarch",
    "moss",
    "nectar",
    "nickel",
    "north",
    "nutmeg",
    "oasis",
    "olive",
    "onyx",
    "orbit",
    "orchid",
    "otter",
    "oyster",
    "paddle",
    "parrot",
    "pebble",
    "pepper",
    "pine",
    "planet",
    "plum",
    "pocket",
    "polar",
    "prairie",
    "quartz",
    "quill",
    "rain",
    "raven",
    "reef",
    "river",
    "rocket",
    "saddle",
    "salmon",
    "sapphire",
    "shadow",
    "silver",
    "sparrow",
    "spruce",
    "stone",
    "storm",
    "summit",
    "sunset",
    "thistle",
    "timber",
    "topaz",
    "tundra",
    "valley",
    "velvet",
    "violet",
    "walnut",
    "willow",
    "winter",
)
BITS_PER_WORD = math.log2(len(WORDLIST))


@dataclass(frozen=True)
class PasswordOptions:
    length: int = 20
    lower: bool = True
    upper: bool = True
    digits: bool = True
    symbols: bool = True
    exclude_ambiguous: bool = False


def _alphabet(options: PasswordOptions) -> list[str]:
    sets: list[str] = []
    if options.lower:
        sets.append(LOWER)
    if options.upper:
        sets.append(UPPER)
    if options.digits:
        sets.append(DIGITS)
    if options.symbols:
        sets.append(SYMBOLS)
    if options.exclude_ambiguous:
        sets = ["".join(ch for ch in group if ch not in AMBIGUOUS) for group in sets]
    return [group for group in sets if group]


def generate_password(options: PasswordOptions) -> str:
    groups = _alphabet(options)
    if not groups:
        raise ValueError("Select at least one character set.")
    if options.length < len(groups):
        raise ValueError(f"Length must be at least {len(groups)} for the selected sets.")
    if options.length > 512:
        raise ValueError("Length must be at most 512.")
    chars = [secrets.choice(group) for group in groups]
    pool = "".join(groups)
    chars += [secrets.choice(pool) for _ in range(options.length - len(chars))]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def generate_passphrase(words: int = 6, separator: str = "-", capitalize: bool = False) -> str:
    if not 3 <= words <= 20:
        raise ValueError("Use between 3 and 20 words.")
    picked = [secrets.choice(WORDLIST) for _ in range(words)]
    if capitalize:
        picked = [word.capitalize() for word in picked]
    return separator.join(picked)


def password_entropy_bits(options: PasswordOptions) -> float:
    groups = _alphabet(options)
    pool_size = sum(len(group) for group in groups)
    if pool_size < 2:
        return 0.0
    return options.length * math.log2(pool_size)


def passphrase_entropy_bits(words: int) -> float:
    return words * BITS_PER_WORD


def strength_level(bits: float) -> str:
    """Return one of: weak, fair, good, strong. The UI maps these to translated labels."""
    if bits < 40:
        return "weak"
    if bits < 60:
        return "fair"
    if bits < 80:
        return "good"
    return "strong"
