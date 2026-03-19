// api/debt.js — Live debt clock data from FRED + US Treasury + Canada PBO

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const FRED_KEY = process.env.FRED_API_KEY || '';
  const results = {};

  const fredFetch = async (id) => {
    const r = await fetch(
      `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED_KEY}&sort_order=desc&limit=2&file_type=json`,
      { signal: AbortSignal.timeout(6000) }
    );
    const j = await r.json();
    const obs = (j.observations||[]).filter(o => o.value !== '.' && o.value !== '');
    return obs.length ? { value: parseFloat(obs[0].value), prev: parseFloat(obs[1]?.value), date: obs[0].date } : null;
  };

  // ── US Data ───────────────────────────────────────────────────────────────
  await Promise.allSettled([
    // National Debt — GFDEBTN is in MILLIONS of dollars
    fredFetch('GFDEBTN').then(d => { if(d) results.us_debt_m = d; }),
    // Federal Revenue — FYFR is in MILLIONS of dollars
    fredFetch('FYFR').then(d => { if(d) results.us_revenue_m = d; }),
    // Federal Outlays — FYOFD is in MILLIONS of dollars
    fredFetch('FYOFD').then(d => { if(d) results.us_spending_m = d; }),
    // GDP nominal — GDP is in BILLIONS of dollars (quarterly annualized)
    fredFetch('GDP').then(d => { if(d) results.us_gdp_b = d; }),
    // Population — POP is in THOUSANDS
    fredFetch('POP').then(d => { if(d) results.us_pop_k = d; }),
    // Social Security outlays — FYOFSSS in MILLIONS
    fredFetch('FYOFSSS').then(d => { if(d) results.us_ss_m = d; }),
    // Interest on debt — FYOINT in MILLIONS
    fredFetch('FYOINT').then(d => { if(d) results.us_interest_m = d; }),
  ]);

  // ── Canada Data (StatsCan + FRED) ─────────────────────────────────────────
  await Promise.allSettled([
    // Canada GDP (billions CAD) — FRED
    fredFetch('NGDPRSAXDCCAQ').then(d => { if(d) results.ca_gdp_b = d; }),
    // Canada population (millions)
    fredFetch('POPTTLCAA647NWDB').then(d => { if(d) results.ca_pop_m = d; }),
  ]);

  // Canada federal debt from StatsCan
  try {
    const scR = await fetch(
      'https://www150.statcan.gc.ca/t1/tbl1/en/dtbl/json/getDataFromVectorsAndLatestNPeriods',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { vectorId: 1530814, latestN: 2 },  // Federal net debt (millions CAD)
          { vectorId: 3820818, latestN: 2 },  // Federal revenue (millions CAD)
          { vectorId: 3820819, latestN: 2 },  // Federal spending (millions CAD)
        ]),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (scR.ok) {
      const scJ = await scR.json();
      const arr = Array.isArray(scJ) ? scJ : [];
      const parse = (obj) => {
        const pts = (obj?.vectorDataPoint||[]).sort((a,b)=>(a.refPer||'').localeCompare(b.refPer||''));
        return pts.length ? { value: parseFloat(pts[pts.length-1].value), date: pts[pts.length-1].refPer } : null;
      };
      if (arr[0]) results.ca_debt_m    = parse(arr[0]);
      if (arr[1]) results.ca_revenue_m = parse(arr[1]);
      if (arr[2]) results.ca_spending_m= parse(arr[2]);
    }
  } catch { /* optional */ }

  // ── Compute derived metrics ───────────────────────────────────────────────
  const out = { us: {}, ca: {}, ts: Date.now() };

  // US — GFDEBTN/FYFR/FYOFD are in MILLIONS, GDP in BILLIONS, POP in THOUSANDS
  if (results.us_debt_m) {
    out.us.debt_total   = results.us_debt_m.value * 1e6;  // millions → dollars
    out.us.debt_date    = results.us_debt_m.date;
    // US adds ~$2T/year to debt = ~$63,000/sec
    const annualDebtGrowth = results.us_spending_m && results.us_revenue_m
      ? (results.us_spending_m.value - results.us_revenue_m.value) * 1e6
      : 2e12;
    out.us.debt_per_sec = annualDebtGrowth / (365.25 * 24 * 3600);
  }
  if (results.us_gdp_b) {
    out.us.gdp = results.us_gdp_b.value * 1e9;
    out.us.debt_to_gdp = results.us_debt_m
      ? ((results.us_debt_m.value * 1e6) / (results.us_gdp_b.value * 1e9) * 100).toFixed(1)
      : null;
  }
  if (results.us_pop_k) {
    const pop = results.us_pop_k.value * 1000; // thousands → actual
    out.us.population       = pop;
    out.us.debt_per_citizen = results.us_debt_m
      ? Math.round(results.us_debt_m.value * 1e6 / pop)
      : null;
  }
  if (results.us_spending_m) out.us.spending = results.us_spending_m.value * 1e6;
  if (results.us_revenue_m)  out.us.revenue  = results.us_revenue_m.value  * 1e6;
  if (results.us_spending_m && results.us_revenue_m) {
    out.us.deficit = (results.us_spending_m.value - results.us_revenue_m.value) * 1e6;
    out.us.deficit_per_sec = out.us.deficit / (365.25 * 24 * 3600);
  }
  if (results.us_ss_m)       out.us.social_security = results.us_ss_m.value * 1e6;
  if (results.us_interest_m) out.us.interest        = results.us_interest_m.value * 1e6;
  out.us.unfunded_est = 175e12;

  // Canada
  if (results.ca_debt_m) {
    out.ca.debt_total   = results.ca_debt_m.value * 1e6; // millions → dollars
    out.ca.debt_date    = results.ca_debt_m.date;
    out.ca.debt_per_sec = out.ca.debt_total / (365.25 * 24 * 3600);
  }
  if (results.ca_gdp_b) {
    out.ca.gdp = results.ca_gdp_b.value * 1e9;
    out.ca.debt_to_gdp = results.ca_debt_m
      ? ((results.ca_debt_m.value * 1e6) / (results.ca_gdp_b.value * 1e9) * 100).toFixed(1)
      : null;
  }
  if (results.ca_pop_m) {
    const pop = results.ca_pop_m.value * 1e6;
    out.ca.population       = pop;
    out.ca.debt_per_citizen = results.ca_debt_m ? Math.round(results.ca_debt_m.value * 1e6 / pop) : null;
  }
  if (results.ca_spending_m) out.ca.spending = results.ca_spending_m.value * 1e6;
  if (results.ca_revenue_m)  out.ca.revenue  = results.ca_revenue_m.value  * 1e6;
  if (results.ca_spending_m && results.ca_revenue_m) {
    out.ca.deficit = (results.ca_spending_m.value - results.ca_revenue_m.value) * 1e6;
    out.ca.deficit_per_sec = out.ca.deficit / (365.25 * 24 * 3600);
  }

  return res.status(200).json(out);
}
