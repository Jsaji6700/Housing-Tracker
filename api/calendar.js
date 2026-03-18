// api/calendar.js — economic calendar with actuals from FRED

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate');

  const isNext = req.query.week === 'next';
  const ffFile = isNext ? 'nextweek' : 'thisweek';

  // ── Try ForexFactory with multiple approaches ────────────────────────────
  const FF_ATTEMPTS = [
    // Attempt 1: standard FF headers
    {
      url: `https://nfs.faireconomy.media/ff_calendar_${ffFile}.json?version=1`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.forexfactory.com/calendar',
        'Origin': 'https://www.forexfactory.com',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'cross-site',
      }
    },
    // Attempt 2: no version param
    {
      url: `https://nfs.faireconomy.media/ff_calendar_${ffFile}.json`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://www.forexfactory.com/',
      }
    },
    // Attempt 3: via corsproxy (free CORS proxy as last resort)
    {
      url: `https://corsproxy.io/?${encodeURIComponent(`https://nfs.faireconomy.media/ff_calendar_${ffFile}.json`)}`,
      headers: { 'Accept': 'application/json' }
    },
    // Attempt 4: allorigins proxy
    {
      url: `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://nfs.faireconomy.media/ff_calendar_${ffFile}.json`)}`,
      headers: { 'Accept': 'application/json' }
    },
  ];

  for (const attempt of FF_ATTEMPTS) {
    try {
      const r = await fetch(attempt.url, {
        headers: attempt.headers,
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      if (!Array.isArray(data) || data.length === 0) continue;
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
    } catch { continue; }
  }

  // ── Build schedule ────────────────────────────────────────────────────────
  const now = new Date();
  const dow = now.getUTCDay();
  const daysToMon = dow === 0 ? -6 : 1 - dow;
  const baseMon = new Date(now);
  baseMon.setUTCDate(now.getUTCDate() + daysToMon + (isNext ? 7 : 0));
  baseMon.setUTCHours(0, 0, 0, 0);

  const todayStr = new Date(now.getTime() - 5*3600000).toISOString().split('T')[0];
  const etHour   = new Date(now.getTime() - 5*3600000).getUTCHours();

  function dayStr(off) {
    const d = new Date(baseMon);
    d.setUTCDate(baseMon.getUTCDate() + off);
    return d.toISOString().split('T')[0];
  }

  // ── FRED actuals ──────────────────────────────────────────────────────────
  const FRED_KEY = process.env.FRED_API_KEY || '';
  const A = {}; // actuals map

  if (FRED_KEY) {
    // Fetch each series — use correct limit for calculation type
    const SERIES = [
      // Series that FRED returns as already-computed rates (no math needed)
      { id:'A191RL1Q225SBEA', key:'gdp',      lim:1,  fmt: v => v.toFixed(1)+'%'  }, // Real GDP QoQ %
      { id:'UNRATE',          key:'unrate',   lim:1,  fmt: v => v.toFixed(1)+'%'  }, // Unemployment rate %
      { id:'UMCSENT',         key:'umcsent',  lim:1,  fmt: v => v.toFixed(1)       }, // UoM sentiment index
      // Weekly — show raw level formatted
      { id:'ICSA',            key:'claims',   lim:1,  fmt: v => Math.round(v/1000)+'K' }, // Initial claims
      // Monthly index series — calculate m/m % change (need 2 obs)
      { id:'CPILFESL',        key:'core_cpi', lim:2,  fmt:(v,p)=> p ? ((v-p)/p*100).toFixed(2)+'%' : '' },
      // CPIAUCSL_PC1 = CPI y/y % change series (pre-calculated by FRED, no math needed)
      { id:'CPIAUCSL_PC1',     key:'cpi',      lim:1,  fmt:(v)=> v.toFixed(1)+'%' },
      { id:'PPIACO',          key:'ppi',      lim:2,  fmt:(v,p)=> p ? ((v-p)/p*100).toFixed(2)+'%' : '' },
      { id:'PPIFIS',          key:'core_ppi', lim:2,  fmt:(v,p)=> p ? ((v-p)/p*100).toFixed(2)+'%' : '' },
      { id:'PCEPILFE',        key:'core_pce', lim:2,  fmt:(v,p)=> p ? ((v-p)/p*100).toFixed(2)+'%' : '' },
    ];

    await Promise.allSettled(SERIES.map(async ({ id, key, lim, fmt }) => {
      try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED_KEY}&sort_order=desc&limit=${lim}&file_type=json`;
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const j = await r.json();
        const obs = (j.observations||[]).filter(o => o.value !== '.' && o.value !== '' && !isNaN(parseFloat(o.value)));
        if (!obs.length) return;

        const latestDate = obs[0].date;
        const ageDays = (now - new Date(latestDate)) / 86400000;

        // Weekly series (claims): must be within 10 days
        // Monthly series: within 50 days (monthly data releases ~3-4 weeks after period)
        // Quarterly (GDP): within 100 days
        const maxAge = id === 'ICSA' ? 10 : id.includes('RL1Q') ? 100 : 60;
        if (ageDays > maxAge) return;

        const cur  = parseFloat(obs[0].value);
        const prev = obs.length > 1 ? parseFloat(obs[1].value) : null;
        const display = fmt(cur, prev, obs);
        if (display) A[key] = display;
      } catch {}
    }));
  }

  // Only show actual if event is in the past AND past 10am ET (enough time for release)
  function act(key, dateStr) {
    if (dateStr > todayStr) return '';                          // future
    if (dateStr === todayStr && etHour < 10) return '';         // today but too early
    return A[key] || '';
  }

  const events = [
    { date:dayStr(0), time:'10:00am ET', currency:'USD', impact:'Medium', title:'ISM Manufacturing PMI',    forecast:'49.5', previous:'50.3',  actual: act('', dayStr(0)) },
    { date:dayStr(0), time:'10:00am ET', currency:'USD', impact:'Medium', title:'Construction Spending m/m',forecast:'0.3%', previous:'0.5%',  actual: act('', dayStr(0)) },
    { date:dayStr(1), time:'8:30am ET',  currency:'USD', impact:'High',   title:'Core CPI m/m',             forecast:'0.3%', previous:'0.4%',  actual: act('core_cpi', dayStr(1)) },
    { date:dayStr(1), time:'8:30am ET',  currency:'USD', impact:'High',   title:'CPI y/y',                  forecast:'3.1%', previous:'3.2%',  actual: act('cpi',      dayStr(1)) },
    { date:dayStr(1), time:'9:30am ET',  currency:'CAD', impact:'High',   title:'CPI m/m',                  forecast:'0.6%', previous:'0.1%',  actual: '' },
    { date:dayStr(2), time:'8:30am ET',  currency:'USD', impact:'High',   title:'PPI m/m',                  forecast:'0.3%', previous:'0.4%',  actual: act('ppi',      dayStr(2)) },
    { date:dayStr(2), time:'8:30am ET',  currency:'USD', impact:'Medium', title:'Core PPI m/m',             forecast:'0.2%', previous:'0.3%',  actual: act('core_ppi', dayStr(2)) },
    { date:dayStr(2), time:'9:30am ET',  currency:'CAD', impact:'High',   title:'Core CPI m/m',             forecast:'0.4%', previous:'0.4%',  actual: '' },
    { date:dayStr(2), time:'2:00pm ET',  currency:'USD', impact:'High',   title:'FOMC Meeting Minutes',     forecast:'',     previous:'',      actual: '' },
    { date:dayStr(3), time:'8:30am ET',  currency:'USD', impact:'High',   title:'Unemployment Claims',      forecast:'220K', previous:'218K',  actual: act('claims',   dayStr(3)) },
    { date:dayStr(3), time:'8:30am ET',  currency:'USD', impact:'Medium', title:'Building Permits',         forecast:'1.45M',previous:'1.47M', actual: '' },
    { date:dayStr(3), time:'10:00am ET', currency:'USD', impact:'Medium', title:'Existing Home Sales',      forecast:'3.9M', previous:'4.0M',  actual: '' },
    { date:dayStr(3), time:'9:30am ET',  currency:'CAD', impact:'Medium', title:'Retail Sales m/m',         forecast:'0.4%', previous:'2.5%',  actual: '' },
    { date:dayStr(3), time:'1:00pm ET',  currency:'USD', impact:'High',   title:'FOMC Member Speech',       forecast:'',     previous:'',      actual: '' },
    { date:dayStr(4), time:'8:30am ET',  currency:'USD', impact:'High',   title:'Core PCE Price Index m/m', forecast:'0.3%', previous:'0.3%',  actual: act('core_pce', dayStr(4)) },
    { date:dayStr(4), time:'8:30am ET',  currency:'USD', impact:'High',   title:'GDP q/q',                  forecast:'2.3%', previous:'3.1%',  actual: act('gdp',      dayStr(4)) },
    { date:dayStr(4), time:'9:45am ET',  currency:'USD', impact:'Medium', title:'Flash Manufacturing PMI',  forecast:'52.0', previous:'52.7',  actual: '' },
    { date:dayStr(4), time:'10:00am ET', currency:'USD', impact:'Medium', title:'UoM Consumer Sentiment',   forecast:'63.0', previous:'64.7',  actual: act('umcsent',  dayStr(4)) },
    { date:dayStr(4), time:'9:30am ET',  currency:'CAD', impact:'High',   title:'GDP m/m',                  forecast:'0.2%', previous:'0.2%',  actual: '' },
    { date:dayStr(4), time:'9:30am ET',  currency:'CAD', impact:'Medium', title:'Employment Change',        forecast:'15.0K',previous:'76.0K', actual: '' },
  ].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  return res.status(200).json({ events, count: events.length, source: 'estimated' });
}
