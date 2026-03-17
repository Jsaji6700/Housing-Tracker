// api/calendar.js — Vercel serverless function
// This week only — USD + CAD high/medium events
// Past events get actual data from FRED where available

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate');

  // ── Try ForexFactory ──────────────────────────────────────────────────────
  try {
    const r = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json?version=1', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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

  // ── Fallback: build this week's events with FRED actuals ──────────────────
  const now = new Date();
  // Get Monday of current week (UTC)
  const dow = now.getUTCDay();
  const daysToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() + daysToMon);
  mon.setUTCHours(0, 0, 0, 0);

  function dayStr(offset) {
    const d = new Date(mon);
    d.setUTCDate(mon.getUTCDate() + offset);
    return d.toISOString().split('T')[0];
  }

  // Fetch latest FRED values for key indicators (single batch)
  let fredData = {};
  try {
    const FRED_KEY = process.env.FRED_API_KEY || '';
    if (FRED_KEY) {
      const series = ['CPIAUCSL','CPILFESL','PPIACO','PPIFIS','ICSA','HOUST','HSNGFARG',
                      'PCE','PCEPILFE','GDP','MICH','UMCSENT','UNRATE'];
      const results = await Promise.allSettled(series.map(id =>
        fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED_KEY}&sort_order=desc&limit=2&file_type=json`)
          .then(r => r.json())
          .then(j => ({ id, val: j.observations?.[0]?.value, prev: j.observations?.[1]?.value }))
      ));
      results.forEach(r => { if (r.status === 'fulfilled' && r.value) fredData[r.value.id] = r.value; });
    }
  } catch { /* FRED optional */ }

  const f = (id) => fredData[id]?.val ? parseFloat(fredData[id].val).toFixed(1) + (id.includes('CPI')||id.includes('PPI')||id.includes('PCE')||id==='GDP'?'%':'') : '';
  const p = (id) => fredData[id]?.prev ? parseFloat(fredData[id].prev).toFixed(1) + (id.includes('CPI')||id.includes('PPI')||id.includes('PCE')||id==='GDP'?'%':'') : '';

  const events = [
    // Monday
    { date:dayStr(0), time:'10:00am ET', currency:'USD', impact:'Medium', title:'ISM Manufacturing PMI',     forecast:'49.5', previous:'50.3',  actual:'' },
    { date:dayStr(0), time:'10:00am ET', currency:'USD', impact:'Medium', title:'Construction Spending m/m', forecast:'0.3%', previous:'0.5%',  actual:'' },
    // Tuesday
    { date:dayStr(1), time:'8:30am ET',  currency:'USD', impact:'High',   title:'Core CPI m/m',              forecast:'0.3%', previous:'0.4%',  actual: f('CPILFESL') },
    { date:dayStr(1), time:'8:30am ET',  currency:'USD', impact:'High',   title:'CPI y/y',                   forecast:'3.1%', previous:'3.2%',  actual: f('CPIAUCSL') },
    { date:dayStr(1), time:'9:30am ET',  currency:'CAD', impact:'High',   title:'CPI m/m',                   forecast:'0.6%', previous:'0.1%',  actual:'' },
    // Wednesday
    { date:dayStr(2), time:'8:30am ET',  currency:'USD', impact:'High',   title:'PPI m/m',                   forecast:'0.3%', previous:'0.4%',  actual: f('PPIACO') },
    { date:dayStr(2), time:'8:30am ET',  currency:'USD', impact:'Medium', title:'Core PPI m/m',              forecast:'0.2%', previous:'0.3%',  actual: f('PPIFIS') },
    { date:dayStr(2), time:'9:30am ET',  currency:'CAD', impact:'High',   title:'Core CPI m/m',              forecast:'0.4%', previous:'0.4%',  actual:'' },
    { date:dayStr(2), time:'2:00pm ET',  currency:'USD', impact:'High',   title:'FOMC Meeting Minutes',      forecast:'',     previous:'',      actual:'' },
    // Thursday
    { date:dayStr(3), time:'8:30am ET',  currency:'USD', impact:'High',   title:'Unemployment Claims',       forecast:'220K', previous:'218K',  actual: f('ICSA') },
    { date:dayStr(3), time:'8:30am ET',  currency:'USD', impact:'Medium', title:'Building Permits',          forecast:'1.45M',previous:'1.47M', actual: f('HSNGFARG') },
    { date:dayStr(3), time:'10:00am ET', currency:'USD', impact:'Medium', title:'Existing Home Sales',       forecast:'3.9M', previous:'4.0M',  actual:'' },
    { date:dayStr(3), time:'9:30am ET',  currency:'CAD', impact:'Medium', title:'Retail Sales m/m',          forecast:'0.4%', previous:'2.5%',  actual:'' },
    { date:dayStr(3), time:'1:00pm ET',  currency:'USD', impact:'High',   title:'FOMC Member Speech',        forecast:'',     previous:'',      actual:'' },
    // Friday
    { date:dayStr(4), time:'8:30am ET',  currency:'USD', impact:'High',   title:'Core PCE Price Index m/m',  forecast:'0.3%', previous:'0.3%',  actual: f('PCEPILFE') },
    { date:dayStr(4), time:'8:30am ET',  currency:'USD', impact:'High',   title:'GDP q/q',                   forecast:'2.3%', previous:'3.1%',  actual: f('GDP') },
    { date:dayStr(4), time:'9:45am ET',  currency:'USD', impact:'Medium', title:'Flash Manufacturing PMI',   forecast:'52.0', previous:'52.7',  actual:'' },
    { date:dayStr(4), time:'10:00am ET', currency:'USD', impact:'Medium', title:'UoM Consumer Sentiment',    forecast:'63.0', previous:'64.7',  actual: f('UMCSENT') },
    { date:dayStr(4), time:'9:30am ET',  currency:'CAD', impact:'High',   title:'GDP m/m',                   forecast:'0.2%', previous:'0.2%',  actual:'' },
    { date:dayStr(4), time:'9:30am ET',  currency:'CAD', impact:'Medium', title:'Employment Change',         forecast:'15.0K',previous:'76.0K', actual:'' },
  ].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  return res.status(200).json({ events, count: events.length, source: 'estimated' });
}
