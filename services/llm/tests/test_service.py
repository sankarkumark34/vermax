"""Guardrail and API tests with a stubbed LLM (no network, no API key)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.clients.llm_client import LlmError
from app.guardrails.grounding import citation_check, numeric_grounding
from app.main import create_app
from app.schemas.models import AnnouncementClass, BusinessSummaryOut, VerdictExplanation
from app.services.tasks import Cache, Tasks

FACTS = {"symbol": "ACE", "verdict": "WAIT", "totalScore": 91.1, "coverage": 1, "watch": {"alertPrice": 1196, "zone": "support zone ₹1189-1196"},
         "entry": {"entry": 1252.2, "stop": 1178.55, "rewardRisk": 1.77}}


def test_grounding_accepts_input_numbers_in_any_format():
    ok, bad = numeric_grounding("Score 91.1, watch ₹1,196, reward to risk 1:1.77, stop 1178.55", FACTS)
    assert ok, bad


def test_grounding_rejects_invented_numbers():
    ok, bad = numeric_grounding("The stock could rise 35% to ₹1,700", FACTS)
    assert not ok
    assert "35" in bad and "1,700" in bad


def test_citation_check():
    src = "The company   manufactures cranes and tractors.\nExports are 5% of sales."
    assert citation_check(["manufactures cranes and tractors"], src)
    assert not citation_check(["makes aircraft"], src)


class FakeLlm:
    model = "fake-model"

    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = 0

    def structured(self, system, user, schema, effort="low", max_tokens=4000):
        self.calls += 1
        out = self.outputs.pop(0)
        assert isinstance(out, schema)
        return out


def make(tmp_path, outputs):
    llm = FakeLlm(outputs)
    return TestClient(create_app(Tasks(llm=llm, cache=Cache(tmp_path)))), llm


def test_explain_grounded_and_cached(tmp_path):
    good = VerdictExplanation(headline="ACE is WAIT with a score of 91.1.", why=["Entry trigger not confirmed; reward to risk 1:1.77."], what_would_change_it="A bullish candle near ₹1196.")
    c, llm = make(tmp_path, [good])
    r = c.post("/v1/explain-verdict", json={"facts": FACTS})
    assert r.status_code == 200 and r.json()["grounded"]
    assert c.post("/v1/explain-verdict", json={"facts": FACTS}).status_code == 200
    assert llm.calls == 1   # second call served from cache


def test_explain_rejects_hallucinated_figures_after_one_retry(tmp_path):
    bad = VerdictExplanation(headline="ACE could gain 40%.", why=["Target ₹1,800."], what_would_change_it="n/a")
    c, llm = make(tmp_path, [bad, bad])
    r = c.post("/v1/explain-verdict", json={"facts": FACTS})
    assert r.status_code == 502 and "grounding" in r.json()["detail"]
    assert llm.calls == 2


def test_classify_returns_suggested(tmp_path):
    out = AnnouncementClass(category="accounting", severity=3, is_red_flag=True, is_catalyst=False, keywords=["auditor", "resignation"], rationale="'statutory auditor has resigned'")
    c, _ = make(tmp_path, [out])
    r = c.post("/v1/classify-announcement", json={"symbol": "X", "date": "2026-09-01", "category": "Resignation", "text": "The statutory auditor has resigned."})
    assert r.status_code == 200
    assert r.json()["status"] == "suggested" and r.json()["severity"] == 3


def test_business_summary_checks_citations(tmp_path):
    out = BusinessSummaryOut(summary="Makes cranes.", segments=["Cranes"], revenue_model="Equipment sales", concentration_notes="not disclosed", source_quotes=["makes pick-and-carry cranes"])
    c, _ = make(tmp_path, [out])
    r = c.post("/v1/business-summary", json={"symbol": "ACE", "text": "ACE makes pick-and-carry cranes and tractors."})
    assert r.json()["citationsValid"] is True


def test_llm_error_maps_to_502(tmp_path):
    class Boom(FakeLlm):
        def structured(self, *a, **k):
            raise LlmError("model declined (cyber)")
    c = TestClient(create_app(Tasks(llm=Boom([]), cache=Cache(tmp_path))))
    assert c.post("/v1/classify-announcement", json={"symbol": "X", "date": "d", "text": "t"}).status_code == 502
