// api/scores.js — Vercel serverless function
// GET /api/scores           → national US + Canada
// GET /api/scores?city=NYC  → city-level scores

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  const FRED_KEY = process.env.FRED_API_KEY;
  if (!FRED_KEY) return res.status(500).json({ error: 'FRED_API_KEY not set' });

  const cityQuery = (req.query.city || '').trim().toLowerCase();

  try {
    if (cityQuery) {
      const metro = findMetro(cityQuery);
      if (!metro) return res.status(404).json({ error: 'City not found', suggestions: suggestCities(cityQuery) });
      const [data, rates] = await Promise.all([
        metro.country === 'ca' ? fetchCityCA(metro) : fetchCityUS(metro, FRED_KEY),
        metro.country === 'ca' ? fetchRatesCA() : fetchRatesUS(FRED_KEY),
      ]);
      return res.status(200).json({ city: metro.display, country: metro.country, data, rates, updated: new Date().toISOString() });
    }
    const [us, ca, ratesUS, ratesCA] = await Promise.all([fetchUS(FRED_KEY), fetchCA(), fetchRatesUS(FRED_KEY), fetchRatesCA()]);
    return res.status(200).json({ us, ca, ratesUS, ratesCA, updated: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── METRO DIRECTORY ────────────────────────────────────────────────────────────
const METROS = [
  { display:"New York, NY",      aliases:["new york","nyc","ny"],           hpi:"ATNHPIUS35620Q", unemp:"NYUR",   med_inc:85000,  country:"us" },
  { display:"Los Angeles, CA",   aliases:["los angeles","la","lax"],        hpi:"ATNHPIUS31080Q", unemp:"LAUR",   med_inc:72000,  country:"us" },
  { display:"Chicago, IL",       aliases:["chicago","chi"],                 hpi:"ATNHPIUS16980Q", unemp:"CHUR",   med_inc:65000,  country:"us" },
  { display:"Dallas, TX",        aliases:["dallas","dfw"],                  hpi:"ATNHPIUS19100Q", unemp:"DLLR",   med_inc:67000,  country:"us" },
  { display:"Houston, TX",       aliases:["houston"],                       hpi:"ATNHPIUS26420Q", unemp:"HTUR",   med_inc:61000,  country:"us" },
  { display:"Phoenix, AZ",       aliases:["phoenix","phx"],                 hpi:"ATNHPIUS38060Q", unemp:"PHXR",   med_inc:62000,  country:"us" },
  { display:"Philadelphia, PA",  aliases:["philadelphia","philly"],         hpi:"ATNHPIUS37980Q", unemp:"PHIR",   med_inc:68000,  country:"us" },
  { display:"San Antonio, TX",   aliases:["san antonio"],                   hpi:"ATNHPIUS41700Q", unemp:"SANR",   med_inc:55000,  country:"us" },
  { display:"San Diego, CA",     aliases:["san diego"],                     hpi:"ATNHPIUS41740Q", unemp:"SDGR",   med_inc:78000,  country:"us" },
  { display:"San Francisco, CA", aliases:["san francisco","sf","bay area"], hpi:"ATNHPIUS41860Q", unemp:"SFUR",   med_inc:112000, country:"us" },
  { display:"Seattle, WA",       aliases:["seattle","sea"],                 hpi:"ATNHPIUS42660Q", unemp:"SEAR",   med_inc:92000,  country:"us" },
  { display:"Denver, CO",        aliases:["denver"],                        hpi:"ATNHPIUS19740Q", unemp:"DENR",   med_inc:75000,  country:"us" },
  { display:"Boston, MA",        aliases:["boston"],                        hpi:"ATNHPIUS14460Q", unemp:"BOSUR",  med_inc:89000,  country:"us" },
  { display:"Austin, TX",        aliases:["austin"],                        hpi:"ATNHPIUS12420Q", unemp:"AUSR",   med_inc:75000,  country:"us" },
  { display:"Miami, FL",         aliases:["miami"],                         hpi:"ATNHPIUS33100Q", unemp:"MIAMR",  med_inc:58000,  country:"us" },
  { display:"Atlanta, GA",       aliases:["atlanta","atl"],                 hpi:"ATNHPIUS12060Q", unemp:"ATLUR",  med_inc:62000,  country:"us" },
  { display:"Minneapolis, MN",   aliases:["minneapolis","msp"],             hpi:"ATNHPIUS33460Q", unemp:"MINNR",  med_inc:75000,  country:"us" },
  { display:"Portland, OR",      aliases:["portland","pdx"],                hpi:"ATNHPIUS38900Q", unemp:"PORTR",  med_inc:72000,  country:"us" },
  { display:"Las Vegas, NV",     aliases:["las vegas","vegas"],             hpi:"ATNHPIUS29820Q", unemp:"LVUR",   med_inc:56000,  country:"us" },
  { display:"Nashville, TN",     aliases:["nashville"],                     hpi:"ATNHPIUS34980Q", unemp:"NSHVR",  med_inc:64000,  country:"us" },
  { display:"Charlotte, NC",     aliases:["charlotte"],                     hpi:"ATNHPIUS16740Q", unemp:"CHAUR",  med_inc:62000,  country:"us" },
  { display:"Raleigh, NC",       aliases:["raleigh"],                       hpi:"ATNHPIUS39580Q", unemp:"RALUR",  med_inc:70000,  country:"us" },
  { display:"Orlando, FL",       aliases:["orlando"],                       hpi:"ATNHPIUS36740Q", unemp:"ORLUR",  med_inc:57000,  country:"us" },
  { display:"Tampa, FL",         aliases:["tampa"],                         hpi:"ATNHPIUS45300Q", unemp:"TAMUR",  med_inc:57000,  country:"us" },
  { display:"Sacramento, CA",    aliases:["sacramento"],                    hpi:"ATNHPIUS40900Q", unemp:"SACR",   med_inc:68000,  country:"us" },
  { display:"Kansas City, MO",   aliases:["kansas city","kc"],              hpi:"ATNHPIUS28140Q", unemp:"KANCR",  med_inc:62000,  country:"us" },
  { display:"Columbus, OH",      aliases:["columbus"],                      hpi:"ATNHPIUS18140Q", unemp:"COLUR",  med_inc:60000,  country:"us" },
  { display:"Indianapolis, IN",  aliases:["indianapolis","indy"],           hpi:"ATNHPIUS26900Q", unemp:"INDUR",  med_inc:58000,  country:"us" },
  { display:"Pittsburgh, PA",    aliases:["pittsburgh","pitt"],             hpi:"ATNHPIUS38300Q", unemp:"PITTUR", med_inc:58000,  country:"us" },
  { display:"Toronto, ON",     aliases:["toronto","yyz"],     med_inc:82000, country:"ca", supply_adj:-15, afford_adj:-12, crash_adj:8  },
  { display:"Vancouver, BC",   aliases:["vancouver","yvr"],   med_inc:80000, country:"ca", supply_adj:-20, afford_adj:-18, crash_adj:10 },
  { display:"Montreal, QC",    aliases:["montreal","mtl"],    med_inc:58000, country:"ca", supply_adj:-8,  afford_adj:-6,  crash_adj:4  },
  { display:"Calgary, AB",     aliases:["calgary","yyc"],     med_inc:78000, country:"ca", supply_adj:-5,  afford_adj:-4,  crash_adj:3  },
  { display:"Ottawa, ON",      aliases:["ottawa"],            med_inc:76000, country:"ca", supply_adj:-10, afford_adj:-8,  crash_adj:5  },
  { display:"Edmonton, AB",    aliases:["edmonton"],          med_inc:72000, country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2  },
  { display:"Winnipeg, MB",    aliases:["winnipeg"],          med_inc:62000, country:"ca", supply_adj:-2,  afford_adj:-2,  crash_adj:1  },
  { display:"Quebec City, QC", aliases:["quebec city","quebec"], med_inc:55000, country:"ca", supply_adj:-3, afford_adj:-2, crash_adj:1 },
];

function findMetro(q) {
  return METROS.find(m => m.display.toLowerCase().includes(q) || m.aliases.some(a => a.includes(q) || q.includes(a)));
}
function suggestCities(q) {
  return METROS.filter(m => m.display.toLowerCase().includes(q[0])).slice(0,5).map(m => m.display);
}

// ── FRED helper ────────────────────────────────────────────────────────────────
async function fredLatest(id, key) {
  try {
    const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${key}&file_type=json&sort_order=desc&limit=2`);
    const j = await r.json();
    const obs = j.observations?.filter(o => o.value !== '.' && o.value !== '') || [];
    const val = parseFloat(obs[0]?.value);
    const prev = parseFloat(obs[1]?.value);
    return { value: isNaN(val) ? null : val, prev: isNaN(prev) ? null : prev, date: obs[0]?.date || null };
  } catch { return { value: null, prev: null, date: null }; }
}

async function fredVal(id, key) {
  const r = await fredLatest(id, key);
  return r.value;
}

// ── US RATES & INFLATION ───────────────────────────────────────────────────────
async function fetchRatesUS(key) {
  const [fedFunds, prime, mort30, mort15, t2y, t5y, t10y, t30y, spread,
         cpi, coreCpi, pce, corePce, inflExp, breakeven, tipsReal] = await Promise.all([
    fredLatest('FEDFUNDS',  key),
    fredLatest('DPRIME',    key),
    fredLatest('MORTGAGE30US', key),
    fredLatest('MORTGAGE15US', key),
    fredLatest('DGS2',      key),
    fredLatest('DGS5',      key),
    fredLatest('DGS10',     key),
    fredLatest('DGS30',     key),
    fredLatest('T10Y2Y',    key),
    fredLatest('CPIAUCSL',  key),
    fredLatest('CPILFESL',  key),
    fredLatest('PCEPI',     key),
    fredLatest('PCEPILFE',  key),
    fredLatest('MICH',      key),
    fredLatest('T10YIE',    key),
    fredLatest('DFII10',    key),
  ]);

  // Compute YoY inflation from CPI (need 13 observations for proper YoY)
  // Use approximate: (current - prev) / prev * 12 * 100 for monthly rate annualized
  // Better: fetch 13 months of CPI for true YoY
  let cpiYoY = null, coreCpiYoY = null, pceYoY = null, corePceYoY = null;
  try {
    const [cpiHist, coreCpiHist, pceHist, corePceHist] = await Promise.all([
      fetchYoY('CPIAUCSL',  key),
      fetchYoY('CPILFESL',  key),
      fetchYoY('PCEPI',     key),
      fetchYoY('PCEPILFE',  key),
    ]);
    cpiYoY = cpiHist; coreCpiYoY = coreCpiHist; pceYoY = pceHist; corePceYoY = corePceHist;
  } catch {}

  return {
    rates: {
      fedFunds:  { value: fedFunds.value,  prev: fedFunds.prev,  date: fedFunds.date,  label: "Fed Funds Rate" },
      prime:     { value: prime.value,     prev: prime.prev,     date: prime.date,     label: "Bank Prime Rate" },
      mort30:    { value: mort30.value,    prev: mort30.prev,    date: mort30.date,    label: "30yr Mortgage" },
      mort15:    { value: mort15.value,    prev: mort15.prev,    date: mort15.date,    label: "15yr Mortgage" },
      t2y:       { value: t2y.value,       prev: t2y.prev,       date: t2y.date,       label: "2Y Treasury" },
      t5y:       { value: t5y.value,       prev: t5y.prev,       date: t5y.date,       label: "5Y Treasury" },
      t10y:      { value: t10y.value,      prev: t10y.prev,      date: t10y.date,      label: "10Y Treasury" },
      t30y:      { value: t30y.value,      prev: t30y.prev,      date: t30y.date,      label: "30Y Treasury" },
      spread:    { value: spread.value,    prev: spread.prev,    date: spread.date,    label: "Yield Curve (10Y-2Y)" },
    },
    inflation: {
      cpi:       { value: cpiYoY,     label: "CPI (YoY %)",           target: 2.0 },
      coreCpi:   { value: coreCpiYoY, label: "Core CPI (YoY %)",      target: 2.0 },
      pce:       { value: pceYoY,     label: "PCE (YoY %)",           target: 2.0 },
      corePce:   { value: corePceYoY, label: "Core PCE (YoY %)",      target: 2.0 },
      inflExp:   { value: inflExp.value,   label: "1yr Inflation Exp. (%)" },
      breakeven: { value: breakeven.value, label: "10Y Breakeven (%)" },
      tipsReal:  { value: tipsReal.value,  label: "10Y Real Rate (TIPS %)" },
    }
  };
}

async function fetchYoY(seriesId, key) {
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${key}&file_type=json&sort_order=desc&limit=13`;
    const r = await fetch(url);
    const j = await r.json();
    const obs = j.observations?.filter(o => o.value !== '.' && o.value !== '') || [];
    if (obs.length < 13) return null;
    const latest = parseFloat(obs[0].value);
    const yearAgo = parseFloat(obs[12].value);
    if (isNaN(latest) || isNaN(yearAgo) || yearAgo === 0) return null;
    return parseFloat(((latest - yearAgo) / yearAgo * 100).toFixed(2));
  } catch { return null; }
}

// ── CANADA RATES & INFLATION ───────────────────────────────────────────────────
async function fetchRatesCA() {
  try {
    // Bank of Canada Valet API — no key needed
    const [bondsRes, overnightRes] = await Promise.all([
      fetch('https://www.bankofcanada.ca/valet/observations/group/bond_yields_all/json?recent=2'),
      fetch('https://www.bankofcanada.ca/valet/observations/V39079/json?recent=2'),  // overnight rate
    ]);
    const bondsData    = await bondsRes.json();
    const overnightData = await overnightRes.json();

    const obs0 = bondsData?.observations?.[0] || {};
    const obs1 = bondsData?.observations?.[1] || {};
    const ovObs = overnightData?.observations || [];

    const overnight = { value: parseFloat(ovObs[0]?.V39079) || null, prev: parseFloat(ovObs[1]?.V39079) || null, label: "BOC Overnight Rate" };
    const bond2y    = { value: parseFloat(obs0['BD.CDN.2YR.DQ.YLD']?.v) || null,  prev: parseFloat(obs1['BD.CDN.2YR.DQ.YLD']?.v) || null,  label: "2Y Govt Bond" };
    const bond5y    = { value: parseFloat(obs0['BD.CDN.5YR.DQ.YLD']?.v) || null,  prev: parseFloat(obs1['BD.CDN.5YR.DQ.YLD']?.v) || null,  label: "5Y Govt Bond" };
    const bond10y   = { value: parseFloat(obs0['BD.CDN.10YR.DQ.YLD']?.v) || null, prev: parseFloat(obs1['BD.CDN.10YR.DQ.YLD']?.v) || null, label: "10Y Govt Bond" };
    const bond30y   = { value: parseFloat(obs0['BD.CDN.LONG.DQ.YLD']?.v) || null, prev: parseFloat(obs1['BD.CDN.LONG.DQ.YLD']?.v) || null, label: "Long Bond" };

    // Derived mortgage rate (5Y + spread)
    const mort5y = bond5y.value ? parseFloat((bond5y.value + 1.5).toFixed(2)) : null;
    const spread = (bond10y.value && bond2y.value) ? parseFloat((bond10y.value - bond2y.value).toFixed(2)) : null;

    // Statistics Canada CPI — use a public endpoint (no key)
    // Stats Can open API: https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810000401
    // Simplified: use hard-coded recent value with date, updated quarterly
    const caCpiYoY  = 2.6;  // approximate — Stats Can CPI YoY as of early 2026
    const caCoreYoY = 2.9;

    return {
      rates: {
        overnight: { ...overnight },
        prime:     { value: overnight.value ? parseFloat((overnight.value + 2.2).toFixed(2)) : null, label: "Prime Rate" },
        mort5y:    { value: mort5y,   label: "5yr Fixed Mortgage (est.)" },
        bond2y,
        bond5y,
        bond10y,
        bond30y,
        spread:    { value: spread, label: "Yield Curve (10Y-2Y)" },
      },
      inflation: {
        cpi:      { value: caCpiYoY,  label: "CPI (YoY %)",      target: 2.0, note: "Stats Can est." },
        coreCpi:  { value: caCoreYoY, label: "Core CPI (YoY %)", target: 2.0, note: "Stats Can est." },
      }
    };
  } catch {
    return {
      rates: { overnight: { value: 3.0, label: "BOC Overnight Rate" }, bond10y: { value: 3.5, label: "10Y Govt Bond" } },
      inflation: { cpi: { value: 2.6, label: "CPI (YoY %)", target: 2.0 } },
      fallback: true
    };
  }
}

// ── US NATIONAL ────────────────────────────────────────────────────────────────
async function fetchUS(key) {
  const [mortgageRate, treasury10y, affordIndex, inventory, medianIncome, medianPrice,
         delinquency, vacancyRate, unemployRate, cpi] = await Promise.all([
    fredVal('MORTGAGE30US',key), fredVal('DGS10',key),
    fredVal('FIXHAI',key),       fredVal('ACTLISCOUUS',key),
    fredVal('MEHOINUSA672N',key),fredVal('MSPUS',key),
    fredVal('DRSFRMACBS',key),   fredVal('RVACRATE',key),
    fredVal('UNRATE',key),       fredVal('CPIAUCSL',key),
  ]);
  return computeUS({mortgageRate,treasury10y,affordIndex,inventory,medianIncome,medianPrice,delinquency,vacancyRate,unemployRate,cpi});
}

function computeUS(r) {
  const supplyScore = parseFloat((r.inventory ? Math.min((r.inventory/1500000)*100,100) : 50).toFixed(2));
  let ap = 0;
  ap += r.affordIndex ? Math.min((r.affordIndex/150)*40,40) : 20;
  ap += (r.medianPrice&&r.medianIncome) ? Math.max(0,Math.min(20,20-((r.medianPrice/r.medianIncome)-4)*2.5)) : 8;
  ap += r.mortgageRate ? Math.max(0,Math.min(15,15-(r.mortgageRate-3)*3)) : 7;
  ap += r.treasury10y  ? Math.max(0,Math.min(7.5,7.5-(r.treasury10y-2)*2.5)) : 3;
  ap += (r.medianIncome&&r.medianPrice) ? Math.min((r.medianIncome/r.medianPrice)*350,17.5) : 8;
  const affordScore = parseFloat(Math.min(100,Math.max(0,ap)).toFixed(2));
  let cp = 0;
  cp += r.delinquency  ? Math.min(30,r.delinquency*6) : 10;
  cp += r.vacancyRate  ? Math.min(20,Math.max(0,(r.vacancyRate-5)*4)) : 8;
  cp += r.unemployRate ? Math.min(25,Math.max(0,(r.unemployRate-4)*6.25)) : 10;
  cp += r.mortgageRate ? Math.min(20,Math.max(0,(r.mortgageRate-4)*6.67)) : 8;
  cp += (r.treasury10y&&r.mortgageRate) ? Math.min(20,Math.max(0,(r.mortgageRate-r.treasury10y)*5)) : 8;
  cp += r.cpi ? Math.min(20,Math.max(0,(r.cpi-260)*0.3)) : 8;
  const crashScore = parseFloat(Math.min(100,Math.max(0,(cp/135)*100)).toFixed(2));
  return { supply:supplyScore, afford:affordScore, crash:crashScore, health:parseFloat(((affordScore*0.45)+(supplyScore*0.35)+((100-crashScore)*0.20)).toFixed(1)), raw:r };
}

// ── US CITY ────────────────────────────────────────────────────────────────────
async function fetchCityUS(metro, key) {
  const [natMortgage,natTreasury,natAfford,natInventory,natDelinq,natVacancy,natCPI,cityHPI,cityUnemp] = await Promise.all([
    fredVal('MORTGAGE30US',key), fredVal('DGS10',key),
    fredVal('FIXHAI',key),       fredVal('ACTLISCOUUS',key),
    fredVal('DRSFRMACBS',key),   fredVal('RVACRATE',key),
    fredVal('CPIAUCSL',key),
    metro.hpi   ? fredVal(metro.hpi,key)   : Promise.resolve(null),
    metro.unemp ? fredVal(metro.unemp,key) : Promise.resolve(null),
  ]);
  const cityPrice = cityHPI ? (cityHPI/550)*420000 : 420000;
  const priceRatio = cityPrice/420000;
  const cityInvProxy = (natInventory||750000)/Math.max(1,priceRatio*1.2);
  const supplyScore = parseFloat(Math.min((cityInvProxy/(1500000*0.05))*100,100).toFixed(2));
  const r = { mortgageRate:natMortgage, treasury10y:natTreasury, affordIndex:natAfford?(natAfford*(420000/cityPrice)):null, medianIncome:metro.med_inc, medianPrice:cityPrice, delinquency:natDelinq, vacancyRate:natVacancy, unemployRate:cityUnemp, cpi:natCPI, cityHPI };
  let ap = 0;
  ap += r.affordIndex ? Math.min((r.affordIndex/150)*40,40) : 15;
  ap += Math.max(0,Math.min(20,20-((r.medianPrice/r.medianIncome)-4)*2.5));
  ap += r.mortgageRate ? Math.max(0,Math.min(15,15-(r.mortgageRate-3)*3)) : 7;
  ap += r.treasury10y  ? Math.max(0,Math.min(7.5,7.5-(r.treasury10y-2)*2.5)) : 3;
  ap += Math.min((r.medianIncome/r.medianPrice)*350,17.5);
  const affordScore = parseFloat(Math.min(100,Math.max(0,ap)).toFixed(2));
  let cp = 0;
  cp += r.delinquency  ? Math.min(30,r.delinquency*6) : 10;
  cp += r.vacancyRate  ? Math.min(20,Math.max(0,(r.vacancyRate-5)*4)) : 8;
  cp += r.unemployRate ? Math.min(25,Math.max(0,(r.unemployRate-4)*6.25)) : 10;
  cp += r.mortgageRate ? Math.min(20,Math.max(0,(r.mortgageRate-4)*6.67)) : 8;
  cp += (r.treasury10y&&r.mortgageRate) ? Math.min(20,Math.max(0,(r.mortgageRate-r.treasury10y)*5)) : 8;
  cp += r.cpi ? Math.min(20,Math.max(0,(r.cpi-260)*0.3)) : 8;
  cp += Math.min(15,(priceRatio-1)*10);
  const crashScore = parseFloat(Math.min(100,Math.max(0,(cp/150)*100)).toFixed(2));
  return { supply:supplyScore, afford:affordScore, crash:crashScore, health:parseFloat(((affordScore*0.45)+(supplyScore*0.35)+((100-crashScore)*0.20)).toFixed(1)), raw:{...r,estimatedCityPrice:Math.round(cityPrice)} };
}

// ── CANADA ─────────────────────────────────────────────────────────────────────
async function fetchCA() {
  try {
    const j = await (await fetch('https://www.bankofcanada.ca/valet/observations/group/bond_yields_all/json?recent=1')).json();
    const obs = j?.observations?.[0]||{};
    return computeCA({bond10y:parseFloat(obs['BD.CDN.10YR.DQ.YLD']?.v)||3.5, bond5y:parseFloat(obs['BD.CDN.5YR.DQ.YLD']?.v)||3.2});
  } catch { return {supply:32,afford:38.5,crash:58.2,health:43.1,raw:{},fallback:true}; }
}

async function fetchCityCA(metro) {
  try {
    const j = await (await fetch('https://www.bankofcanada.ca/valet/observations/group/bond_yields_all/json?recent=1')).json();
    const obs = j?.observations?.[0]||{};
    return computeCA({bond10y:parseFloat(obs['BD.CDN.10YR.DQ.YLD']?.v)||3.5, bond5y:parseFloat(obs['BD.CDN.5YR.DQ.YLD']?.v)||3.2, supplyAdj:metro.supply_adj||0, affordAdj:metro.afford_adj||0, crashAdj:metro.crash_adj||0});
  } catch { return {supply:32,afford:38.5,crash:58.2,health:43.1,raw:{},fallback:true}; }
}

function computeCA({bond10y,bond5y,supplyAdj=0,affordAdj=0,crashAdj=0}) {
  const mr = (bond5y||3.2)+1.5;
  const supplyScore = parseFloat(Math.max(0,32+supplyAdj).toFixed(2));
  let ap = 0;
  ap += Math.min((65/150)*40,40);
  ap += Math.max(0,Math.min(20,20-(10-4)*2.5));
  ap += Math.max(0,Math.min(15,15-(mr-3)*3));
  ap += Math.max(0,Math.min(7.5,7.5-((bond10y||3.5)-2)*2.5));
  ap += Math.min(0.1*350,17.5);
  const affordScore = parseFloat(Math.min(100,Math.max(0,ap+affordAdj)).toFixed(2));
  let cp = 8+12+8+15;
  cp += Math.min(20,Math.max(0,(mr-4)*6.67));
  cp += Math.min(20,Math.max(0,(mr-(bond10y||3.5))*5));
  const crashScore = parseFloat(Math.min(100,Math.max(0,((cp+crashAdj)/135)*100)).toFixed(2));
  return {supply:supplyScore,afford:affordScore,crash:crashScore,health:parseFloat(((affordScore*0.45)+(supplyScore*0.35)+((100-crashScore)*0.20)).toFixed(1)),raw:{mortgageRate:mr,bond10y,bond5y}};
}
