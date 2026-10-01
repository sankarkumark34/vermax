import path from 'node:path';

const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));
const num = (v: string | undefined, d: number) => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Repo root regardless of the cwd the API is started from. */
const repoRoot = path.resolve(process.cwd().endsWith(path.join('apps', 'api')) ? path.join(process.cwd(), '..', '..') : process.cwd());

export interface AppConfig {
  port: number;
  repoRoot: string;
  sqlitePath: string;
  cacheDir: string;
  picksDir: string;
  researchDir: string;
  mlDir: string;
  pythonBin: string;
  requestDelayMs: number;
  userAgent: string;
  scheduler: { enabled: boolean; dailyCron: string; retryCron: string; watchdogCron: string; retrainCron: string; timezone: string };
  picks: { shortlist: number; finalCore: number; finalTheme: number; minPrice: number; maxPrice: number; capital: number; riskPerTrade: number; maxPositionPct: number };
}

export function loadConfig(): AppConfig {
  const e = process.env;
  return {
    port: num(e.PORT, 4100),
    repoRoot,
    sqlitePath: e.VERMAX_DB ?? path.join(repoRoot, 'data', 'market.sqlite'),
    cacheDir: e.DATA_CACHE_DIR ?? path.join(repoRoot, 'data', 'cache'),
    picksDir: path.join(repoRoot, 'data', 'picks'),
    researchDir: path.join(repoRoot, 'data', 'research'),
    mlDir: path.join(repoRoot, 'ml'),
    pythonBin: e.PYTHON_BIN ?? 'python',
    requestDelayMs: num(e.NSE_REQUEST_DELAY_MS, 400),
    userAgent: e.NSE_USER_AGENT ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    scheduler: {
      enabled: bool(e.SCHEDULER_ENABLED, true),
      dailyCron: e.DAILY_CRON ?? '45 18 * * 1-5',
      retryCron: e.RETRY_CRON ?? '30 20 * * 1-5',
      watchdogCron: e.WATCHDOG_CRON ?? '0 21 * * 1-5',
      retrainCron: e.RETRAIN_CRON ?? '0 9 * * 0',
      timezone: e.TZ_NAME ?? 'Asia/Kolkata',
    },
    picks: {
      shortlist: num(e.PICKS_SHORTLIST, 15),
      finalCore: num(e.PICKS_CORE, 5),
      finalTheme: num(e.PICKS_THEME, 5),
      minPrice: num(e.PICKS_MIN_PRICE, 200),
      maxPrice: num(e.PICKS_MAX_PRICE, 650),
      capital: num(e.CAPITAL, 500000),
      riskPerTrade: num(e.RISK_PER_TRADE, 0.005),
      maxPositionPct: num(e.MAX_POSITION_PCT, 0.2),
    },
  };
}
