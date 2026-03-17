// api/metals.js — proxy for gold, silver, platinum spot prices
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

  const sources = [
    // metals.live — free, reliable
    async () => {
      const r = await fetch('https://api.metals.live/v1/spot', { signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error('metals.live failed');
      const j = await r.json();
      if (!j?.gold || j.gold < 500) throw new Error('bad data');
      return {
        gold:     { price: Math.round(j.gold),              currency: 'USD', source: 'metals.live' },
        silver:   { price: parseFloat(j.silver?.toFixed(2)),currency: 'USD', source: 'metals.live' },
        platinum: { price: Math.round(j.platinum || 0),     currency: 'USD', source: 'metals.live' },
      };
    },
    // goldprice.org
    async () => {
      const r = await fetch('https://data-asg.goldprice.org/dbXRates/USD', { signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error('goldprice failed');
      const j = await r.json();
      const item = j?.items?.[0];
      if (!item?.xauPrice || item.xauPrice < 500) throw new Error('bad data');
      return {
        gold:   { price: Math.round(item.xauPrice),          open: item.xauOpen, currency: 'USD', source: 'goldprice.org' },
        silver: { price: parseFloat(item.xagPrice?.toFixed(2)), open: item.xagOpen, currency: 'USD', source: 'goldprice.org' },
        platinum: { price: 0, currency: 'USD', source: 'goldprice.org' },
      };
    },
  ];

  for (const source of sources) {
    try {
      const data = await source();
      return res.status(200).json(data);
    } catch { continue; }
  }

  return res.status(500).json({ error: 'All metal price sources failed' });
}
