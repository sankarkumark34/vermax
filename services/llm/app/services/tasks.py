"""Orchestration only: build the prompt, call the client, apply guardrails, cache by content hash."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from ..clients.llm_client import LlmClient, LlmError
from ..core.settings import settings
from ..guardrails.grounding import citation_check, numeric_grounding
from ..prompts import templates as P
from ..schemas.models import (
    AnnouncementClass, AnnouncementRequest, AnnouncementResponse, BusinessSummaryOut, BusinessSummaryRequest,
    BusinessSummaryResponse, ExplainResponse, VerdictExplanation,
)


class Cache:
    """Results cached on disk by (prompt version, model, document hash) so the same filing is never sent twice."""

    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def key(*parts: Any) -> str:
        return hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()[:32]

    def get(self, k: str) -> dict | None:
        p = self.root / f"{k}.json"
        return json.loads(p.read_text(encoding="utf8")) if p.exists() else None

    def put(self, k: str, v: dict) -> None:
        (self.root / f"{k}.json").write_text(json.dumps(v, ensure_ascii=False), encoding="utf8")


class Tasks:
    def __init__(self, llm: LlmClient | None = None, cache: Cache | None = None):
        self.llm = llm or LlmClient()
        self.cache = cache or Cache(settings.cache_dir)

    def explain(self, facts: dict[str, Any]) -> ExplainResponse:
        k = self.cache.key(P.EXPLAIN_VERSION, self.llm.model, facts)
        if hit := self.cache.get(k):
            return ExplainResponse(**hit)
        user = "Explain this verdict.\n\n<facts>\n" + json.dumps(facts, ensure_ascii=False, sort_keys=True) + "\n</facts>"
        out = self.llm.structured(P.EXPLAIN_SYSTEM, user, VerdictExplanation, effort="medium")
        text = " ".join([out.headline, *out.why, out.what_would_change_it])
        ok, bad = numeric_grounding(text, facts)
        if not ok:   # one regeneration with the offending figures named, then reject
            out = self.llm.structured(P.EXPLAIN_SYSTEM, user + f"\n\nYour previous answer used figures that are not in the facts: {bad}. Use only figures from the facts.", VerdictExplanation, effort="medium")
            text = " ".join([out.headline, *out.why, out.what_would_change_it])
            ok, bad = numeric_grounding(text, facts)
            if not ok:
                raise LlmError(f"explanation failed numeric grounding: {bad}")
        body = out.headline + "\n\n" + "\n".join(f"• {w}" for w in out.why) + "\n\n" + out.what_would_change_it
        res = ExplainResponse(text=body, model=self.llm.model, grounded=True, ungrounded=[], prompt_version=P.EXPLAIN_VERSION)
        self.cache.put(k, res.model_dump())
        return res

    def classify(self, req: AnnouncementRequest) -> AnnouncementResponse:
        k = self.cache.key(P.CLASSIFY_VERSION, self.llm.model, req.symbol, req.category, req.text)
        if hit := self.cache.get(k):
            return AnnouncementResponse(**hit)
        user = f"Symbol: {req.symbol}\nDate: {req.date}\nNSE category: {req.category}\n\n<announcement>\n{req.text}\n</announcement>"
        out = self.llm.structured(P.CLASSIFY_SYSTEM, user, AnnouncementClass, effort="low", max_tokens=1500)
        res = AnnouncementResponse(category=out.category, severity=out.severity, isRedFlag=out.is_red_flag, isCatalyst=out.is_catalyst,
                                   keywords=out.keywords, rationale=out.rationale, model=self.llm.model, prompt_version=P.CLASSIFY_VERSION)
        self.cache.put(k, res.model_dump())
        return res

    def business_summary(self, req: BusinessSummaryRequest) -> BusinessSummaryResponse:
        k = self.cache.key(P.SUMMARY_VERSION, self.llm.model, req.symbol, req.text)
        if hit := self.cache.get(k):
            return BusinessSummaryResponse(**hit)
        user = f"Company: {req.name or req.symbol} ({req.symbol})\n\n<document>\n{req.text}\n</document>"
        out = self.llm.structured(P.SUMMARY_SYSTEM, user, BusinessSummaryOut, effort="medium")
        res = BusinessSummaryResponse(summary=out.summary, segments=out.segments, revenueModel=out.revenue_model, concentrationNotes=out.concentration_notes,
                                      sourceQuotes=out.source_quotes, citationsValid=citation_check(out.source_quotes, req.text),
                                      model=self.llm.model, prompt_version=P.SUMMARY_VERSION)
        self.cache.put(k, res.model_dump())
        return res
