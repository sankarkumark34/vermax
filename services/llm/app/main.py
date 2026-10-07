"""Vermax LLM service (proposal 8.7). Language tasks only: it never produces scores or financial figures.

Run:  cd services/llm && python -m uvicorn app.main:app --host 127.0.0.1 --port 8100
"""
from __future__ import annotations

import logging
import os

from fastapi import Depends, FastAPI, Header, HTTPException

from .clients.llm_client import LlmError
from .core.settings import settings
from .schemas.models import (
    AnnouncementRequest, AnnouncementResponse, BusinessSummaryRequest, BusinessSummaryResponse, ExplainRequest, ExplainResponse,
)
from .services.tasks import Tasks

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def create_app(tasks: Tasks | None = None) -> FastAPI:
    app = FastAPI(title="Vermax LLM service", version="1.0.0")
    state = {"tasks": tasks}

    def get_tasks() -> Tasks:
        if state["tasks"] is None:
            state["tasks"] = Tasks()
        return state["tasks"]

    def auth(authorization: str | None = Header(default=None)) -> None:
        if settings.service_token and authorization != f"Bearer {settings.service_token}":
            raise HTTPException(status_code=401, detail="invalid service token")

    def run(fn):
        try:
            return fn()
        except LlmError as e:
            raise HTTPException(status_code=502, detail=str(e)) from e

    @app.get("/health")
    def health():
        configured = bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN") or os.environ.get("ANTHROPIC_PROFILE"))
        return {"ok": True, "provider": "anthropic", "model": settings.model, "credentialsFromEnv": configured}

    @app.post("/v1/explain-verdict", response_model=ExplainResponse, dependencies=[Depends(auth)])
    def explain(req: ExplainRequest, t: Tasks = Depends(get_tasks)):
        return run(lambda: t.explain(req.facts))

    @app.post("/v1/classify-announcement", response_model=AnnouncementResponse, dependencies=[Depends(auth)])
    def classify(req: AnnouncementRequest, t: Tasks = Depends(get_tasks)):
        return run(lambda: t.classify(req))

    @app.post("/v1/business-summary", response_model=BusinessSummaryResponse, dependencies=[Depends(auth)])
    def summary(req: BusinessSummaryRequest, t: Tasks = Depends(get_tasks)):
        return run(lambda: t.business_summary(req))

    return app


app = create_app()
