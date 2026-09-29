"""One-off: seed Vermax's market DB from the legacy NSE Picks sqlite (read-only)."""
import sqlite3, sys, os
src = sys.argv[1]; dst = sys.argv[2]
if os.path.exists(dst): os.remove(dst)
s = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
d = sqlite3.connect(dst)
s.backup(d)
s.close()
for t in ("predictions", "backtest_runs", "market_snapshots", "ingest_logs"):
    d.execute(f"DROP TABLE IF EXISTS {t}")
d.commit()
d.execute("VACUUM")
d.close()
print("seeded", dst, os.path.getsize(dst) // 1_000_000, "MB")
