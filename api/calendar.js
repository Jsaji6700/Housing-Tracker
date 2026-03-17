// api/calendar.js
// Builds this/next week calendar with FRED actuals for past events

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate');

  const isNext = req.query.week === 'next';

  // ── Try ForexFactory first ────────────────────────────────────────────────
  const ffFile = isNext ? 'nextweek' : 'thisweek';
  try {
    const r = await fetch(`https://nfs.faireconomy.media/ff_calendar_${ffFile}.json?version=1`, {
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
            date: e.date||'', time: e.time||'All Day',
            currency: e.currency, impact: e.impact,
            title: e.title||'', forecast: e.forecast||'',
            previous: e.previous||'', actual: e.actual||'',
          }));
        if (filtered.length > 0) {
          return res.status(200).json({ events: filtered, count: filtered.length, source: 'forexfactory.com' });
        }
      }
    }
  } catch { /* fall through */ }

  // ── Build week schedule ───────────────────────────────────────────────────
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

  // Today in ET (UTC-5)
  const todayStr = new Date(now.getTime() - 5*3600000).toISOString().split('T')[0];

  // ── Fetch FRED actuals ────────────────────────────────────────────────────
  // Each series: id, how to format the value for display
  const FRED_KEY = process.env.FRED_API_KEY || '';
  const fredVals = {};

  if (FRED_KEY) {
    // Series mapped to event keys with display format
    // format: 'pct' = already a %, 'level_k' = divide by 1000 + K, 'index' = show as-is, 'mom_pct' = need to calc from index
    const SERIES = [
      // US
      { id:'CPILFESL',        key:'core_cpi_mom',   fmt:'mom_pct' },   // Core CPI index → m/m %
      { id:'CPIAUCSL',        key:'cpi_yoy',         fmt:'yoy_pct' },   // CPI index → y/y %
      { id:'PPIACO',          key:'ppi_mom',         fmt:'mom_pct' },   // PPI index → m/m %
      { id:'PPIFIS',          key:'core_ppi_mom',    fmt:'mom_pct' },   // Core PPI → m/m %
      { id:'ICSA',            key:'claims',           fmt:'level_k' },   // Initial claims (weekly level)
      { id:'PERMIT',          key:'permits',          fmt:'level_m' },   // Building permits (thousands → M)
      { id:'EXHOSLUSM495S',   key:'exist_homes',     fmt:'level_m' },   // Existing home sales (M)
      { id:'PCEPILFE',        key:'core_pce_mom',    fmt:'mom_pct' },   // Core PCE → m/m %
      { id:'A191RL1Q225SBEA', key:'gdp',             fmt:'pct' },       // Real GDP growth rate (already %)
      { id:'UMCSENT',         key:'umcsent',          fmt:'index' },     // UoM Sentiment (index)
      { id:'UNRATE',          key:'unrate',           fmt:'pct' },       // Unemployment rate
      { id:'ISRATIO',         key:'ism_mfg',          fmt:'index' },     // ISM proxy
    ];

    await Promise.allSettled(SERIES.map(async ({ id, key, fmt }) => {
      try {
        // For m/m and y/y calcs we need more observations
        const limit = fmt === 'yoy_pct' ? 14 : 3;
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED_KEY}&sort_order=desc&limit=${limit}&file_type=json`;
        const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
        const j = await r.json();
        const obs = (j.observations || []).filter(o => o.value !== '.' && o.value !== '');
        if (!obs.length) return;

        const latest = parseFloat(obs[0].value);
        const latestDate = obs[0].date;

        // Don't use stale data (> 60 days old for monthly, > 14 days for weekly)
        const agedays = (now - new Date(latestDate)) / 86400000;
        const maxAge = fmt === 'level_k' ? 14 : 60;
        if (agedays > maxAge) return;

        let display = '';
        if (fmt === 'pct') {
          display = latest.toFixed(1) + '%';
        } else if (fmt === 'index') {
          display = latest.toFixed(1);
        } else if (fmt === 'level_k') {
          display = Math.round(latest / 1000) + 'K';
        } else if (fmt === 'level_m') {
          display = (latest / 1000).toFixed(2) + 'M';
        } else if (fmt === 'mom_pct' && obs.length >= 2) {
          const prev = parseFloat(obs[1].value);
          if (prev && prev !== 0) {
            display = ((latest - prev) / prev * 100).toFixed(1) + '%';
          }
        } else if (fmt === 'yoy_pct' && obs.length >= 13) {
          const yr_ago = parseFloat(obs[12].value);
          if (yr_ago && yr_ago !== 0) {
            display = ((latest - yr_ago) / yr_ago * 100).toFixed(1) + '%';
          }
        }

        if (display) fredVals[key] = display;
      } catch { /* skip */ }
    }));
  }

  // Only return actual if event date is strictly before today (already released)
  function act(key, dateStr) {
    if (dateStr >= todayStr) return '';
    return fredVals[key] || '';
  }

  // For today's events — show actual if it's past 9am ET (most morning releases done)
  const etHour = new Date(now.getTime() - 5*3600000).getUTCHours();
  function actToday(key, dateStr) {
    if (dateStr > todayStr) return '';
    if (dateStr === todayStr && etHour < 9) return ''; // too early
    return fredVals[key] || '';
  }

  const events = [
    // Monday
    { date:dayStr(0), time:'10:00am ET', currency:'USD', impact:'Medium', title:'ISM Manufacturing PMI',    forecast:'49.5', previous:'50.3',  actual: actToday('ism_mfg',      dayStr(0)) },
    { date:dayStr(0), time:'10:00am ET', currency:'USD', impact:'Medium', title:'Construction Spending m/m',forecast:'0.3%', previous:'0.5%',  actual: act('',                  dayStr(0)) },
    // Tuesday
    { date:dayStr(1), time:'8:30am ET',  currency:'USD', impact:'High',   title:'Core CPI m/m',             forecast:'0.3%', previous:'0.4%',  actual: actToday('core_cpi_mom', dayStr(1)) },
    { date:dayStr(1), time:'8:30am ET',  currency:'USD', impact:'High',   title:'CPI y/y',                  forecast:'3.1%', previous:'3.2%',  actual: actToday('cpi_yoy',      dayStr(1)) },
    { date:dayStr(1), time:'9:30am ET',  currency:'CAD', impact:'High',   title:'CPI m/m',                  forecast:'0.6%', previous:'0.1%',  actual: '' },
    // Wednesday
    { date:dayStr(2), time:'8:30am ET',  currency:'USD', impact:'High',   title:'PPI m/m',                  forecast:'0.3%', previous:'0.4%',  actual: actToday('ppi_mom',      dayStr(2)) },
    { date:dayStr(2), time:'8:30am ET',  currency:'USD', impact:'Medium', title:'Core PPI m/m',             forecast:'0.2%', previous:'0.3%',  actual: actToday('core_ppi_mom', dayStr(2)) },
    { date:dayStr(2), time:'9:30am ET',  currency:'CAD', impact:'High',   title:'Core CPI m/m',             forecast:'0.4%', previous:'0.4%',  actual: '' },
    { date:dayStr(2), time:'2:00pm ET',  currency:'USD', impact:'High',   title:'FOMC Meeting Minutes',     forecast:'',     previous:'',      actual: '' },
    // Thursday
    { date:dayStr(3), time:'8:30am ET',  currency:'USD', impact:'High',   title:'Unemployment Claims',      forecast:'220K', previous:'218K',  actual: actToday('claims',       dayStr(3)) },
    { date:dayStr(3), time:'8:30am ET',  currency:'USD', impact:'Medium', title:'Building Permits',         forecast:'1.45M',previous:'1.47M', actual: actToday('permits',      dayStr(3)) },
    { date:dayStr(3), time:'10:00am ET', currency:'USD', impact:'Medium', title:'Existing Home Sales',      forecast:'3.9M', previous:'4.0M',  actual: actToday('exist_homes',  dayStr(3)) },
    { date:dayStr(3), time:'9:30am ET',  currency:'CAD', impact:'Medium', title:'Retail Sales m/m',         forecast:'0.4%', previous:'2.5%',  actual: '' },
    { date:dayStr(3), time:'1:00pm ET',  currency:'USD', impact:'High',   title:'FOMC Member Speech',       forecast:'',     previous:'',      actual: '' },
    // Friday
    { date:dayStr(4), time:'8:30am ET',  currency:'USD', impact:'High',   title:'Core PCE Price Index m/m', forecast:'0.3%', previous:'0.3%',  actual: actToday('core_pce_mom', dayStr(4)) },
    { date:dayStr(4), time:'8:30am ET',  currency:'USD', impact:'High',   title:'GDP q/q',                  forecast:'2.3%', previous:'3.1%',  actual: actToday('gdp',          dayStr(4)) },
    { date:dayStr(4), time:'9:45am ET',  currency:'USD', impact:'Medium', title:'Flash Manufacturing PMI',  forecast:'52.0', previous:'52.7',  actual: '' },
    { date:dayStr(4), time:'10:00am ET', currency:'USD', impact:'Medium', title:'UoM Consumer Sentiment',   forecast:'63.0', previous:'64.7',  actual: actToday('umcsent',      dayStr(4)) },
    { date:dayStr(4), time:'9:30am ET',  currency:'CAD', impact:'High',   title:'GDP m/m',                  forecast:'0.2%', previous:'0.2%',  actual: '' },
    { date:dayStr(4), time:'9:30am ET',  currency:'CAD', impact:'Medium', title:'Employment Change',        forecast:'15.0K',previous:'76.0K', actual: '' },
  ].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  return res.status(200).json({ events, count: events.length, source: 'estimated' });
}
