// api/calendar.js — economic calendar with actuals from BLS + FRED + StatsCan

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate');

  const isNext = req.query.week === 'next';
  const ffFile = isNext ? 'nextweek' : 'thisweek';

  // ── Try ForexFactory (4 attempts) ────────────────────────────────────────
  const FF_ATTEMPTS = [
    { url: `https://nfs.faireconomy.media/ff_calendar_${ffFile}.json?version=1`,
      headers: { 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept':'application/json','Referer':'https://www.forexfactory.com/','Origin':'https://www.forexfactory.com' } },
    { url: `https://corsproxy.io/?${encodeURIComponent(`https://nfs.faireconomy.media/ff_calendar_${ffFile}.json`)}`,
      headers: { 'Accept':'application/json' } },
    { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://nfs.faireconomy.media/ff_calendar_${ffFile}.json`)}`,
      headers: { 'Accept':'application/json' } },
  ];

  for (const att of FF_ATTEMPTS) {
    try {
      const r = await fetch(att.url, { headers: att.headers, signal: AbortSignal.timeout(7000) });
      if (!r.ok) continue;
      const data = await r.json();
      if (!Array.isArray(data) || !data.length) continue;
      const filtered = data
        .filter(e => ['USD','CAD'].includes(e.currency) && ['High','Medium'].includes(e.impact))
        .map(e => ({ date:e.date||'', time:e.time||'All Day', currency:e.currency, impact:e.impact,
                     title:e.title||'', forecast:e.forecast||'', previous:e.previous||'', actual:e.actual||'' }));
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

  const etNow    = new Date(now.getTime() - 5*3600000);
  const todayStr = etNow.toISOString().split('T')[0];
  const etHour   = etNow.getUTCHours();

  function dayStr(off) {
    const d = new Date(baseMon);
    d.setUTCDate(baseMon.getUTCDate() + off);
    return d.toISOString().split('T')[0];
  }

  const FRED_KEY = process.env.FRED_API_KEY || '';
  const A = {};

  // ── BLS API (USD — same-day releases) ────────────────────────────────────
  try {
    const blsR = await fetch('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesid: [
          'CUSR0000SA0',     // CPI All items
          'CUSR0000SA0L1E',  // Core CPI (ex food & energy)
          'WPUFD49104',      // Core PPI
          'WPUFD4',          // PPI Final demand
          'PCU',             // PPI alternative
          'EIUIR',           // ISM Manufacturing (proxy)
        ],
        startyear: (now.getFullYear() - 1).toString(),
        endyear:   now.getFullYear().toString(),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (blsR.ok) {
      const blsJ = await blsR.json();
      (blsJ?.Results?.series || []).forEach(s => {
        const data = (s.data || []).filter(d => d.value !== '-' && d.value !== '');
        if (data.length < 2) return;
        const cur  = parseFloat(data[0].value);
        const prev = parseFloat(data[1].value);
        if (isNaN(cur) || isNaN(prev) || prev === 0) return;
        const ageDays = (now - new Date(`${data[0].year}-${String(parseInt(data[0].period.replace('M',''))).padStart(2,'0')}-01`)) / 86400000;
        if (ageDays > 60) return;
        const mom = ((cur - prev) / prev * 100).toFixed(2) + '%';
        if (s.seriesID === 'CUSR0000SA0') {
          A['cpi_mom'] = mom;
          const yrAgo = data.find(d => parseInt(d.year) === parseInt(data[0].year) - 1 && d.period === data[0].period);
          if (yrAgo) A['cpi_yoy'] = ((cur - parseFloat(yrAgo.value)) / parseFloat(yrAgo.value) * 100).toFixed(1) + '%';
        }
        if (s.seriesID === 'CUSR0000SA0L1E') A['core_cpi'] = mom;
        if (s.seriesID === 'WPUFD49104')     A['core_ppi'] = mom;
        if (s.seriesID === 'WPUFD4')         A['ppi']      = mom;
      });
    }
  } catch { /* fall through */ }

  // ── FRED backup (USD) ─────────────────────────────────────────────────────
  if (FRED_KEY) {
    const FRED_SERIES = [
      { id:'CPILFESL',        key:'core_cpi', lim:2, fmt:(v,p)=> p?((v-p)/p*100).toFixed(2)+'%':'' },
      { id:'CPIAUCSL_PC1',    key:'cpi_yoy',  lim:1, fmt:(v)  => v.toFixed(1)+'%'                   },
      { id:'PPIACO',          key:'ppi',      lim:2, fmt:(v,p)=> p?((v-p)/p*100).toFixed(2)+'%':'' },
      { id:'PPIFIS',          key:'core_ppi', lim:2, fmt:(v,p)=> p?((v-p)/p*100).toFixed(2)+'%':'' },
      { id:'PCEPILFE',        key:'core_pce', lim:2, fmt:(v,p)=> p?((v-p)/p*100).toFixed(2)+'%':'' },
      { id:'A191RL1Q225SBEA', key:'gdp',      lim:1, fmt:(v)  => v.toFixed(1)+'%'                   },
      { id:'UMCSENT',         key:'umcsent',  lim:1, fmt:(v)  => v.toFixed(1)                        },
      { id:'ICSA',            key:'claims',   lim:1, fmt:(v)  => Math.round(v/1000)+'K'              },
      { id:'PERMIT',          key:'permits',  lim:1, fmt:(v)  => (v/1000).toFixed(2)+'M'             },
      { id:'EXHOSLUSM495S',   key:'exist_homes',lim:1,fmt:(v) => (v/1000).toFixed(2)+'M'             },
      { id:'NAPM',            key:'ism_mfg',  lim:1, fmt:(v)  => v.toFixed(1)                        },
      { id:'TOTALSA',         key:'construction',lim:2,fmt:(v,p)=>p?((v-p)/p*100).toFixed(2)+'%':'' },
    ];
    await Promise.allSettled(FRED_SERIES.map(async ({ id, key, lim, fmt }) => {
      if (A[key]) return;
      try {
        const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED_KEY}&sort_order=desc&limit=${lim}&file_type=json`, { signal: AbortSignal.timeout(5000) });
        const j = await r.json();
        const obs = (j.observations||[]).filter(o => o.value!='.'&&o.value!=''&&!isNaN(parseFloat(o.value)));
        if (!obs.length) return;
        const ageDays = (now - new Date(obs[0].date)) / 86400000;
        const maxAge  = id==='ICSA'?10:id.includes('RL1Q')?100:60;
        if (ageDays > maxAge) return;
        const v = parseFloat(obs[0].value);
        const p = obs.length>1?parseFloat(obs[1].value):null;
        const display = fmt(v, p, obs);
        if (display) A[key] = display;
      } catch {}
    }));
  }

  // ── Statistics Canada (CAD actuals) via POST endpoint ────────────────────
  try {
    const scSeries = [
      { id: 41690973,  key:'cad_cpi',      fmt:'mom' },
      { id: 41692043,  key:'cad_core_cpi', fmt:'mom' },
      { id: 62305752,  key:'cad_gdp',      fmt:'mom' },
      { id: 52367074,  key:'cad_retail',   fmt:'mom' },
      { id: 2062815,   key:'cad_employ',   fmt:'chg' },
    ];
    const scR = await fetch(
      'https://www150.statcan.gc.ca/t1/tbl1/en/dtbl/json/getDataFromVectorsAndLatestNPeriods',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(scSeries.map(s => ({ vectorId: s.id, latestN: 3 }))),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (scR.ok) {
      const scJ = await scR.json();
      const results = Array.isArray(scJ) ? scJ : [];
      results.forEach((obj, i) => {
        const series = scSeries[i];
        if (!series) return;
        const pts = obj?.vectorDataPoint || [];
        if (pts.length < 2) return;
        const sorted = [...pts].sort((a,b) => (a.refPer||'').localeCompare(b.refPer||''));
        const cur  = parseFloat(sorted[sorted.length-1]?.value);
        const prev = parseFloat(sorted[sorted.length-2]?.value);
        if (isNaN(cur)||isNaN(prev)||prev===0) return;
        const refDate = sorted[sorted.length-1]?.refPer || '';
        const ageDays = refDate ? (now - new Date(refDate.length===7?refDate+'-01':refDate)) / 86400000 : 999;
        if (ageDays > 65) return;
        if (series.fmt==='mom') A[series.key] = ((cur-prev)/prev*100).toFixed(2)+'%';
        if (series.fmt==='chg') A[series.key] = (cur-prev>0?'+':'')+Math.round((cur-prev)*1000)+'K';
      });
    }
  } catch { /* optional */ }

  // ── Only show actual for past events (≥10am ET for today) ────────────────
  function act(key, dateStr) {
    if (!key || dateStr > todayStr) return '';
    if (dateStr === todayStr && etHour < 10) return '';
    return A[key] || '';
  }

  const events = [
    // Monday
    { date:dayStr(0), time:'10:00am ET', currency:'USD', impact:'Medium', title:'ISM Manufacturing PMI',    forecast:'49.5', previous:'50.3',  actual: act('ism_mfg',     dayStr(0)) },
    { date:dayStr(0), time:'10:00am ET', currency:'USD', impact:'Medium', title:'Construction Spending m/m',forecast:'0.3%', previous:'0.5%',  actual: act('construction', dayStr(0)) },
    // Tuesday
    { date:dayStr(1), time:'8:30am ET',  currency:'USD', impact:'High',   title:'Core CPI m/m',             forecast:'0.3%', previous:'0.4%',  actual: act('core_cpi',    dayStr(1)) },
    { date:dayStr(1), time:'8:30am ET',  currency:'USD', impact:'High',   title:'CPI y/y',                  forecast:'3.1%', previous:'3.2%',  actual: act('cpi_yoy',     dayStr(1)) },
    { date:dayStr(1), time:'9:30am ET',  currency:'CAD', impact:'High',   title:'CPI m/m',                  forecast:'0.6%', previous:'0.1%',  actual: act('cad_cpi',     dayStr(1)) },
    // Wednesday
    { date:dayStr(2), time:'8:30am ET',  currency:'USD', impact:'High',   title:'PPI m/m',                  forecast:'0.3%', previous:'0.4%',  actual: act('ppi',         dayStr(2)) },
    { date:dayStr(2), time:'8:30am ET',  currency:'USD', impact:'Medium', title:'Core PPI m/m',             forecast:'0.2%', previous:'0.3%',  actual: act('core_ppi',    dayStr(2)) },
    { date:dayStr(2), time:'9:30am ET',  currency:'CAD', impact:'High',   title:'Core CPI m/m',             forecast:'0.4%', previous:'0.4%',  actual: act('cad_core_cpi',dayStr(2)) },
    { date:dayStr(2), time:'2:00pm ET',  currency:'USD', impact:'High',   title:'FOMC Meeting Minutes',     forecast:'',     previous:'',      actual: '' },
    // Thursday
    { date:dayStr(3), time:'8:30am ET',  currency:'USD', impact:'High',   title:'Unemployment Claims',      forecast:'220K', previous:'218K',  actual: act('claims',      dayStr(3)) },
    { date:dayStr(3), time:'8:30am ET',  currency:'USD', impact:'Medium', title:'Building Permits',         forecast:'1.45M',previous:'1.47M', actual: act('permits',     dayStr(3)) },
    { date:dayStr(3), time:'10:00am ET', currency:'USD', impact:'Medium', title:'Existing Home Sales',      forecast:'3.9M', previous:'4.0M',  actual: act('exist_homes', dayStr(3)) },
    { date:dayStr(3), time:'9:30am ET',  currency:'CAD', impact:'Medium', title:'Retail Sales m/m',         forecast:'0.4%', previous:'2.5%',  actual: act('cad_retail',  dayStr(3)) },
    { date:dayStr(3), time:'1:00pm ET',  currency:'USD', impact:'High',   title:'FOMC Member Speech',       forecast:'',     previous:'',      actual: '' },
    // Friday
    { date:dayStr(4), time:'8:30am ET',  currency:'USD', impact:'High',   title:'Core PCE Price Index m/m', forecast:'0.3%', previous:'0.3%',  actual: act('core_pce',    dayStr(4)) },
    { date:dayStr(4), time:'8:30am ET',  currency:'USD', impact:'High',   title:'GDP q/q',                  forecast:'2.3%', previous:'3.1%',  actual: act('gdp',         dayStr(4)) },
    { date:dayStr(4), time:'9:45am ET',  currency:'USD', impact:'Medium', title:'Flash Manufacturing PMI',  forecast:'52.0', previous:'52.7',  actual: '' },
    { date:dayStr(4), time:'10:00am ET', currency:'USD', impact:'Medium', title:'UoM Consumer Sentiment',   forecast:'63.0', previous:'64.7',  actual: act('umcsent',     dayStr(4)) },
    { date:dayStr(4), time:'9:30am ET',  currency:'CAD', impact:'High',   title:'GDP m/m',                  forecast:'0.2%', previous:'0.2%',  actual: act('cad_gdp',     dayStr(4)) },
    { date:dayStr(4), time:'9:30am ET',  currency:'CAD', impact:'Medium', title:'Employment Change',        forecast:'15.0K',previous:'76.0K', actual: act('cad_employ',  dayStr(4)) },
  ].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  return res.status(200).json({ events, count: events.length, source: 'estimated' });
}
