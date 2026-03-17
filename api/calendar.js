// api/calendar.js — Vercel serverless function
// Proxies Forex Factory public JSON calendar
// GET /api/calendar?week=this|next

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate'); // 30min cache

  const week = req.query.week === 'next' ? 'nextweek' : 'thisweek';
  const url  = `https://nfs.faireconomy.media/ff_calendar_${week}.json`;

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.forexfactory.com/',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!r.ok) throw new Error(`FF feed ${r.status}`);
    const data = await r.json();

    // Filter to US and CAD only, and only medium/high impact
    const KEEP = ['USD', 'CAD'];
    const filtered = data
      .filter(e => KEEP.includes(e.currency) && (e.impact === 'High' || e.impact === 'Medium'))
      .map(e => ({
        date:     e.date,
        time:     e.time || '',
        currency: e.currency,
        impact:   e.impact,
        title:    e.title,
        forecast: e.forecast || '',
        previous: e.previous || '',
        actual:   e.actual   || '',
      }));

    return res.status(200).json({ events: filtered, week, count: filtered.length, source: 'forexfactory.com' });
  } catch (err) {
    // Fallback: return curated static events for the week if FF is unreachable
    return res.status(200).json({
      events: [],
      week,
      count: 0,
      error: err.message,
      source: 'unavailable',
    });
  }
}
