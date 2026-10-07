"""Claude client behind a narrow interface: one structured call that returns a validated Pydantic object.

- Structured output via `client.beta.messages.parse(..., output_format=Model)`; invalid output is retried once, then rejected.
- Server-side refusal fallback (`fallbacks="default"`) so a classifier decline is re-run on Anthropic's recommended model.
- The stable system prompt is cached (`cache_control`); only the per-request document varies.
"""
from __future__ import annotations

import logging
from typing import TypeVar

import anthropic
from pydantic import BaseModel, ValidationError

from ..core.settings import settings

log = logging.getLogger("llm")
T = TypeVar("T", bound=BaseModel)


class LlmError(RuntimeError):
    pass


class LlmClient:
    def __init__(self, client: anthropic.Anthropic | None = None, model: str | None = None):
        self._client = client
        self.model = model or settings.model

    @property
    def client(self) -> anthropic.Anthropic:
        if self._client is None:
            self._client = anthropic.Anthropic(timeout=settings.timeout_s, max_retries=2)
        return self._client

    def structured(self, system: str, user: str, schema: type[T], effort: str = "low", max_tokens: int = 4000) -> T:
        last: Exception | None = None
        for _attempt in range(2):
            try:
                resp = self.client.beta.messages.parse(
                    model=self.model,
                    max_tokens=max_tokens,
                    betas=["server-side-fallback-2026-07-01"],
                    fallbacks="default",
                    output_config={"effort": effort},
                    system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                    messages=[{"role": "user", "content": user}],
                    output_format=schema,
                )
            except anthropic.BadRequestError as e:          # not retryable
                raise LlmError(f"bad request: {e.message}") from e
            except anthropic.RateLimitError as e:
                last = e
                continue
            except anthropic.APIStatusError as e:
                last = e
                continue
            except anthropic.APIConnectionError as e:
                last = e
                continue
            except ValidationError as e:                    # schema-invalid output: retry once
                last = e
                continue
            if resp.stop_reason == "refusal":
                raise LlmError(f"model declined ({getattr(resp.stop_details, 'category', None)})")
            if resp.stop_reason == "max_tokens" or resp.parsed_output is None:
                last = LlmError(f"incomplete output (stop_reason={resp.stop_reason})")
                continue
            return resp.parsed_output
        raise LlmError(f"failed after retry: {last}")
