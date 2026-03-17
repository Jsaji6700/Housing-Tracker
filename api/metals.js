// api/metals.js — live gold, silver, platinum spot prices
// Sources tried in order: metals-api, goldprice.org, metals.live

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  // ── Source 1: goldprice.org (same backend Kitco uses) ──────────────────
  try {
    const r = await fetch('https://data-asg.goldprice.org/dbXRates/USD', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.goldprice.org/',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const j = await r.json();
      const item = j?.items?.[0];
      if (item?.xauPrice && item.xauPrice > 500) {
        return res.status(200).json({
          gold:     { price: Math.round(item.xauPrice),            open: item.xauOpen || null, currency: 'USD', source: 'goldprice.org' },
          silver:   { price: parseFloat(item.xagPrice?.toFixed(2) || 0), open: item.xagOpen || null, currency: 'USD', source: 'goldprice.org' },
          platinum: { price: 0, currency: 'USD', source: 'goldprice.org' },
        });
      }
    }
  } catch { /* try next */ }

  // ── Source 2: metals.live ──────────────────────────────────────────────
  try {
    const r = await fetch('https://api.metals.live/v1/spot', {
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const j = await r.json();
      if (j?.gold && j.gold > 500) {
        return res.status(200).json({
          gold:     { price: Math.round(j.gold),                  open: null, currency: 'USD', source: 'metals.live' },
          silver:   { price: parseFloat(j.silver?.toFixed(2) || 0), open: null, currency: 'USD', source: 'metals.live' },
          platinum: { price: Math.round(j.platinum || 0),         open: null, currency: 'USD', source: 'metals.live' },
        });
      }
    }
  } catch { /* try next */ }

  // ── Source 3: ExchangeRate-API (free, has XAU/XAG) ────────────────────
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/XAU', {
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const j = await r.json();
      // XAU base = 1 troy oz gold. rates.USD = gold price in USD
      const goldPrice = j?.rates?.USD;
      const silverPrice = goldPrice && j?.rates?.XAG ? goldPrice / j.rates.XAG : null;
      if (goldPrice && goldPrice > 500) {
        return res.status(200).json({
          gold:     { price: Math.round(goldPrice),   open: null, currency: 'USD', source: 'er-api.com' },
          silver:   { price: silverPrice ? parseFloat(silverPrice.toFixed(2)) : 0, open: null, currency: 'USD', source: 'er-api.com' },
          platinum: { price: 0, currency: 'USD', source: 'er-api.com' },
        });
      }
    }
  } catch { /* all failed */ }

  return res.status(500).json({ error: 'All metal price sources failed' });
}
