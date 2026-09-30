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
    elif cmd == "screener":
        from .screener import screen
        from . import config
        out = screen(**args)
        dest = config.OUT_DIR.parent / "screener"
        dest.mkdir(parents=True, exist_ok=True)
        path = dest / f"{out['asOf']}.json"
        path.write_text(json.dumps(out))
        out = {"path": str(path), "asOf": out["asOf"], "count": out["count"]}
    elif cmd == "fundamentals":
        from .fundamentals import fetch_many
        out = fetch_many(args["symbols"], args.get("sectors"))
    else:
        out = {"commands": ["train", "score", "track", "fundamentals"]}
    sys.stdout.write("\n" + json.dumps(out, default=str) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
