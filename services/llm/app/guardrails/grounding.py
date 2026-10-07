"""Guardrails (proposal section 7).

numeric_grounding: every number in LLM text must also appear in the input facts. Formatting is normalised
(₹, commas, %, trailing zeros), and tiny integers (list counts, "1:2" style ratios, step numbers) are allowed.
citation_check: every quoted source passage must occur verbatim in the source text.
"""
from __future__ import annotations

import json
import re
from typing import Any

NUM = re.compile(r"(?<![A-Za-z])[-+]?\d[\d,]*(?:\.\d+)?")


def _norm(token: str) -> str | None:
    t = token.replace(",", "").lstrip("+")
    try:
        v = float(t)
    except ValueError:
        return None
    return f"{v:.4f}".rstrip("0").rstrip(".")


def numbers_in(value: Any) -> set[str]:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    out = set()
    for m in NUM.findall(text):
        n = _norm(m)
        if n is not None:
            out.add(n)
            out.add(n.lstrip("-"))
    return out


def numeric_grounding(text: str, facts: Any, allow_small: int = 10) -> tuple[bool, list[str]]:
    allowed = numbers_in(facts)
    bad = []
    for m in NUM.findall(text):
        n = _norm(m)
        if n is None:
            continue
        if n in allowed or n.lstrip("-") in allowed:
            continue
        try:
            if float(n).is_integer() and abs(float(n)) <= allow_small:
                continue
        except ValueError:
            pass
        bad.append(m)
    return (not bad, bad)


def _squash(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def citation_check(quotes: list[str], source: str) -> bool:
    src = _squash(source)
    return all(_squash(q) in src for q in quotes if q.strip())
