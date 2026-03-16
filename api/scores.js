// api/scores.js — Vercel serverless function
// GET /api/scores                → national US + Canada
// GET /api/scores?city=Toronto   → city-level scores + listings
// GET /api/scores?city=Austin    → city-level scores + listings

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');

  const FRED_KEY = process.env.FRED_API_KEY;
  if (!FRED_KEY) return res.status(500).json({ error: 'FRED_API_KEY not set' });

  const cityQuery = (req.query.city || '').trim().toLowerCase();

  try {
    if (cityQuery) {
      const metro = findMetro(cityQuery);
      if (!metro) return res.status(404).json({ error: 'City not found', suggestions: suggestCities(cityQuery) });

      const isCA = metro.country === 'ca';
      const [data, rates, listings] = await Promise.all([
        isCA ? fetchCityCA(metro) : fetchCityUS(metro, FRED_KEY),
        isCA ? fetchRatesCA() : fetchRatesUS(FRED_KEY),
        fetchListings(metro),
      ]);
      return res.status(200).json({ city: metro.display, country: metro.country, province: metro.prov || null, data, rates, listings, updated: new Date().toISOString() });
    }

    const [us, ca, ratesUS, ratesCA] = await Promise.all([fetchUS(FRED_KEY), fetchCA(), fetchRatesUS(FRED_KEY), fetchRatesCA()]);
    return res.status(200).json({ us, ca, ratesUS, ratesCA, updated: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── LISTINGS via realtor.ca internal API ──────────────────────────────────────
async function fetchListings(metro) {
  try {
    if (metro.country === 'us') return await fetchListingsUS(metro);
    return await fetchListingsCA(metro);
  } catch(e) {
    return { forSale: [], foreclosures: [], total: 0, error: e.message };
  }
}

async function fetchListingsCA(metro) {
  // Realtor.ca internal API — reverse engineered, no key needed
  const body = {
    ZoomLevel: 11,
    LatitudeMax: (metro.lat || 43.7) + 0.3,
    LongitudeMax: (metro.lng || -79.4) + 0.4,
    LatitudeMin: (metro.lat || 43.7) - 0.3,
    LongitudeMin: (metro.lng || -79.4) - 0.4,
    Sort: "6-D",
    PropertyTypeGroupID: 1,
    TransactionTypeId: 2,
    RecordsPerPage: 12,
    ApplicationId: 1,
    CultureId: 1,
    Version: 7.0,
    CurrentPage: 1
  };

  const headers = {
    'Content-Type': 'application/json',
    'Referer': 'https://www.realtor.ca/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };

  const r = await fetch('https://api2.realtor.ca/Listing.svc/PropertySearch_Post', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const j = await r.json();
  const results = j?.Results || [];
  const total = j?.Paging?.TotalRecords || 0;

  const forSale = results.slice(0, 8).map(p => ({
    address: p.Property?.Address?.AddressText || 'Address not available',
    price: p.Property?.Price || 'Price not listed',
    beds: p.Building?.BedRange || null,
    baths: p.Building?.BathRange || null,
    type: p.Property?.Type || 'Residential',
    url: p.RelativeDetailsURL ? 'https://www.realtor.ca' + p.RelativeDetailsURL : null,
    photo: p.Property?.Photo?.[0]?.HighResPath || null,
    mls: p.MlsNumber || null,
  }));

  // Power of sale / foreclosure search
  const bodyPOS = { ...body, Keywords: 'power of sale', RecordsPerPage: 6 };
  let foreclosures = [];
  try {
    const r2 = await fetch('https://api2.realtor.ca/Listing.svc/PropertySearch_Post', {
      method: 'POST', headers, body: JSON.stringify(bodyPOS)
    });
    const j2 = await r2.json();
    foreclosures = (j2?.Results || []).slice(0, 6).map(p => ({
      address: p.Property?.Address?.AddressText || 'Address not available',
      price: p.Property?.Price || 'Price not listed',
      beds: p.Building?.BedRange || null,
      baths: p.Building?.BathRange || null,
      type: 'Power of Sale',
      url: p.RelativeDetailsURL ? 'https://www.realtor.ca' + p.RelativeDetailsURL : null,
      mls: p.MlsNumber || null,
    }));
  } catch {}

  return { forSale, foreclosures, total, source: 'realtor.ca' };
}

async function fetchListingsUS(metro) {
  // Zillow-style search via public realtor.com API approximation
  // Use a simple redirect to search page — no listings API available without key
  // Return a search URL instead
  const citySlug = metro.display.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-');
  return {
    forSale: [],
    foreclosures: [],
    total: null,
    searchUrl: `https://www.realtor.com/realestateandhomes-search/${citySlug}`,
    foreclosureUrl: `https://www.realtor.com/realestateandhomes-search/${citySlug}/type-foreclosure`,
    source: 'realtor.com',
    note: 'Click links to view live US listings on realtor.com'
  };
}

// ── CANADIAN CITY DATABASE (98 cities) ────────────────────────────────────────
const CA_CITIES = [
  // ONTARIO — Large
  { display:"Toronto, ON",            aliases:["toronto","yyz"],              prov:"ON", sgc:"3520005", lat:43.70, lng:-79.42, pop:2794356, country:"ca", supply_adj:-15, afford_adj:-12, crash_adj:8  },
  { display:"Ottawa, ON",             aliases:["ottawa"],                     prov:"ON", sgc:"3506008", lat:45.42, lng:-75.69, pop:1017449, country:"ca", supply_adj:-10, afford_adj:-8,  crash_adj:5  },
  { display:"Mississauga, ON",        aliases:["mississauga"],                prov:"ON", sgc:"3521010", lat:43.59, lng:-79.64, pop:717961,  country:"ca", supply_adj:-14, afford_adj:-11, crash_adj:7  },
  { display:"Brampton, ON",           aliases:["brampton"],                   prov:"ON", sgc:"3521005", lat:43.73, lng:-79.76, pop:656480,  country:"ca", supply_adj:-13, afford_adj:-10, crash_adj:7  },
  { display:"Hamilton, ON",           aliases:["hamilton"],                   prov:"ON", sgc:"3525005", lat:43.25, lng:-79.87, pop:569353,  country:"ca", supply_adj:-9,  afford_adj:-7,  crash_adj:4  },
  { display:"London, ON",             aliases:["london ontario","london on"], prov:"ON", sgc:"3539036", lat:43.00, lng:-81.27, pop:422324,  country:"ca", supply_adj:-7,  afford_adj:-5,  crash_adj:3  },
  { display:"Markham, ON",            aliases:["markham"],                    prov:"ON", sgc:"3519036", lat:43.86, lng:-79.34, pop:338503,  country:"ca", supply_adj:-13, afford_adj:-11, crash_adj:7  },
  { display:"Vaughan, ON",            aliases:["vaughan"],                    prov:"ON", sgc:"3519049", lat:43.84, lng:-79.50, pop:323103,  country:"ca", supply_adj:-12, afford_adj:-10, crash_adj:6  },
  { display:"Kitchener, ON",          aliases:["kitchener","kw","waterloo region"], prov:"ON", sgc:"3530013", lat:43.45, lng:-80.49, pop:256885, country:"ca", supply_adj:-8, afford_adj:-6, crash_adj:4 },
  { display:"Windsor, ON",            aliases:["windsor ontario","windsor on"],prov:"ON", sgc:"3537039", lat:42.31, lng:-83.03, pop:229660,  country:"ca", supply_adj:-5,  afford_adj:-3,  crash_adj:2  },
  { display:"Oshawa, ON",             aliases:["oshawa"],                     prov:"ON", sgc:"3518013", lat:43.90, lng:-78.85, pop:166000,  country:"ca", supply_adj:-8,  afford_adj:-6,  crash_adj:4  },
  { display:"Barrie, ON",             aliases:["barrie"],                     prov:"ON", sgc:"3543042", lat:44.39, lng:-79.69, pop:153356,  country:"ca", supply_adj:-9,  afford_adj:-7,  crash_adj:4  },
  { display:"Guelph, ON",             aliases:["guelph"],                     prov:"ON", sgc:"3523008", lat:43.55, lng:-80.25, pop:143740,  country:"ca", supply_adj:-8,  afford_adj:-6,  crash_adj:4  },
  { display:"St. Catharines, ON",     aliases:["st catharines","niagara"],    prov:"ON", sgc:"3526043", lat:43.16, lng:-79.23, pop:133113,  country:"ca", supply_adj:-6,  afford_adj:-4,  crash_adj:3  },
  { display:"Cambridge, ON",          aliases:["cambridge ontario"],          prov:"ON", sgc:"3530010", lat:43.36, lng:-80.31, pop:129920,  country:"ca", supply_adj:-7,  afford_adj:-5,  crash_adj:3  },
  { display:"Kingston, ON",           aliases:["kingston ontario"],           prov:"ON", sgc:"3510010", lat:44.23, lng:-76.49, pop:123363,  country:"ca", supply_adj:-6,  afford_adj:-4,  crash_adj:3  },
  { display:"Greater Sudbury, ON",    aliases:["sudbury","greater sudbury"],  prov:"ON", sgc:"3553005", lat:46.49, lng:-80.99, pop:166004,  country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1  },
  { display:"Thunder Bay, ON",        aliases:["thunder bay"],                prov:"ON", sgc:"3558004", lat:48.38, lng:-89.25, pop:107909,  country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1  },
  { display:"Waterloo, ON",           aliases:["waterloo ontario"],           prov:"ON", sgc:"3530016", lat:43.47, lng:-80.52, pop:121436,  country:"ca", supply_adj:-8,  afford_adj:-6,  crash_adj:4  },
  { display:"Brantford, ON",          aliases:["brantford"],                  prov:"ON", sgc:"3529006", lat:43.14, lng:-80.26, pop:97496,   country:"ca", supply_adj:-5,  afford_adj:-3,  crash_adj:2  },
  { display:"Peterborough, ON",       aliases:["peterborough"],               prov:"ON", sgc:"3515005", lat:44.30, lng:-78.32, pop:83651,   country:"ca", supply_adj:-5,  afford_adj:-4,  crash_adj:2  },
  { display:"North Bay, ON",          aliases:["north bay"],                  prov:"ON", sgc:"3548010", lat:46.31, lng:-79.46, pop:51553,   country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1  },
  { display:"Sault Ste. Marie, ON",   aliases:["sault ste marie","soo"],      prov:"ON", sgc:"3557061", lat:46.51, lng:-84.34, pop:73368,   country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1  },
  { display:"Sarnia, ON",             aliases:["sarnia"],                     prov:"ON", sgc:"3538030", lat:42.97, lng:-82.40, pop:71594,   country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1  },
  { display:"Belleville, ON",         aliases:["belleville"],                 prov:"ON", sgc:"3512020", lat:44.16, lng:-77.38, pop:55686,   country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2  },
  { display:"Niagara Falls, ON",      aliases:["niagara falls ontario"],      prov:"ON", sgc:"3526043", lat:43.10, lng:-79.07, pop:99270,   country:"ca", supply_adj:-6,  afford_adj:-4,  crash_adj:3  },
  { display:"Welland, ON",            aliases:["welland"],                    prov:"ON", sgc:"3526026", lat:42.99, lng:-79.25, pop:55069,   country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2  },
  { display:"Aurora, ON",             aliases:["aurora ontario"],             prov:"ON", sgc:"3519002", lat:44.00, lng:-79.45, pop:67909,   country:"ca", supply_adj:-10, afford_adj:-9,  crash_adj:5  },
  { display:"Newmarket, ON",          aliases:["newmarket ontario"],          prov:"ON", sgc:"3519048", lat:44.05, lng:-79.47, pop:90260,   country:"ca", supply_adj:-10, afford_adj:-8,  crash_adj:5  },
  { display:"Ajax, ON",               aliases:["ajax ontario"],               prov:"ON", sgc:"3518002", lat:43.85, lng:-79.03, pop:126666,  country:"ca", supply_adj:-11, afford_adj:-9,  crash_adj:6  },
  { display:"Whitby, ON",             aliases:["whitby"],                     prov:"ON", sgc:"3518007", lat:43.87, lng:-78.94, pop:138501,  country:"ca", supply_adj:-10, afford_adj:-8,  crash_adj:5  },
  { display:"Pickering, ON",          aliases:["pickering"],                  prov:"ON", sgc:"3518001", lat:43.84, lng:-79.09, pop:99186,   country:"ca", supply_adj:-11, afford_adj:-9,  crash_adj:6  },
  { display:"Richmond Hill, ON",      aliases:["richmond hill"],              prov:"ON", sgc:"3519044", lat:43.87, lng:-79.44, pop:202022,  country:"ca", supply_adj:-13, afford_adj:-11, crash_adj:7  },
  { display:"Oakville, ON",           aliases:["oakville"],                   prov:"ON", sgc:"3524001", lat:43.45, lng:-79.69, pop:213759,  country:"ca", supply_adj:-12, afford_adj:-10, crash_adj:6  },
  { display:"Burlington, ON",         aliases:["burlington ontario"],         prov:"ON", sgc:"3524002", lat:43.33, lng:-79.80, pop:186948,  country:"ca", supply_adj:-11, afford_adj:-9,  crash_adj:5  },
  // ONTARIO — Small northern cities
  { display:"Kenora, ON",             aliases:["kenora"],                     prov:"ON", sgc:"3560027", lat:49.77, lng:-94.49, pop:15096,   country:"ca", supply_adj:2,   afford_adj:4,   crash_adj:-1 },
  { display:"Fort Frances, ON",       aliases:["fort frances"],               prov:"ON", sgc:"3560038", lat:48.61, lng:-93.40, pop:7559,    country:"ca", supply_adj:3,   afford_adj:5,   crash_adj:-2 },
  { display:"Timmins, ON",            aliases:["timmins"],                    prov:"ON", sgc:"3556027", lat:48.47, lng:-81.33, pop:41788,   country:"ca", supply_adj:1,   afford_adj:3,   crash_adj:-1 },
  { display:"Dryden, ON",             aliases:["dryden ontario"],             prov:"ON", sgc:"3560079", lat:49.78, lng:-92.84, pop:7749,    country:"ca", supply_adj:3,   afford_adj:5,   crash_adj:-2 },
  { display:"Sioux Lookout, ON",      aliases:["sioux lookout"],              prov:"ON", sgc:"3560090", lat:50.09, lng:-91.91, pop:5272,    country:"ca", supply_adj:4,   afford_adj:6,   crash_adj:-2 },
  { display:"Kapuskasing, ON",        aliases:["kapuskasing"],                prov:"ON", sgc:"3556068", lat:49.42, lng:-82.43, pop:8177,    country:"ca", supply_adj:2,   afford_adj:4,   crash_adj:-1 },
  { display:"Kirkland Lake, ON",      aliases:["kirkland lake"],              prov:"ON", sgc:"3554013", lat:48.15, lng:-80.03, pop:7981,    country:"ca", supply_adj:2,   afford_adj:4,   crash_adj:-1 },
  { display:"Temiskaming Shores, ON", aliases:["temiskaming","haileybury"],   prov:"ON", sgc:"3554006", lat:47.52, lng:-79.68, pop:9920,    country:"ca", supply_adj:2,   afford_adj:4,   crash_adj:-1 },
  { display:"Elliot Lake, ON",        aliases:["elliot lake"],                prov:"ON", sgc:"3557012", lat:46.38, lng:-82.65, pop:10741,   country:"ca", supply_adj:3,   afford_adj:5,   crash_adj:-2 },
  { display:"Parry Sound, ON",        aliases:["parry sound"],                prov:"ON", sgc:"3549005", lat:45.35, lng:-80.03, pop:5861,    country:"ca", supply_adj:1,   afford_adj:2,   crash_adj:0  },
  { display:"Bracebridge, ON",        aliases:["bracebridge"],                prov:"ON", sgc:"3544006", lat:45.04, lng:-79.31, pop:17533,   country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1  },
  { display:"Huntsville, ON",         aliases:["huntsville ontario"],         prov:"ON", sgc:"3544010", lat:45.33, lng:-79.22, pop:21054,   country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1  },
  { display:"Gravenhurst, ON",        aliases:["gravenhurst"],                prov:"ON", sgc:"3544026", lat:44.92, lng:-79.37, pop:12311,   country:"ca", supply_adj:-1,  afford_adj:-1,  crash_adj:1  },
  { display:"Cochrane, ON",           aliases:["cochrane ontario"],           prov:"ON", sgc:"3556010", lat:49.06, lng:-81.01, pop:5340,    country:"ca", supply_adj:3,   afford_adj:5,   crash_adj:-2 },
  { display:"Hearst, ON",             aliases:["hearst ontario"],             prov:"ON", sgc:"3556066", lat:49.69, lng:-83.67, pop:4722,    country:"ca", supply_adj:4,   afford_adj:6,   crash_adj:-2 },
  // BRITISH COLUMBIA
  { display:"Vancouver, BC",          aliases:["vancouver","yvr"],            prov:"BC", sgc:"5915022", lat:49.25, lng:-123.10, pop:662248,  country:"ca", supply_adj:-20, afford_adj:-18, crash_adj:10 },
  { display:"Surrey, BC",             aliases:["surrey bc"],                  prov:"BC", sgc:"5915004", lat:49.19, lng:-122.85, pop:568322,  country:"ca", supply_adj:-16, afford_adj:-14, crash_adj:8  },
  { display:"Burnaby, BC",            aliases:["burnaby"],                    prov:"BC", sgc:"5915025", lat:49.25, lng:-122.98, pop:249125,  country:"ca", supply_adj:-17, afford_adj:-15, crash_adj:9  },
  { display:"Richmond, BC",           aliases:["richmond bc"],                prov:"BC", sgc:"5915015", lat:49.16, lng:-123.13, pop:209937,  country:"ca", supply_adj:-17, afford_adj:-15, crash_adj:9  },
  { display:"Kelowna, BC",            aliases:["kelowna"],                    prov:"BC", sgc:"5935010", lat:49.89, lng:-119.49, pop:144576,  country:"ca", supply_adj:-12, afford_adj:-11, crash_adj:6  },
  { display:"Abbotsford, BC",         aliases:["abbotsford"],                 prov:"BC", sgc:"5909052", lat:49.05, lng:-122.30, pop:180518,  country:"ca", supply_adj:-11, afford_adj:-9,  crash_adj:5  },
  { display:"Coquitlam, BC",          aliases:["coquitlam"],                  prov:"BC", sgc:"5915029", lat:49.28, lng:-122.79, pop:148625,  country:"ca", supply_adj:-15, afford_adj:-13, crash_adj:8  },
  { display:"Victoria, BC",           aliases:["victoria bc","yyj"],          prov:"BC", sgc:"5917034", lat:48.43, lng:-123.37, pop:91867,   country:"ca", supply_adj:-14, afford_adj:-13, crash_adj:7  },
  { display:"Nanaimo, BC",            aliases:["nanaimo"],                    prov:"BC", sgc:"5921007", lat:49.16, lng:-123.94, pop:99863,   country:"ca", supply_adj:-9,  afford_adj:-8,  crash_adj:5  },
  { display:"Kamloops, BC",           aliases:["kamloops"],                   prov:"BC", sgc:"5933042", lat:50.67, lng:-120.33, pop:97902,   country:"ca", supply_adj:-7,  afford_adj:-6,  crash_adj:3  },
  { display:"Prince George, BC",      aliases:["prince george"],              prov:"BC", sgc:"5953023", lat:53.92, lng:-122.75, pop:74003,   country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1  },
  { display:"Chilliwack, BC",         aliases:["chilliwack"],                 prov:"BC", sgc:"5909010", lat:49.16, lng:-121.95, pop:93203,   country:"ca", supply_adj:-8,  afford_adj:-7,  crash_adj:4  },
  // ALBERTA
  { display:"Calgary, AB",            aliases:["calgary","yyc"],              prov:"AB", sgc:"4806016", lat:51.05, lng:-114.07, pop:1336000, country:"ca", supply_adj:-5,  afford_adj:-4,  crash_adj:3  },
  { display:"Edmonton, AB",           aliases:["edmonton","yeg"],             prov:"AB", sgc:"4811061", lat:53.55, lng:-113.47, pop:1010899, country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2  },
  { display:"Red Deer, AB",           aliases:["red deer"],                   prov:"AB", sgc:"4808011", lat:52.27, lng:-113.81, pop:100844,  country:"ca", supply_adj:-2,  afford_adj:-2,  crash_adj:1  },
  { display:"Lethbridge, AB",         aliases:["lethbridge"],                 prov:"AB", sgc:"4802012", lat:49.70, lng:-112.84, pop:101482,  country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1  },
  { display:"Fort McMurray, AB",      aliases:["fort mcmurray","wood buffalo"],prov:"AB", sgc:"4816037", lat:56.73, lng:-111.38, pop:68678,  country:"ca", supply_adj:0,   afford_adj:2,   crash_adj:0  },
  { display:"Grande Prairie, AB",     aliases:["grande prairie"],             prov:"AB", sgc:"4819033", lat:55.17, lng:-118.80, pop:68556,   country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0  },
  { display:"Medicine Hat, AB",       aliases:["medicine hat"],               prov:"AB", sgc:"4801006", lat:50.04, lng:-110.68, pop:65314,   country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0  },
  { display:"Airdrie, AB",            aliases:["airdrie"],                    prov:"AB", sgc:"4806005", lat:51.29, lng:-114.01, pop:73975,   country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2  },
  { display:"St. Albert, AB",         aliases:["st albert"],                  prov:"AB", sgc:"4811002", lat:53.63, lng:-113.63, pop:69588,   country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1  },
  { display:"Spruce Grove, AB",       aliases:["spruce grove"],               prov:"AB", sgc:"4811014", lat:53.55, lng:-113.90, pop:40195,   country:"ca", supply_adj:-2,  afford_adj:-2,  crash_adj:1  },
  // QUEBEC
  { display:"Montreal, QC",           aliases:["montreal","mtl","yul"],       prov:"QC", sgc:"2466023", lat:45.51, lng:-73.55, pop:2129661, country:"ca", supply_adj:-8,  afford_adj:-6,  crash_adj:4  },
  { display:"Quebec City, QC",        aliases:["quebec city","quebec"],       prov:"QC", sgc:"2423027", lat:46.81, lng:-71.21, pop:542298,  country:"ca", supply_adj:-5,  afford_adj:-4,  crash_adj:2  },
  { display:"Laval, QC",              aliases:["laval"],                      prov:"QC", sgc:"2465005", lat:45.57, lng:-73.69, pop:440745,  country:"ca", supply_adj:-7,  afford_adj:-5,  crash_adj:3  },
  { display:"Gatineau, QC",           aliases:["gatineau"],                   prov:"QC", sgc:"2481017", lat:45.48, lng:-75.70, pop:291041,  country:"ca", supply_adj:-6,  afford_adj:-5,  crash_adj:3  },
  { display:"Longueuil, QC",          aliases:["longueuil"],                  prov:"QC", sgc:"2458227", lat:45.53, lng:-73.52, pop:259715,  country:"ca", supply_adj:-7,  afford_adj:-5,  crash_adj:3  },
  { display:"Sherbrooke, QC",         aliases:["sherbrooke"],                 prov:"QC", sgc:"2443027", lat:45.40, lng:-71.90, pop:172950,  country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2  },
  { display:"Saguenay, QC",           aliases:["saguenay","chicoutimi"],      prov:"QC", sgc:"2494068", lat:48.42, lng:-71.07, pop:160980,  country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1  },
  { display:"Trois-Rivieres, QC",     aliases:["trois rivieres","trois-rivieres"], prov:"QC", sgc:"2437097", lat:46.35, lng:-72.55, pop:160018, country:"ca", supply_adj:-2, afford_adj:-1, crash_adj:1 },
  // MANITOBA
  { display:"Winnipeg, MB",           aliases:["winnipeg","ywg"],             prov:"MB", sgc:"4611040", lat:49.90, lng:-97.14, pop:749607,  country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1  },
  { display:"Brandon, MB",            aliases:["brandon mb"],                 prov:"MB", sgc:"4607066", lat:49.85, lng:-99.95, pop:51313,   country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0  },
  { display:"Steinbach, MB",          aliases:["steinbach"],                  prov:"MB", sgc:"4601052", lat:49.52, lng:-96.68, pop:17806,   country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1  },
  // SASKATCHEWAN
  { display:"Saskatoon, SK",          aliases:["saskatoon","yxe"],            prov:"SK", sgc:"4711066", lat:52.13, lng:-106.67, pop:317480, country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1  },
  { display:"Regina, SK",             aliases:["regina","yqr"],               prov:"SK", sgc:"4706027", lat:50.45, lng:-104.62, pop:249217, country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1  },
  { display:"Prince Albert, SK",      aliases:["prince albert sk"],           prov:"SK", sgc:"4715049", lat:53.20, lng:-105.75, pop:37756,  country:"ca", supply_adj:0,   afford_adj:1,   crash_adj:0  },
  { display:"Moose Jaw, SK",          aliases:["moose jaw"],                  prov:"SK", sgc:"4706027", lat:50.39, lng:-105.53, pop:34421,  country:"ca", supply_adj:0,   afford_adj:1,   crash_adj:0  },
  // NOVA SCOTIA
  { display:"Halifax, NS",            aliases:["halifax","yhz"],              prov:"NS", sgc:"1209034", lat:44.65, lng:-63.58, pop:465703,  country:"ca", supply_adj:-7,  afford_adj:-5,  crash_adj:3  },
  { display:"Cape Breton, NS",        aliases:["cape breton","sydney ns"],    prov:"NS", sgc:"1217030", lat:46.14, lng:-60.19, pop:94285,   country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0  },
  // NEW BRUNSWICK
  { display:"Moncton, NB",            aliases:["moncton"],                    prov:"NB", sgc:"1307022", lat:46.09, lng:-64.80, pop:90669,   country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2  },
  { display:"Saint John, NB",         aliases:["saint john nb","st john nb"], prov:"NB", sgc:"1301006", lat:45.27, lng:-66.06, pop:69895,   country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1  },
  { display:"Fredericton, NB",        aliases:["fredericton"],                prov:"NB", sgc:"1310032", lat:45.96, lng:-66.64, pop:63116,   country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1  },
  // NEWFOUNDLAND
  { display:"St. John's, NL",         aliases:["st johns","stjohns","yjt"],   prov:"NL", sgc:"1001519", lat:47.56, lng:-52.71, pop:110525,  country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2  },
  { display:"Corner Brook, NL",       aliases:["corner brook"],               prov:"NL", sgc:"1005026", lat:48.95, lng:-57.95, pop:19770,   country:"ca", supply_adj:0,   afford_adj:1,   crash_adj:0  },
  // PEI
  { display:"Charlottetown, PE",      aliases:["charlottetown"],              prov:"PE", sgc:"1102075", lat:46.24, lng:-63.13, pop:40285,   country:"ca", supply_adj:-5,  afford_adj:-4,  crash_adj:2  },
];

// ── US CITY DATABASE ────────────────────────────────────────────────────────────
const US_CITIES = [
  { display:"New York, NY",      aliases:["new york","nyc","ny"],           hpi:"ATNHPIUS35620Q", unemp:"NYUR",   med_inc:85000,  lat:40.71, lng:-74.01, country:"us" },
  { display:"Los Angeles, CA",   aliases:["los angeles","la","lax"],        hpi:"ATNHPIUS31080Q", unemp:"LAUR",   med_inc:72000,  lat:34.05, lng:-118.24, country:"us" },
  { display:"Chicago, IL",       aliases:["chicago","chi"],                 hpi:"ATNHPIUS16980Q", unemp:"CHUR",   med_inc:65000,  lat:41.88, lng:-87.63, country:"us" },
  { display:"Dallas, TX",        aliases:["dallas","dfw"],                  hpi:"ATNHPIUS19100Q", unemp:"DLLR",   med_inc:67000,  lat:32.78, lng:-96.80, country:"us" },
  { display:"Houston, TX",       aliases:["houston"],                       hpi:"ATNHPIUS26420Q", unemp:"HTUR",   med_inc:61000,  lat:29.76, lng:-95.37, country:"us" },
  { display:"Phoenix, AZ",       aliases:["phoenix","phx"],                 hpi:"ATNHPIUS38060Q", unemp:"PHXR",   med_inc:62000,  lat:33.45, lng:-112.07, country:"us" },
  { display:"Philadelphia, PA",  aliases:["philadelphia","philly"],         hpi:"ATNHPIUS37980Q", unemp:"PHIR",   med_inc:68000,  lat:39.95, lng:-75.16, country:"us" },
  { display:"San Antonio, TX",   aliases:["san antonio"],                   hpi:"ATNHPIUS41700Q", unemp:"SANR",   med_inc:55000,  lat:29.42, lng:-98.49, country:"us" },
  { display:"San Diego, CA",     aliases:["san diego"],                     hpi:"ATNHPIUS41740Q", unemp:"SDGR",   med_inc:78000,  lat:32.72, lng:-117.16, country:"us" },
  { display:"San Francisco, CA", aliases:["san francisco","sf","bay area"], hpi:"ATNHPIUS41860Q", unemp:"SFUR",   med_inc:112000, lat:37.77, lng:-122.42, country:"us" },
  { display:"Seattle, WA",       aliases:["seattle","sea"],                 hpi:"ATNHPIUS42660Q", unemp:"SEAR",   med_inc:92000,  lat:47.61, lng:-122.33, country:"us" },
  { display:"Denver, CO",        aliases:["denver"],                        hpi:"ATNHPIUS19740Q", unemp:"DENR",   med_inc:75000,  lat:39.74, lng:-104.98, country:"us" },
  { display:"Boston, MA",        aliases:["boston"],                        hpi:"ATNHPIUS14460Q", unemp:"BOSUR",  med_inc:89000,  lat:42.36, lng:-71.06, country:"us" },
  { display:"Austin, TX",        aliases:["austin"],                        hpi:"ATNHPIUS12420Q", unemp:"AUSR",   med_inc:75000,  lat:30.27, lng:-97.74, country:"us" },
  { display:"Miami, FL",         aliases:["miami"],                         hpi:"ATNHPIUS33100Q", unemp:"MIAMR",  med_inc:58000,  lat:25.77, lng:-80.19, country:"us" },
  { display:"Atlanta, GA",       aliases:["atlanta","atl"],                 hpi:"ATNHPIUS12060Q", unemp:"ATLUR",  med_inc:62000,  lat:33.75, lng:-84.39, country:"us" },
  { display:"Minneapolis, MN",   aliases:["minneapolis","msp"],             hpi:"ATNHPIUS33460Q", unemp:"MINNR",  med_inc:75000,  lat:44.98, lng:-93.27, country:"us" },
  { display:"Portland, OR",      aliases:["portland","pdx"],                hpi:"ATNHPIUS38900Q", unemp:"PORTR",  med_inc:72000,  lat:45.52, lng:-122.68, country:"us" },
  { display:"Las Vegas, NV",     aliases:["las vegas","vegas"],             hpi:"ATNHPIUS29820Q", unemp:"LVUR",   med_inc:56000,  lat:36.17, lng:-115.14, country:"us" },
  { display:"Nashville, TN",     aliases:["nashville"],                     hpi:"ATNHPIUS34980Q", unemp:"NSHVR",  med_inc:64000,  lat:36.17, lng:-86.78, country:"us" },
  { display:"Charlotte, NC",     aliases:["charlotte"],                     hpi:"ATNHPIUS16740Q", unemp:"CHAUR",  med_inc:62000,  lat:35.23, lng:-80.84, country:"us" },
  { display:"Raleigh, NC",       aliases:["raleigh"],                       hpi:"ATNHPIUS39580Q", unemp:"RALUR",  med_inc:70000,  lat:35.78, lng:-78.64, country:"us" },
  { display:"Orlando, FL",       aliases:["orlando"],                       hpi:"ATNHPIUS36740Q", unemp:"ORLUR",  med_inc:57000,  lat:28.54, lng:-81.38, country:"us" },
  { display:"Tampa, FL",         aliases:["tampa"],                         hpi:"ATNHPIUS45300Q", unemp:"TAMUR",  med_inc:57000,  lat:27.95, lng:-82.46, country:"us" },
  { display:"Sacramento, CA",    aliases:["sacramento"],                    hpi:"ATNHPIUS40900Q", unemp:"SACR",   med_inc:68000,  lat:38.58, lng:-121.49, country:"us" },
  { display:"Kansas City, MO",   aliases:["kansas city","kc"],              hpi:"ATNHPIUS28140Q", unemp:"KANCR",  med_inc:62000,  lat:39.10, lng:-94.58, country:"us" },
  { display:"Columbus, OH",      aliases:["columbus"],                      hpi:"ATNHPIUS18140Q", unemp:"COLUR",  med_inc:60000,  lat:39.96, lng:-82.99, country:"us" },
  { display:"Indianapolis, IN",  aliases:["indianapolis","indy"],           hpi:"ATNHPIUS26900Q", unemp:"INDUR",  med_inc:58000,  lat:39.77, lng:-86.16, country:"us" },
  { display:"Pittsburgh, PA",    aliases:["pittsburgh","pitt"],             hpi:"ATNHPIUS38300Q", unemp:"PITTUR", med_inc:58000,  lat:40.44, lng:-79.99, country:"us" },
];

const ALL_METROS = [...US_CITIES, ...CA_CITIES];

function findMetro(q) {
  const clean = q.toLowerCase().trim();
  return ALL_METROS.find(m =>
    m.display.toLowerCase().includes(clean) ||
    m.aliases.some(a => a.includes(clean) || clean.includes(a))
  );
}
function suggestCities(q) {
  const c = q.toLowerCase();
  return ALL_METROS.filter(m => m.display.toLowerCase().includes(c) || m.aliases.some(a => a.startsWith(c[0]))).slice(0,5).map(m => m.display);
}

// ── FRED helper ────────────────────────────────────────────────────────────────
async function fredLatest(id, key) {
  try {
    const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${key}&file_type=json&sort_order=desc&limit=2`);
    const j = await r.json();
    const obs = j.observations?.filter(o => o.value !== '.' && o.value !== '') || [];
    const val = parseFloat(obs[0]?.value);
    const prev = parseFloat(obs[1]?.value);
    return { value: isNaN(val)?null:val, prev: isNaN(prev)?null:prev, date: obs[0]?.date||null };
  } catch { return { value:null, prev:null, date:null }; }
}
async function fredVal(id, key) { const r = await fredLatest(id,key); return r.value; }

// ── US NATIONAL ────────────────────────────────────────────────────────────────
async function fetchUS(key) {
  const [mortgageRate,treasury10y,affordIndex,inventory,medianIncome,medianPrice,
         delinquency,vacancyRate,unemployRate,cpi] = await Promise.all([
    fredVal('MORTGAGE30US',key), fredVal('DGS10',key), fredVal('FIXHAI',key),
    fredVal('ACTLISCOUUS',key),  fredVal('MEHOINUSA672N',key), fredVal('MSPUS',key),
    fredVal('DRSFRMACBS',key),   fredVal('RVACRATE',key), fredVal('UNRATE',key), fredVal('CPIAUCSL',key),
  ]);
  return computeUS({mortgageRate,treasury10y,affordIndex,inventory,medianIncome,medianPrice,delinquency,vacancyRate,unemployRate,cpi});
}

function computeUS(r) {
  const supplyScore = parseFloat((r.inventory?Math.min((r.inventory/1500000)*100,100):50).toFixed(2));
  let ap=0;
  ap += r.affordIndex?Math.min((r.affordIndex/150)*40,40):20;
  ap += (r.medianPrice&&r.medianIncome)?Math.max(0,Math.min(20,20-((r.medianPrice/r.medianIncome)-4)*2.5)):8;
  ap += r.mortgageRate?Math.max(0,Math.min(15,15-(r.mortgageRate-3)*3)):7;
  ap += r.treasury10y?Math.max(0,Math.min(7.5,7.5-(r.treasury10y-2)*2.5)):3;
  ap += (r.medianIncome&&r.medianPrice)?Math.min((r.medianIncome/r.medianPrice)*350,17.5):8;
  const affordScore=parseFloat(Math.min(100,Math.max(0,ap)).toFixed(2));
  let cp=0;
  cp+=r.delinquency?Math.min(30,r.delinquency*6):10;
  cp+=r.vacancyRate?Math.min(20,Math.max(0,(r.vacancyRate-5)*4)):8;
  cp+=r.unemployRate?Math.min(25,Math.max(0,(r.unemployRate-4)*6.25)):10;
  cp+=r.mortgageRate?Math.min(20,Math.max(0,(r.mortgageRate-4)*6.67)):8;
  cp+=(r.treasury10y&&r.mortgageRate)?Math.min(20,Math.max(0,(r.mortgageRate-r.treasury10y)*5)):8;
  cp+=r.cpi?Math.min(20,Math.max(0,(r.cpi-260)*0.3)):8;
  const crashScore=parseFloat(Math.min(100,Math.max(0,(cp/135)*100)).toFixed(2));
  return{supply:supplyScore,afford:affordScore,crash:crashScore,health:parseFloat(((affordScore*0.45)+(supplyScore*0.35)+((100-crashScore)*0.20)).toFixed(1)),raw:r};
}

// ── US CITY ────────────────────────────────────────────────────────────────────
async function fetchCityUS(metro,key) {
  const [natMortgage,natTreasury,natAfford,natInventory,natDelinq,natVacancy,natCPI,cityHPI,cityUnemp]=await Promise.all([
    fredVal('MORTGAGE30US',key),fredVal('DGS10',key),fredVal('FIXHAI',key),fredVal('ACTLISCOUUS',key),
    fredVal('DRSFRMACBS',key),fredVal('RVACRATE',key),fredVal('CPIAUCSL',key),
    metro.hpi?fredVal(metro.hpi,key):Promise.resolve(null),
    metro.unemp?fredVal(metro.unemp,key):Promise.resolve(null),
  ]);
  const cityPrice=cityHPI?(cityHPI/550)*420000:420000;
  const priceRatio=cityPrice/420000;
  const cityInvProxy=(natInventory||750000)/Math.max(1,priceRatio*1.2);
  const supplyScore=parseFloat(Math.min((cityInvProxy/(1500000*0.05))*100,100).toFixed(2));
  const r={mortgageRate:natMortgage,treasury10y:natTreasury,affordIndex:natAfford?(natAfford*(420000/cityPrice)):null,medianIncome:metro.med_inc,medianPrice:cityPrice,delinquency:natDelinq,vacancyRate:natVacancy,unemployRate:cityUnemp,cpi:natCPI,cityHPI};
  let ap=0;
  ap+=r.affordIndex?Math.min((r.affordIndex/150)*40,40):15;
  ap+=Math.max(0,Math.min(20,20-((r.medianPrice/r.medianIncome)-4)*2.5));
  ap+=r.mortgageRate?Math.max(0,Math.min(15,15-(r.mortgageRate-3)*3)):7;
  ap+=r.treasury10y?Math.max(0,Math.min(7.5,7.5-(r.treasury10y-2)*2.5)):3;
  ap+=Math.min((r.medianIncome/r.medianPrice)*350,17.5);
  const affordScore=parseFloat(Math.min(100,Math.max(0,ap)).toFixed(2));
  let cp=0;
  cp+=r.delinquency?Math.min(30,r.delinquency*6):10;
  cp+=r.vacancyRate?Math.min(20,Math.max(0,(r.vacancyRate-5)*4)):8;
  cp+=r.unemployRate?Math.min(25,Math.max(0,(r.unemployRate-4)*6.25)):10;
  cp+=r.mortgageRate?Math.min(20,Math.max(0,(r.mortgageRate-4)*6.67)):8;
  cp+=(r.treasury10y&&r.mortgageRate)?Math.min(20,Math.max(0,(r.mortgageRate-r.treasury10y)*5)):8;
  cp+=r.cpi?Math.min(20,Math.max(0,(r.cpi-260)*0.3)):8;
  cp+=Math.min(15,(priceRatio-1)*10);
  const crashScore=parseFloat(Math.min(100,Math.max(0,(cp/150)*100)).toFixed(2));
  return{supply:supplyScore,afford:affordScore,crash:crashScore,health:parseFloat(((affordScore*0.45)+(supplyScore*0.35)+((100-crashScore)*0.20)).toFixed(1)),raw:{...r,estimatedCityPrice:Math.round(cityPrice)}};
}

// ── CANADA NATIONAL ────────────────────────────────────────────────────────────
async function fetchCA() {
  try {
    const j=await(await fetch('https://www.bankofcanada.ca/valet/observations/group/bond_yields_all/json?recent=1')).json();
    const obs=j?.observations?.[0]||{};
    return computeCA({bond10y:parseFloat(obs['BD.CDN.10YR.DQ.YLD']?.v)||3.5,bond5y:parseFloat(obs['BD.CDN.5YR.DQ.YLD']?.v)||3.2});
  } catch{return{supply:32,afford:38.5,crash:58.2,health:43.1,raw:{},fallback:true};}
}
async function fetchCityCA(metro) {
  try {
    const j=await(await fetch('https://www.bankofcanada.ca/valet/observations/group/bond_yields_all/json?recent=1')).json();
    const obs=j?.observations?.[0]||{};
    return computeCA({bond10y:parseFloat(obs['BD.CDN.10YR.DQ.YLD']?.v)||3.5,bond5y:parseFloat(obs['BD.CDN.5YR.DQ.YLD']?.v)||3.2,supplyAdj:metro.supply_adj||0,affordAdj:metro.afford_adj||0,crashAdj:metro.crash_adj||0});
  } catch{return{supply:32,afford:38.5,crash:58.2,health:43.1,raw:{},fallback:true};}
}
function computeCA({bond10y,bond5y,supplyAdj=0,affordAdj=0,crashAdj=0}) {
  const mr=(bond5y||3.2)+1.5;
  const supplyScore=parseFloat(Math.max(0,32+supplyAdj).toFixed(2));
  let ap=0;
  ap+=Math.min((65/150)*40,40);
  ap+=Math.max(0,Math.min(20,20-(10-4)*2.5));
  ap+=Math.max(0,Math.min(15,15-(mr-3)*3));
  ap+=Math.max(0,Math.min(7.5,7.5-((bond10y||3.5)-2)*2.5));
  ap+=Math.min(0.1*350,17.5);
  const affordScore=parseFloat(Math.min(100,Math.max(0,ap+affordAdj)).toFixed(2));
  let cp=8+12+8+15;
  cp+=Math.min(20,Math.max(0,(mr-4)*6.67));
  cp+=Math.min(20,Math.max(0,(mr-(bond10y||3.5))*5));
  const crashScore=parseFloat(Math.min(100,Math.max(0,((cp+crashAdj)/135)*100)).toFixed(2));
  return{supply:supplyScore,afford:affordScore,crash:crashScore,health:parseFloat(((affordScore*0.45)+(supplyScore*0.35)+((100-crashScore)*0.20)).toFixed(1)),raw:{mortgageRate:mr,bond10y,bond5y}};
}

// ── US RATES ────────────────────────────────────────────────────────────────────
async function fetchRatesUS(key) {
  const [fedFunds,prime,mort30,mort15,t2y,t5y,t10y,t30y,spread]=await Promise.all([
    fredLatest('FEDFUNDS',key),fredLatest('DPRIME',key),fredLatest('MORTGAGE30US',key),
    fredLatest('MORTGAGE15US',key),fredLatest('DGS2',key),fredLatest('DGS5',key),
    fredLatest('DGS10',key),fredLatest('DGS30',key),fredLatest('T10Y2Y',key),
  ]);
  let cpiYoY=null,coreCpiYoY=null,pceYoY=null,corePceYoY=null;
  try{[cpiYoY,coreCpiYoY,pceYoY,corePceYoY]=await Promise.all([fetchYoY('CPIAUCSL',key),fetchYoY('CPILFESL',key),fetchYoY('PCEPI',key),fetchYoY('PCEPILFE',key)]);}catch{}
  const [inflExp,breakeven,tipsReal]=await Promise.all([fredLatest('MICH',key),fredLatest('T10YIE',key),fredLatest('DFII10',key)]);
  return{
    rates:{fedFunds:{...fedFunds,label:"Fed Funds Rate"},prime:{...prime,label:"Bank Prime Rate"},mort30:{...mort30,label:"30yr Mortgage"},mort15:{...mort15,label:"15yr Mortgage"},t2y:{...t2y,label:"2Y Treasury"},t5y:{...t5y,label:"5Y Treasury"},t10y:{...t10y,label:"10Y Treasury"},t30y:{...t30y,label:"30Y Treasury"},spread:{...spread,label:"Yield Curve (10Y-2Y)"}},
    inflation:{cpi:{value:cpiYoY,label:"CPI (YoY %)",target:2.0},coreCpi:{value:coreCpiYoY,label:"Core CPI (YoY %)",target:2.0},pce:{value:pceYoY,label:"PCE (YoY %)",target:2.0},corePce:{value:corePceYoY,label:"Core PCE (YoY %)",target:2.0},inflExp:{value:inflExp.value,label:"1yr Inflation Exp. (%)"},breakeven:{value:breakeven.value,label:"10Y Breakeven (%)"},tipsReal:{value:tipsReal.value,label:"10Y Real Rate (TIPS %)"}}
  };
}
async function fetchYoY(id,key) {
  try{
    const r=await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${key}&file_type=json&sort_order=desc&limit=13`);
    const j=await r.json();
    const obs=j.observations?.filter(o=>o.value!=='.'&&o.value!=='')||[];
    if(obs.length<13)return null;
    const latest=parseFloat(obs[0].value),yearAgo=parseFloat(obs[12].value);
    if(isNaN(latest)||isNaN(yearAgo)||yearAgo===0)return null;
    return parseFloat(((latest-yearAgo)/yearAgo*100).toFixed(2));
  }catch{return null;}
}

// ── CANADA RATES ────────────────────────────────────────────────────────────────
async function fetchRatesCA() {
  try{
    const[bondsRes,overnightRes]=await Promise.all([
      fetch('https://www.bankofcanada.ca/valet/observations/group/bond_yields_all/json?recent=2'),
      fetch('https://www.bankofcanada.ca/valet/observations/V39079/json?recent=2'),
    ]);
    const bondsData=await bondsRes.json(),overnightData=await overnightRes.json();
    const obs0=bondsData?.observations?.[0]||{},obs1=bondsData?.observations?.[1]||{};
    const ovObs=overnightData?.observations||[];
    const overnight={value:parseFloat(ovObs[0]?.V39079)||null,prev:parseFloat(ovObs[1]?.V39079)||null,label:"BOC Overnight Rate"};
    const bond2y={value:parseFloat(obs0['BD.CDN.2YR.DQ.YLD']?.v)||null,prev:parseFloat(obs1['BD.CDN.2YR.DQ.YLD']?.v)||null,label:"2Y Govt Bond"};
    const bond5y={value:parseFloat(obs0['BD.CDN.5YR.DQ.YLD']?.v)||null,prev:parseFloat(obs1['BD.CDN.5YR.DQ.YLD']?.v)||null,label:"5Y Govt Bond"};
    const bond10y={value:parseFloat(obs0['BD.CDN.10YR.DQ.YLD']?.v)||null,prev:parseFloat(obs1['BD.CDN.10YR.DQ.YLD']?.v)||null,label:"10Y Govt Bond"};
    const bond30y={value:parseFloat(obs0['BD.CDN.LONG.DQ.YLD']?.v)||null,prev:parseFloat(obs1['BD.CDN.LONG.DQ.YLD']?.v)||null,label:"Long Bond"};
    const mort5y=bond5y.value?parseFloat((bond5y.value+1.5).toFixed(2)):null;
    const spread=(bond10y.value&&bond2y.value)?parseFloat((bond10y.value-bond2y.value).toFixed(2)):null;
    return{
      rates:{overnight,prime:{value:overnight.value?parseFloat((overnight.value+2.2).toFixed(2)):null,label:"Prime Rate"},mort5y:{value:mort5y,label:"5yr Fixed Mortgage (est.)"},bond2y,bond5y,bond10y,bond30y,spread:{value:spread,label:"Yield Curve (10Y-2Y)"}},
      inflation:{cpi:{value:2.6,label:"CPI (YoY %)",target:2.0,note:"Stats Can est."},coreCpi:{value:2.9,label:"Core CPI (YoY %)",target:2.0,note:"Stats Can est."}}
    };
  }catch{return{rates:{overnight:{value:3.0,label:"BOC Overnight Rate"},bond10y:{value:3.5,label:"10Y Govt Bond"}},inflation:{cpi:{value:2.6,label:"CPI (YoY %)",target:2.0}},fallback:true};}
}
