"""Thematic sector buckets. Defence + Engineering are the user's priority themes."""
from __future__ import annotations

# Pure/near-pure defence & aerospace names (NSE symbols).
DEFENCE = {
    "HAL", "BEL", "BDL", "MAZDOCK", "COCHINSHIP", "GRSE", "SOLARINDS", "DATAPATTNS",
    "ASTRAMICRO", "BEML", "MTARTECH", "PARAS", "ZENTEC", "MIDHANI", "APOLLO", "DCXINDIA",
    "IDEAFORGE", "AVANTEL", "HBLENGINE", "BHARATFORG", "PREMEXPLN", "UNIMECH", "CENTUM",
    "AZAD", "NIBE", "TANAA", "ROSSELLIND", "HBLPOWER", "AXISCADES",
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
# Added 2026-10-01: AI / data-centre infrastructure builders and suppliers, EPC & infrastructure contractors,
# power / cables / electrical equipment and industrial engineering - all counted as "Engineering".
ENGINEERING_MANUAL |= {
    # AI / data-centre infra: servers & cloud, networking, builders, cooling, power backup
    "NETWEB", "E2E", "ANANTRAJ", "TECHNOE", "STLTECH", "STLNETWORK", "TEJASNET", "HFCL", "AVALON", "VOLTAS", "BLUESTARCO",
    "KAYNES", "SYRMA", "CYIENTDLM", "EXICOM", "HAVELLS", "GENUSPOWER", "RIR", "QPOWER", "MARINE", "SHILCTECH", "SALZERELEC",
    # power transmission, cables, transformers, renewables equipment
    "GVT&D", "TARIL", "DIACABS", "DYCL", "FINCABLES", "PRECWIRE", "JTLIND", "ELECTCAST", "WAAREEENER", "PREMIERENE", "INOXGREEN", "TRITURBINE",
    # EPC and infrastructure contractors
    "GRINFRA", "DBL", "AFCONS", "JKIL", "AHLUCONT", "CAPACITE", "PSPPROJECT", "HCC", "MANINFRA", "AGIIL", "EIEL", "BLEL",
    # industrial engineering, pumps, pipes, bearings, forgings
    "LLOYDSENGG", "JASH", "SETL", "OMNI", "KMEW", "RATNAVEER", "MANINDS", "VENUSPIPES", "SHAKTIPUMP", "DYNAMATECH", "AEROFLEX",
    "SKFINDUS", "NRBBEARING", "KSB", "LMW", "APLAPOLLO", "RATNAMANI", "INOXINDIA", "BALUFORGE", "UNIPARTS", "TEGA",
}
# Sub-theme tags shown on picks.
DATACENTRE_AI = {
    "NETWEB", "E2E", "ANANTRAJ", "TECHNOE", "STLTECH", "STLNETWORK", "TEJASNET", "HFCL", "AVALON", "VOLTAS", "BLUESTARCO", "KAYNES", "SYRMA",
    "CYIENTDLM", "EXICOM", "SCHNEIDER", "SIEMENS", "ABB", "POWERINDIA", "GVT&D", "LT", "KEC", "KALPATPOWR", "POLYCAB", "KEI", "FINCABLES",
    "HAVELLS", "CGPOWER", "DIACABS", "DYCL", "QPOWER", "RIR", "TDPOWERSYS", "GENUSPOWER", "DIXON", "RAILTEL",
}


def subtheme(symbol: str) -> str | None:
    return "AI / Data-centre infra" if symbol in DATACENTRE_AI else None


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
