// api/metals.js — Gold, Silver, Platinum + S&P500, DJI
// Always returns data: live from Yahoo Finance, fallback to hardcoded current values

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  // ── Hardcoded fallbacks (March 2026 current values) ──────────────────────
  const FALLBACK = {
    gold:     { price: 5020,   open: 4998,  source: 'fallback' },
    silver:   { price: 79.50,  open: 80.10, source: 'fallback' },
    platinum: { price: 2130,   open: 2115,  source: 'fallback' },
    sp500:    { price: 6720,   open: 6680,  source: 'fallback' },
    dji:      { price: 47100,  open: 46900, source: 'fallback' },
  };

  const out = {
    gold:     { ...FALLBACK.gold },
    silver:   { ...FALLBACK.silver },
    platinum: { ...FALLBACK.platinum },
    sp500:    { ...FALLBACK.sp500 },
    dji:      { ...FALLBACK.dji },
  };

  const SANITY = {
    gold:     [3000, 8000],
    silver:   [40,   200],
    platinum: [500,  5000],
    sp500:    [2000, 20000],
    dji:      [15000, 80000],
  };

  const SYMBOLS = {
    gold:     'GC%3DF',
    silver:   'SI%3DF',
    platinum: 'PL%3DF',
    sp500:    '%5EGSPC',
    dji:      '%5EDJI',
  };

  // ── Try Yahoo Finance for all assets in parallel ──────────────────────────
  await Promise.allSettled(
    Object.entries(SYMBOLS).map(async ([key, sym]) => {
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2d`,
          {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/json' },
            signal: AbortSignal.timeout(6000),
          }
        );
        if (!r.ok) throw new Error(`${r.status}`);
        const j = await r.json();
        const meta = j?.chart?.result?.[0]?.meta;
        if (!meta?.regularMarketPrice) throw new Error('no price');
        const price = meta.regularMarketPrice;
        const open  = meta.chartPreviousClose || meta.previousClose || null;
        const [min, max] = SANITY[key];
        if (price < min || price > max) throw new Error(`sanity: ${price}`);
        out[key] = { price, open, source: 'yahoo' };
      } catch { /* keep fallback */ }
    })
  );

  // ── If gold/silver still on fallback, try metals.live ────────────────────
  if (out.gold.source === 'fallback' || out.silver.source === 'fallback') {
    try {
      const r = await fetch('https://api.metals.live/v1/spot', { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const j = await r.json();
        if (j?.gold   > 3000 && j.gold   < 8000)  out.gold     = { price: Math.round(j.gold),                    open: null, source: 'metals.live' };
        if (j?.silver > 40   && j.silver < 200)   out.silver   = { price: parseFloat(j.silver.toFixed(2)),       open: null, source: 'metals.live' };
        if (j?.platinum > 500)                     out.platinum = { price: Math.round(j.platinum),                open: null, source: 'metals.live' };
      }
    } catch { /* keep fallback */ }
  }

  // ── If gold/silver still on fallback, try goldprice.org ─────────────────
  if (out.gold.source === 'fallback' || out.silver.source === 'fallback') {
    try {
      const r = await fetch('https://data-asg.goldprice.org/dbXRates/USD', { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const j = await r.json();
        const item = j?.items?.[0];
        if (item?.xauPrice > 3000) out.gold   = { price: Math.round(item.xauPrice),              open: item.xauOpen || null, source: 'goldprice.org' };
        if (item?.xagPrice > 40)   out.silver = { price: parseFloat(item.xagPrice.toFixed(2)),   open: item.xagOpen || null, source: 'goldprice.org' };
      }
    } catch { /* keep fallback */ }
  }

  // Always 200 — worst case returns fallback values
  return res.status(200).json(out);
}
