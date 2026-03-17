// api/calendar.js — Vercel serverless function
// This week + next week — USD + CAD high/medium events
// Actuals only shown for past events where FRED data is reliable

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate');

  const isNext = req.query.week === 'next';

  // ── Try ForexFactory ──────────────────────────────────────────────────────
  const ffWeek = isNext ? 'nextweek' : 'thisweek';
  try {
    const r = await fetch(`https://nfs.faireconomy.media/ff_calendar_${ffWeek}.json?version=1`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, */*',
        'Referer': 'https://www.forexfactory.com/',
        'Origin': 'https://www.forexfactory.com',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) {
        const filtered = data
          .filter(e => ['USD','CAD'].includes(e.currency) && ['High','Medium'].includes(e.impact))
          .map(e => ({
            date: e.date || '', time: e.time || 'All Day',
            currency: e.currency, impact: e.impact,
            title: e.title || '', forecast: e.forecast || '',
            previous: e.previous || '', actual: e.actual || '',
          }));
        if (filtered.length > 0) {
          return res.status(200).json({ events: filtered, count: filtered.length, source: 'forexfactory.com' });
        }
      }
    }
  } catch { /* fall through */ }

  // ── Fallback schedule ─────────────────────────────────────────────────────
  const now = new Date();
  const dow = now.getUTCDay();
  const daysToMon = dow === 0 ? -6 : 1 - dow;
  const baseMon = new Date(now);
  baseMon.setUTCDate(now.getUTCDate() + daysToMon + (isNext ? 7 : 0));
  baseMon.setUTCHours(0, 0, 0, 0);

  function dayStr(offset) {
    const d = new Date(baseMon);
    d.setUTCDate(baseMon.getUTCDate() + offset);
    return d.toISOString().split('T')[0];
  }

  // Today in ET
  const etNow = new Date(now.getTime() - 5 * 3600000);
  const todayStr = etNow.toISOString().split('T')[0];

  // ── FRED actuals — only for known reliable series with correct formatting ──
  const FRED_KEY = process.env.FRED_API_KEY || '';
  const actuals = {};

  if (FRED_KEY) {
    // Series that return the % change directly (already a rate, not index)
    const directPct = [
      { id: 'UNRATE',        key: 'unrate' },       // Unemployment rate %
      { id: 'A191RL1Q225SBEA', key: 'gdp' },        // Real GDP growth rate % (quarterly)
      { id: 'UMCSENT',       key: 'umcsent' },      // UoM sentiment (index level, show as-is)
    ];

    // Series where we calculate m/m % change
    const momSeries = [
      { id: 'ICSA', key: 'claims', fmt: 'level' },  // Weekly claims — show as ###K
    ];

    await Promise.allSettled([
      ...directPct.map(async ({ id, key }) => {
        try {
          const r = await fetch(
            `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED_KEY}&sort_order=desc&limit=1&file_type=json`,
            { signal: AbortSignal.timeout(5000) }
          );
          const j = await r.json();
          const obs = j.observations?.filter(o => o.value !== '.');
          if (!obs?.length) return;
          const val = parseFloat(obs[0].value);
          const age = (now - new Date(obs[0].date)) / 86400000;
          if (age > 45) return; // skip stale data
          if (key === 'claims') actuals[key] = Math.round(val / 1000) + 'K';
          else if (key === 'umcsent') actuals[key] = val.toFixed(1);
          else actuals[key] = val.toFixed(1) + '%';
        } catch {}
      }),
      ...momSeries.map(async ({ id, key }) => {
        try {
          const r = await fetch(
            `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED_KEY}&sort_order=desc&limit=1&file_type=json`,
            { signal: AbortSignal.timeout(5000) }
          );
          const j = await r.json();
          const obs = j.observations?.filter(o => o.value !== '.');
          if (!obs?.length) return;
          const val = parseFloat(obs[0].value);
          const age = (now - new Date(obs[0].date)) / 86400000;
          if (age > 14) return; // claims are weekly, must be very recent
          actuals[key] = Math.round(val / 1000) + 'K';
        } catch {}
      }),
    ]);
  }

  function act(key, dateStr) {
    // Only show actual if event date is strictly before today
    if (!key || dateStr >= todayStr) return '';
    return actuals[key] || '';
  }

  const events = [
    { date:dayStr(0), time:'10:00am ET', currency:'USD', impact:'Medium', title:'ISM Manufacturing PMI',    forecast:'49.5', previous:'50.3',  actual:'' },
    { date:dayStr(0), time:'10:00am ET', currency:'USD', impact:'Medium', title:'Construction Spending m/m',forecast:'0.3%', previous:'0.5%',  actual:'' },
    { date:dayStr(1), time:'8:30am ET',  currency:'USD', impact:'High',   title:'Core CPI m/m',             forecast:'0.3%', previous:'0.4%',  actual:'' },
    { date:dayStr(1), time:'8:30am ET',  currency:'USD', impact:'High',   title:'CPI y/y',                  forecast:'3.1%', previous:'3.2%',  actual:'' },
    { date:dayStr(1), time:'9:30am ET',  currency:'CAD', impact:'High',   title:'CPI m/m',                  forecast:'0.6%', previous:'0.1%',  actual:'' },
    { date:dayStr(2), time:'8:30am ET',  currency:'USD', impact:'High',   title:'PPI m/m',                  forecast:'0.3%', previous:'0.4%',  actual:'' },
    { date:dayStr(2), time:'8:30am ET',  currency:'USD', impact:'Medium', title:'Core PPI m/m',             forecast:'0.2%', previous:'0.3%',  actual:'' },
    { date:dayStr(2), time:'9:30am ET',  currency:'CAD', impact:'High',   title:'Core CPI m/m',             forecast:'0.4%', previous:'0.4%',  actual:'' },
    { date:dayStr(2), time:'2:00pm ET',  currency:'USD', impact:'High',   title:'FOMC Meeting Minutes',     forecast:'',     previous:'',      actual:'' },
    { date:dayStr(3), time:'8:30am ET',  currency:'USD', impact:'High',   title:'Unemployment Claims',      forecast:'220K', previous:'218K',  actual: act('claims', dayStr(3)) },
    { date:dayStr(3), time:'8:30am ET',  currency:'USD', impact:'Medium', title:'Building Permits',         forecast:'1.45M',previous:'1.47M', actual:'' },
    { date:dayStr(3), time:'10:00am ET', currency:'USD', impact:'Medium', title:'Existing Home Sales',      forecast:'3.9M', previous:'4.0M',  actual:'' },
    { date:dayStr(3), time:'9:30am ET',  currency:'CAD', impact:'Medium', title:'Retail Sales m/m',         forecast:'0.4%', previous:'2.5%',  actual:'' },
    { date:dayStr(3), time:'1:00pm ET',  currency:'USD', impact:'High',   title:'FOMC Member Speech',       forecast:'',     previous:'',      actual:'' },
    { date:dayStr(4), time:'8:30am ET',  currency:'USD', impact:'High',   title:'Core PCE Price Index m/m', forecast:'0.3%', previous:'0.3%',  actual:'' },
    { date:dayStr(4), time:'8:30am ET',  currency:'USD', impact:'High',   title:'GDP q/q',                  forecast:'2.3%', previous:'3.1%',  actual: act('gdp', dayStr(4)) },
    { date:dayStr(4), time:'9:45am ET',  currency:'USD', impact:'Medium', title:'Flash Manufacturing PMI',  forecast:'52.0', previous:'52.7',  actual:'' },
    { date:dayStr(4), time:'10:00am ET', currency:'USD', impact:'Medium', title:'UoM Consumer Sentiment',   forecast:'63.0', previous:'64.7',  actual: act('umcsent', dayStr(4)) },
    { date:dayStr(4), time:'9:30am ET',  currency:'CAD', impact:'High',   title:'GDP m/m',                  forecast:'0.2%', previous:'0.2%',  actual:'' },
    { date:dayStr(4), time:'9:30am ET',  currency:'CAD', impact:'Medium', title:'Employment Change',        forecast:'15.0K',previous:'76.0K', actual:'' },
  ].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  return res.status(200).json({ events, count: events.length, source: 'estimated' });
}
