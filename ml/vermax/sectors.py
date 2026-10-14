"""Sector for stocks NSE leaves unclassified (outside the Nifty Total Market list).

NSE's own sector names (the "Industry" column of its index lists) are the reference. For the rest the Yahoo Finance
industry is mapped onto the same names, so every stock lands in one of NSE's sectors. Sources, cheapest first:
the company / fundamentals caches, then yfinance `info` (cached in data/cache/sector-map.json for 90 days; a failed
lookup is retried after 7 days).
"""
from __future__ import annotations
import json
import time
from datetime import datetime, timedelta, timezone
from . import config

CACHE = config.ROOT / "data" / "cache" / "sector-map.json"
TTL_OK, TTL_FAIL = timedelta(days=90), timedelta(days=7)

# Yahoo industry (substring, lower case) -> NSE sector; first match wins
INDUSTRY = [
    (("bank", "credit services", "capital markets", "asset management", "insurance", "financial", "mortgage", "shell companies"), "Financial Services"),
    (("software", "information technology", "computer", "electronic gaming", "semiconductor", "communication equipment", "scientific & technical"), "Information Technology"),
    (("drug", "pharma", "biotech", "medical", "health", "diagnostics"), "Healthcare"),
    (("auto", "recreational vehicles", "farm & heavy construction machinery"), "Automobile and Auto Components"),
    (("steel", "aluminum", "copper", "industrial metals", "precious metals", "mining", "gold", "silver", "coking coal"), "Metals & Mining"),
    (("oil", "gas", "thermal coal", "refining"), "Oil Gas & Consumable Fuels"),
    (("utilities", "solar", "renewable"), "Power"),
    (("chemical", "agricultural inputs", "specialty chemicals"), "Chemicals"),
    (("building materials", "cement"), "Construction Materials"),
    (("engineering & construction", "infrastructure operations"), "Construction"),
    (("real estate",), "Realty"),
    (("telecom",), "Telecommunication"),
    (("entertainment", "broadcasting", "publishing", "advertising", "internet content"), "Media Entertainment & Publication"),
    (("textile", "apparel", "footwear"), "Textiles"),
    (("packaged foods", "beverages", "household & personal", "tobacco", "farm products", "confectioners", "food distribution", "grocery", "personal products"), "Fast Moving Consumer Goods"),
    (("furnishings", "appliances", "home improvement", "luxury goods", "electronics", "leisure"), "Consumer Durables"),
    (("restaurants", "lodging", "resorts", "travel", "retail", "education", "personal services", "gambling"), "Consumer Services"),
    (("paper", "lumber", "forest"), "Forest Materials"),
    (("aerospace", "defense", "machinery", "electrical equipment", "industrial distribution", "tools", "metal fabrication", "pollution", "security & protection", "conglomerates"), "Capital Goods"),
    (("freight", "logistics", "shipping", "airlines", "airports", "railroads", "trucking", "staffing", "consulting", "rental", "waste management", "specialty business", "packaging"), "Services"),
]
SECTOR = {
    "Financial Services": "Financial Services", "Technology": "Information Technology", "Healthcare": "Healthcare",
    "Energy": "Oil Gas & Consumable Fuels", "Utilities": "Power", "Real Estate": "Realty", "Communication Services": "Telecommunication",
    "Consumer Defensive": "Fast Moving Consumer Goods", "Consumer Cyclical": "Consumer Durables", "Basic Materials": "Chemicals",
    "Industrials": "Capital Goods",
}


def to_nse(yahoo_sector: str | None, yahoo_industry: str | None) -> str | None:
    ind = (yahoo_industry or "").lower()
    for keys, sector in INDUSTRY:
        if ind and any(k in ind for k in keys):
            return sector
    return SECTOR.get(yahoo_sector or "")


def _cached_yahoo(symbol: str) -> tuple[str | None, str | None] | None:
    for p, get in ((config.ROOT / "data" / "company" / f"{symbol}.json", lambda d: d.get("statements") or {}),
                   (config.ROOT / "data" / "fundamentals" / f"{symbol}.json", lambda d: d)):
        if p.exists():
            try:
                d = get(json.loads(p.read_text()))
            except (ValueError, OSError):
                continue
            ind = d.get("yahooIndustry") or d.get("industry")
            if d.get("yahooSector") or ind:
                return d.get("yahooSector"), ind
    return None


def sector_map(symbols: list[str], fetch: bool = True, budget_s: float = 1500) -> dict:
    """{symbol: {sector, industry, source}} for the given symbols; sector is None when nothing is known."""
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    now = datetime.now(timezone.utc)
    t0 = time.time()
    out, fetched = {}, 0
    for s in symbols:
        hit = _cached_yahoo(s)
        if hit:
            out[s] = {"sector": to_nse(*hit), "industry": hit[1], "source": "yahoo"}
            continue
        c = cache.get(s)
        fresh = c and now - datetime.fromisoformat(c["fetchedAt"]) < (TTL_OK if c.get("industry") or c.get("yahooSector") else TTL_FAIL)
        if not fresh and fetch and time.time() - t0 < budget_s:
            import yfinance as yf
            try:
                info = yf.Ticker(f"{s}.NS").info or {}
            except Exception:  # noqa: BLE001
                info = {}
            c = {"yahooSector": info.get("sector"), "industry": info.get("industry"), "fetchedAt": now.isoformat()}
            cache[s] = c
            fetched += 1
            if fetched % 25 == 0:
                CACHE.write_text(json.dumps(cache))
            time.sleep(0.2)
        if c:
            out[s] = {"sector": to_nse(c.get("yahooSector"), c.get("industry")), "industry": c.get("industry"), "source": "yahoo"}
        else:
            out[s] = {"sector": None, "industry": None, "source": None}
    if fetched:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(cache))
    return {"map": out, "fetched": fetched}
