// api/calendar.js — Vercel serverless function
// Fetches USD + CAD economic calendar
// Primary: ForexFactory JSON · Fallback: curated recurring events

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate');

  const isNext = req.query.week === 'next';
  const week   = isNext ? 'nextweek' : 'thisweek';

  // ── Try ForexFactory ──────────────────────────────────────────────────────
  const urls = [
    `https://nfs.faireconomy.media/ff_calendar_${week}.json?version=1`,
    `https://nfs.faireconomy.media/ff_calendar_${week}.json`,
  ];

  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://www.forexfactory.com/',
          'Origin': 'https://www.forexfactory.com',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      if (!Array.isArray(data) || data.length === 0) continue;

      const filtered = data
        .filter(e => ['USD','CAD'].includes(e.currency) && ['High','Medium'].includes(e.impact))
        .map(e => ({
          date: e.date || '', time: e.time || 'All Day',
          currency: e.currency, impact: e.impact,
          title: e.title || '', forecast: e.forecast || '',
          previous: e.previous || '', actual: e.actual || '',
        }));

      // If FF returned data but it's all past (empty after filter), fall through to fallback
      if (filtered.length > 0) {
        return res.status(200).json({ events: filtered, week, count: filtered.length, source: 'forexfactory.com' });
      }
    } catch { continue; }
  }

  // ── Fallback: generate events for correct week ────────────────────────────
  // Get start of the target week (Mon)
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun,1=Mon,...6=Sat
  const daysToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const thisMon = new Date(now);
  thisMon.setUTCDate(now.getUTCDate() + daysToMon + (isNext ? 7 : 0));
  thisMon.setUTCHours(0, 0, 0, 0);

  // Helper: date string for day offset from Monday
  function dayDate(offsetFromMon) {
    const d = new Date(thisMon);
    d.setUTCDate(thisMon.getUTCDate() + offsetFromMon);
    return d.toISOString().split('T')[0];
  }

  // Recurring weekly events mapped to Mon(0)..Fri(4)
  const RECURRING = [
    // Monday
    { off:0, time:'10:00am ET', currency:'USD', impact:'Medium', title:'ISM Manufacturing PMI',       forecast:'49.5', previous:'50.3' },
    // Tuesday
    { off:1, time:'8:30am ET',  currency:'USD', impact:'High',   title:'Core CPI m/m',                forecast:'0.3%', previous:'0.4%' },
    { off:1, time:'8:30am ET',  currency:'USD', impact:'High',   title:'CPI y/y',                     forecast:'3.1%', previous:'3.2%' },
    { off:1, time:'9:30am ET',  currency:'CAD', impact:'High',   title:'CPI m/m',                     forecast:'0.6%', previous:'0.1%' },
    // Wednesday
    { off:2, time:'8:30am ET',  currency:'USD', impact:'High',   title:'PPI m/m',                     forecast:'0.3%', previous:'0.4%' },
    { off:2, time:'8:30am ET',  currency:'USD', impact:'Medium', title:'Core PPI m/m',                forecast:'0.2%', previous:'0.3%' },
    { off:2, time:'9:30am ET',  currency:'CAD', impact:'High',   title:'Core CPI m/m',                forecast:'0.4%', previous:'0.4%' },
    { off:2, time:'2:00pm ET',  currency:'USD', impact:'High',   title:'FOMC Meeting Minutes',        forecast:'',     previous:''     },
    // Thursday
    { off:3, time:'8:30am ET',  currency:'USD', impact:'High',   title:'Unemployment Claims',         forecast:'220K', previous:'218K' },
    { off:3, time:'8:30am ET',  currency:'USD', impact:'Medium', title:'Building Permits',            forecast:'1.45M',previous:'1.47M'},
    { off:3, time:'9:00am ET',  currency:'USD', impact:'Medium', title:'Existing Home Sales',         forecast:'3.9M', previous:'4.0M' },
    { off:3, time:'9:30am ET',  currency:'CAD', impact:'Medium', title:'Retail Sales m/m',            forecast:'0.4%', previous:'2.5%' },
    { off:3, time:'1:00pm ET',  currency:'USD', impact:'High',   title:'FOMC Member Speech',          forecast:'',     previous:''     },
    // Friday
    { off:4, time:'8:30am ET',  currency:'USD', impact:'High',   title:'Core PCE Price Index m/m',    forecast:'0.3%', previous:'0.3%' },
    { off:4, time:'8:30am ET',  currency:'USD', impact:'High',   title:'GDP q/q',                     forecast:'2.3%', previous:'3.1%' },
    { off:4, time:'9:45am ET',  currency:'USD', impact:'Medium', title:'Flash Manufacturing PMI',     forecast:'52.0', previous:'52.7' },
    { off:4, time:'10:00am ET', currency:'USD', impact:'Medium', title:'CB Consumer Confidence',      forecast:'93.0', previous:'98.3' },
    { off:4, time:'9:30am ET',  currency:'CAD', impact:'High',   title:'GDP m/m',                     forecast:'0.2%', previous:'0.2%' },
    { off:4, time:'9:30am ET',  currency:'CAD', impact:'Medium', title:'Employment Change',           forecast:'15.0K',previous:'76.0K'},
  ];

  // For "this week", only show events from today onwards
  const todayStr = now.toISOString().split('T')[0];

  const events = RECURRING
    .map(e => ({
      date:     dayDate(e.off),
      time:     e.time,
      currency: e.currency,
      impact:   e.impact,
      title:    e.title,
      forecast: e.forecast,
      previous: e.previous,
      actual:   '',
    }))
    .filter(e => isNext || e.date >= todayStr) // for this week, only show today+
    .sort((a, b) => a.date.localeCompare(b.date));

  return res.status(200).json({
    events,
    week,
    count: events.length,
    source: 'estimated',
  });
}
