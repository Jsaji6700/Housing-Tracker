// api/metals.js — gold, silver, platinum + S&P500, DJI
// Always returns best available data, never blocks on one failure

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const FRED_KEY = process.env.FRED_API_KEY || '';
  const out = {
    gold:     { price: 0, open: null, source: 'none' },
    silver:   { price: 0, open: null, source: 'none' },
    platinum: { price: 0, open: null, source: 'none' },
    sp500:    { price: 0, open: null, source: 'none' },
    dji:      { price: 0, open: null, source: 'none' },
  };

  // ── Fetch metals + equities all in parallel ──────────────────────────────
  const YAHOO_SYMBOLS = {
    gold:     'GC%3DF',
    silver:   'SI%3DF',
    platinum: 'PL%3DF',
    sp500:    '%5EGSPC',
    dji:      '%5EDJI',
  };

  const SANITY = {
    gold:     [3000, 8000],
    silver:   [40,   200],
    platinum: [500,  4000],
    sp500:    [1000, 20000],
    dji:      [10000, 80000],
  };

  // Yahoo Finance — fetch all in parallel
  await Promise.allSettled(
    Object.entries(YAHOO_SYMBOLS).map(async ([key, sym]) => {
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2d`,
          { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
            signal: AbortSignal.timeout(7000) }
        );
        if (!r.ok) throw new Error(`Yahoo ${sym}: ${r.status}`);
        const j = await r.json();
        const meta = j?.chart?.result?.[0]?.meta;
        if (!meta?.regularMarketPrice) throw new Error('no price');
        const price = meta.regularMarketPrice;
        const open  = meta.chartPreviousClose || meta.previousClose || null;
        const [min, max] = SANITY[key];
        if (price < min || price > max) throw new Error(`sanity fail: ${price} not in [${min},${max}]`);
        out[key] = { price, open, source: 'yahoo' };
      } catch { /* keep zero, try fallback below */ }
    })
  );

  // ── Fallback for metals that Yahoo missed ────────────────────────────────

  // metals.live — free, no key
  if (!out.gold.price || !out.silver.price) {
    try {
      const r = await fetch('https://api.metals.live/v1/spot', { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const j = await r.json();
        if (!out.gold.price && j?.gold > 3000 && j.gold < 8000) {
          out.gold = { price: Math.round(j.gold), open: null, source: 'metals.live' };
        }
        if (!out.silver.price && j?.silver > 40 && j.silver < 200) {
          out.silver = { price: parseFloat(j.silver.toFixed(2)), open: null, source: 'metals.live' };
        }
        if (!out.platinum.price && j?.platinum > 500) {
          out.platinum = { price: Math.round(j.platinum), open: null, source: 'metals.live' };
        }
      }
    } catch { /* skip */ }
  }

  // goldprice.org — fallback for gold/silver
  if (!out.gold.price || !out.silver.price) {
    try {
      const r = await fetch('https://data-asg.goldprice.org/dbXRates/USD', { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const j = await r.json();
        const item = j?.items?.[0];
        if (!out.gold.price && item?.xauPrice > 3000) {
          out.gold = { price: Math.round(item.xauPrice), open: item.xauOpen || null, source: 'goldprice.org' };
        }
        if (!out.silver.price && item?.xagPrice > 40) {
          out.silver = { price: parseFloat(item.xagPrice.toFixed(2)), open: item.xagOpen || null, source: 'goldprice.org' };
        }
      }
    } catch { /* skip */ }
  }

  // FRED — last resort for gold/silver (monthly, but better than nothing)
  if (FRED_KEY && (!out.gold.price || !out.silver.price)) {
    try {
      const [gR, sR] = await Promise.all([
        fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=GOLDPMGBD228NLBM&api_key=${FRED_KEY}&sort_order=desc&limit=1&file_type=json`, { signal: AbortSignal.timeout(5000) }),
        fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=SLVPRUSD&api_key=${FRED_KEY}&sort_order=desc&limit=1&file_type=json`, { signal: AbortSignal.timeout(5000) }),
      ]);
      const gj = await gR.json();
      const sj = await sR.json();
      const gp = parseFloat(gj?.observations?.[0]?.value);
      const sp = parseFloat(sj?.observations?.[0]?.value);
      if (!out.gold.price   && gp > 3000) out.gold   = { price: Math.round(gp), open: null, source: 'FRED' };
      if (!out.silver.price && sp > 40)   out.silver = { price: parseFloat(sp.toFixed(2)), open: null, source: 'FRED' };
    } catch { /* skip */ }
  }

  // Always return 200 with whatever we have
  return res.status(200).json(out);
}
