/** NSE sector index used as the industry benchmark (step 2); mirrors ml/vermax/analyse.py. */
export const SECTOR_INDEX: Record<string, string> = {
  'Capital Goods': 'Nifty Capital Goods', Engineering: 'Nifty Capital Goods', Defence: 'Nifty India Defence',
  Construction: 'Nifty Construction', 'Information Technology': 'Nifty IT', Healthcare: 'Nifty Healthcare Index',
  'Automobile and Auto Components': 'Nifty Auto', 'Fast Moving Consumer Goods': 'Nifty FMCG',
  'Financial Services': 'Nifty Financial Services', 'Metals & Mining': 'Nifty Metal', 'Oil Gas & Consumable Fuels': 'Nifty Oil & Gas',
  Power: 'Nifty Power', Realty: 'Nifty Realty', 'Consumer Durables': 'Nifty Consumer Durables', Chemicals: 'Nifty Chemicals',
  Telecommunication: 'Nifty Telecommunications', 'Media Entertainment & Publication': 'Nifty Media',
  'Consumer Services': 'Nifty Consumer Services', 'Construction Materials': 'Nifty Cement', Services: 'Nifty Services Sector',
};

export const YAHOO_INDEX: Record<string, string> = {
  Industrials: 'Nifty Capital Goods', Technology: 'Nifty IT', Healthcare: 'Nifty Healthcare Index',
  'Consumer Cyclical': 'Nifty India Consumption', 'Consumer Defensive': 'Nifty FMCG', 'Financial Services': 'Nifty Financial Services',
  'Basic Materials': 'Nifty Commodities', Energy: 'Nifty Energy', Utilities: 'Nifty Power', 'Real Estate': 'Nifty Realty',
  'Communication Services': 'Nifty Media',
};

/** NSE classifies only index constituents; for the rest the Yahoo sector is used (same rule as the sector medians). */
export function effectiveSector(nse: string | null | undefined, yahoo: string | null | undefined): string | null {
  if (nse && nse !== 'Unclassified') return nse;
  return yahoo ?? null;
}

export function sectorIndexName(nse: string | null | undefined, yahoo: string | null | undefined): string | null {
  return (nse && SECTOR_INDEX[nse]) || (yahoo && YAHOO_INDEX[yahoo]) || null;
}
