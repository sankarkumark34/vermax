"""Thematic sector buckets. Defence + Engineering are the user's priority themes."""
from __future__ import annotations

# Pure/near-pure defence & aerospace names (NSE symbols).
DEFENCE = {
    "HAL", "BEL", "BDL", "MAZDOCK", "COCHINSHIP", "GRSE", "SOLARINDS", "DATAPATTNS",
    "ASTRAMICRO", "BEML", "MTARTECH", "PARAS", "ZENTEC", "MIDHANI", "APOLLO", "DCXINDIA",
    "IDEAFORGE", "AVANTEL", "HBLENGINE", "BHARATFORG", "PREMEXPLN", "UNIMECH", "CENTUM",
    "AZAD", "NIBE", "TANAA", "ROSSELLIND",
}
# Engineering: capital goods / EPC / electricals / industrial machinery / rail & infra equipment.
ENGINEERING_MANUAL = {
    "LT", "SIEMENS", "ABB", "CUMMINSIND", "THERMAX", "KEC", "KALPATPOWR", "BHEL", "TITAGARH",
    "JWL", "RVNL", "IRCON", "KIRLOSENG", "GRINDWELL", "TIMKEN", "SCHAEFFLER", "AIAENG",
    "ELGIEQUIP", "HONAUT", "GMMPFAUDLR", "POWERINDIA",
    "TRIVENI", "KIRLOSBROS", "ISGEC", "PRAJIND", "SKFINDIA", "CARBORUNIV",
    "ENGINERSIN", "TEXRAIL", "RITES", "NBCC", "IRB", "HGINFRA", "PNCINFRA", "NCC",
    "KNRCON", "ASHOKA", "GPIL", "APARINDS", "POLYCAB", "KEI", "CGPOWER", "SUZLON",
    "INOXWIND", "VOLTAMP", "TDPOWERSYS", "TRANSRAILL", "BEML", "RAILTEL", "SALASAR",
    "ESABINDIA", "GRAPHITE", "WABAG", "PATELENG", "JYOTICNC", "MTARTECH", "DIXON",
}
ENGINEERING_SECTORS = {"Capital Goods", "Construction"}

DEFENCE_LABEL = "Defence"
ENGINEERING_LABEL = "Engineering"


def assign_sector(symbol: str, db_sector: str | None) -> str:
    if symbol in DEFENCE:
        return DEFENCE_LABEL
    if symbol in ENGINEERING_MANUAL or (db_sector in ENGINEERING_SECTORS):
        return ENGINEERING_LABEL
    if not db_sector or db_sector == "Unclassified":
        return "Other"
    return db_sector


def is_priority_theme(sector: str) -> bool:
    return sector in (DEFENCE_LABEL, ENGINEERING_LABEL)
