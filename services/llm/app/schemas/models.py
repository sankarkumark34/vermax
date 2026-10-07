"""Pydantic models for every boundary: HTTP requests/responses and the LLM's structured output."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# ---- requests ---------------------------------------------------------------------------------
class ExplainRequest(BaseModel):
    facts: dict[str, Any] = Field(description="Engine output (verdictFacts): the only numbers the explanation may use")


class AnnouncementRequest(BaseModel):
    symbol: str = Field(max_length=20)
    date: str
    category: str = ""
    text: str = Field(max_length=4000)
    link: str | None = None


class BusinessSummaryRequest(BaseModel):
    symbol: str = Field(max_length=20)
    name: str | None = None
    text: str = Field(max_length=60000, description="Company profile / annual report sections")


# ---- LLM structured outputs -------------------------------------------------------------------
class VerdictExplanation(BaseModel):
    headline: str = Field(description="One sentence: the verdict and the single most important reason")
    why: list[str] = Field(description="2-5 short bullets explaining the verdict, citing the engine's own numbers")
    what_would_change_it: str = Field(description="What has to happen for the verdict to improve (or what would make it worse)")


class AnnouncementClass(BaseModel):
    category: Literal["accounting", "governance", "financial", "market", "business", "catalyst", "routine"]
    severity: Literal[1, 2, 3] = Field(description="1 record only, 2 score penalty, 3 hard gate (only for grave events)")
    is_red_flag: bool
    is_catalyst: bool
    keywords: list[str]
    rationale: str = Field(description="One sentence quoting the phrase that drove the decision")


class BusinessSummaryOut(BaseModel):
    summary: str = Field(description="3-5 sentences on what the company does and how it earns money")
    segments: list[str]
    revenue_model: str
    concentration_notes: str = Field(description="Customer / product / geography concentration mentioned in the text, or 'not disclosed'")
    source_quotes: list[str] = Field(description="Short verbatim quotes from the text that support the summary")


# ---- responses ------------------------------------------------------------------------------------
class ExplainResponse(BaseModel):
    text: str
    model: str
    grounded: bool
    ungrounded: list[str]
    prompt_version: str


class AnnouncementResponse(BaseModel):
    category: str
    severity: int
    isRedFlag: bool
    isCatalyst: bool
    keywords: list[str]
    rationale: str
    status: Literal["suggested"] = "suggested"
    model: str
    prompt_version: str


class BusinessSummaryResponse(BaseModel):
    summary: str
    segments: list[str]
    revenueModel: str
    concentrationNotes: str
    sourceQuotes: list[str]
    citationsValid: bool
    model: str
    prompt_version: str
