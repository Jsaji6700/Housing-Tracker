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
    // National Debt (billions)
    fredFetch('GFDEBTN').then(d => { if(d) results.us_debt_b = d; }),
    // Federal Revenue (billions, annual)
    fredFetch('FYFR').then(d => { if(d) results.us_revenue_b = d; }),
    // Federal Outlays/Spending (billions, annual)
    fredFetch('FYOFD').then(d => { if(d) results.us_spending_b = d; }),
    // GDP nominal (billions)
    fredFetch('GDP').then(d => { if(d) results.us_gdp_b = d; }),
    // Population
    fredFetch('POP').then(d => { if(d) results.us_pop_m = d; }),
    // Medicare + Medicaid spending (billions)
    fredFetch('MEDICAID').then(d => { if(d) results.us_medicaid_b = d; }),
    // Social Security outlays (billions)
    fredFetch('FYOFSSS').then(d => { if(d) results.us_ss_b = d; }),
    // Federal debt held by public (billions)
    fredFetch('FYGFDPUN').then(d => { if(d) results.us_debt_public_b = d; }),
    // Interest on debt (billions)
    fredFetch('FYOINT').then(d => { if(d) results.us_interest_b = d; }),
    // Unemployment (millions)
    fredFetch('UNEMPLOY').then(d => { if(d) results.us_unemployed_m = d; }),
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

  // US
  if (results.us_debt_b) {
    const debtB = results.us_debt_b.value;
    out.us.debt_total     = debtB * 1e9;                          // raw dollars
    out.us.debt_date      = results.us_debt_b.date;
    out.us.debt_per_sec   = (debtB * 1e9) / (365.25 * 24 * 3600); // $ added per second (rough)
  }
  if (results.us_gdp_b) {
    out.us.gdp            = results.us_gdp_b.value * 1e9;
    out.us.debt_to_gdp    = results.us_debt_b ? ((results.us_debt_b.value / results.us_gdp_b.value) * 100).toFixed(1) : null;
  }
  if (results.us_pop_m) {
    const pop = results.us_pop_m.value * 1000; // thousands → actual
    out.us.population     = pop;
    out.us.debt_per_citizen = results.us_debt_b ? Math.round(results.us_debt_b.value * 1e9 / pop) : null;
  }
  if (results.us_spending_b) out.us.spending   = results.us_spending_b.value * 1e9;
  if (results.us_revenue_b)  out.us.revenue    = results.us_revenue_b.value  * 1e9;
  if (results.us_spending_b && results.us_revenue_b) {
    out.us.deficit = (results.us_spending_b.value - results.us_revenue_b.value) * 1e9;
    out.us.deficit_per_sec = out.us.deficit / (365.25 * 24 * 3600);
  }
  if (results.us_ss_b)       out.us.social_security = results.us_ss_b.value * 1e9;
  if (results.us_medicaid_b) out.us.medicaid        = results.us_medicaid_b.value * 1e9;
  if (results.us_interest_b) out.us.interest        = results.us_interest_b.value * 1e9;
  // Unfunded liabilities estimate (SS + Medicare future obligations — standard ~$175T estimate)
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
