// api/metals.js — gold, silver, platinum spot prices
// Uses FRED (already works for this app) + Yahoo Finance as backup

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const FRED_KEY = process.env.FRED_API_KEY || '';

  // ── Source 1: Yahoo Finance (no key, reliable server-side) ───────────────
  try {
    const symbols = { gold: 'GC%3DF', silver: 'SI%3DF', platinum: 'PL%3DF', sp500: '%5EGSPC', dji: '%5EDJI' };
    const results = await Promise.allSettled(
      Object.entries(symbols).map(async ([name, sym]) => {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2d`,
          { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
            signal: AbortSignal.timeout(6000) }
        );
        if (!r.ok) throw new Error(`Yahoo ${sym} failed`);
        const j = await r.json();
        const meta = j?.chart?.result?.[0]?.meta;
        if (!meta?.regularMarketPrice) throw new Error('no price');
        return { name, price: meta.regularMarketPrice, open: meta.chartPreviousClose || meta.previousClose };
      })
    );

    const data = {};
    results.forEach(r => { if (r.status === 'fulfilled') data[r.value.name] = r.value; });

    if (data.gold?.price && data.gold.price > 3000 && data.gold.price < 8000) {
      return res.status(200).json({
        gold:     { price: Math.round(data.gold.price),                                open: data.gold.open     || null, currency: 'USD', source: 'yahoo' },
        silver:   { price: (data.silver && data.silver.price > 40 && data.silver.price < 150) ? parseFloat(data.silver.price.toFixed(2)) : 0, open: data.silver?.open || null, currency: 'USD', source: 'yahoo' },
        platinum: { price: data.platinum ? Math.round(data.platinum.price)             : 0, open: data.platinum?.open || null, currency: 'USD', source: 'yahoo' },
        sp500:    { price: data.sp500    ? Math.round(data.sp500.price)                : 0, open: data.sp500?.open    || null, source: 'yahoo' },
        dji:      { price: data.dji      ? Math.round(data.dji.price)                  : 0, open: data.dji?.open      || null, source: 'yahoo' },
      });
    }
  } catch { /* try next */ }

  // ── Source 2: FRED (XAU series — monthly, but better than nothing) ───────
  if (FRED_KEY) {
    try {
      const [goldR, silverR] = await Promise.all([
        fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=GOLDPMGBD228NLBM&api_key=${FRED_KEY}&sort_order=desc&limit=1&file_type=json`,
          { signal: AbortSignal.timeout(5000) }),
        fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=SLVPRUSD&api_key=${FRED_KEY}&sort_order=desc&limit=1&file_type=json`,
          { signal: AbortSignal.timeout(5000) }),
      ]);
      const gj = await goldR.json();
      const sj = await silverR.json();
      const gPrice = parseFloat(gj?.observations?.[0]?.value);
      const sPrice = parseFloat(sj?.observations?.[0]?.value);
      if (gPrice && gPrice > 500) {
        return res.status(200).json({
          gold:     { price: Math.round(gPrice),              open: null, currency: 'USD', source: 'FRED' },
          silver:   { price: sPrice ? parseFloat(sPrice.toFixed(2)) : 0, open: null, currency: 'USD', source: 'FRED' },
          platinum: { price: 0, currency: 'USD', source: 'FRED' },
        });
      }
    } catch { /* try next */ }
  }

  // ── Source 3: metals.live ─────────────────────────────────────────────────
  try {
    const r = await fetch('https://api.metals.live/v1/spot', { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const j = await r.json();
      if (j?.gold && j.gold > 3000 && j.gold < 8000) {
        // Also fetch equities separately since metals.live doesn't have them
        const eq = { sp500: { price: 0 }, dji: { price: 0 } };
        try {
          const [spR, djR] = await Promise.all([
            fetch('https://query2.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=2d', { signal: AbortSignal.timeout(4000) }),
            fetch('https://query2.finance.yahoo.com/v8/finance/chart/%5EDJI?interval=1d&range=2d',  { signal: AbortSignal.timeout(4000) }),
          ]);
          const spJ = await spR.json();
          const djJ = await djR.json();
          const spMeta = spJ?.chart?.result?.[0]?.meta;
          const djMeta = djJ?.chart?.result?.[0]?.meta;
          if (spMeta?.regularMarketPrice) eq.sp500 = { price: spMeta.regularMarketPrice, open: spMeta.chartPreviousClose };
          if (djMeta?.regularMarketPrice) eq.dji   = { price: djMeta.regularMarketPrice, open: djMeta.chartPreviousClose };
        } catch {}
        return res.status(200).json({
          gold:     { price: Math.round(j.gold),                     open: null, currency: 'USD', source: 'metals.live' },
          silver:   { price: parseFloat((j.silver || 0).toFixed(2)), open: null, currency: 'USD', source: 'metals.live' },
          platinum: { price: Math.round(j.platinum || 0),            open: null, currency: 'USD', source: 'metals.live' },
          sp500:    eq.sp500,
          dji:      eq.dji,
        });
      }
    }
  } catch { /* all failed */ }

  return res.status(500).json({ error: 'All metal price sources failed' });
}
