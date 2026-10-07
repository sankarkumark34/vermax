"""Typed settings from the environment. No secrets in the repository: the Anthropic SDK reads ANTHROPIC_API_KEY
(or an `ant auth login` profile) itself."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    model: str = field(default_factory=lambda: os.environ.get("LLM_MODEL", "claude-opus-5-5"))
    service_token: str = field(default_factory=lambda: os.environ.get("LLM_SERVICE_TOKEN", ""))
    host: str = field(default_factory=lambda: os.environ.get("LLM_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(os.environ.get("LLM_PORT", "8100")))
    cache_dir: Path = field(default_factory=lambda: Path(os.environ.get("LLM_CACHE_DIR", Path(__file__).resolve().parents[4] / "data" / "llm-cache")))
    timeout_s: float = field(default_factory=lambda: float(os.environ.get("LLM_TIMEOUT_S", "60")))


settings = Settings()
