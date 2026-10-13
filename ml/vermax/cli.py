"""JSON CLI used by the NestJS backend:  python -m vermax.cli <command> [json-args]

Every command prints exactly one JSON document on the last stdout line.
"""
from __future__ import annotations
import json
import sys
import warnings

warnings.filterwarnings("ignore")


def main(argv: list[str]) -> None:
    cmd = argv[0] if argv else "help"
    args = json.loads(argv[1]) if len(argv) > 1 else {}
    if cmd == "train":
        from .production import train
        out = train(**args)
    elif cmd == "score":
        from .production import score
        out = score(**args)
        out = {"path": out["_path"], "asOf": out["asOf"], "picks": len(out["picks"]), "regime": out["regime"]["label"]}
    elif cmd == "track":
        from .production import track
        out = track(args["items"])
    elif cmd == "ipos":
        from .screener import ipos
        from . import config
        out = ipos(**args)
        dest = config.OUT_DIR.parent / "screener"
        dest.mkdir(parents=True, exist_ok=True)
        path = dest / f"ipos-{out['asOf']}.json"
        path.write_text(json.dumps(out))
        out = {"path": str(path), "asOf": out["asOf"], "count": out["count"]}
    elif cmd == "trusted":
        from .trusted import trusted
        from . import config
        out = trusted(**args)
        dest = config.OUT_DIR.parent / "screener"
        dest.mkdir(parents=True, exist_ok=True)
        path = dest / f"trusted-{out['asOf']}.json"
        path.write_text(json.dumps(out, default=str))
        out = {"path": str(path), "asOf": out["asOf"], "scanned": out["scanned"], "count": out["count"]}
    elif cmd == "ipo-quality":
        from .ipo_quality import ipo_quality
        from . import config
        out = ipo_quality(**args)
        dest = config.OUT_DIR.parent / "screener"
        dest.mkdir(parents=True, exist_ok=True)
        path = dest / f"ipo-quality-{out['months']}m-{out['asOf']}.json"
        path.write_text(json.dumps(out, default=str))
        out = {"path": str(path), "asOf": out["asOf"], "count": out["count"]}
    elif cmd == "ipo-study":
        from .ipo_journey import ipo_study
        from . import config
        out = ipo_study()
        dest = config.OUT_DIR.parent / "screener"
        dest.mkdir(parents=True, exist_ok=True)
        path = dest / f"ipo-study-{out['asOf']}.json"
        path.write_text(json.dumps(out, default=str))
        out = {"path": str(path), "asOf": out["asOf"], "count": out["count"]}
    elif cmd == "analyse":
        from .analyse import analyse
        out = analyse(args["symbol"])
    elif cmd == "health":
        from .health import health
        out = health()
    elif cmd == "derivs":
        from .derivs import backfill
        out = backfill(**args)
    elif cmd == "company":
        from .company import company
        out = company(args["symbol"], force=bool(args.get("force")))
    elif cmd == "company-batch":
        from .company import company_batch
        out = company_batch(args["symbols"], force=bool(args.get("force")))
    elif cmd == "sector-medians":
        from .company import sector_medians
        out = sector_medians()
    elif cmd == "surveillance":
        from .company import surveillance
        out = surveillance()
    elif cmd == "fundamentals":
        from .fundamentals import fetch_many
        out = fetch_many(args["symbols"], args.get("sectors"))
    else:
        out = {"commands": ["train", "score", "track", "fundamentals", "ipos", "ipo-quality", "analyse", "ipo-study", "health", "derivs",
                            "company", "company-batch", "sector-medians", "surveillance"]}
    sys.stdout.write("\n" + json.dumps(out, default=str) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
