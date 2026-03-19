// api/debt.js — National Debt Clock data
// Always returns data: FRED when available, hardcoded current values as fallback

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const FRED_KEY = process.env.FRED_API_KEY || '';

  // ── Hardcoded fallback values (updated March 2026) ───────────────────────
  // These are used when FRED API is unavailable
  const FALLBACK = {
    us: {
      debt_total:      36_500_000_000_000,  // $36.5T (Mar 2026)
      gdp:             29_300_000_000_000,  // $29.3T GDP
      population:         335_000_000,      // 335M
      revenue:          4_900_000_000_000,  // $4.9T annual
      spending:         6_700_000_000_000,  // $6.7T annual
      deficit:          1_800_000_000_000,  // $1.8T annual
      interest:           900_000_000_000,  // $900B annual
      social_security:  1_400_000_000_000,  // $1.4T annual
      debt_to_gdp:      '124.6',
      debt_per_citizen:  108955,
      unfunded_est:   175_000_000_000_000,  // ~$175T
      debt_date:        '2026-01-31',
      source:           'fallback',
    },
    ca: {
      debt_total:      1_400_000_000_000,   // ~C$1.4T federal debt
      gdp:             2_800_000_000_000,   // ~C$2.8T GDP
      population:          40_000_000,      // 40M
      revenue:           500_000_000_000,   // ~C$500B
      spending:          550_000_000_000,   // ~C$550B
      deficit:            50_000_000_000,   // ~C$50B
      interest:           55_000_000_000,   // ~C$55B
      social_security:   120_000_000_000,   // OAS+CPP ~C$120B
      debt_to_gdp:       '50.0',
      debt_per_citizen:   35000,
      unfunded_est:    3_200_000_000_000,   // ~C$3.2T
      debt_date:         '2025-12-31',
      source:            'fallback',
    },
  };

  const out = { us: { ...FALLBACK.us }, ca: { ...FALLBACK.ca }, ts: Date.now() };

  // ── Try FRED for live US data ─────────────────────────────────────────────
  if (FRED_KEY) {
    try {
      const fredFetch = async (id, lim) => {
        lim = lim || 2;
        const r = await fetch(
          `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED_KEY}&sort_order=desc&limit=${lim}&file_type=json`,
          { signal: AbortSignal.timeout(5000) }
        );
        const j = await r.json();
        const obs = (j.observations || []).filter(o => o.value !== '.' && o.value !== '');
        return obs.length ? { value: parseFloat(obs[0].value), date: obs[0].date } : null;
      };

      const [debt, gdp, pop, rev, spend, ss, interest] = await Promise.all([
        fredFetch('GFDEBTN'),       // millions
        fredFetch('GDP'),           // billions
        fredFetch('POP'),           // thousands
        fredFetch('FYFR'),          // millions
        fredFetch('FYOFD'),         // millions
        fredFetch('FYOFSSS'),       // millions
        fredFetch('FYOINT'),        // millions
      ]);

      if (debt?.value > 1000) {
        out.us.debt_total      = debt.value * 1e6;
        out.us.debt_date       = debt.date;
        out.us.source          = 'FRED';
      }
      if (gdp?.value > 1000)    out.us.gdp             = gdp.value * 1e9;
      if (pop?.value > 1000)    out.us.population      = pop.value * 1000;
      if (rev?.value > 100)     out.us.revenue         = rev.value * 1e6;
      if (spend?.value > 100)   out.us.spending        = spend.value * 1e6;
      if (ss?.value > 1)        out.us.social_security = ss.value * 1e6;
      if (interest?.value > 1)  out.us.interest        = interest.value * 1e6;

      // Recalculate derived
      if (out.us.spending && out.us.revenue) {
        out.us.deficit = out.us.spending - out.us.revenue;
      }
      if (out.us.debt_total && out.us.gdp) {
        out.us.debt_to_gdp = (out.us.debt_total / out.us.gdp * 100).toFixed(1);
      }
      if (out.us.debt_total && out.us.population) {
        out.us.debt_per_citizen = Math.round(out.us.debt_total / out.us.population);
      }
    } catch { /* keep fallback */ }

    // ── Try StatsCan for Canada ─────────────────────────────────────────────
    try {
      const scR = await fetch(
        'https://www150.statcan.gc.ca/t1/tbl1/en/dtbl/json/getDataFromVectorsAndLatestNPeriods',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([
            { vectorId: 1530814, latestN: 2 },
            { vectorId: 3820818, latestN: 2 },
            { vectorId: 3820819, latestN: 2 },
          ]),
          signal: AbortSignal.timeout(8000),
        }
      );
      if (scR.ok) {
        const scJ = await scR.json();
        const arr = Array.isArray(scJ) ? scJ : [];
        const parse = obj => {
          const pts = (obj?.vectorDataPoint || []).sort((a, b) => (a.refPer || '').localeCompare(b.refPer || ''));
          return pts.length ? { value: parseFloat(pts[pts.length - 1].value), date: pts[pts.length - 1].refPer } : null;
        };
        const [caDebt, caRev, caSpend] = arr.map(parse);
        if (caDebt?.value  > 1)   { out.ca.debt_total = caDebt.value  * 1e6; out.ca.debt_date = caDebt.date; out.ca.source = 'StatsCan'; }
        if (caRev?.value   > 1)     out.ca.revenue    = caRev.value   * 1e6;
        if (caSpend?.value > 1)     out.ca.spending   = caSpend.value * 1e6;
        if (out.ca.spending && out.ca.revenue) out.ca.deficit = out.ca.spending - out.ca.revenue;
        if (out.ca.debt_total && out.ca.gdp)   out.ca.debt_to_gdp = (out.ca.debt_total / out.ca.gdp * 100).toFixed(1);
        if (out.ca.debt_total && out.ca.population) out.ca.debt_per_citizen = Math.round(out.ca.debt_total / out.ca.population);
      }
    } catch { /* keep fallback */ }
  }

  // Always set deficit per sec and debt per sec
  out.us.debt_per_sec    = (out.us.deficit    || 1_800_000_000_000) / (365.25 * 86400);
  out.us.deficit_per_sec = (out.us.deficit    || 1_800_000_000_000) / (365.25 * 86400);
  out.us.interest_per_sec= (out.us.interest   || 900_000_000_000)   / (365.25 * 86400);
  out.us.spending_per_sec= (out.us.spending   || 6_700_000_000_000) / (365.25 * 86400);

  out.ca.debt_per_sec    = (out.ca.deficit    || 50_000_000_000)    / (365.25 * 86400);
  out.ca.deficit_per_sec = (out.ca.deficit    || 50_000_000_000)    / (365.25 * 86400);
  out.ca.interest_per_sec= (out.ca.interest   || 55_000_000_000)    / (365.25 * 86400);
  out.ca.spending_per_sec= (out.ca.spending   || 550_000_000_000)   / (365.25 * 86400);

  return res.status(200).json(out);
}
