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
      const [data, rates] = await Promise.all([
        isCA ? fetchCityCA(metro) : fetchCityUS(metro, FRED_KEY),
        isCA ? fetchRatesCA() : fetchRatesUS(FRED_KEY),
      ]);
      return res.status(200).json({ city: metro.display, country: metro.country, province: metro.prov || null, lat: metro.lat || null, lng: metro.lng || null, data, rates, estimated: metro.estimated || false, updated: new Date().toISOString() });
    }

    const [us, ca, ratesUS, ratesCA] = await Promise.all([fetchUS(FRED_KEY), fetchCA(), fetchRatesUS(FRED_KEY), fetchRatesCA()]);
    return res.status(200).json({ us, ca, ratesUS, ratesCA, updated: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── CANADIAN CITY DATABASE (98 cities) ────────────────────────────────────────
const CA_CITIES = [
  // ONTARIO — Large
  { display:"Toronto, ON",            aliases:["toronto","yyz","scarborough","etobicoke","north york","east york","york ontario"],              prov:"ON", sgc:"3520005", lat:43.70, lng:-79.42, pop:2794356, country:"ca", supply_adj:-15, afford_adj:-12, crash_adj:8  },
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
  // YUKON
  { display:"Whitehorse, YT",         aliases:["whitehorse","yxy"],           prov:"YT", sgc:"6001009", lat:60.72, lng:-135.05, pop:28201,  country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1  },
  // NORTHWEST TERRITORIES
  { display:"Yellowknife, NT",        aliases:["yellowknife","yzf"],          prov:"NT", sgc:"6101006", lat:62.45, lng:-114.38, pop:20340,  country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1  },
  // NUNAVUT
  { display:"Iqaluit, NU",            aliases:["iqaluit","yfu"],              prov:"NU", sgc:"6204003", lat:63.75, lng:-68.52,  pop:7429,   country:"ca", supply_adj:2,   afford_adj:-5,  crash_adj:0  },
  // ONTARIO — additional GTA/suburbs
  { display:"Scarborough, ON",        aliases:["scarborough"],                prov:"ON", sgc:"3520005", lat:43.77, lng:-79.26, pop:632098,  country:"ca", supply_adj:-14, afford_adj:-11, crash_adj:7  },
  { display:"Etobicoke, ON",          aliases:["etobicoke"],                  prov:"ON", sgc:"3520005", lat:43.69, lng:-79.55, pop:362325,  country:"ca", supply_adj:-13, afford_adj:-10, crash_adj:7  },
  { display:"North York, ON",         aliases:["north york"],                 prov:"ON", sgc:"3520005", lat:43.76, lng:-79.41, pop:655305,  country:"ca", supply_adj:-14, afford_adj:-11, crash_adj:7  },
  { display:"Mississauga, ON",        aliases:["port credit","streetsville","cooksville"], prov:"ON", sgc:"3521010", lat:43.59, lng:-79.64, pop:717961, country:"ca", supply_adj:-14, afford_adj:-11, crash_adj:7 },
  { display:"Thornhill, ON",          aliases:["thornhill"],                  prov:"ON", sgc:"3519044", lat:43.81, lng:-79.42, pop:114652,  country:"ca", supply_adj:-13, afford_adj:-11, crash_adj:7  },
  { display:"Woodbridge, ON",         aliases:["woodbridge ontario"],         prov:"ON", sgc:"3519049", lat:43.78, lng:-79.59, pop:47766,   country:"ca", supply_adj:-12, afford_adj:-10, crash_adj:6  },
  { display:"Orangeville, ON",        aliases:["orangeville"],                prov:"ON", sgc:"3522013", lat:43.92, lng:-80.09, pop:30167,   country:"ca", supply_adj:-7,  afford_adj:-5,  crash_adj:3  },
  { display:"Collingwood, ON",        aliases:["collingwood"],                prov:"ON", sgc:"3543013", lat:44.50, lng:-80.22, pop:24905,   country:"ca", supply_adj:-6,  afford_adj:-5,  crash_adj:3  },
  { display:"Owen Sound, ON",         aliases:["owen sound"],                 prov:"ON", sgc:"3542006", lat:44.57, lng:-80.94, pop:21688,   country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1  },
  { display:"Midland, ON",            aliases:["midland ontario"],            prov:"ON", sgc:"3543042", lat:44.75, lng:-79.88, pop:16941,   country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2  },
  { display:"Cobourg, ON",            aliases:["cobourg"],                    prov:"ON", sgc:"3514008", lat:43.96, lng:-78.17, pop:20730,   country:"ca", supply_adj:-5,  afford_adj:-4,  crash_adj:2  },
  { display:"Port Hope, ON",          aliases:["port hope ontario"],          prov:"ON", sgc:"3514005", lat:43.95, lng:-78.30, pop:17949,   country:"ca", supply_adj:-5,  afford_adj:-4,  crash_adj:2  },
  // BC — additional
  { display:"Langley, BC",            aliases:["langley bc"],                 prov:"BC", sgc:"5915011", lat:49.10, lng:-122.66, pop:132603,  country:"ca", supply_adj:-12, afford_adj:-10, crash_adj:6  },
  { display:"Delta, BC",              aliases:["delta bc","ladner","tsawwassen"], prov:"BC", sgc:"5915007", lat:49.08, lng:-123.06, pop:108455, country:"ca", supply_adj:-13, afford_adj:-11, crash_adj:7 },
  { display:"North Vancouver, BC",    aliases:["north vancouver"],            prov:"BC", sgc:"5915046", lat:49.32, lng:-123.07, pop:85935,   country:"ca", supply_adj:-18, afford_adj:-16, crash_adj:9  },
  { display:"West Vancouver, BC",     aliases:["west vancouver"],             prov:"BC", sgc:"5915051", lat:49.36, lng:-123.17, pop:44122,   country:"ca", supply_adj:-20, afford_adj:-19, crash_adj:10 },
  { display:"Maple Ridge, BC",        aliases:["maple ridge"],                prov:"BC", sgc:"5915029", lat:49.22, lng:-122.60, pop:90990,   country:"ca", supply_adj:-10, afford_adj:-9,  crash_adj:5  },
  { display:"Port Coquitlam, BC",     aliases:["port coquitlam","poco"],      prov:"BC", sgc:"5915043", lat:49.26, lng:-122.78, pop:61498,   country:"ca", supply_adj:-13, afford_adj:-11, crash_adj:7  },
  { display:"White Rock, BC",         aliases:["white rock bc"],              prov:"BC", sgc:"5915058", lat:49.02, lng:-122.80, pop:22340,   country:"ca", supply_adj:-14, afford_adj:-12, crash_adj:7  },
  { display:"Courtenay, BC",          aliases:["courtenay","comox valley"],   prov:"BC", sgc:"5926010", lat:49.69, lng:-124.99, pop:28304,   country:"ca", supply_adj:-8,  afford_adj:-7,  crash_adj:4  },
  { display:"Campbell River, BC",     aliases:["campbell river"],             prov:"BC", sgc:"5924034", lat:50.02, lng:-125.25, pop:37757,   country:"ca", supply_adj:-5,  afford_adj:-4,  crash_adj:2  },
  { display:"Cranbrook, BC",          aliases:["cranbrook bc"],               prov:"BC", sgc:"5901006", lat:49.51, lng:-115.77, pop:26083,   country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1  },
  { display:"Penticton, BC",          aliases:["penticton"],                  prov:"BC", sgc:"5907016", lat:49.49, lng:-119.59, pop:33761,   country:"ca", supply_adj:-9,  afford_adj:-8,  crash_adj:4  },
  { display:"Vernon, BC",             aliases:["vernon bc"],                  prov:"BC", sgc:"5937065", lat:50.27, lng:-119.27, pop:44168,   country:"ca", supply_adj:-8,  afford_adj:-7,  crash_adj:4  },
  // ALBERTA — additional
  { display:"Sherwood Park, AB",      aliases:["sherwood park"],              prov:"AB", sgc:"4811052", lat:53.52, lng:-113.32, pop:76015,   country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1  },
  { display:"Cochrane, AB",           aliases:["cochrane ab","cochrane alberta"], prov:"AB", sgc:"4806006", lat:51.19, lng:-114.47, pop:33630, country:"ca", supply_adj:-4, afford_adj:-3,  crash_adj:2  },
  { display:"Okotoks, AB",            aliases:["okotoks"],                    prov:"AB", sgc:"4806010", lat:50.73, lng:-113.98, pop:30426,   country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2  },
  { display:"Lloydminster, AB",       aliases:["lloydminster"],               prov:"AB", sgc:"4810023", lat:53.28, lng:-110.00, pop:31897,   country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0  },
  { display:"Camrose, AB",            aliases:["camrose"],                    prov:"AB", sgc:"4805006", lat:53.02, lng:-112.83, pop:18742,   country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0  },
  // QUEBEC — additional
  { display:"Levis, QC",              aliases:["levis","lévis"],              prov:"QC", sgc:"2425213", lat:46.80, lng:-71.18, pop:146643,  country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2  },
  { display:"Repentigny, QC",         aliases:["repentigny"],                 prov:"QC", sgc:"2461007", lat:45.74, lng:-73.46, pop:84965,   country:"ca", supply_adj:-6,  afford_adj:-4,  crash_adj:3  },
  { display:"Brossard, QC",           aliases:["brossard"],                   prov:"QC", sgc:"2457058", lat:45.46, lng:-73.46, pop:85721,   country:"ca", supply_adj:-6,  afford_adj:-4,  crash_adj:3  },
  { display:"Drummondville, QC",      aliases:["drummondville"],              prov:"QC", sgc:"2449110", lat:45.88, lng:-72.48, pop:82948,   country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1  },
  { display:"Saint-Jerome, QC",       aliases:["saint jerome","st jerome"],   prov:"QC", sgc:"2475027", lat:45.78, lng:-74.00, pop:79756,   country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2  },
  { display:"Granby, QC",             aliases:["granby qc"],                  prov:"QC", sgc:"2447057", lat:45.40, lng:-72.73, pop:71249,   country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1  },
  // NOVA SCOTIA — additional
  { display:"Dartmouth, NS",          aliases:["dartmouth ns"],               prov:"NS", sgc:"1209034", lat:44.67, lng:-63.57, pop:101657,  country:"ca", supply_adj:-6,  afford_adj:-4,  crash_adj:3  },
  { display:"Truro, NS",              aliases:["truro ns"],                   prov:"NS", sgc:"1209015", lat:45.36, lng:-63.29, pop:12954,   country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1  },
  // NEW BRUNSWICK — additional
  { display:"Miramichi, NB",          aliases:["miramichi"],                  prov:"NB", sgc:"1315033", lat:47.02, lng:-65.50, pop:17537,   country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0  },
  { display:"Bathurst, NB",           aliases:["bathurst nb"],                prov:"NB", sgc:"1314019", lat:47.62, lng:-65.65, pop:10661,   country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0  },
  // ── ESTIMATED CITIES (no direct data feed — scores derived from provincial baseline) ──
  // YUKON — small towns
  { display:"Dawson City, YT",        aliases:["dawson city","dawson yt"],    prov:"YT", lat:64.06, lng:-139.43, pop:1375,   country:"ca", supply_adj:5,   afford_adj:-3,  crash_adj:-1, estimated:true },
  { display:"Watson Lake, YT",        aliases:["watson lake"],                prov:"YT", lat:60.06, lng:-128.71, pop:1064,   country:"ca", supply_adj:4,   afford_adj:-2,  crash_adj:-1, estimated:true },
  { display:"Haines Junction, YT",    aliases:["haines junction"],            prov:"YT", lat:60.75, lng:-137.51, pop:1028,   country:"ca", supply_adj:4,   afford_adj:-2,  crash_adj:-1, estimated:true },
  // NWT — small towns
  { display:"Hay River, NT",          aliases:["hay river"],                  prov:"NT", lat:60.82, lng:-115.78, pop:3353,   country:"ca", supply_adj:3,   afford_adj:-2,  crash_adj:-1, estimated:true },
  { display:"Inuvik, NT",             aliases:["inuvik"],                     prov:"NT", lat:68.36, lng:-133.72, pop:3243,   country:"ca", supply_adj:3,   afford_adj:-3,  crash_adj:-1, estimated:true },
  { display:"Fort Smith, NT",         aliases:["fort smith nt"],              prov:"NT", lat:60.00, lng:-111.89, pop:2093,   country:"ca", supply_adj:3,   afford_adj:-2,  crash_adj:-1, estimated:true },
  { display:"Norman Wells, NT",       aliases:["norman wells"],               prov:"NT", lat:65.28, lng:-126.83, pop:1021,   country:"ca", supply_adj:3,   afford_adj:-4,  crash_adj:-1, estimated:true },
  // ONTARIO — small/mid towns
  { display:"Stratford, ON",          aliases:["stratford ontario"],          prov:"ON", lat:43.37, lng:-80.98, pop:32000,   country:"ca", supply_adj:-5,  afford_adj:-3,  crash_adj:2,  estimated:true },
  { display:"Woodstock, ON",          aliases:["woodstock ontario"],          prov:"ON", lat:43.13, lng:-80.75, pop:45000,   country:"ca", supply_adj:-5,  afford_adj:-3,  crash_adj:2,  estimated:true },
  { display:"Orillia, ON",            aliases:["orillia"],                    prov:"ON", lat:44.61, lng:-79.42, pop:33000,   country:"ca", supply_adj:-5,  afford_adj:-4,  crash_adj:2,  estimated:true },
  { display:"Lindsay, ON",            aliases:["lindsay ontario","kawartha lakes"], prov:"ON", lat:44.35, lng:-78.74, pop:20800, country:"ca", supply_adj:-4, afford_adj:-3, crash_adj:2, estimated:true },
  { display:"Pembroke, ON",           aliases:["pembroke ontario"],           prov:"ON", lat:45.82, lng:-77.11, pop:14000,   country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Trenton, ON",            aliases:["trenton ontario","quinte west"], prov:"ON", lat:44.10, lng:-77.58, pop:17000, country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2,  estimated:true },
  { display:"Napanee, ON",            aliases:["napanee"],                    prov:"ON", lat:44.25, lng:-76.95, pop:16000,   country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Cornwall, ON",           aliases:["cornwall ontario"],           prov:"ON", lat:45.02, lng:-74.73, pop:47000,   country:"ca", supply_adj:-4,  afford_adj:-2,  crash_adj:2,  estimated:true },
  { display:"Hawkesbury, ON",         aliases:["hawkesbury"],                 prov:"ON", lat:45.61, lng:-74.60, pop:10500,   country:"ca", supply_adj:-3,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Smiths Falls, ON",       aliases:["smiths falls"],               prov:"ON", lat:44.90, lng:-76.02, pop:9200,    country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Brockville, ON",         aliases:["brockville"],                 prov:"ON", lat:44.59, lng:-75.69, pop:21870,   country:"ca", supply_adj:-4,  afford_adj:-2,  crash_adj:2,  estimated:true },
  { display:"Renfrew, ON",            aliases:["renfrew ontario"],            prov:"ON", lat:45.47, lng:-76.68, pop:8200,    country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Arnprior, ON",           aliases:["arnprior"],                   prov:"ON", lat:45.43, lng:-76.35, pop:10000,   country:"ca", supply_adj:-5,  afford_adj:-4,  crash_adj:2,  estimated:true },
  { display:"Carleton Place, ON",     aliases:["carleton place"],             prov:"ON", lat:45.14, lng:-76.15, pop:13500,   country:"ca", supply_adj:-6,  afford_adj:-5,  crash_adj:3,  estimated:true },
  { display:"Almonte, ON",            aliases:["almonte ontario"],            prov:"ON", lat:45.23, lng:-76.19, pop:5300,    country:"ca", supply_adj:-5,  afford_adj:-4,  crash_adj:2,  estimated:true },
  { display:"Perth, ON",              aliases:["perth ontario"],              prov:"ON", lat:44.90, lng:-76.25, pop:6000,    country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Prescott, ON",           aliases:["prescott ontario"],           prov:"ON", lat:44.72, lng:-75.52, pop:4400,    country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Kemptville, ON",         aliases:["kemptville"],                 prov:"ON", lat:45.02, lng:-75.65, pop:4900,    country:"ca", supply_adj:-5,  afford_adj:-4,  crash_adj:2,  estimated:true },
  { display:"Listowel, ON",           aliases:["listowel"],                   prov:"ON", lat:43.73, lng:-80.95, pop:8600,    country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2,  estimated:true },
  { display:"Fergus, ON",             aliases:["fergus ontario","centre wellington"], prov:"ON", lat:43.70, lng:-80.38, pop:20000, country:"ca", supply_adj:-6, afford_adj:-5, crash_adj:3, estimated:true },
  { display:"Elora, ON",              aliases:["elora ontario"],              prov:"ON", lat:43.68, lng:-80.43, pop:3800,    country:"ca", supply_adj:-5,  afford_adj:-4,  crash_adj:2,  estimated:true },
  { display:"Palmerston, ON",         aliases:["palmerston ontario"],         prov:"ON", lat:43.83, lng:-80.84, pop:2500,    country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Wingham, ON",            aliases:["wingham ontario"],            prov:"ON", lat:43.88, lng:-81.31, pop:2900,    country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Clinton, ON",            aliases:["clinton ontario"],            prov:"ON", lat:43.61, lng:-81.53, pop:3100,    country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Goderich, ON",           aliases:["goderich"],                   prov:"ON", lat:43.74, lng:-81.71, pop:7800,    country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Kincardine, ON",         aliases:["kincardine"],                 prov:"ON", lat:44.18, lng:-81.64, pop:12000,   country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2,  estimated:true },
  { display:"Southampton, ON",        aliases:["southampton ontario"],        prov:"ON", lat:44.50, lng:-81.37, pop:3200,    country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2,  estimated:true },
  { display:"Hanover, ON",            aliases:["hanover ontario"],            prov:"ON", lat:44.15, lng:-81.03, pop:8200,    country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Mount Forest, ON",       aliases:["mount forest"],               prov:"ON", lat:43.98, lng:-80.73, pop:5000,    country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Tillsonburg, ON",        aliases:["tillsonburg"],                prov:"ON", lat:42.86, lng:-80.73, pop:18000,   country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2,  estimated:true },
  { display:"Simcoe, ON",             aliases:["simcoe ontario"],             prov:"ON", lat:42.84, lng:-80.30, pop:15000,   country:"ca", supply_adj:-4,  afford_adj:-2,  crash_adj:2,  estimated:true },
  { display:"Aylmer, ON",             aliases:["aylmer ontario"],             prov:"ON", lat:42.77, lng:-80.99, pop:8300,    country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Leamington, ON",         aliases:["leamington"],                 prov:"ON", lat:42.05, lng:-82.60, pop:30000,   country:"ca", supply_adj:-3,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Amherstburg, ON",        aliases:["amherstburg"],                prov:"ON", lat:42.10, lng:-83.10, pop:24000,   country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Tecumseh, ON",           aliases:["tecumseh ontario"],           prov:"ON", lat:42.24, lng:-82.92, pop:25000,   country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2,  estimated:true },
  { display:"Chatham, ON",            aliases:["chatham ontario","chatham-kent"], prov:"ON", lat:42.40, lng:-82.19, pop:45000, country:"ca", supply_adj:-3, afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Wallaceburg, ON",        aliases:["wallaceburg"],                prov:"ON", lat:42.60, lng:-82.39, pop:11000,   country:"ca", supply_adj:-2,  afford_adj:0,   crash_adj:1,  estimated:true },
  { display:"Strathroy, ON",          aliases:["strathroy"],                  prov:"ON", lat:42.96, lng:-81.62, pop:22000,   country:"ca", supply_adj:-4,  afford_adj:-2,  crash_adj:2,  estimated:true },
  { display:"St. Thomas, ON",         aliases:["st thomas ontario","saint thomas on"], prov:"ON", lat:42.78, lng:-81.19, pop:42000, country:"ca", supply_adj:-5, afford_adj:-3, crash_adj:2, estimated:true },
  { display:"Ingersoll, ON",          aliases:["ingersoll ontario"],          prov:"ON", lat:43.04, lng:-80.88, pop:13000,   country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2,  estimated:true },
  // BC — small towns
  { display:"Prince Rupert, BC",      aliases:["prince rupert"],              prov:"BC", lat:54.31, lng:-130.32, pop:12220,  country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Terrace, BC",            aliases:["terrace bc"],                 prov:"BC", lat:54.52, lng:-128.60, pop:12700,  country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Kitimat, BC",            aliases:["kitimat"],                    prov:"BC", lat:54.05, lng:-128.65, pop:8448,   country:"ca", supply_adj:-1,  afford_adj:1,   crash_adj:0,  estimated:true },
  { display:"Fort St. John, BC",      aliases:["fort st john","fort saint john"], prov:"BC", lat:56.25, lng:-120.85, pop:23000, country:"ca", supply_adj:-1, afford_adj:1,  crash_adj:0,  estimated:true },
  { display:"Dawson Creek, BC",       aliases:["dawson creek"],               prov:"BC", lat:55.76, lng:-120.24, pop:12600,  country:"ca", supply_adj:-1,  afford_adj:1,   crash_adj:0,  estimated:true },
  { display:"Quesnel, BC",            aliases:["quesnel"],                    prov:"BC", lat:52.98, lng:-122.49, pop:10007,  country:"ca", supply_adj:-2,  afford_adj:0,   crash_adj:0,  estimated:true },
  { display:"Williams Lake, BC",      aliases:["williams lake"],              prov:"BC", lat:52.13, lng:-122.14, pop:11680,  country:"ca", supply_adj:-2,  afford_adj:0,   crash_adj:0,  estimated:true },
  { display:"100 Mile House, BC",     aliases:["100 mile house"],             prov:"BC", lat:51.64, lng:-121.29, pop:2000,   country:"ca", supply_adj:-1,  afford_adj:1,   crash_adj:0,  estimated:true },
  { display:"Smithers, BC",           aliases:["smithers bc"],                prov:"BC", lat:54.78, lng:-127.17, pop:5732,   country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Hope, BC",               aliases:["hope bc"],                    prov:"BC", lat:49.38, lng:-121.44, pop:7000,   country:"ca", supply_adj:-5,  afford_adj:-5,  crash_adj:3,  estimated:true },
  { display:"Harrison Hot Springs, BC",aliases:["harrison hot springs"],      prov:"BC", lat:49.30, lng:-121.78, pop:1600,   country:"ca", supply_adj:-6,  afford_adj:-6,  crash_adj:3,  estimated:true },
  { display:"Squamish, BC",           aliases:["squamish"],                   prov:"BC", lat:49.70, lng:-123.16, pop:23000,  country:"ca", supply_adj:-14, afford_adj:-13, crash_adj:7,  estimated:true },
  { display:"Whistler, BC",           aliases:["whistler"],                   prov:"BC", lat:50.12, lng:-122.95, pop:14000,  country:"ca", supply_adj:-20, afford_adj:-20, crash_adj:10, estimated:true },
  { display:"Pemberton, BC",          aliases:["pemberton bc"],               prov:"BC", lat:50.32, lng:-122.80, pop:3500,   country:"ca", supply_adj:-12, afford_adj:-11, crash_adj:6,  estimated:true },
  { display:"Osoyoos, BC",            aliases:["osoyoos"],                    prov:"BC", lat:49.03, lng:-119.47, pop:5900,   country:"ca", supply_adj:-7,  afford_adj:-7,  crash_adj:4,  estimated:true },
  { display:"Oliver, BC",             aliases:["oliver bc"],                  prov:"BC", lat:49.18, lng:-119.55, pop:5000,   country:"ca", supply_adj:-6,  afford_adj:-6,  crash_adj:3,  estimated:true },
  { display:"Trail, BC",              aliases:["trail bc"],                   prov:"BC", lat:49.10, lng:-117.71, pop:7709,   country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Nelson, BC",             aliases:["nelson bc"],                  prov:"BC", lat:49.49, lng:-117.29, pop:10664,  country:"ca", supply_adj:-7,  afford_adj:-7,  crash_adj:4,  estimated:true },
  { display:"Castlegar, BC",          aliases:["castlegar"],                  prov:"BC", lat:49.33, lng:-117.66, pop:8600,   country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2,  estimated:true },
  { display:"Grand Forks, BC",        aliases:["grand forks bc"],             prov:"BC", lat:49.03, lng:-118.44, pop:4500,   country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  // ALBERTA — small towns
  { display:"Canmore, AB",            aliases:["canmore"],                    prov:"AB", lat:51.09, lng:-115.36, pop:14000,  country:"ca", supply_adj:-15, afford_adj:-14, crash_adj:8,  estimated:true },
  { display:"Banff, AB",              aliases:["banff"],                      prov:"AB", lat:51.18, lng:-115.57, pop:7800,   country:"ca", supply_adj:-18, afford_adj:-18, crash_adj:9,  estimated:true },
  { display:"Jasper, AB",             aliases:["jasper alberta"],             prov:"AB", lat:52.88, lng:-118.08, pop:4800,   country:"ca", supply_adj:-10, afford_adj:-10, crash_adj:5,  estimated:true },
  { display:"Lacombe, AB",            aliases:["lacombe"],                    prov:"AB", lat:52.47, lng:-113.73, pop:14000,  country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Wetaskiwin, AB",         aliases:["wetaskiwin"],                 prov:"AB", lat:52.97, lng:-113.38, pop:13000,  country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0,  estimated:true },
  { display:"Stony Plain, AB",        aliases:["stony plain"],                prov:"AB", lat:53.53, lng:-114.00, pop:17600,  country:"ca", supply_adj:-2,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Leduc, AB",              aliases:["leduc"],                      prov:"AB", lat:53.26, lng:-113.55, pop:35000,  country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Fort Saskatchewan, AB",  aliases:["fort saskatchewan"],          prov:"AB", lat:53.71, lng:-113.21, pop:28000,  country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Beaumont, AB",           aliases:["beaumont alberta"],           prov:"AB", lat:53.36, lng:-113.41, pop:23000,  country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Strathmore, AB",         aliases:["strathmore alberta"],         prov:"AB", lat:51.04, lng:-113.40, pop:15000,  country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"High River, AB",         aliases:["high river"],                 prov:"AB", lat:50.58, lng:-113.87, pop:15000,  country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Drumheller, AB",         aliases:["drumheller"],                 prov:"AB", lat:51.46, lng:-112.72, pop:8000,   country:"ca", supply_adj:-1,  afford_adj:1,   crash_adj:0,  estimated:true },
  { display:"Taber, AB",              aliases:["taber alberta"],              prov:"AB", lat:49.79, lng:-112.15, pop:9000,   country:"ca", supply_adj:-1,  afford_adj:1,   crash_adj:0,  estimated:true },
  { display:"Brooks, AB",             aliases:["brooks alberta"],             prov:"AB", lat:50.56, lng:-111.90, pop:15000,  country:"ca", supply_adj:-1,  afford_adj:1,   crash_adj:0,  estimated:true },
  { display:"Pincher Creek, AB",      aliases:["pincher creek"],              prov:"AB", lat:49.49, lng:-113.95, pop:3700,   country:"ca", supply_adj:0,   afford_adj:1,   crash_adj:0,  estimated:true },
  { display:"Claresholm, AB",         aliases:["claresholm"],                 prov:"AB", lat:50.02, lng:-113.59, pop:3900,   country:"ca", supply_adj:0,   afford_adj:1,   crash_adj:0,  estimated:true },
  { display:"Slave Lake, AB",         aliases:["slave lake"],                 prov:"AB", lat:55.28, lng:-114.77, pop:7000,   country:"ca", supply_adj:0,   afford_adj:2,   crash_adj:0,  estimated:true },
  { display:"Peace River, AB",        aliases:["peace river alberta"],        prov:"AB", lat:56.24, lng:-117.29, pop:7000,   country:"ca", supply_adj:0,   afford_adj:2,   crash_adj:0,  estimated:true },
  // SASKATCHEWAN — small towns
  { display:"Swift Current, SK",      aliases:["swift current"],              prov:"SK", lat:50.29, lng:-107.79, pop:17700,  country:"ca", supply_adj:0,   afford_adj:2,   crash_adj:0,  estimated:true },
  { display:"Yorkton, SK",            aliases:["yorkton"],                    prov:"SK", lat:51.21, lng:-102.46, pop:16343,  country:"ca", supply_adj:0,   afford_adj:2,   crash_adj:0,  estimated:true },
  { display:"North Battleford, SK",   aliases:["north battleford"],           prov:"SK", lat:52.77, lng:-108.29, pop:14600,  country:"ca", supply_adj:1,   afford_adj:2,   crash_adj:0,  estimated:true },
  { display:"Battleford, SK",         aliases:["battleford"],                 prov:"SK", lat:52.74, lng:-108.32, pop:4200,   country:"ca", supply_adj:1,   afford_adj:3,   crash_adj:0,  estimated:true },
  { display:"Estevan, SK",            aliases:["estevan"],                    prov:"SK", lat:49.14, lng:-102.99, pop:12633,  country:"ca", supply_adj:1,   afford_adj:2,   crash_adj:0,  estimated:true },
  { display:"Weyburn, SK",            aliases:["weyburn"],                    prov:"SK", lat:49.66, lng:-103.85, pop:11141,  country:"ca", supply_adj:1,   afford_adj:2,   crash_adj:0,  estimated:true },
  { display:"Humboldt, SK",           aliases:["humboldt sk"],                prov:"SK", lat:52.20, lng:-105.12, pop:6150,   country:"ca", supply_adj:1,   afford_adj:3,   crash_adj:0,  estimated:true },
  { display:"Melfort, SK",            aliases:["melfort"],                    prov:"SK", lat:52.86, lng:-104.61, pop:6000,   country:"ca", supply_adj:1,   afford_adj:3,   crash_adj:0,  estimated:true },
  { display:"Melville, SK",           aliases:["melville sk"],                prov:"SK", lat:50.93, lng:-102.81, pop:4600,   country:"ca", supply_adj:1,   afford_adj:3,   crash_adj:0,  estimated:true },
  // MANITOBA — small towns
  { display:"Thompson, MB",           aliases:["thompson mb"],                prov:"MB", lat:55.74, lng:-97.86,  pop:13678,  country:"ca", supply_adj:1,   afford_adj:2,   crash_adj:0,  estimated:true },
  { display:"Portage la Prairie, MB", aliases:["portage la prairie","portage mb"], prov:"MB", lat:49.97, lng:-98.29, pop:13270, country:"ca", supply_adj:0,  afford_adj:1,   crash_adj:0,  estimated:true },
  { display:"Selkirk, MB",            aliases:["selkirk mb"],                 prov:"MB", lat:50.14, lng:-96.88,  pop:10278,  country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0,  estimated:true },
  { display:"Morden, MB",             aliases:["morden mb"],                  prov:"MB", lat:49.19, lng:-98.08,  pop:9500,   country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0,  estimated:true },
  { display:"Winkler, MB",            aliases:["winkler"],                    prov:"MB", lat:49.18, lng:-97.94,  pop:14500,  country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0,  estimated:true },
  { display:"Dauphin, MB",            aliases:["dauphin mb"],                 prov:"MB", lat:51.15, lng:-100.05, pop:8457,   country:"ca", supply_adj:1,   afford_adj:2,   crash_adj:0,  estimated:true },
  { display:"The Pas, MB",            aliases:["the pas"],                    prov:"MB", lat:53.82, lng:-101.24, pop:5768,   country:"ca", supply_adj:2,   afford_adj:3,   crash_adj:0,  estimated:true },
  { display:"Flin Flon, MB",          aliases:["flin flon"],                  prov:"MB", lat:54.77, lng:-101.88, pop:5190,   country:"ca", supply_adj:2,   afford_adj:3,   crash_adj:0,  estimated:true },
  // QUEBEC — small towns
  { display:"Rouyn-Noranda, QC",      aliases:["rouyn noranda","rouyn-noranda"], prov:"QC", lat:48.24, lng:-79.02, pop:43000, country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Val-d'Or, QC",           aliases:["val d'or","val dor"],         prov:"QC", lat:48.10, lng:-77.79,  pop:33000,  country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Alma, QC",               aliases:["alma qc"],                    prov:"QC", lat:48.55, lng:-71.65,  pop:30000,  country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Baie-Comeau, QC",        aliases:["baie comeau","baie-comeau"],  prov:"QC", lat:49.22, lng:-68.15,  pop:22000,  country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0,  estimated:true },
  { display:"Sept-Iles, QC",          aliases:["sept iles","sept-iles"],      prov:"QC", lat:50.22, lng:-66.38,  pop:26000,  country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0,  estimated:true },
  { display:"Saint-Georges, QC",      aliases:["saint georges qc","st georges qc"], prov:"QC", lat:46.12, lng:-70.67, pop:32000, country:"ca", supply_adj:-3, afford_adj:-2, crash_adj:1, estimated:true },
  { display:"Victoriaville, QC",      aliases:["victoriaville"],              prov:"QC", lat:46.06, lng:-71.97,  pop:47000,  country:"ca", supply_adj:-2,  afford_adj:-2,  crash_adj:1,  estimated:true },
  { display:"Joliette, QC",           aliases:["joliette qc"],                prov:"QC", lat:46.02, lng:-73.45,  pop:50000,  country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:2,  estimated:true },
  { display:"Thetford Mines, QC",     aliases:["thetford mines"],             prov:"QC", lat:46.10, lng:-71.30,  pop:26000,  country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0,  estimated:true },
  { display:"Sorel-Tracy, QC",        aliases:["sorel tracy","sorel-tracy"],  prov:"QC", lat:46.05, lng:-73.11,  pop:35000,  country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Riviere-du-Loup, QC",    aliases:["riviere du loup","rivière-du-loup"], prov:"QC", lat:47.83, lng:-69.53, pop:21000, country:"ca", supply_adj:-2, afford_adj:-1, crash_adj:1, estimated:true },
  { display:"Rimouski, QC",           aliases:["rimouski"],                   prov:"QC", lat:48.45, lng:-68.52,  pop:48000,  country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Matane, QC",             aliases:["matane"],                     prov:"QC", lat:48.85, lng:-67.53,  pop:15000,  country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0,  estimated:true },
  { display:"Amos, QC",               aliases:["amos qc"],                    prov:"QC", lat:48.57, lng:-78.11,  pop:13500,  country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0,  estimated:true },
  { display:"Magog, QC",              aliases:["magog qc"],                   prov:"QC", lat:45.27, lng:-72.15,  pop:29000,  country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2,  estimated:true },
  { display:"Cowansville, QC",        aliases:["cowansville"],                prov:"QC", lat:45.20, lng:-72.75,  pop:14000,  country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  // NOVA SCOTIA — small towns
  { display:"New Glasgow, NS",        aliases:["new glasgow ns"],             prov:"NS", lat:45.59, lng:-62.64,  pop:9432,   country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0,  estimated:true },
  { display:"Amherst, NS",            aliases:["amherst ns"],                 prov:"NS", lat:45.83, lng:-64.21,  pop:9717,   country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0,  estimated:true },
  { display:"Bridgewater, NS",        aliases:["bridgewater ns"],             prov:"NS", lat:44.38, lng:-64.52,  pop:8573,   country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Yarmouth, NS",           aliases:["yarmouth ns"],                prov:"NS", lat:43.84, lng:-66.12,  pop:7162,   country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Antigonish, NS",         aliases:["antigonish"],                 prov:"NS", lat:45.62, lng:-61.99,  pop:5160,   country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Windsor, NS",            aliases:["windsor nova scotia","windsor ns"], prov:"NS", lat:44.99, lng:-64.14, pop:3700, country:"ca", supply_adj:-2,  afford_adj:-1,  crash_adj:1,  estimated:true },
  { display:"Kentville, NS",          aliases:["kentville"],                  prov:"NS", lat:45.08, lng:-64.49,  pop:6271,   country:"ca", supply_adj:-3,  afford_adj:-2,  crash_adj:1,  estimated:true },
  // NEW BRUNSWICK — small towns
  { display:"Campbellton, NB",        aliases:["campbellton"],                prov:"NB", lat:48.01, lng:-66.67,  pop:7072,   country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0,  estimated:true },
  { display:"Edmundston, NB",         aliases:["edmundston"],                 prov:"NB", lat:47.37, lng:-68.33,  pop:16658,  country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0,  estimated:true },
  { display:"Woodstock, NB",          aliases:["woodstock nb","woodstock new brunswick"], prov:"NB", lat:46.15, lng:-67.60, pop:5600, country:"ca", supply_adj:-1, afford_adj:0, crash_adj:0, estimated:true },
  { display:"Sussex, NB",             aliases:["sussex nb"],                  prov:"NB", lat:45.73, lng:-65.51,  pop:4304,   country:"ca", supply_adj:-1,  afford_adj:0,   crash_adj:0,  estimated:true },
  // NEWFOUNDLAND — small towns
  { display:"Gander, NL",             aliases:["gander nl"],                  prov:"NL", lat:48.96, lng:-54.60,  pop:13228,  country:"ca", supply_adj:0,   afford_adj:1,   crash_adj:0,  estimated:true },
  { display:"Grand Falls-Windsor, NL",aliases:["grand falls windsor","grand falls-windsor"], prov:"NL", lat:48.93, lng:-55.67, pop:14171, country:"ca", supply_adj:0, afford_adj:1, crash_adj:0, estimated:true },
  { display:"Happy Valley-Goose Bay, NL",aliases:["goose bay","happy valley","happy valley-goose bay"], prov:"NL", lat:53.30, lng:-60.41, pop:8109, country:"ca", supply_adj:1, afford_adj:0, crash_adj:0, estimated:true },
  { display:"Labrador City, NL",      aliases:["labrador city"],              prov:"NL", lat:52.94, lng:-66.91,  pop:7220,   country:"ca", supply_adj:1,   afford_adj:1,   crash_adj:0,  estimated:true },
  { display:"Stephenville, NL",       aliases:["stephenville nl"],            prov:"NL", lat:48.55, lng:-58.58,  pop:6534,   country:"ca", supply_adj:0,   afford_adj:1,   crash_adj:0,  estimated:true },
  { display:"Marystown, NL",          aliases:["marystown"],                  prov:"NL", lat:47.17, lng:-55.16,  pop:4988,   country:"ca", supply_adj:0,   afford_adj:1,   crash_adj:0,  estimated:true },
  { display:"Clarenville, NL",        aliases:["clarenville"],                prov:"NL", lat:48.17, lng:-53.97,  pop:5971,   country:"ca", supply_adj:0,   afford_adj:1,   crash_adj:0,  estimated:true },
  { display:"Bonavista, NL",          aliases:["bonavista"],                  prov:"NL", lat:48.65, lng:-53.11,  pop:3240,   country:"ca", supply_adj:1,   afford_adj:2,   crash_adj:0,  estimated:true },
  // PEI — small towns
  { display:"Summerside, PE",         aliases:["summerside pei","summerside pe"], prov:"PE", lat:46.40, lng:-63.79, pop:16474, country:"ca", supply_adj:-4,  afford_adj:-3,  crash_adj:2,  estimated:true },
  { display:"Stratford, PE",          aliases:["stratford pei","stratford pe"], prov:"PE", lat:46.22, lng:-63.08,  pop:12000, country:"ca", supply_adj:-5,  afford_adj:-4,  crash_adj:2,  estimated:true },
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
  { display:"Akron, OH",          aliases:["akron"],                         hpi:"ATNHPIUS10420Q", unemp:"AKRUR",  med_inc:54000,  lat:41.08, lng:-81.52, country:"us" },
  { display:"Albany, NY",         aliases:["albany ny"],                     hpi:"ATNHPIUS10580Q", unemp:"ALBNR",  med_inc:62000,  lat:42.65, lng:-73.75, country:"us" },
  { display:"Albuquerque, NM",    aliases:["albuquerque"],                   hpi:"ATNHPIUS10740Q", unemp:"ALBUR",  med_inc:55000,  lat:35.08, lng:-106.65,country:"us" },
  { display:"Allentown, PA",      aliases:["allentown"],                     hpi:"ATNHPIUS10900Q", unemp:"ALLNR",  med_inc:60000,  lat:40.60, lng:-75.49, country:"us" },
  { display:"Anchorage, AK",      aliases:["anchorage"],                     hpi:"ATNHPIUS11260Q", unemp:"ANCHR",  med_inc:82000,  lat:61.22, lng:-149.90,country:"us" },
  { display:"Ann Arbor, MI",      aliases:["ann arbor"],                     hpi:"ATNHPIUS11460Q", unemp:"ANNUR",  med_inc:70000,  lat:42.28, lng:-83.74, country:"us" },
  { display:"Asheville, NC",      aliases:["asheville"],                     hpi:"ATNHPIUS11700Q", unemp:"ASHVR",  med_inc:52000,  lat:35.57, lng:-82.55, country:"us" },
  { display:"Bakersfield, CA",    aliases:["bakersfield"],                   hpi:"ATNHPIUS12540Q", unemp:"BAKR",   med_inc:52000,  lat:35.37, lng:-119.02,country:"us" },
  { display:"Baltimore, MD",      aliases:["baltimore","bwi"],               hpi:"ATNHPIUS12580Q", unemp:"BALTR",  med_inc:72000,  lat:39.29, lng:-76.61, country:"us" },
  { display:"Baton Rouge, LA",    aliases:["baton rouge"],                   hpi:"ATNHPIUS12940Q", unemp:"BATNR",  med_inc:55000,  lat:30.45, lng:-91.15, country:"us" },
  { display:"Birmingham, AL",     aliases:["birmingham al"],                 hpi:"ATNHPIUS13820Q", unemp:"BIRUR",  med_inc:53000,  lat:33.52, lng:-86.80, country:"us" },
  { display:"Boise, ID",          aliases:["boise"],                         hpi:"ATNHPIUS14260Q", unemp:"BOISR",  med_inc:60000,  lat:43.61, lng:-116.20,country:"us" },
  { display:"Bridgeport, CT",     aliases:["bridgeport","stamford"],         hpi:"ATNHPIUS14860Q", unemp:"BRDGR",  med_inc:82000,  lat:41.17, lng:-73.20, country:"us" },
  { display:"Buffalo, NY",        aliases:["buffalo"],                       hpi:"ATNHPIUS15380Q", unemp:"BUFUR",  med_inc:54000,  lat:42.89, lng:-78.87, country:"us" },
  { display:"Cape Coral, FL",     aliases:["cape coral","fort myers"],       hpi:"ATNHPIUS15980Q", unemp:"CAPCR",  med_inc:54000,  lat:26.56, lng:-81.95, country:"us" },
  { display:"Charleston, SC",     aliases:["charleston sc"],                 hpi:"ATNHPIUS16700Q", unemp:"CHASR",  med_inc:62000,  lat:32.78, lng:-79.93, country:"us" },
  { display:"Colorado Springs, CO",aliases:["colorado springs"],             hpi:"ATNHPIUS17820Q", unemp:"COLSR",  med_inc:62000,  lat:38.83, lng:-104.82,country:"us" },
  { display:"Columbia, SC",       aliases:["columbia sc"],                   hpi:"ATNHPIUS17900Q", unemp:"COLMR",  med_inc:52000,  lat:34.00, lng:-81.03, country:"us" },
  { display:"Dayton, OH",         aliases:["dayton"],                        hpi:"ATNHPIUS19380Q", unemp:"DAYTR",  med_inc:52000,  lat:39.76, lng:-84.19, country:"us" },
  { display:"Des Moines, IA",     aliases:["des moines"],                    hpi:"ATNHPIUS19780Q", unemp:"DESUR",  med_inc:65000,  lat:41.59, lng:-93.62, country:"us" },
  { display:"Durham, NC",         aliases:["durham"],                        hpi:"ATNHPIUS20500Q", unemp:"DURMR",  med_inc:68000,  lat:35.99, lng:-78.90, country:"us" },
  { display:"El Paso, TX",        aliases:["el paso"],                       hpi:"ATNHPIUS21340Q", unemp:"ELPUR",  med_inc:46000,  lat:31.76, lng:-106.49,country:"us" },
  { display:"Fresno, CA",         aliases:["fresno"],                        hpi:"ATNHPIUS23420Q", unemp:"FRESR",  med_inc:54000,  lat:36.74, lng:-119.77,country:"us" },
  { display:"Grand Rapids, MI",   aliases:["grand rapids"],                  hpi:"ATNHPIUS24340Q", unemp:"GRANR",  med_inc:60000,  lat:42.96, lng:-85.66, country:"us" },
  { display:"Greensboro, NC",     aliases:["greensboro"],                    hpi:"ATNHPIUS24660Q", unemp:"GRNSR",  med_inc:51000,  lat:36.07, lng:-79.79, country:"us" },
  { display:"Hartford, CT",       aliases:["hartford"],                      hpi:"ATNHPIUS25540Q", unemp:"HARTR",  med_inc:72000,  lat:41.76, lng:-72.68, country:"us" },
  { display:"Honolulu, HI",       aliases:["honolulu","hawaii"],             hpi:"ATNHPIUS26180Q", unemp:"HONUR",  med_inc:80000,  lat:21.31, lng:-157.86,country:"us" },
  { display:"Jacksonville, FL",   aliases:["jacksonville"],                  hpi:"ATNHPIUS27260Q", unemp:"JACKR",  med_inc:57000,  lat:30.33, lng:-81.66, country:"us" },
  { display:"Knoxville, TN",      aliases:["knoxville"],                     hpi:"ATNHPIUS28940Q", unemp:"KNOXR",  med_inc:52000,  lat:35.96, lng:-83.92, country:"us" },
  { display:"Lakeland, FL",       aliases:["lakeland"],                      hpi:"ATNHPIUS29460Q", unemp:"LAKR",   med_inc:48000,  lat:28.04, lng:-81.95, country:"us" },
  { display:"Lexington, KY",      aliases:["lexington ky"],                  hpi:"ATNHPIUS30460Q", unemp:"LEXUR",  med_inc:55000,  lat:38.04, lng:-84.50, country:"us" },
  { display:"Little Rock, AR",    aliases:["little rock"],                   hpi:"ATNHPIUS30780Q", unemp:"LITKR",  med_inc:50000,  lat:34.75, lng:-92.29, country:"us" },
  { display:"Louisville, KY",     aliases:["louisville"],                    hpi:"ATNHPIUS31140Q", unemp:"LOUIR",  med_inc:54000,  lat:38.25, lng:-85.76, country:"us" },
  { display:"Madison, WI",        aliases:["madison wi"],                    hpi:"ATNHPIUS31540Q", unemp:"MADIR",  med_inc:68000,  lat:43.07, lng:-89.40, country:"us" },
  { display:"McAllen, TX",        aliases:["mcallen"],                       hpi:"ATNHPIUS32580Q", unemp:"MCALR",  med_inc:38000,  lat:26.20, lng:-98.23, country:"us" },
  { display:"Memphis, TN",        aliases:["memphis"],                       hpi:"ATNHPIUS32820Q", unemp:"MEMPR",  med_inc:51000,  lat:35.15, lng:-90.05, country:"us" },
  { display:"Milwaukee, WI",      aliases:["milwaukee"],                     hpi:"ATNHPIUS33340Q", unemp:"MILWUR", med_inc:58000,  lat:43.04, lng:-87.91, country:"us" },
  { display:"Modesto, CA",        aliases:["modesto"],                       hpi:"ATNHPIUS33700Q", unemp:"MODR",   med_inc:55000,  lat:37.64, lng:-120.99,country:"us" },
  { display:"New Haven, CT",      aliases:["new haven"],                     hpi:"ATNHPIUS35300Q", unemp:"NEWHR",  med_inc:62000,  lat:41.31, lng:-72.92, country:"us" },
  { display:"New Orleans, LA",    aliases:["new orleans"],                   hpi:"ATNHPIUS35380Q", unemp:"NEWORR", med_inc:50000,  lat:29.95, lng:-90.07, country:"us" },
  { display:"Ogden, UT",          aliases:["ogden"],                         hpi:"ATNHPIUS36260Q", unemp:"OGDNR",  med_inc:62000,  lat:41.23, lng:-111.97,country:"us" },
  { display:"Oklahoma City, OK",  aliases:["oklahoma city","okc"],           hpi:"ATNHPIUS36420Q", unemp:"OKLAR",  med_inc:55000,  lat:35.47, lng:-97.52, country:"us" },
  { display:"Omaha, NE",          aliases:["omaha"],                         hpi:"ATNHPIUS36540Q", unemp:"OMAHR",  med_inc:62000,  lat:41.26, lng:-95.94, country:"us" },
  { display:"Oxnard, CA",         aliases:["oxnard","ventura"],              hpi:"ATNHPIUS37100Q", unemp:"OXNR",   med_inc:80000,  lat:34.20, lng:-119.18,country:"us" },
  { display:"Palm Bay, FL",       aliases:["palm bay","melbourne fl"],       hpi:"ATNHPIUS37340Q", unemp:"PALMR",  med_inc:52000,  lat:28.03, lng:-80.59, country:"us" },
  { display:"Pensacola, FL",      aliases:["pensacola"],                     hpi:"ATNHPIUS37860Q", unemp:"PENSR",  med_inc:50000,  lat:30.42, lng:-87.22, country:"us" },
  { display:"Provo, UT",          aliases:["provo","orem"],                  hpi:"ATNHPIUS39340Q", unemp:"PROVR",  med_inc:64000,  lat:40.23, lng:-111.66,country:"us" },
  { display:"Richmond, VA",       aliases:["richmond va"],                   hpi:"ATNHPIUS40060Q", unemp:"RICHR",  med_inc:62000,  lat:37.54, lng:-77.43, country:"us" },
  { display:"Riverside, CA",      aliases:["riverside","san bernardino"],    hpi:"ATNHPIUS40140Q", unemp:"RIVR",   med_inc:62000,  lat:33.98, lng:-117.37,country:"us" },
  { display:"Rochester, NY",      aliases:["rochester ny"],                  hpi:"ATNHPIUS40380Q", unemp:"ROCHR",  med_inc:54000,  lat:43.16, lng:-77.61, country:"us" },
  { display:"Salt Lake City, UT", aliases:["salt lake city","slc"],          hpi:"ATNHPIUS41620Q", unemp:"SALTR",  med_inc:72000,  lat:40.76, lng:-111.89,country:"us" },
  { display:"San Jose, CA",       aliases:["san jose","silicon valley"],     hpi:"ATNHPIUS41940Q", unemp:"SANJR",  med_inc:120000, lat:37.34, lng:-121.89,country:"us" },
  { display:"Santa Rosa, CA",     aliases:["santa rosa"],                    hpi:"ATNHPIUS42220Q", unemp:"SANRR",  med_inc:80000,  lat:38.44, lng:-122.71,country:"us" },
  { display:"Scranton, PA",       aliases:["scranton"],                      hpi:"ATNHPIUS42540Q", unemp:"SCRR",   med_inc:48000,  lat:41.41, lng:-75.66, country:"us" },
  { display:"Spokane, WA",        aliases:["spokane"],                       hpi:"ATNHPIUS44060Q", unemp:"SPOKR",  med_inc:55000,  lat:47.66, lng:-117.43,country:"us" },
  { display:"Springfield, MO",    aliases:["springfield mo"],                hpi:"ATNHPIUS44180Q", unemp:"SPRIR",  med_inc:48000,  lat:37.21, lng:-93.30, country:"us" },
  { display:"St. Louis, MO",      aliases:["st louis","saint louis"],        hpi:"ATNHPIUS41180Q", unemp:"STLUR",  med_inc:60000,  lat:38.63, lng:-90.20, country:"us" },
  { display:"Stockton, CA",       aliases:["stockton"],                      hpi:"ATNHPIUS44700Q", unemp:"STOKR",  med_inc:58000,  lat:37.96, lng:-121.29,country:"us" },
  { display:"Syracuse, NY",       aliases:["syracuse"],                      hpi:"ATNHPIUS45060Q", unemp:"SYRR",   med_inc:52000,  lat:43.05, lng:-76.15, country:"us" },
  { display:"Toledo, OH",         aliases:["toledo"],                        hpi:"ATNHPIUS45780Q", unemp:"TOLUR",  med_inc:48000,  lat:41.66, lng:-83.56, country:"us" },
  { display:"Tucson, AZ",         aliases:["tucson"],                        hpi:"ATNHPIUS46060Q", unemp:"TUCSR",  med_inc:50000,  lat:32.22, lng:-110.97,country:"us" },
  { display:"Tulsa, OK",          aliases:["tulsa"],                         hpi:"ATNHPIUS46140Q", unemp:"TULSR",  med_inc:52000,  lat:36.15, lng:-95.99, country:"us" },
  { display:"Virginia Beach, VA", aliases:["virginia beach","norfolk"],      hpi:"ATNHPIUS47260Q", unemp:"VIRR",   med_inc:62000,  lat:36.85, lng:-75.98, country:"us" },
  { display:"Washington DC",      aliases:["washington","dc","washington dc"],hpi:"ATNHPIUS47900Q",unemp:"WASR",   med_inc:95000,  lat:38.91, lng:-77.04, country:"us" },
  { display:"Wichita, KS",        aliases:["wichita"],                       hpi:"ATNHPIUS48620Q", unemp:"WICHR",  med_inc:52000,  lat:37.69, lng:-97.34, country:"us" },
  { display:"Winston-Salem, NC",  aliases:["winston-salem","winston salem"], hpi:"ATNHPIUS49180Q", unemp:"WINSR",  med_inc:50000,  lat:36.10, lng:-80.24, country:"us" },
  { display:"Worcester, MA",      aliases:["worcester"],                     hpi:"ATNHPIUS49340Q", unemp:"WORCR",  med_inc:68000,  lat:42.26, lng:-71.80, country:"us" },
  { display:"Youngstown, OH",     aliases:["youngstown"],                    hpi:"ATNHPIUS49660Q", unemp:"YOUNGR", med_inc:42000,  lat:41.10, lng:-80.65, country:"us" },
  // ── ESTIMATED US CITIES (5,000+ pop, no direct FRED feed) ──
  // ALABAMA
  { display:"Huntsville, AL",     aliases:["huntsville al"],   prov:"AL", med_inc:58000, lat:34.73, lng:-86.59, country:"us", estimated:true },
  { display:"Mobile, AL",         aliases:["mobile al"],       prov:"AL", med_inc:46000, lat:30.69, lng:-88.04, country:"us", estimated:true },
  { display:"Montgomery, AL",     aliases:["montgomery al"],   prov:"AL", med_inc:46000, lat:32.36, lng:-86.30, country:"us", estimated:true },
  { display:"Tuscaloosa, AL",     aliases:["tuscaloosa"],      prov:"AL", med_inc:44000, lat:33.21, lng:-87.57, country:"us", estimated:true },
  { display:"Hoover, AL",         aliases:["hoover al"],       prov:"AL", med_inc:74000, lat:33.40, lng:-86.81, country:"us", estimated:true },
  { display:"Dothan, AL",         aliases:["dothan"],          prov:"AL", med_inc:44000, lat:31.22, lng:-85.39, country:"us", estimated:true },
  { display:"Auburn, AL",         aliases:["auburn al"],       prov:"AL", med_inc:42000, lat:32.61, lng:-85.48, country:"us", estimated:true },
  { display:"Decatur, AL",        aliases:["decatur al"],      prov:"AL", med_inc:46000, lat:34.61, lng:-86.98, country:"us", estimated:true },
  { display:"Madison, AL",        aliases:["madison al"],      prov:"AL", med_inc:82000, lat:34.70, lng:-86.75, country:"us", estimated:true },
  { display:"Florence, AL",       aliases:["florence al"],     prov:"AL", med_inc:44000, lat:34.80, lng:-87.67, country:"us", estimated:true },
  { display:"Phenix City, AL",    aliases:["phenix city"],     prov:"AL", med_inc:40000, lat:32.47, lng:-85.00, country:"us", estimated:true },
  { display:"Gadsden, AL",        aliases:["gadsden al"],      prov:"AL", med_inc:36000, lat:34.01, lng:-86.00, country:"us", estimated:true },
  { display:"Vestavia Hills, AL", aliases:["vestavia hills"],  prov:"AL", med_inc:92000, lat:33.45, lng:-86.79, country:"us", estimated:true },
  { display:"Prattville, AL",     aliases:["prattville"],      prov:"AL", med_inc:60000, lat:32.46, lng:-86.46, country:"us", estimated:true },
  { display:"Alabaster, AL",      aliases:["alabaster al"],    prov:"AL", med_inc:66000, lat:33.24, lng:-86.82, country:"us", estimated:true },
  { display:"Bessemer, AL",       aliases:["bessemer al"],     prov:"AL", med_inc:36000, lat:33.40, lng:-86.95, country:"us", estimated:true },
  { display:"Opelika, AL",        aliases:["opelika"],         prov:"AL", med_inc:44000, lat:32.64, lng:-85.37, country:"us", estimated:true },
  { display:"Northport, AL",      aliases:["northport al"],    prov:"AL", med_inc:52000, lat:33.24, lng:-87.58, country:"us", estimated:true },
  { display:"Enterprise, AL",     aliases:["enterprise al"],   prov:"AL", med_inc:48000, lat:31.32, lng:-85.85, country:"us", estimated:true },
  { display:"Daphne, AL",         aliases:["daphne al"],       prov:"AL", med_inc:64000, lat:30.60, lng:-87.90, country:"us", estimated:true },
  { display:"Athens, AL",         aliases:["athens al"],       prov:"AL", med_inc:50000, lat:34.80, lng:-86.97, country:"us", estimated:true },
  { display:"Homewood, AL",       aliases:["homewood al"],     prov:"AL", med_inc:78000, lat:33.47, lng:-86.80, country:"us", estimated:true },
  { display:"Talladega, AL",      aliases:["talladega"],       prov:"AL", med_inc:34000, lat:33.44, lng:-86.10, country:"us", estimated:true },
  { display:"Selma, AL",          aliases:["selma al"],        prov:"AL", med_inc:28000, lat:32.41, lng:-87.02, country:"us", estimated:true },
  // ALASKA
  { display:"Fairbanks, AK",      aliases:["fairbanks"],       prov:"AK", med_inc:66000, lat:64.84, lng:-147.72,country:"us", estimated:true },
  { display:"Juneau, AK",         aliases:["juneau"],          prov:"AK", med_inc:88000, lat:58.30, lng:-134.42,country:"us", estimated:true },
  { display:"Sitka, AK",          aliases:["sitka"],           prov:"AK", med_inc:72000, lat:57.05, lng:-135.33,country:"us", estimated:true },
  { display:"Ketchikan, AK",      aliases:["ketchikan"],       prov:"AK", med_inc:68000, lat:55.34, lng:-131.65,country:"us", estimated:true },
  { display:"Wasilla, AK",        aliases:["wasilla"],         prov:"AK", med_inc:72000, lat:61.58, lng:-149.44,country:"us", estimated:true },
  // ARIZONA
  { display:"Mesa, AZ",           aliases:["mesa az"],         prov:"AZ", med_inc:58000, lat:33.42, lng:-111.83,country:"us", estimated:true },
  { display:"Chandler, AZ",       aliases:["chandler az"],     prov:"AZ", med_inc:78000, lat:33.30, lng:-111.84,country:"us", estimated:true },
  { display:"Scottsdale, AZ",     aliases:["scottsdale"],      prov:"AZ", med_inc:88000, lat:33.49, lng:-111.93,country:"us", estimated:true },
  { display:"Gilbert, AZ",        aliases:["gilbert az"],      prov:"AZ", med_inc:86000, lat:33.35, lng:-111.79,country:"us", estimated:true },
  { display:"Glendale, AZ",       aliases:["glendale az"],     prov:"AZ", med_inc:56000, lat:33.54, lng:-112.19,country:"us", estimated:true },
  { display:"Tempe, AZ",          aliases:["tempe az"],        prov:"AZ", med_inc:58000, lat:33.43, lng:-111.94,country:"us", estimated:true },
  { display:"Peoria, AZ",         aliases:["peoria az"],       prov:"AZ", med_inc:72000, lat:33.58, lng:-112.24,country:"us", estimated:true },
  { display:"Surprise, AZ",       aliases:["surprise az"],     prov:"AZ", med_inc:66000, lat:33.63, lng:-112.37,country:"us", estimated:true },
  { display:"Yuma, AZ",           aliases:["yuma az"],         prov:"AZ", med_inc:46000, lat:32.69, lng:-114.63,country:"us", estimated:true },
  { display:"Avondale, AZ",       aliases:["avondale az"],     prov:"AZ", med_inc:62000, lat:33.43, lng:-112.35,country:"us", estimated:true },
  { display:"Goodyear, AZ",       aliases:["goodyear az"],     prov:"AZ", med_inc:76000, lat:33.43, lng:-112.36,country:"us", estimated:true },
  { display:"Flagstaff, AZ",      aliases:["flagstaff"],       prov:"AZ", med_inc:56000, lat:35.20, lng:-111.65,country:"us", estimated:true },
  { display:"Buckeye, AZ",        aliases:["buckeye az"],      prov:"AZ", med_inc:66000, lat:33.37, lng:-112.58,country:"us", estimated:true },
  { display:"Prescott, AZ",       aliases:["prescott az"],     prov:"AZ", med_inc:56000, lat:34.54, lng:-112.47,country:"us", estimated:true },
  { display:"Casa Grande, AZ",    aliases:["casa grande"],     prov:"AZ", med_inc:52000, lat:32.88, lng:-111.76,country:"us", estimated:true },
  { display:"Lake Havasu City, AZ",aliases:["lake havasu"],    prov:"AZ", med_inc:52000, lat:34.48, lng:-114.32,country:"us", estimated:true },
  { display:"Maricopa, AZ",       aliases:["maricopa az"],     prov:"AZ", med_inc:68000, lat:33.06, lng:-112.05,country:"us", estimated:true },
  { display:"Queen Creek, AZ",    aliases:["queen creek"],     prov:"AZ", med_inc:88000, lat:33.25, lng:-111.64,country:"us", estimated:true },
  { display:"Bullhead City, AZ",  aliases:["bullhead city"],   prov:"AZ", med_inc:44000, lat:35.14, lng:-114.57,country:"us", estimated:true },
  { display:"Prescott Valley, AZ",aliases:["prescott valley"], prov:"AZ", med_inc:56000, lat:34.61, lng:-112.32,country:"us", estimated:true },
  { display:"Apache Junction, AZ",aliases:["apache junction"], prov:"AZ", med_inc:48000, lat:33.42, lng:-111.55,country:"us", estimated:true },
  { display:"Sierra Vista, AZ",   aliases:["sierra vista"],    prov:"AZ", med_inc:52000, lat:31.56, lng:-110.30,country:"us", estimated:true },
  { display:"Peoria, IL",         aliases:["peoria il"],       prov:"IL", med_inc:50000, lat:40.69, lng:-89.59, country:"us", estimated:true },
  // ARKANSAS
  { display:"Fort Smith, AR",     aliases:["fort smith ar"],   prov:"AR", med_inc:44000, lat:35.39, lng:-94.42, country:"us", estimated:true },
  { display:"Fayetteville, AR",   aliases:["fayetteville ar"], prov:"AR", med_inc:50000, lat:36.07, lng:-94.16, country:"us", estimated:true },
  { display:"Springdale, AR",     aliases:["springdale ar"],   prov:"AR", med_inc:50000, lat:36.19, lng:-94.13, country:"us", estimated:true },
  { display:"Jonesboro, AR",      aliases:["jonesboro ar"],    prov:"AR", med_inc:46000, lat:35.84, lng:-90.70, country:"us", estimated:true },
  { display:"North Little Rock, AR",aliases:["north little rock"],prov:"AR",med_inc:44000,lat:34.77,lng:-92.27, country:"us", estimated:true },
  { display:"Conway, AR",         aliases:["conway ar"],       prov:"AR", med_inc:50000, lat:35.09, lng:-92.44, country:"us", estimated:true },
  { display:"Rogers, AR",         aliases:["rogers ar"],       prov:"AR", med_inc:58000, lat:36.33, lng:-94.12, country:"us", estimated:true },
  { display:"Pine Bluff, AR",     aliases:["pine bluff"],      prov:"AR", med_inc:34000, lat:34.23, lng:-92.00, country:"us", estimated:true },
  { display:"Bentonville, AR",    aliases:["bentonville"],     prov:"AR", med_inc:68000, lat:36.37, lng:-94.21, country:"us", estimated:true },
  { display:"Hot Springs, AR",    aliases:["hot springs ar"],  prov:"AR", med_inc:40000, lat:34.50, lng:-93.05, country:"us", estimated:true },
  { display:"Bella Vista, AR",    aliases:["bella vista ar"],  prov:"AR", med_inc:62000, lat:36.47, lng:-94.27, country:"us", estimated:true },
  { display:"Texarkana, AR",      aliases:["texarkana ar"],    prov:"AR", med_inc:42000, lat:33.44, lng:-94.04, country:"us", estimated:true },
  // CALIFORNIA
  { display:"Long Beach, CA",     aliases:["long beach ca"],   prov:"CA", med_inc:66000, lat:33.77, lng:-118.19,country:"us", estimated:true },
  { display:"Oakland, CA",        aliases:["oakland"],         prov:"CA", med_inc:72000, lat:37.80, lng:-122.27,country:"us", estimated:true },
  { display:"Fresno, CA",         aliases:["fresno"],          prov:"CA", med_inc:46000, lat:36.74, lng:-119.77,country:"us", estimated:true },
  { display:"Anaheim, CA",        aliases:["anaheim"],         prov:"CA", med_inc:72000, lat:33.84, lng:-117.91,country:"us", estimated:true },
  { display:"Irvine, CA",         aliases:["irvine ca"],       prov:"CA", med_inc:104000,lat:33.68, lng:-117.79,country:"us", estimated:true },
  { display:"Chula Vista, CA",    aliases:["chula vista"],     prov:"CA", med_inc:76000, lat:32.64, lng:-117.08,country:"us", estimated:true },
  { display:"Fremont, CA",        aliases:["fremont ca"],      prov:"CA", med_inc:120000,lat:37.55, lng:-121.99,country:"us", estimated:true },
  { display:"Santa Ana, CA",      aliases:["santa ana ca"],    prov:"CA", med_inc:62000, lat:33.75, lng:-117.87,country:"us", estimated:true },
  { display:"Fontana, CA",        aliases:["fontana"],         prov:"CA", med_inc:68000, lat:34.09, lng:-117.44,country:"us", estimated:true },
  { display:"Moreno Valley, CA",  aliases:["moreno valley"],   prov:"CA", med_inc:60000, lat:33.94, lng:-117.23,country:"us", estimated:true },
  { display:"Glendale, CA",       aliases:["glendale ca"],     prov:"CA", med_inc:68000, lat:34.14, lng:-118.26,country:"us", estimated:true },
  { display:"Huntington Beach, CA",aliases:["huntington beach"],prov:"CA",med_inc:90000, lat:33.66, lng:-117.99,country:"us", estimated:true },
  { display:"Ontario, CA",        aliases:["ontario ca"],      prov:"CA", med_inc:64000, lat:34.07, lng:-117.65,country:"us", estimated:true },
  { display:"Rancho Cucamonga, CA",aliases:["rancho cucamonga"],prov:"CA",med_inc:80000, lat:34.11, lng:-117.59,country:"us", estimated:true },
  { display:"Garden Grove, CA",   aliases:["garden grove"],    prov:"CA", med_inc:64000, lat:33.77, lng:-117.94,country:"us", estimated:true },
  { display:"Oceanside, CA",      aliases:["oceanside ca"],    prov:"CA", med_inc:68000, lat:33.20, lng:-117.38,country:"us", estimated:true },
  { display:"Elk Grove, CA",      aliases:["elk grove"],       prov:"CA", med_inc:82000, lat:38.41, lng:-121.37,country:"us", estimated:true },
  { display:"Corona, CA",         aliases:["corona ca"],       prov:"CA", med_inc:80000, lat:33.88, lng:-117.57,country:"us", estimated:true },
  { display:"Lancaster, CA",      aliases:["lancaster ca"],    prov:"CA", med_inc:56000, lat:34.70, lng:-118.14,country:"us", estimated:true },
  { display:"Palmdale, CA",       aliases:["palmdale ca"],     prov:"CA", med_inc:60000, lat:34.58, lng:-118.11,country:"us", estimated:true },
  { display:"Salinas, CA",        aliases:["salinas ca"],      prov:"CA", med_inc:58000, lat:36.68, lng:-121.65,country:"us", estimated:true },
  { display:"Pomona, CA",         aliases:["pomona ca"],       prov:"CA", med_inc:54000, lat:34.06, lng:-117.75,country:"us", estimated:true },
  { display:"Torrance, CA",       aliases:["torrance"],        prov:"CA", med_inc:84000, lat:33.84, lng:-118.34,country:"us", estimated:true },
  { display:"Escondido, CA",      aliases:["escondido"],       prov:"CA", med_inc:64000, lat:33.12, lng:-117.09,country:"us", estimated:true },
  { display:"Hayward, CA",        aliases:["hayward ca"],      prov:"CA", med_inc:76000, lat:37.67, lng:-122.08,country:"us", estimated:true },
  { display:"Sunnyvale, CA",      aliases:["sunnyvale"],       prov:"CA", med_inc:122000,lat:37.37, lng:-122.04,country:"us", estimated:true },
  { display:"Pasadena, CA",       aliases:["pasadena ca"],     prov:"CA", med_inc:82000, lat:34.15, lng:-118.14,country:"us", estimated:true },
  { display:"Roseville, CA",      aliases:["roseville ca"],    prov:"CA", med_inc:84000, lat:38.75, lng:-121.29,country:"us", estimated:true },
  { display:"Visalia, CA",        aliases:["visalia"],         prov:"CA", med_inc:54000, lat:36.33, lng:-119.29,country:"us", estimated:true },
  { display:"Fullerton, CA",      aliases:["fullerton ca"],    prov:"CA", med_inc:74000, lat:33.87, lng:-117.93,country:"us", estimated:true },
  { display:"Thousand Oaks, CA",  aliases:["thousand oaks"],   prov:"CA", med_inc:100000,lat:34.17, lng:-118.84,country:"us", estimated:true },
  { display:"Concord, CA",        aliases:["concord ca"],      prov:"CA", med_inc:82000, lat:37.98, lng:-122.03,country:"us", estimated:true },
  { display:"Victorville, CA",    aliases:["victorville"],     prov:"CA", med_inc:54000, lat:34.54, lng:-117.29,country:"us", estimated:true },
  { display:"Simi Valley, CA",    aliases:["simi valley"],     prov:"CA", med_inc:90000, lat:34.27, lng:-118.78,country:"us", estimated:true },
  { display:"Murrieta, CA",       aliases:["murrieta"],        prov:"CA", med_inc:82000, lat:33.57, lng:-117.21,country:"us", estimated:true },
  { display:"Temecula, CA",       aliases:["temecula"],        prov:"CA", med_inc:82000, lat:33.49, lng:-117.15,country:"us", estimated:true },
  { display:"Beaumont, CA",       aliases:["beaumont ca"],     prov:"CA", med_inc:68000, lat:33.93, lng:-116.98,country:"us", estimated:true },
  { display:"Antioch, CA",        aliases:["antioch ca"],      prov:"CA", med_inc:74000, lat:38.00, lng:-121.81,country:"us", estimated:true },
  { display:"Richmond, CA",       aliases:["richmond ca"],     prov:"CA", med_inc:66000, lat:37.94, lng:-122.35,country:"us", estimated:true },
  { display:"Daly City, CA",      aliases:["daly city"],       prov:"CA", med_inc:86000, lat:37.71, lng:-122.47,country:"us", estimated:true },
  { display:"Burbank, CA",        aliases:["burbank ca"],      prov:"CA", med_inc:74000, lat:34.18, lng:-118.31,country:"us", estimated:true },
  { display:"El Monte, CA",       aliases:["el monte"],        prov:"CA", med_inc:50000, lat:34.07, lng:-118.03,country:"us", estimated:true },
  { display:"West Covina, CA",    aliases:["west covina"],     prov:"CA", med_inc:72000, lat:34.07, lng:-117.94,country:"us", estimated:true },
  { display:"Inglewood, CA",      aliases:["inglewood ca"],    prov:"CA", med_inc:56000, lat:33.96, lng:-118.35,country:"us", estimated:true },
  { display:"San Bernardino, CA", aliases:["san bernardino"],  prov:"CA", med_inc:44000, lat:34.11, lng:-117.29,country:"us", estimated:true },
  { display:"Vallejo, CA",        aliases:["vallejo"],         prov:"CA", med_inc:70000, lat:38.10, lng:-122.26,country:"us", estimated:true },
  { display:"Berkeley, CA",       aliases:["berkeley ca"],     prov:"CA", med_inc:84000, lat:37.87, lng:-122.27,country:"us", estimated:true },
  { display:"Downey, CA",         aliases:["downey ca"],       prov:"CA", med_inc:66000, lat:33.94, lng:-118.13,country:"us", estimated:true },
  { display:"Costa Mesa, CA",     aliases:["costa mesa"],      prov:"CA", med_inc:80000, lat:33.65, lng:-117.92,country:"us", estimated:true },
  { display:"Norwalk, CA",        aliases:["norwalk ca"],      prov:"CA", med_inc:64000, lat:33.90, lng:-118.08,country:"us", estimated:true },
  { display:"Jurupa Valley, CA",  aliases:["jurupa valley"],   prov:"CA", med_inc:66000, lat:34.00, lng:-117.49,country:"us", estimated:true },
  { display:"Clovis, CA",         aliases:["clovis ca"],       prov:"CA", med_inc:68000, lat:36.83, lng:-119.70,country:"us", estimated:true },
  { display:"Ventura, CA",        aliases:["ventura ca"],      prov:"CA", med_inc:76000, lat:34.27, lng:-119.23,country:"us", estimated:true },
  { display:"West Sacramento, CA",aliases:["west sacramento"], prov:"CA", med_inc:60000, lat:38.58, lng:-121.53,country:"us", estimated:true },
  { display:"Santa Clara, CA",    aliases:["santa clara ca"],  prov:"CA", med_inc:118000,lat:37.35, lng:-121.95,country:"us", estimated:true },
  { display:"Hesperia, CA",       aliases:["hesperia ca"],     prov:"CA", med_inc:58000, lat:34.43, lng:-117.30,country:"us", estimated:true },
  { display:"Chico, CA",          aliases:["chico ca"],        prov:"CA", med_inc:44000, lat:39.73, lng:-121.84,country:"us", estimated:true },
  { display:"Santa Rosa, CA",     aliases:["santa rosa ca"],   prov:"CA", med_inc:72000, lat:38.44, lng:-122.71,country:"us", estimated:true },
  // COLORADO
  { display:"Aurora, CO",         aliases:["aurora co"],       prov:"CO", med_inc:62000, lat:39.73, lng:-104.83,country:"us", estimated:true },
  { display:"Fort Collins, CO",   aliases:["fort collins"],    prov:"CO", med_inc:64000, lat:40.59, lng:-105.08,country:"us", estimated:true },
  { display:"Lakewood, CO",       aliases:["lakewood co"],     prov:"CO", med_inc:64000, lat:39.71, lng:-105.08,country:"us", estimated:true },
  { display:"Thornton, CO",       aliases:["thornton co"],     prov:"CO", med_inc:70000, lat:39.87, lng:-104.97,country:"us", estimated:true },
  { display:"Arvada, CO",         aliases:["arvada"],          prov:"CO", med_inc:74000, lat:39.80, lng:-105.09,country:"us", estimated:true },
  { display:"Westminster, CO",    aliases:["westminster co"],  prov:"CO", med_inc:72000, lat:39.84, lng:-105.04,country:"us", estimated:true },
  { display:"Pueblo, CO",         aliases:["pueblo co"],       prov:"CO", med_inc:44000, lat:38.25, lng:-104.61,country:"us", estimated:true },
  { display:"Centennial, CO",     aliases:["centennial co"],   prov:"CO", med_inc:90000, lat:39.58, lng:-104.87,country:"us", estimated:true },
  { display:"Boulder, CO",        aliases:["boulder co"],      prov:"CO", med_inc:74000, lat:40.01, lng:-105.27,country:"us", estimated:true },
  { display:"Highlands Ranch, CO",aliases:["highlands ranch"], prov:"CO", med_inc:98000, lat:39.55, lng:-104.97,country:"us", estimated:true },
  { display:"Greeley, CO",        aliases:["greeley co"],      prov:"CO", med_inc:54000, lat:40.42, lng:-104.71,country:"us", estimated:true },
  { display:"Longmont, CO",       aliases:["longmont"],        prov:"CO", med_inc:68000, lat:40.17, lng:-105.10,country:"us", estimated:true },
  { display:"Loveland, CO",       aliases:["loveland co"],     prov:"CO", med_inc:64000, lat:40.40, lng:-105.07,country:"us", estimated:true },
  { display:"Broomfield, CO",     aliases:["broomfield"],      prov:"CO", med_inc:84000, lat:39.92, lng:-105.09,country:"us", estimated:true },
  { display:"Castle Rock, CO",    aliases:["castle rock co"],  prov:"CO", med_inc:96000, lat:39.37, lng:-104.86,country:"us", estimated:true },
  { display:"Parker, CO",         aliases:["parker co"],       prov:"CO", med_inc:96000, lat:39.52, lng:-104.76,country:"us", estimated:true },
  { display:"Commerce City, CO",  aliases:["commerce city co"],prov:"CO", med_inc:60000, lat:39.81, lng:-104.94,country:"us", estimated:true },
  // CONNECTICUT
  { display:"New Haven, CT",      aliases:["new haven ct"],    prov:"CT", med_inc:44000, lat:41.31, lng:-72.92, country:"us", estimated:true },
  { display:"Stamford, CT",       aliases:["stamford ct"],     prov:"CT", med_inc:88000, lat:41.05, lng:-73.54, country:"us", estimated:true },
  { display:"Waterbury, CT",      aliases:["waterbury ct"],    prov:"CT", med_inc:44000, lat:41.56, lng:-73.04, country:"us", estimated:true },
  { display:"Norwalk, CT",        aliases:["norwalk ct"],      prov:"CT", med_inc:82000, lat:41.12, lng:-73.41, country:"us", estimated:true },
  { display:"Danbury, CT",        aliases:["danbury"],         prov:"CT", med_inc:72000, lat:41.39, lng:-73.45, country:"us", estimated:true },
  { display:"New Britain, CT",    aliases:["new britain ct"],  prov:"CT", med_inc:42000, lat:41.66, lng:-72.78, country:"us", estimated:true },
  { display:"West Hartford, CT",  aliases:["west hartford"],   prov:"CT", med_inc:86000, lat:41.76, lng:-72.74, country:"us", estimated:true },
  { display:"Meriden, CT",        aliases:["meriden ct"],      prov:"CT", med_inc:54000, lat:41.54, lng:-72.80, country:"us", estimated:true },
  // DELAWARE
  { display:"Wilmington, DE",     aliases:["wilmington de"],   prov:"DE", med_inc:44000, lat:39.74, lng:-75.54, country:"us", estimated:true },
  { display:"Dover, DE",          aliases:["dover de"],        prov:"DE", med_inc:56000, lat:39.16, lng:-75.52, country:"us", estimated:true },
  { display:"Newark, DE",         aliases:["newark de"],       prov:"DE", med_inc:60000, lat:39.68, lng:-75.75, country:"us", estimated:true },
  // FLORIDA
  { display:"Jacksonville, FL",   aliases:["jacksonville fl"], prov:"FL", med_inc:56000, lat:30.33, lng:-81.66, country:"us", estimated:true },
  { display:"St. Petersburg, FL", aliases:["st petersburg fl","saint petersburg fl"], prov:"FL", med_inc:56000, lat:27.77, lng:-82.68, country:"us", estimated:true },
  { display:"Hialeah, FL",        aliases:["hialeah"],         prov:"FL", med_inc:38000, lat:25.86, lng:-80.28, country:"us", estimated:true },
  { display:"Port St. Lucie, FL", aliases:["port st lucie","port saint lucie"], prov:"FL", med_inc:60000, lat:27.29, lng:-80.35, country:"us", estimated:true },
  { display:"Tallahassee, FL",    aliases:["tallahassee"],     prov:"FL", med_inc:46000, lat:30.44, lng:-84.28, country:"us", estimated:true },
  { display:"Fort Lauderdale, FL",aliases:["fort lauderdale"], prov:"FL", med_inc:60000, lat:26.12, lng:-80.14, country:"us", estimated:true },
  { display:"Cape Coral, FL",     aliases:["cape coral fl"],   prov:"FL", med_inc:58000, lat:26.56, lng:-81.95, country:"us", estimated:true },
  { display:"Pembroke Pines, FL", aliases:["pembroke pines"],  prov:"FL", med_inc:66000, lat:26.01, lng:-86.30, country:"us", estimated:true },
  { display:"Hollywood, FL",      aliases:["hollywood fl"],    prov:"FL", med_inc:56000, lat:26.01, lng:-80.15, country:"us", estimated:true },
  { display:"Gainesville, FL",    aliases:["gainesville fl"],  prov:"FL", med_inc:40000, lat:29.65, lng:-82.33, country:"us", estimated:true },
  { display:"Miramar, FL",        aliases:["miramar fl"],      prov:"FL", med_inc:68000, lat:25.98, lng:-80.23, country:"us", estimated:true },
  { display:"Coral Springs, FL",  aliases:["coral springs"],   prov:"FL", med_inc:72000, lat:26.27, lng:-80.27, country:"us", estimated:true },
  { display:"Clearwater, FL",     aliases:["clearwater fl"],   prov:"FL", med_inc:52000, lat:27.97, lng:-82.77, country:"us", estimated:true },
  { display:"Palm Bay, FL",       aliases:["palm bay fl"],     prov:"FL", med_inc:52000, lat:28.03, lng:-80.59, country:"us", estimated:true },
  { display:"Pompano Beach, FL",  aliases:["pompano beach"],   prov:"FL", med_inc:52000, lat:26.24, lng:-80.12, country:"us", estimated:true },
  { display:"West Palm Beach, FL",aliases:["west palm beach"], prov:"FL", med_inc:54000, lat:26.71, lng:-80.06, country:"us", estimated:true },
  { display:"Lehigh Acres, FL",   aliases:["lehigh acres"],    prov:"FL", med_inc:50000, lat:26.61, lng:-81.65, country:"us", estimated:true },
  { display:"Davie, FL",          aliases:["davie fl"],        prov:"FL", med_inc:72000, lat:26.07, lng:-80.25, country:"us", estimated:true },
  { display:"Boca Raton, FL",     aliases:["boca raton"],      prov:"FL", med_inc:78000, lat:26.36, lng:-80.13, country:"us", estimated:true },
  { display:"Fort Myers, FL",     aliases:["fort myers"],      prov:"FL", med_inc:54000, lat:26.64, lng:-81.87, country:"us", estimated:true },
  { display:"Deltona, FL",        aliases:["deltona"],         prov:"FL", med_inc:54000, lat:28.90, lng:-81.26, country:"us", estimated:true },
  { display:"Daytona Beach, FL",  aliases:["daytona beach"],   prov:"FL", med_inc:38000, lat:29.21, lng:-81.02, country:"us", estimated:true },
  { display:"North Port, FL",     aliases:["north port fl"],   prov:"FL", med_inc:60000, lat:27.05, lng:-82.24, country:"us", estimated:true },
  { display:"Deerfield Beach, FL",aliases:["deerfield beach"], prov:"FL", med_inc:52000, lat:26.32, lng:-80.10, country:"us", estimated:true },
  { display:"Sunrise, FL",        aliases:["sunrise fl"],      prov:"FL", med_inc:56000, lat:26.17, lng:-80.26, country:"us", estimated:true },
  { display:"Plantation, FL",     aliases:["plantation fl"],   prov:"FL", med_inc:70000, lat:26.13, lng:-80.23, country:"us", estimated:true },
  { display:"Boynton Beach, FL",  aliases:["boynton beach"],   prov:"FL", med_inc:56000, lat:26.53, lng:-80.09, country:"us", estimated:true },
  { display:"Kissimmee, FL",      aliases:["kissimmee"],       prov:"FL", med_inc:44000, lat:28.30, lng:-81.41, country:"us", estimated:true },
  { display:"Ocala, FL",          aliases:["ocala fl"],        prov:"FL", med_inc:42000, lat:29.19, lng:-82.14, country:"us", estimated:true },
  { display:"Lakeland, FL",       aliases:["lakeland fl"],     prov:"FL", med_inc:48000, lat:28.04, lng:-81.95, country:"us", estimated:true },
  { display:"Sarasota, FL",       aliases:["sarasota"],        prov:"FL", med_inc:58000, lat:27.34, lng:-82.53, country:"us", estimated:true },
  { display:"Pensacola, FL",      aliases:["pensacola fl"],    prov:"FL", med_inc:48000, lat:30.42, lng:-87.22, country:"us", estimated:true },
  { display:"Palm Coast, FL",     aliases:["palm coast"],      prov:"FL", med_inc:58000, lat:29.58, lng:-81.21, country:"us", estimated:true },
  { display:"Melbourne, FL",      aliases:["melbourne fl"],    prov:"FL", med_inc:54000, lat:28.08, lng:-80.61, country:"us", estimated:true },
  { display:"Tallahassee, FL",    aliases:["tallahassee fl"],  prov:"FL", med_inc:46000, lat:30.44, lng:-84.28, country:"us", estimated:true },
  // GEORGIA
  { display:"Augusta, GA",        aliases:["augusta ga"],      prov:"GA", med_inc:46000, lat:33.47, lng:-82.01, country:"us", estimated:true },
  { display:"Columbus, GA",       aliases:["columbus ga"],     prov:"GA", med_inc:44000, lat:32.46, lng:-84.99, country:"us", estimated:true },
  { display:"Macon, GA",          aliases:["macon ga"],        prov:"GA", med_inc:38000, lat:32.84, lng:-83.63, country:"us", estimated:true },
  { display:"Savannah, GA",       aliases:["savannah ga"],     prov:"GA", med_inc:48000, lat:32.08, lng:-81.10, country:"us", estimated:true },
  { display:"Athens, GA",         aliases:["athens ga"],       prov:"GA", med_inc:38000, lat:33.96, lng:-83.38, country:"us", estimated:true },
  { display:"Sandy Springs, GA",  aliases:["sandy springs"],   prov:"GA", med_inc:90000, lat:33.92, lng:-84.38, country:"us", estimated:true },
  { display:"Roswell, GA",        aliases:["roswell ga"],      prov:"GA", med_inc:86000, lat:34.02, lng:-84.36, country:"us", estimated:true },
  { display:"Johns Creek, GA",    aliases:["johns creek"],     prov:"GA", med_inc:96000, lat:34.03, lng:-84.20, country:"us", estimated:true },
  { display:"Albany, GA",         aliases:["albany ga"],       prov:"GA", med_inc:34000, lat:31.58, lng:-84.16, country:"us", estimated:true },
  { display:"Warner Robins, GA",  aliases:["warner robins"],   prov:"GA", med_inc:54000, lat:32.61, lng:-83.60, country:"us", estimated:true },
  { display:"Alpharetta, GA",     aliases:["alpharetta"],      prov:"GA", med_inc:102000,lat:34.07, lng:-84.29, country:"us", estimated:true },
  { display:"Marietta, GA",       aliases:["marietta ga"],     prov:"GA", med_inc:62000, lat:33.95, lng:-84.55, country:"us", estimated:true },
  { display:"Valdosta, GA",       aliases:["valdosta"],        prov:"GA", med_inc:38000, lat:30.83, lng:-83.28, country:"us", estimated:true },
  { display:"Smyrna, GA",         aliases:["smyrna ga"],       prov:"GA", med_inc:72000, lat:33.88, lng:-84.52, country:"us", estimated:true },
  { display:"Peachtree City, GA", aliases:["peachtree city"],  prov:"GA", med_inc:88000, lat:33.40, lng:-84.57, country:"us", estimated:true },
  // IDAHO
  { display:"Nampa, ID",          aliases:["nampa"],           prov:"ID", med_inc:56000, lat:43.58, lng:-116.56,country:"us", estimated:true },
  { display:"Meridian, ID",       aliases:["meridian id"],     prov:"ID", med_inc:74000, lat:43.61, lng:-116.39,country:"us", estimated:true },
  { display:"Idaho Falls, ID",    aliases:["idaho falls"],     prov:"ID", med_inc:54000, lat:43.49, lng:-112.03,country:"us", estimated:true },
  { display:"Pocatello, ID",      aliases:["pocatello"],       prov:"ID", med_inc:46000, lat:42.87, lng:-112.45,country:"us", estimated:true },
  { display:"Caldwell, ID",       aliases:["caldwell id"],     prov:"ID", med_inc:52000, lat:43.66, lng:-116.69,country:"us", estimated:true },
  { display:"Coeur d'Alene, ID",  aliases:["coeur d'alene","coeur dalene"], prov:"ID", med_inc:56000, lat:47.68, lng:-116.78,country:"us", estimated:true },
  { display:"Twin Falls, ID",     aliases:["twin falls"],      prov:"ID", med_inc:50000, lat:42.56, lng:-114.46,country:"us", estimated:true },
  { display:"Post Falls, ID",     aliases:["post falls"],      prov:"ID", med_inc:60000, lat:47.72, lng:-116.95,country:"us", estimated:true },
  { display:"Lewiston, ID",       aliases:["lewiston id"],     prov:"ID", med_inc:50000, lat:46.42, lng:-117.02,country:"us", estimated:true },
  // ILLINOIS
  { display:"Aurora, IL",         aliases:["aurora il"],       prov:"IL", med_inc:68000, lat:41.76, lng:-88.32, country:"us", estimated:true },
  { display:"Rockford, IL",       aliases:["rockford il"],     prov:"IL", med_inc:46000, lat:42.27, lng:-89.09, country:"us", estimated:true },
  { display:"Joliet, IL",         aliases:["joliet"],          prov:"IL", med_inc:66000, lat:41.52, lng:-88.08, country:"us", estimated:true },
  { display:"Naperville, IL",     aliases:["naperville"],      prov:"IL", med_inc:104000,lat:41.79, lng:-88.16, country:"us", estimated:true },
  { display:"Springfield, IL",    aliases:["springfield il"],  prov:"IL", med_inc:54000, lat:39.80, lng:-89.65, country:"us", estimated:true },
  { display:"Elgin, IL",          aliases:["elgin il"],        prov:"IL", med_inc:64000, lat:42.04, lng:-88.29, country:"us", estimated:true },
  { display:"Waukegan, IL",       aliases:["waukegan"],        prov:"IL", med_inc:52000, lat:42.36, lng:-87.84, country:"us", estimated:true },
  { display:"Champaign, IL",      aliases:["champaign"],       prov:"IL", med_inc:46000, lat:40.12, lng:-88.24, country:"us", estimated:true },
  { display:"Bloomington, IL",    aliases:["bloomington il"],  prov:"IL", med_inc:62000, lat:40.48, lng:-88.99, country:"us", estimated:true },
  { display:"Decatur, IL",        aliases:["decatur il"],      prov:"IL", med_inc:42000, lat:39.84, lng:-88.95, country:"us", estimated:true },
  { display:"Evanston, IL",       aliases:["evanston il"],     prov:"IL", med_inc:80000, lat:42.05, lng:-87.69, country:"us", estimated:true },
  { display:"Schaumburg, IL",     aliases:["schaumburg"],      prov:"IL", med_inc:72000, lat:42.03, lng:-88.08, country:"us", estimated:true },
  { display:"Bolingbrook, IL",    aliases:["bolingbrook"],     prov:"IL", med_inc:76000, lat:41.70, lng:-88.07, country:"us", estimated:true },
  { display:"Waukegan, IL",       aliases:["waukegan il"],     prov:"IL", med_inc:52000, lat:42.36, lng:-87.84, country:"us", estimated:true },
  // INDIANA
  { display:"Fort Wayne, IN",     aliases:["fort wayne"],      prov:"IN", med_inc:52000, lat:41.13, lng:-85.13, country:"us", estimated:true },
  { display:"Evansville, IN",     aliases:["evansville"],      prov:"IN", med_inc:46000, lat:37.97, lng:-87.56, country:"us", estimated:true },
  { display:"South Bend, IN",     aliases:["south bend"],      prov:"IN", med_inc:42000, lat:41.68, lng:-86.25, country:"us", estimated:true },
  { display:"Carmel, IN",         aliases:["carmel in"],       prov:"IN", med_inc:98000, lat:39.98, lng:-86.12, country:"us", estimated:true },
  { display:"Fishers, IN",        aliases:["fishers in"],      prov:"IN", med_inc:90000, lat:39.96, lng:-85.97, country:"us", estimated:true },
  { display:"Bloomington, IN",    aliases:["bloomington in"],  prov:"IN", med_inc:42000, lat:39.17, lng:-86.52, country:"us", estimated:true },
  { display:"Hammond, IN",        aliases:["hammond in"],      prov:"IN", med_inc:46000, lat:41.62, lng:-87.50, country:"us", estimated:true },
  { display:"Gary, IN",           aliases:["gary in"],         prov:"IN", med_inc:34000, lat:41.59, lng:-87.35, country:"us", estimated:true },
  { display:"Muncie, IN",         aliases:["muncie"],          prov:"IN", med_inc:38000, lat:40.19, lng:-85.39, country:"us", estimated:true },
  { display:"Lafayette, IN",      aliases:["lafayette in"],    prov:"IN", med_inc:46000, lat:40.42, lng:-86.88, country:"us", estimated:true },
  { display:"Terre Haute, IN",    aliases:["terre haute"],     prov:"IN", med_inc:38000, lat:39.47, lng:-87.41, country:"us", estimated:true },
  { display:"Noblesville, IN",    aliases:["noblesville"],     prov:"IN", med_inc:82000, lat:40.05, lng:-86.01, country:"us", estimated:true },
  // IOWA
  { display:"Des Moines, IA",     aliases:["des moines"],      prov:"IA", med_inc:54000, lat:41.59, lng:-93.62, country:"us", estimated:true },
  { display:"Cedar Rapids, IA",   aliases:["cedar rapids"],    prov:"IA", med_inc:58000, lat:42.01, lng:-91.64, country:"us", estimated:true },
  { display:"Davenport, IA",      aliases:["davenport ia"],    prov:"IA", med_inc:52000, lat:41.52, lng:-90.58, country:"us", estimated:true },
  { display:"Sioux City, IA",     aliases:["sioux city"],      prov:"IA", med_inc:50000, lat:42.50, lng:-96.40, country:"us", estimated:true },
  { display:"Iowa City, IA",      aliases:["iowa city"],       prov:"IA", med_inc:52000, lat:41.66, lng:-91.53, country:"us", estimated:true },
  { display:"Waterloo, IA",       aliases:["waterloo ia"],     prov:"IA", med_inc:50000, lat:42.50, lng:-92.34, country:"us", estimated:true },
  { display:"Ames, IA",           aliases:["ames ia"],         prov:"IA", med_inc:54000, lat:42.03, lng:-93.62, country:"us", estimated:true },
  { display:"Dubuque, IA",        aliases:["dubuque"],         prov:"IA", med_inc:54000, lat:42.50, lng:-90.66, country:"us", estimated:true },
  { display:"Council Bluffs, IA", aliases:["council bluffs"],  prov:"IA", med_inc:50000, lat:41.26, lng:-95.86, country:"us", estimated:true },
  { display:"Ankeny, IA",         aliases:["ankeny"],          prov:"IA", med_inc:72000, lat:41.73, lng:-93.60, country:"us", estimated:true },
  // KANSAS
  { display:"Overland Park, KS",  aliases:["overland park"],   prov:"KS", med_inc:82000, lat:38.99, lng:-94.67, country:"us", estimated:true },
  { display:"Kansas City, KS",    aliases:["kansas city ks"],  prov:"KS", med_inc:50000, lat:39.11, lng:-94.63, country:"us", estimated:true },
  { display:"Olathe, KS",         aliases:["olathe"],          prov:"KS", med_inc:78000, lat:38.88, lng:-94.82, country:"us", estimated:true },
  { display:"Topeka, KS",         aliases:["topeka"],          prov:"KS", med_inc:48000, lat:39.05, lng:-95.69, country:"us", estimated:true },
  { display:"Lawrence, KS",       aliases:["lawrence ks"],     prov:"KS", med_inc:48000, lat:38.97, lng:-95.24, country:"us", estimated:true },
  { display:"Shawnee, KS",        aliases:["shawnee ks"],      prov:"KS", med_inc:76000, lat:39.02, lng:-94.72, country:"us", estimated:true },
  { display:"Manhattan, KS",      aliases:["manhattan ks"],    prov:"KS", med_inc:46000, lat:39.19, lng:-96.60, country:"us", estimated:true },
  { display:"Lenexa, KS",         aliases:["lenexa"],          prov:"KS", med_inc:80000, lat:38.95, lng:-94.73, country:"us", estimated:true },
  { display:"Salina, KS",         aliases:["salina ks"],       prov:"KS", med_inc:50000, lat:38.84, lng:-97.61, country:"us", estimated:true },
  // KENTUCKY
  { display:"Louisville, KY",     aliases:["louisville ky"],   prov:"KY", med_inc:54000, lat:38.25, lng:-85.76, country:"us", estimated:true },
  { display:"Lexington, KY",      aliases:["lexington ky"],    prov:"KY", med_inc:54000, lat:38.04, lng:-84.50, country:"us", estimated:true },
  { display:"Bowling Green, KY",  aliases:["bowling green ky"],prov:"KY", med_inc:46000, lat:36.99, lng:-86.44, country:"us", estimated:true },
  { display:"Owensboro, KY",      aliases:["owensboro"],       prov:"KY", med_inc:48000, lat:37.77, lng:-87.11, country:"us", estimated:true },
  { display:"Covington, KY",      aliases:["covington ky"],    prov:"KY", med_inc:44000, lat:39.08, lng:-84.51, country:"us", estimated:true },
  { display:"Hopkinsville, KY",   aliases:["hopkinsville"],    prov:"KY", med_inc:44000, lat:36.87, lng:-87.49, country:"us", estimated:true },
  { display:"Richmond, KY",       aliases:["richmond ky"],     prov:"KY", med_inc:42000, lat:37.75, lng:-84.29, country:"us", estimated:true },
  // LOUISIANA
  { display:"New Orleans, LA",    aliases:["new orleans la"],  prov:"LA", med_inc:44000, lat:29.95, lng:-90.07, country:"us", estimated:true },
  { display:"Shreveport, LA",     aliases:["shreveport"],      prov:"LA", med_inc:42000, lat:32.53, lng:-93.75, country:"us", estimated:true },
  { display:"Metairie, LA",       aliases:["metairie"],        prov:"LA", med_inc:62000, lat:30.00, lng:-90.18, country:"us", estimated:true },
  { display:"Baton Rouge, LA",    aliases:["baton rouge la"],  prov:"LA", med_inc:50000, lat:30.45, lng:-91.15, country:"us", estimated:true },
  { display:"Lafayette, LA",      aliases:["lafayette la"],    prov:"LA", med_inc:48000, lat:30.22, lng:-92.02, country:"us", estimated:true },
  { display:"Lake Charles, LA",   aliases:["lake charles"],    prov:"LA", med_inc:48000, lat:30.21, lng:-93.21, country:"us", estimated:true },
  { display:"Kenner, LA",         aliases:["kenner la"],       prov:"LA", med_inc:54000, lat:29.99, lng:-90.24, country:"us", estimated:true },
  { display:"Monroe, LA",         aliases:["monroe la"],       prov:"LA", med_inc:38000, lat:32.51, lng:-92.12, country:"us", estimated:true },
  { display:"Alexandria, LA",     aliases:["alexandria la"],   prov:"LA", med_inc:40000, lat:31.31, lng:-92.45, country:"us", estimated:true },
  // MAINE
  { display:"Portland, ME",       aliases:["portland me"],     prov:"ME", med_inc:60000, lat:43.66, lng:-70.26, country:"us", estimated:true },
  { display:"Lewiston, ME",       aliases:["lewiston me"],     prov:"ME", med_inc:40000, lat:44.10, lng:-70.21, country:"us", estimated:true },
  { display:"Bangor, ME",         aliases:["bangor me"],       prov:"ME", med_inc:46000, lat:44.80, lng:-68.78, country:"us", estimated:true },
  { display:"Auburn, ME",         aliases:["auburn me"],       prov:"ME", med_inc:48000, lat:44.10, lng:-70.23, country:"us", estimated:true },
  // MARYLAND
  { display:"Baltimore, MD",      aliases:["baltimore md"],    prov:"MD", med_inc:52000, lat:39.29, lng:-76.61, country:"us", estimated:true },
  { display:"Columbia, MD",       aliases:["columbia md"],     prov:"MD", med_inc:100000,lat:39.20, lng:-76.86, country:"us", estimated:true },
  { display:"Germantown, MD",     aliases:["germantown md"],   prov:"MD", med_inc:86000, lat:39.17, lng:-77.27, country:"us", estimated:true },
  { display:"Silver Spring, MD",  aliases:["silver spring"],   prov:"MD", med_inc:80000, lat:38.99, lng:-77.03, country:"us", estimated:true },
  { display:"Waldorf, MD",        aliases:["waldorf md"],      prov:"MD", med_inc:84000, lat:38.63, lng:-76.91, country:"us", estimated:true },
  { display:"Frederick, MD",      aliases:["frederick md"],    prov:"MD", med_inc:72000, lat:39.41, lng:-77.41, country:"us", estimated:true },
  { display:"Rockville, MD",      aliases:["rockville md"],    prov:"MD", med_inc:98000, lat:39.08, lng:-77.15, country:"us", estimated:true },
  { display:"Bethesda, MD",       aliases:["bethesda"],        prov:"MD", med_inc:130000,lat:38.98, lng:-77.10, country:"us", estimated:true },
  { display:"Gaithersburg, MD",   aliases:["gaithersburg"],    prov:"MD", med_inc:80000, lat:39.14, lng:-77.20, country:"us", estimated:true },
  { display:"Annapolis, MD",      aliases:["annapolis"],       prov:"MD", med_inc:80000, lat:38.98, lng:-76.49, country:"us", estimated:true },
  { display:"Hagerstown, MD",     aliases:["hagerstown"],      prov:"MD", med_inc:52000, lat:39.64, lng:-77.72, country:"us", estimated:true },
  // MASSACHUSETTS
  { display:"Worcester, MA",      aliases:["worcester ma"],    prov:"MA", med_inc:60000, lat:42.26, lng:-71.80, country:"us", estimated:true },
  { display:"Springfield, MA",    aliases:["springfield ma"],  prov:"MA", med_inc:38000, lat:42.10, lng:-72.59, country:"us", estimated:true },
  { display:"Lowell, MA",         aliases:["lowell ma"],       prov:"MA", med_inc:52000, lat:42.63, lng:-71.32, country:"us", estimated:true },
  { display:"Cambridge, MA",      aliases:["cambridge ma"],    prov:"MA", med_inc:106000,lat:42.37, lng:-71.11, country:"us", estimated:true },
  { display:"New Bedford, MA",    aliases:["new bedford"],     prov:"MA", med_inc:42000, lat:41.64, lng:-70.94, country:"us", estimated:true },
  { display:"Brockton, MA",       aliases:["brockton"],        prov:"MA", med_inc:50000, lat:42.08, lng:-71.02, country:"us", estimated:true },
  { display:"Quincy, MA",         aliases:["quincy ma"],       prov:"MA", med_inc:72000, lat:42.25, lng:-71.00, country:"us", estimated:true },
  { display:"Lynn, MA",           aliases:["lynn ma"],         prov:"MA", med_inc:52000, lat:42.47, lng:-70.95, country:"us", estimated:true },
  { display:"Fall River, MA",     aliases:["fall river"],      prov:"MA", med_inc:40000, lat:41.70, lng:-71.16, country:"us", estimated:true },
  { display:"Newton, MA",         aliases:["newton ma"],       prov:"MA", med_inc:130000,lat:42.34, lng:-71.21, country:"us", estimated:true },
  { display:"Somerville, MA",     aliases:["somerville ma"],   prov:"MA", med_inc:88000, lat:42.39, lng:-71.10, country:"us", estimated:true },
  { display:"Framingham, MA",     aliases:["framingham"],      prov:"MA", med_inc:84000, lat:42.28, lng:-71.42, country:"us", estimated:true },
  { display:"Haverhill, MA",      aliases:["haverhill"],       prov:"MA", med_inc:66000, lat:42.78, lng:-71.08, country:"us", estimated:true },
  { display:"Waltham, MA",        aliases:["waltham ma"],      prov:"MA", med_inc:92000, lat:42.38, lng:-71.24, country:"us", estimated:true },
  { display:"Malden, MA",         aliases:["malden ma"],       prov:"MA", med_inc:62000, lat:42.43, lng:-71.07, country:"us", estimated:true },
  { display:"Medford, MA",        aliases:["medford ma"],      prov:"MA", med_inc:80000, lat:42.42, lng:-71.11, country:"us", estimated:true },
  { display:"Taunton, MA",        aliases:["taunton ma"],      prov:"MA", med_inc:60000, lat:41.90, lng:-71.09, country:"us", estimated:true },
  { display:"Chicopee, MA",       aliases:["chicopee"],        prov:"MA", med_inc:46000, lat:42.15, lng:-72.61, country:"us", estimated:true },
  // MICHIGAN
  { display:"Grand Rapids, MI",   aliases:["grand rapids mi"], prov:"MI", med_inc:52000, lat:42.96, lng:-85.66, country:"us", estimated:true },
  { display:"Warren, MI",         aliases:["warren mi"],       prov:"MI", med_inc:58000, lat:42.49, lng:-83.03, country:"us", estimated:true },
  { display:"Sterling Heights, MI",aliases:["sterling heights"],prov:"MI",med_inc:66000, lat:42.58, lng:-83.03, country:"us", estimated:true },
  { display:"Lansing, MI",        aliases:["lansing mi"],      prov:"MI", med_inc:44000, lat:42.73, lng:-84.56, country:"us", estimated:true },
  { display:"Ann Arbor, MI",      aliases:["ann arbor mi"],    prov:"MI", med_inc:68000, lat:42.28, lng:-83.74, country:"us", estimated:true },
  { display:"Flint, MI",          aliases:["flint mi"],        prov:"MI", med_inc:30000, lat:43.01, lng:-83.69, country:"us", estimated:true },
  { display:"Dearborn, MI",       aliases:["dearborn mi"],     prov:"MI", med_inc:54000, lat:42.32, lng:-83.18, country:"us", estimated:true },
  { display:"Livonia, MI",        aliases:["livonia"],         prov:"MI", med_inc:72000, lat:42.37, lng:-83.35, country:"us", estimated:true },
  { display:"Clinton Township, MI",aliases:["clinton township"],prov:"MI",med_inc:62000, lat:42.59, lng:-82.92, country:"us", estimated:true },
  { display:"Westland, MI",       aliases:["westland mi"],     prov:"MI", med_inc:54000, lat:42.32, lng:-83.40, country:"us", estimated:true },
  { display:"Troy, MI",           aliases:["troy mi"],         prov:"MI", med_inc:84000, lat:42.61, lng:-83.15, country:"us", estimated:true },
  { display:"Farmington Hills, MI",aliases:["farmington hills"],prov:"MI",med_inc:82000, lat:42.49, lng:-83.37, country:"us", estimated:true },
  { display:"Kalamazoo, MI",      aliases:["kalamazoo"],       prov:"MI", med_inc:42000, lat:42.29, lng:-85.59, country:"us", estimated:true },
  { display:"Wyoming, MI",        aliases:["wyoming mi"],      prov:"MI", med_inc:54000, lat:42.91, lng:-85.71, country:"us", estimated:true },
  { display:"Southfield, MI",     aliases:["southfield"],      prov:"MI", med_inc:54000, lat:42.47, lng:-83.25, country:"us", estimated:true },
  { display:"Rochester Hills, MI",aliases:["rochester hills"], prov:"MI", med_inc:86000, lat:42.66, lng:-83.15, country:"us", estimated:true },
  { display:"Taylor, MI",         aliases:["taylor mi"],       prov:"MI", med_inc:48000, lat:42.24, lng:-83.27, country:"us", estimated:true },
  { display:"Pontiac, MI",        aliases:["pontiac mi"],      prov:"MI", med_inc:38000, lat:42.64, lng:-83.29, country:"us", estimated:true },
  { display:"Saginaw, MI",        aliases:["saginaw"],         prov:"MI", med_inc:32000, lat:43.42, lng:-83.95, country:"us", estimated:true },
  { display:"Traverse City, MI",  aliases:["traverse city"],   prov:"MI", med_inc:54000, lat:44.76, lng:-85.62, country:"us", estimated:true },
  { display:"Midland, MI",        aliases:["midland mi"],      prov:"MI", med_inc:66000, lat:43.62, lng:-84.24, country:"us", estimated:true },
  // MINNESOTA
  { display:"Minneapolis, MN",    aliases:["minneapolis mn"],  prov:"MN", med_inc:62000, lat:44.98, lng:-93.27, country:"us", estimated:true },
  { display:"St. Paul, MN",       aliases:["st paul","saint paul"], prov:"MN", med_inc:58000, lat:44.95, lng:-93.09, country:"us", estimated:true },
  { display:"Rochester, MN",      aliases:["rochester mn"],    prov:"MN", med_inc:72000, lat:44.02, lng:-92.47, country:"us", estimated:true },
  { display:"Duluth, MN",         aliases:["duluth mn"],       prov:"MN", med_inc:50000, lat:46.79, lng:-92.10, country:"us", estimated:true },
  { display:"Bloomington, MN",    aliases:["bloomington mn"],  prov:"MN", med_inc:74000, lat:44.84, lng:-93.39, country:"us", estimated:true },
  { display:"Brooklyn Park, MN",  aliases:["brooklyn park mn"],prov:"MN", med_inc:66000, lat:45.09, lng:-93.37, country:"us", estimated:true },
  { display:"Plymouth, MN",       aliases:["plymouth mn"],     prov:"MN", med_inc:92000, lat:45.02, lng:-93.46, country:"us", estimated:true },
  { display:"St. Cloud, MN",      aliases:["st cloud","saint cloud"], prov:"MN", med_inc:50000, lat:45.56, lng:-94.16, country:"us", estimated:true },
  { display:"Eagan, MN",          aliases:["eagan mn"],        prov:"MN", med_inc:86000, lat:44.80, lng:-93.17, country:"us", estimated:true },
  { display:"Woodbury, MN",       aliases:["woodbury mn"],     prov:"MN", med_inc:96000, lat:44.92, lng:-92.96, country:"us", estimated:true },
  { display:"Maple Grove, MN",    aliases:["maple grove mn"],  prov:"MN", med_inc:90000, lat:45.07, lng:-93.46, country:"us", estimated:true },
  { display:"Coon Rapids, MN",    aliases:["coon rapids"],     prov:"MN", med_inc:68000, lat:45.12, lng:-93.31, country:"us", estimated:true },
  { display:"Eden Prairie, MN",   aliases:["eden prairie"],    prov:"MN", med_inc:100000,lat:44.85, lng:-93.47, country:"us", estimated:true },
  { display:"Burnsville, MN",     aliases:["burnsville mn"],   prov:"MN", med_inc:72000, lat:44.77, lng:-93.28, country:"us", estimated:true },
  { display:"Mankato, MN",        aliases:["mankato"],         prov:"MN", med_inc:50000, lat:44.16, lng:-94.00, country:"us", estimated:true },
  // MISSISSIPPI
  { display:"Jackson, MS",        aliases:["jackson ms"],      prov:"MS", med_inc:36000, lat:32.30, lng:-90.18, country:"us", estimated:true },
  { display:"Gulfport, MS",       aliases:["gulfport"],        prov:"MS", med_inc:44000, lat:30.37, lng:-89.09, country:"us", estimated:true },
  { display:"Southaven, MS",      aliases:["southaven"],       prov:"MS", med_inc:62000, lat:34.99, lng:-90.00, country:"us", estimated:true },
  { display:"Hattiesburg, MS",    aliases:["hattiesburg"],     prov:"MS", med_inc:38000, lat:31.33, lng:-89.29, country:"us", estimated:true },
  { display:"Biloxi, MS",         aliases:["biloxi"],          prov:"MS", med_inc:42000, lat:30.40, lng:-88.89, country:"us", estimated:true },
  { display:"Meridian, MS",       aliases:["meridian ms"],     prov:"MS", med_inc:36000, lat:32.36, lng:-88.70, country:"us", estimated:true },
  // MISSOURI
  { display:"Kansas City, MO",    aliases:["kansas city mo"],  prov:"MO", med_inc:56000, lat:39.10, lng:-94.58, country:"us", estimated:true },
  { display:"St. Louis, MO",      aliases:["st louis mo"],     prov:"MO", med_inc:46000, lat:38.63, lng:-90.20, country:"us", estimated:true },
  { display:"Springfield, MO",    aliases:["springfield mo"],  prov:"MO", med_inc:44000, lat:37.21, lng:-93.30, country:"us", estimated:true },
  { display:"Columbia, MO",       aliases:["columbia mo"],     prov:"MO", med_inc:50000, lat:38.95, lng:-92.33, country:"us", estimated:true },
  { display:"Independence, MO",   aliases:["independence mo"], prov:"MO", med_inc:52000, lat:39.09, lng:-94.41, country:"us", estimated:true },
  { display:"Lee's Summit, MO",   aliases:["lees summit","lee's summit"], prov:"MO", med_inc:74000, lat:38.91, lng:-94.38, country:"us", estimated:true },
  { display:"O'Fallon, MO",       aliases:["ofallon mo","o'fallon mo"], prov:"MO", med_inc:76000, lat:38.81, lng:-90.70, country:"us", estimated:true },
  { display:"St. Joseph, MO",     aliases:["st joseph mo"],    prov:"MO", med_inc:46000, lat:39.77, lng:-94.85, country:"us", estimated:true },
  { display:"St. Charles, MO",    aliases:["st charles mo"],   prov:"MO", med_inc:68000, lat:38.79, lng:-90.49, country:"us", estimated:true },
  { display:"Blue Springs, MO",   aliases:["blue springs mo"], prov:"MO", med_inc:68000, lat:39.02, lng:-94.28, country:"us", estimated:true },
  { display:"Joplin, MO",         aliases:["joplin mo"],       prov:"MO", med_inc:42000, lat:37.08, lng:-94.51, country:"us", estimated:true },
  // MONTANA
  { display:"Billings, MT",       aliases:["billings mt"],     prov:"MT", med_inc:54000, lat:45.78, lng:-108.50,country:"us", estimated:true },
  { display:"Missoula, MT",       aliases:["missoula"],        prov:"MT", med_inc:50000, lat:46.87, lng:-113.99,country:"us", estimated:true },
  { display:"Great Falls, MT",    aliases:["great falls mt"],  prov:"MT", med_inc:52000, lat:47.50, lng:-111.30,country:"us", estimated:true },
  { display:"Bozeman, MT",        aliases:["bozeman"],         prov:"MT", med_inc:60000, lat:45.68, lng:-111.04,country:"us", estimated:true },
  { display:"Butte, MT",          aliases:["butte mt"],        prov:"MT", med_inc:46000, lat:46.00, lng:-112.54,country:"us", estimated:true },
  { display:"Helena, MT",         aliases:["helena mt"],       prov:"MT", med_inc:58000, lat:46.60, lng:-112.02,country:"us", estimated:true },
  { display:"Kalispell, MT",      aliases:["kalispell"],       prov:"MT", med_inc:52000, lat:48.20, lng:-114.31,country:"us", estimated:true },
  // NEBRASKA
  { display:"Omaha, NE",          aliases:["omaha ne"],        prov:"NE", med_inc:60000, lat:41.26, lng:-95.94, country:"us", estimated:true },
  { display:"Lincoln, NE",        aliases:["lincoln ne"],      prov:"NE", med_inc:56000, lat:40.81, lng:-96.68, country:"us", estimated:true },
  { display:"Bellevue, NE",       aliases:["bellevue ne"],     prov:"NE", med_inc:68000, lat:41.15, lng:-95.91, country:"us", estimated:true },
  { display:"Grand Island, NE",   aliases:["grand island ne"], prov:"NE", med_inc:52000, lat:40.93, lng:-98.34, country:"us", estimated:true },
  { display:"Kearney, NE",        aliases:["kearney ne"],      prov:"NE", med_inc:52000, lat:40.70, lng:-99.08, country:"us", estimated:true },
  { display:"Fremont, NE",        aliases:["fremont ne"],      prov:"NE", med_inc:54000, lat:41.44, lng:-96.50, country:"us", estimated:true },
  { display:"Norfolk, NE",        aliases:["norfolk ne"],      prov:"NE", med_inc:54000, lat:42.03, lng:-97.42, country:"us", estimated:true },
  // NEVADA
  { display:"Reno, NV",           aliases:["reno nv"],         prov:"NV", med_inc:62000, lat:39.53, lng:-119.81,country:"us", estimated:true },
  { display:"Henderson, NV",      aliases:["henderson nv"],    prov:"NV", med_inc:68000, lat:36.03, lng:-114.98,country:"us", estimated:true },
  { display:"North Las Vegas, NV",aliases:["north las vegas"], prov:"NV", med_inc:58000, lat:36.20, lng:-115.12,country:"us", estimated:true },
  { display:"Paradise, NV",       aliases:["paradise nv"],     prov:"NV", med_inc:52000, lat:36.09, lng:-115.15,country:"us", estimated:true },
  { display:"Sparks, NV",         aliases:["sparks nv"],       prov:"NV", med_inc:60000, lat:39.53, lng:-119.75,country:"us", estimated:true },
  { display:"Carson City, NV",    aliases:["carson city"],     prov:"NV", med_inc:60000, lat:39.16, lng:-119.77,country:"us", estimated:true },
  // NEW HAMPSHIRE
  { display:"Manchester, NH",     aliases:["manchester nh"],   prov:"NH", med_inc:62000, lat:42.99, lng:-71.46, country:"us", estimated:true },
  { display:"Nashua, NH",         aliases:["nashua"],          prov:"NH", med_inc:74000, lat:42.77, lng:-71.47, country:"us", estimated:true },
  { display:"Concord, NH",        aliases:["concord nh"],      prov:"NH", med_inc:66000, lat:43.21, lng:-71.54, country:"us", estimated:true },
  { display:"Dover, NH",          aliases:["dover nh"],        prov:"NH", med_inc:68000, lat:43.20, lng:-70.87, country:"us", estimated:true },
  { display:"Rochester, NH",      aliases:["rochester nh"],    prov:"NH", med_inc:60000, lat:43.30, lng:-70.97, country:"us", estimated:true },
  // NEW JERSEY
  { display:"Newark, NJ",         aliases:["newark nj"],       prov:"NJ", med_inc:36000, lat:40.73, lng:-74.17, country:"us", estimated:true },
  { display:"Jersey City, NJ",    aliases:["jersey city"],     prov:"NJ", med_inc:72000, lat:40.72, lng:-74.04, country:"us", estimated:true },
  { display:"Paterson, NJ",       aliases:["paterson nj"],     prov:"NJ", med_inc:38000, lat:40.92, lng:-74.17, country:"us", estimated:true },
  { display:"Elizabeth, NJ",      aliases:["elizabeth nj"],    prov:"NJ", med_inc:44000, lat:40.66, lng:-74.21, country:"us", estimated:true },
  { display:"Lakewood, NJ",       aliases:["lakewood nj"],     prov:"NJ", med_inc:50000, lat:40.10, lng:-74.22, country:"us", estimated:true },
  { display:"Edison, NJ",         aliases:["edison nj"],       prov:"NJ", med_inc:88000, lat:40.52, lng:-74.41, country:"us", estimated:true },
  { display:"Toms River, NJ",     aliases:["toms river"],      prov:"NJ", med_inc:74000, lat:39.95, lng:-74.20, country:"us", estimated:true },
  { display:"Woodbridge, NJ",     aliases:["woodbridge nj"],   prov:"NJ", med_inc:80000, lat:40.56, lng:-74.29, country:"us", estimated:true },
  { display:"Trenton, NJ",        aliases:["trenton nj"],      prov:"NJ", med_inc:36000, lat:40.22, lng:-74.76, country:"us", estimated:true },
  { display:"Camden, NJ",         aliases:["camden nj"],       prov:"NJ", med_inc:26000, lat:39.93, lng:-75.12, country:"us", estimated:true },
  // NEW MEXICO
  { display:"Albuquerque, NM",    aliases:["albuquerque nm"],  prov:"NM", med_inc:52000, lat:35.08, lng:-106.65,country:"us", estimated:true },
  { display:"Las Cruces, NM",     aliases:["las cruces"],      prov:"NM", med_inc:42000, lat:32.32, lng:-106.77,country:"us", estimated:true },
  { display:"Rio Rancho, NM",     aliases:["rio rancho"],      prov:"NM", med_inc:62000, lat:35.23, lng:-106.66,country:"us", estimated:true },
  { display:"Santa Fe, NM",       aliases:["santa fe nm"],     prov:"NM", med_inc:58000, lat:35.69, lng:-105.94,country:"us", estimated:true },
  { display:"Roswell, NM",        aliases:["roswell nm"],      prov:"NM", med_inc:44000, lat:33.39, lng:-104.52,country:"us", estimated:true },
  // NEW YORK
  { display:"New York, NY",       aliases:["new york ny"],     prov:"NY", med_inc:72000, lat:40.71, lng:-74.01, country:"us", estimated:true },
  { display:"Buffalo, NY",        aliases:["buffalo ny"],      prov:"NY", med_inc:40000, lat:42.89, lng:-78.87, country:"us", estimated:true },
  { display:"Yonkers, NY",        aliases:["yonkers"],         prov:"NY", med_inc:60000, lat:40.93, lng:-73.90, country:"us", estimated:true },
  { display:"Syracuse, NY",       aliases:["syracuse ny"],     prov:"NY", med_inc:40000, lat:43.05, lng:-76.15, country:"us", estimated:true },
  { display:"Rochester, NY",      aliases:["rochester ny"],    prov:"NY", med_inc:38000, lat:43.16, lng:-77.61, country:"us", estimated:true },
  { display:"Albany, NY",         aliases:["albany ny"],       prov:"NY", med_inc:52000, lat:42.65, lng:-73.75, country:"us", estimated:true },
  { display:"New Rochelle, NY",   aliases:["new rochelle"],    prov:"NY", med_inc:72000, lat:40.91, lng:-73.78, country:"us", estimated:true },
  { display:"Mount Vernon, NY",   aliases:["mount vernon ny"], prov:"NY", med_inc:58000, lat:40.91, lng:-73.84, country:"us", estimated:true },
  { display:"Schenectady, NY",    aliases:["schenectady"],     prov:"NY", med_inc:44000, lat:42.81, lng:-73.94, country:"us", estimated:true },
  { display:"Utica, NY",          aliases:["utica ny"],        prov:"NY", med_inc:36000, lat:43.10, lng:-75.23, country:"us", estimated:true },
  { display:"White Plains, NY",   aliases:["white plains"],    prov:"NY", med_inc:72000, lat:41.03, lng:-73.76, country:"us", estimated:true },
  { display:"Binghamton, NY",     aliases:["binghamton"],      prov:"NY", med_inc:38000, lat:42.10, lng:-75.91, country:"us", estimated:true },
  { display:"Troy, NY",           aliases:["troy ny"],         prov:"NY", med_inc:42000, lat:42.73, lng:-73.69, country:"us", estimated:true },
  { display:"Niagara Falls, NY",  aliases:["niagara falls ny"],prov:"NY", med_inc:36000, lat:43.09, lng:-79.06, country:"us", estimated:true },
  { display:"Ithaca, NY",         aliases:["ithaca ny"],       prov:"NY", med_inc:44000, lat:42.44, lng:-76.50, country:"us", estimated:true },
  // NORTH CAROLINA
  { display:"Charlotte, NC",      aliases:["charlotte nc"],    prov:"NC", med_inc:60000, lat:35.23, lng:-80.84, country:"us", estimated:true },
  { display:"Raleigh, NC",        aliases:["raleigh nc"],      prov:"NC", med_inc:64000, lat:35.78, lng:-78.64, country:"us", estimated:true },
  { display:"Greensboro, NC",     aliases:["greensboro nc"],   prov:"NC", med_inc:50000, lat:36.07, lng:-79.79, country:"us", estimated:true },
  { display:"Durham, NC",         aliases:["durham nc"],       prov:"NC", med_inc:62000, lat:35.99, lng:-78.90, country:"us", estimated:true },
  { display:"Winston-Salem, NC",  aliases:["winston-salem nc"],prov:"NC", med_inc:48000, lat:36.10, lng:-80.24, country:"us", estimated:true },
  { display:"Fayetteville, NC",   aliases:["fayetteville nc"], prov:"NC", med_inc:46000, lat:35.05, lng:-78.88, country:"us", estimated:true },
  { display:"Cary, NC",           aliases:["cary nc"],         prov:"NC", med_inc:96000, lat:35.79, lng:-78.78, country:"us", estimated:true },
  { display:"Wilmington, NC",     aliases:["wilmington nc"],   prov:"NC", med_inc:52000, lat:34.23, lng:-77.95, country:"us", estimated:true },
  { display:"High Point, NC",     aliases:["high point nc"],   prov:"NC", med_inc:48000, lat:35.96, lng:-80.00, country:"us", estimated:true },
  { display:"Concord, NC",        aliases:["concord nc"],      prov:"NC", med_inc:62000, lat:35.41, lng:-80.58, country:"us", estimated:true },
  { display:"Gastonia, NC",       aliases:["gastonia"],        prov:"NC", med_inc:48000, lat:35.26, lng:-81.19, country:"us", estimated:true },
  { display:"Chapel Hill, NC",    aliases:["chapel hill"],     prov:"NC", med_inc:70000, lat:35.91, lng:-79.05, country:"us", estimated:true },
  { display:"Huntersville, NC",   aliases:["huntersville"],    prov:"NC", med_inc:86000, lat:35.41, lng:-80.85, country:"us", estimated:true },
  { display:"Burlington, NC",     aliases:["burlington nc"],   prov:"NC", med_inc:46000, lat:36.10, lng:-79.44, country:"us", estimated:true },
  { display:"Rocky Mount, NC",    aliases:["rocky mount nc"],  prov:"NC", med_inc:40000, lat:35.94, lng:-77.80, country:"us", estimated:true },
  { display:"Hickory, NC",        aliases:["hickory nc"],      prov:"NC", med_inc:48000, lat:35.73, lng:-81.34, country:"us", estimated:true },
  // NORTH DAKOTA
  { display:"Fargo, ND",          aliases:["fargo nd"],        prov:"ND", med_inc:62000, lat:46.88, lng:-96.79, country:"us", estimated:true },
  { display:"Bismarck, ND",       aliases:["bismarck nd"],     prov:"ND", med_inc:66000, lat:46.81, lng:-100.79,country:"us", estimated:true },
  { display:"Grand Forks, ND",    aliases:["grand forks nd"],  prov:"ND", med_inc:54000, lat:47.92, lng:-97.03, country:"us", estimated:true },
  { display:"Minot, ND",          aliases:["minot nd"],        prov:"ND", med_inc:62000, lat:48.23, lng:-101.30,country:"us", estimated:true },
  // OHIO
  { display:"Columbus, OH",       aliases:["columbus oh"],     prov:"OH", med_inc:52000, lat:39.96, lng:-82.99, country:"us", estimated:true },
  { display:"Cleveland, OH",      aliases:["cleveland oh"],    prov:"OH", med_inc:32000, lat:41.50, lng:-81.69, country:"us", estimated:true },
  { display:"Cincinnati, OH",     aliases:["cincinnati"],      prov:"OH", med_inc:44000, lat:39.10, lng:-84.51, country:"us", estimated:true },
  { display:"Toledo, OH",         aliases:["toledo oh"],       prov:"OH", med_inc:40000, lat:41.66, lng:-83.56, country:"us", estimated:true },
  { display:"Akron, OH",          aliases:["akron oh"],        prov:"OH", med_inc:42000, lat:41.08, lng:-81.52, country:"us", estimated:true },
  { display:"Dayton, OH",         aliases:["dayton oh"],       prov:"OH", med_inc:36000, lat:39.76, lng:-84.19, country:"us", estimated:true },
  { display:"Parma, OH",          aliases:["parma oh"],        prov:"OH", med_inc:54000, lat:41.38, lng:-81.72, country:"us", estimated:true },
  { display:"Canton, OH",         aliases:["canton oh"],       prov:"OH", med_inc:38000, lat:40.80, lng:-81.38, country:"us", estimated:true },
  { display:"Lorain, OH",         aliases:["lorain oh"],       prov:"OH", med_inc:42000, lat:41.45, lng:-82.18, country:"us", estimated:true },
  { display:"Hamilton, OH",       aliases:["hamilton oh"],     prov:"OH", med_inc:46000, lat:39.40, lng:-84.56, country:"us", estimated:true },
  { display:"Springfield, OH",    aliases:["springfield oh"],  prov:"OH", med_inc:40000, lat:39.92, lng:-83.81, country:"us", estimated:true },
  { display:"Kettering, OH",      aliases:["kettering"],       prov:"OH", med_inc:54000, lat:39.69, lng:-84.17, country:"us", estimated:true },
  { display:"Elyria, OH",         aliases:["elyria"],          prov:"OH", med_inc:50000, lat:41.37, lng:-82.11, country:"us", estimated:true },
  { display:"Lakewood, OH",       aliases:["lakewood oh"],     prov:"OH", med_inc:56000, lat:41.48, lng:-81.80, country:"us", estimated:true },
  { display:"Newark, OH",         aliases:["newark oh"],       prov:"OH", med_inc:48000, lat:40.06, lng:-82.40, country:"us", estimated:true },
  { display:"Mentor, OH",         aliases:["mentor oh"],       prov:"OH", med_inc:64000, lat:41.67, lng:-81.34, country:"us", estimated:true },
  { display:"Cuyahoga Falls, OH", aliases:["cuyahoga falls"],  prov:"OH", med_inc:54000, lat:41.13, lng:-81.48, country:"us", estimated:true },
  { display:"Euclid, OH",         aliases:["euclid oh"],       prov:"OH", med_inc:44000, lat:41.59, lng:-81.53, country:"us", estimated:true },
  { display:"Mansfield, OH",      aliases:["mansfield oh"],    prov:"OH", med_inc:40000, lat:40.76, lng:-82.52, country:"us", estimated:true },
  { display:"Middletown, OH",     aliases:["middletown oh"],   prov:"OH", med_inc:42000, lat:39.51, lng:-84.40, country:"us", estimated:true },
  // OKLAHOMA
  { display:"Oklahoma City, OK",  aliases:["oklahoma city ok"],prov:"OK", med_inc:52000, lat:35.47, lng:-97.52, country:"us", estimated:true },
  { display:"Tulsa, OK",          aliases:["tulsa ok"],        prov:"OK", med_inc:50000, lat:36.15, lng:-95.99, country:"us", estimated:true },
  { display:"Norman, OK",         aliases:["norman ok"],       prov:"OK", med_inc:54000, lat:35.22, lng:-97.44, country:"us", estimated:true },
  { display:"Broken Arrow, OK",   aliases:["broken arrow"],    prov:"OK", med_inc:66000, lat:36.06, lng:-95.79, country:"us", estimated:true },
  { display:"Lawton, OK",         aliases:["lawton ok"],       prov:"OK", med_inc:46000, lat:34.61, lng:-98.39, country:"us", estimated:true },
  { display:"Edmond, OK",         aliases:["edmond ok"],       prov:"OK", med_inc:74000, lat:35.65, lng:-97.48, country:"us", estimated:true },
  { display:"Moore, OK",          aliases:["moore ok"],        prov:"OK", med_inc:58000, lat:35.34, lng:-97.49, country:"us", estimated:true },
  { display:"Midwest City, OK",   aliases:["midwest city"],    prov:"OK", med_inc:52000, lat:35.45, lng:-97.40, country:"us", estimated:true },
  { display:"Enid, OK",           aliases:["enid ok"],         prov:"OK", med_inc:50000, lat:36.40, lng:-97.88, country:"us", estimated:true },
  // OREGON
  { display:"Portland, OR",       aliases:["portland or"],     prov:"OR", med_inc:70000, lat:45.52, lng:-122.68,country:"us", estimated:true },
  { display:"Eugene, OR",         aliases:["eugene or"],       prov:"OR", med_inc:50000, lat:44.05, lng:-123.09,country:"us", estimated:true },
  { display:"Salem, OR",          aliases:["salem or"],        prov:"OR", med_inc:54000, lat:44.94, lng:-123.03,country:"us", estimated:true },
  { display:"Gresham, OR",        aliases:["gresham or"],      prov:"OR", med_inc:58000, lat:45.50, lng:-122.43,country:"us", estimated:true },
  { display:"Hillsboro, OR",      aliases:["hillsboro or"],    prov:"OR", med_inc:72000, lat:45.52, lng:-122.99,country:"us", estimated:true },
  { display:"Beaverton, OR",      aliases:["beaverton"],       prov:"OR", med_inc:68000, lat:45.49, lng:-122.80,country:"us", estimated:true },
  { display:"Medford, OR",        aliases:["medford or"],      prov:"OR", med_inc:50000, lat:42.33, lng:-122.87,country:"us", estimated:true },
  { display:"Bend, OR",           aliases:["bend or"],         prov:"OR", med_inc:68000, lat:44.06, lng:-121.31,country:"us", estimated:true },
  { display:"Corvallis, OR",      aliases:["corvallis"],       prov:"OR", med_inc:50000, lat:44.56, lng:-123.26,country:"us", estimated:true },
  { display:"Springfield, OR",    aliases:["springfield or"],  prov:"OR", med_inc:52000, lat:44.05, lng:-122.99,country:"us", estimated:true },
  { display:"Albany, OR",         aliases:["albany or"],       prov:"OR", med_inc:52000, lat:44.64, lng:-123.10,country:"us", estimated:true },
  { display:"Lake Oswego, OR",    aliases:["lake oswego"],     prov:"OR", med_inc:100000,lat:45.42, lng:-122.70,country:"us", estimated:true },
  // PENNSYLVANIA
  { display:"Philadelphia, PA",   aliases:["philadelphia pa"], prov:"PA", med_inc:46000, lat:39.95, lng:-75.16, country:"us", estimated:true },
  { display:"Pittsburgh, PA",     aliases:["pittsburgh pa"],   prov:"PA", med_inc:48000, lat:40.44, lng:-79.99, country:"us", estimated:true },
  { display:"Allentown, PA",      aliases:["allentown pa"],    prov:"PA", med_inc:44000, lat:40.60, lng:-75.49, country:"us", estimated:true },
  { display:"Erie, PA",           aliases:["erie pa"],         prov:"PA", med_inc:40000, lat:42.13, lng:-80.09, country:"us", estimated:true },
  { display:"Reading, PA",        aliases:["reading pa"],      prov:"PA", med_inc:36000, lat:40.34, lng:-75.93, country:"us", estimated:true },
  { display:"Scranton, PA",       aliases:["scranton pa"],     prov:"PA", med_inc:40000, lat:41.41, lng:-75.66, country:"us", estimated:true },
  { display:"Bethlehem, PA",      aliases:["bethlehem pa"],    prov:"PA", med_inc:56000, lat:40.62, lng:-75.37, country:"us", estimated:true },
  { display:"Lancaster, PA",      aliases:["lancaster pa"],    prov:"PA", med_inc:40000, lat:40.04, lng:-76.31, country:"us", estimated:true },
  { display:"Harrisburg, PA",     aliases:["harrisburg"],      prov:"PA", med_inc:42000, lat:40.27, lng:-76.88, country:"us", estimated:true },
  { display:"York, PA",           aliases:["york pa"],         prov:"PA", med_inc:40000, lat:39.96, lng:-76.73, country:"us", estimated:true },
  { display:"Wilkes-Barre, PA",   aliases:["wilkes barre","wilkes-barre"], prov:"PA", med_inc:38000, lat:41.25, lng:-75.88, country:"us", estimated:true },
  { display:"Chester, PA",        aliases:["chester pa"],      prov:"PA", med_inc:30000, lat:39.85, lng:-75.36, country:"us", estimated:true },
  { display:"Altoona, PA",        aliases:["altoona"],         prov:"PA", med_inc:40000, lat:40.52, lng:-78.40, country:"us", estimated:true },
  // RHODE ISLAND
  { display:"Providence, RI",     aliases:["providence ri"],   prov:"RI", med_inc:42000, lat:41.82, lng:-71.42, country:"us", estimated:true },
  { display:"Cranston, RI",       aliases:["cranston ri"],     prov:"RI", med_inc:64000, lat:41.78, lng:-71.44, country:"us", estimated:true },
  { display:"Warwick, RI",        aliases:["warwick ri"],      prov:"RI", med_inc:68000, lat:41.72, lng:-71.42, country:"us", estimated:true },
  { display:"Pawtucket, RI",      aliases:["pawtucket"],       prov:"RI", med_inc:44000, lat:41.88, lng:-71.38, country:"us", estimated:true },
  // SOUTH CAROLINA
  { display:"Columbia, SC",       aliases:["columbia sc"],     prov:"SC", med_inc:46000, lat:34.00, lng:-81.03, country:"us", estimated:true },
  { display:"Charleston, SC",     aliases:["charleston sc"],   prov:"SC", med_inc:60000, lat:32.78, lng:-79.93, country:"us", estimated:true },
  { display:"North Charleston, SC",aliases:["north charleston"],prov:"SC",med_inc:50000, lat:32.85, lng:-79.97, country:"us", estimated:true },
  { display:"Mount Pleasant, SC", aliases:["mount pleasant sc"],prov:"SC",med_inc:88000, lat:32.83, lng:-79.83, country:"us", estimated:true },
  { display:"Rock Hill, SC",      aliases:["rock hill sc"],    prov:"SC", med_inc:54000, lat:34.93, lng:-81.02, country:"us", estimated:true },
  { display:"Greenville, SC",     aliases:["greenville sc"],   prov:"SC", med_inc:50000, lat:34.85, lng:-82.40, country:"us", estimated:true },
  { display:"Summerville, SC",    aliases:["summerville sc"],  prov:"SC", med_inc:68000, lat:33.02, lng:-80.18, country:"us", estimated:true },
  { display:"Hilton Head Island, SC",aliases:["hilton head"],  prov:"SC", med_inc:76000, lat:32.22, lng:-80.75, country:"us", estimated:true },
  { display:"Spartanburg, SC",    aliases:["spartanburg"],     prov:"SC", med_inc:44000, lat:34.95, lng:-81.93, country:"us", estimated:true },
  { display:"Florence, SC",       aliases:["florence sc"],     prov:"SC", med_inc:44000, lat:34.20, lng:-79.76, country:"us", estimated:true },
  // SOUTH DAKOTA
  { display:"Sioux Falls, SD",    aliases:["sioux falls"],     prov:"SD", med_inc:60000, lat:43.55, lng:-96.73, country:"us", estimated:true },
  { display:"Rapid City, SD",     aliases:["rapid city"],      prov:"SD", med_inc:56000, lat:44.08, lng:-103.23,country:"us", estimated:true },
  { display:"Aberdeen, SD",       aliases:["aberdeen sd"],     prov:"SD", med_inc:54000, lat:45.46, lng:-98.49, country:"us", estimated:true },
  // TENNESSEE
  { display:"Memphis, TN",        aliases:["memphis tn"],      prov:"TN", med_inc:44000, lat:35.15, lng:-90.05, country:"us", estimated:true },
  { display:"Nashville, TN",      aliases:["nashville tn"],    prov:"TN", med_inc:60000, lat:36.17, lng:-86.78, country:"us", estimated:true },
  { display:"Knoxville, TN",      aliases:["knoxville tn"],    prov:"TN", med_inc:46000, lat:35.96, lng:-83.92, country:"us", estimated:true },
  { display:"Chattanooga, TN",    aliases:["chattanooga"],     prov:"TN", med_inc:50000, lat:35.07, lng:-85.25, country:"us", estimated:true },
  { display:"Clarksville, TN",    aliases:["clarksville tn"],  prov:"TN", med_inc:56000, lat:36.53, lng:-87.36, country:"us", estimated:true },
  { display:"Murfreesboro, TN",   aliases:["murfreesboro tn"], prov:"TN", med_inc:60000, lat:35.85, lng:-86.39, country:"us", estimated:true },
  { display:"Franklin, TN",       aliases:["franklin tn"],     prov:"TN", med_inc:92000, lat:35.92, lng:-86.87, country:"us", estimated:true },
  { display:"Jackson, TN",        aliases:["jackson tn"],      prov:"TN", med_inc:46000, lat:35.61, lng:-88.81, country:"us", estimated:true },
  { display:"Johnson City, TN",   aliases:["johnson city tn"], prov:"TN", med_inc:46000, lat:36.33, lng:-82.36, country:"us", estimated:true },
  { display:"Bartlett, TN",       aliases:["bartlett tn"],     prov:"TN", med_inc:76000, lat:35.20, lng:-89.87, country:"us", estimated:true },
  { display:"Hendersonville, TN", aliases:["hendersonville tn"],prov:"TN",med_inc:76000, lat:36.30, lng:-86.62, country:"us", estimated:true },
  { display:"Kingsport, TN",      aliases:["kingsport"],       prov:"TN", med_inc:48000, lat:36.55, lng:-82.56, country:"us", estimated:true },
  { display:"Smyrna, TN",         aliases:["smyrna tn"],       prov:"TN", med_inc:66000, lat:35.98, lng:-86.52, country:"us", estimated:true },
  { display:"Collierville, TN",   aliases:["collierville"],    prov:"TN", med_inc:96000, lat:35.04, lng:-89.66, country:"us", estimated:true },
  // TEXAS
  { display:"Houston, TX",        aliases:["houston tx"],      prov:"TX", med_inc:54000, lat:29.76, lng:-95.37, country:"us", estimated:true },
  { display:"San Antonio, TX",    aliases:["san antonio tx"],  prov:"TX", med_inc:52000, lat:29.42, lng:-98.49, country:"us", estimated:true },
  { display:"Dallas, TX",         aliases:["dallas tx"],       prov:"TX", med_inc:56000, lat:32.78, lng:-96.80, country:"us", estimated:true },
  { display:"Austin, TX",         aliases:["austin tx"],       prov:"TX", med_inc:72000, lat:30.27, lng:-97.74, country:"us", estimated:true },
  { display:"Fort Worth, TX",     aliases:["fort worth"],      prov:"TX", med_inc:58000, lat:32.75, lng:-97.33, country:"us", estimated:true },
  { display:"El Paso, TX",        aliases:["el paso tx"],      prov:"TX", med_inc:46000, lat:31.76, lng:-106.49,country:"us", estimated:true },
  { display:"Arlington, TX",      aliases:["arlington tx"],    prov:"TX", med_inc:60000, lat:32.74, lng:-97.11, country:"us", estimated:true },
  { display:"Corpus Christi, TX", aliases:["corpus christi"],  prov:"TX", med_inc:54000, lat:27.80, lng:-97.40, country:"us", estimated:true },
  { display:"Plano, TX",          aliases:["plano tx"],        prov:"TX", med_inc:86000, lat:33.02, lng:-96.70, country:"us", estimated:true },
  { display:"Lubbock, TX",        aliases:["lubbock"],         prov:"TX", med_inc:48000, lat:33.58, lng:-101.86,country:"us", estimated:true },
  { display:"Laredo, TX",         aliases:["laredo tx"],       prov:"TX", med_inc:42000, lat:27.51, lng:-99.51, country:"us", estimated:true },
  { display:"Irving, TX",         aliases:["irving tx"],       prov:"TX", med_inc:62000, lat:32.81, lng:-96.95, country:"us", estimated:true },
  { display:"Garland, TX",        aliases:["garland tx"],      prov:"TX", med_inc:58000, lat:32.91, lng:-96.64, country:"us", estimated:true },
  { display:"Amarillo, TX",       aliases:["amarillo"],        prov:"TX", med_inc:52000, lat:35.22, lng:-101.83,country:"us", estimated:true },
  { display:"Frisco, TX",         aliases:["frisco tx"],       prov:"TX", med_inc:102000,lat:33.15, lng:-96.82, country:"us", estimated:true },
  { display:"McKinney, TX",       aliases:["mckinney"],        prov:"TX", med_inc:84000, lat:33.20, lng:-96.62, country:"us", estimated:true },
  { display:"Grand Prairie, TX",  aliases:["grand prairie tx"],prov:"TX", med_inc:58000, lat:32.75, lng:-97.01, country:"us", estimated:true },
  { display:"Brownsville, TX",    aliases:["brownsville tx"],  prov:"TX", med_inc:38000, lat:25.93, lng:-97.48, country:"us", estimated:true },
  { display:"Killeen, TX",        aliases:["killeen"],         prov:"TX", med_inc:50000, lat:31.12, lng:-97.73, country:"us", estimated:true },
  { display:"Pasadena, TX",       aliases:["pasadena tx"],     prov:"TX", med_inc:52000, lat:29.69, lng:-95.21, country:"us", estimated:true },
  { display:"Midland, TX",        aliases:["midland tx"],      prov:"TX", med_inc:68000, lat:31.99, lng:-102.08,country:"us", estimated:true },
  { display:"Mesquite, TX",       aliases:["mesquite tx"],     prov:"TX", med_inc:56000, lat:32.77, lng:-96.60, country:"us", estimated:true },
  { display:"Denton, TX",         aliases:["denton tx"],       prov:"TX", med_inc:54000, lat:33.21, lng:-97.13, country:"us", estimated:true },
  { display:"Waco, TX",           aliases:["waco tx"],         prov:"TX", med_inc:42000, lat:31.55, lng:-97.14, country:"us", estimated:true },
  { display:"Carrollton, TX",     aliases:["carrollton tx"],   prov:"TX", med_inc:72000, lat:32.95, lng:-96.90, country:"us", estimated:true },
  { display:"Abilene, TX",        aliases:["abilene"],         prov:"TX", med_inc:46000, lat:32.45, lng:-99.73, country:"us", estimated:true },
  { display:"Beaumont, TX",       aliases:["beaumont tx"],     prov:"TX", med_inc:48000, lat:30.09, lng:-94.10, country:"us", estimated:true },
  { display:"Odessa, TX",         aliases:["odessa tx"],       prov:"TX", med_inc:60000, lat:31.85, lng:-102.37,country:"us", estimated:true },
  { display:"Round Rock, TX",     aliases:["round rock"],      prov:"TX", med_inc:82000, lat:30.51, lng:-97.68, country:"us", estimated:true },
  { display:"Cedar Park, TX",     aliases:["cedar park tx"],   prov:"TX", med_inc:92000, lat:30.52, lng:-97.82, country:"us", estimated:true },
  { display:"Sugar Land, TX",     aliases:["sugar land"],      prov:"TX", med_inc:98000, lat:29.62, lng:-95.64, country:"us", estimated:true },
  { display:"Tyler, TX",          aliases:["tyler tx"],        prov:"TX", med_inc:52000, lat:32.35, lng:-95.30, country:"us", estimated:true },
  { display:"Pearland, TX",       aliases:["pearland"],        prov:"TX", med_inc:90000, lat:29.56, lng:-95.29, country:"us", estimated:true },
  { display:"League City, TX",    aliases:["league city"],     prov:"TX", med_inc:86000, lat:29.51, lng:-95.10, country:"us", estimated:true },
  { display:"Richardson, TX",     aliases:["richardson tx"],   prov:"TX", med_inc:72000, lat:32.95, lng:-96.73, country:"us", estimated:true },
  { display:"Edinburg, TX",       aliases:["edinburg tx"],     prov:"TX", med_inc:44000, lat:26.30, lng:-98.16, country:"us", estimated:true },
  { display:"New Braunfels, TX",  aliases:["new braunfels"],   prov:"TX", med_inc:68000, lat:29.70, lng:-98.12, country:"us", estimated:true },
  { display:"Lewisville, TX",     aliases:["lewisville tx"],   prov:"TX", med_inc:66000, lat:33.05, lng:-96.99, country:"us", estimated:true },
  { display:"Flower Mound, TX",   aliases:["flower mound"],    prov:"TX", med_inc:112000,lat:33.01, lng:-97.10, country:"us", estimated:true },
  { display:"Allen, TX",          aliases:["allen tx"],        prov:"TX", med_inc:94000, lat:33.10, lng:-96.67, country:"us", estimated:true },
  { display:"Wichita Falls, TX",  aliases:["wichita falls"],   prov:"TX", med_inc:48000, lat:33.91, lng:-98.49, country:"us", estimated:true },
  { display:"Edinburg, TX",       aliases:["edinburg"],        prov:"TX", med_inc:44000, lat:26.30, lng:-98.16, country:"us", estimated:true },
  { display:"Mission, TX",        aliases:["mission tx"],      prov:"TX", med_inc:42000, lat:26.21, lng:-98.33, country:"us", estimated:true },
  { display:"Longview, TX",       aliases:["longview tx"],     prov:"TX", med_inc:50000, lat:32.50, lng:-94.74, country:"us", estimated:true },
  { display:"Conroe, TX",         aliases:["conroe tx"],       prov:"TX", med_inc:58000, lat:30.31, lng:-95.46, country:"us", estimated:true },
  { display:"San Marcos, TX",     aliases:["san marcos tx"],   prov:"TX", med_inc:40000, lat:29.88, lng:-97.94, country:"us", estimated:true },
  { display:"Baytown, TX",        aliases:["baytown"],         prov:"TX", med_inc:56000, lat:29.74, lng:-94.98, country:"us", estimated:true },
  { display:"Pharr, TX",          aliases:["pharr tx"],        prov:"TX", med_inc:36000, lat:26.19, lng:-98.18, country:"us", estimated:true },
  { display:"College Station, TX",aliases:["college station"], prov:"TX", med_inc:42000, lat:30.63, lng:-96.33, country:"us", estimated:true },
  { display:"Manvel, TX",         aliases:["manvel tx"],       prov:"TX", med_inc:84000, lat:29.47, lng:-95.36, country:"us", estimated:true },
  // UTAH
  { display:"Salt Lake City, UT", aliases:["salt lake city ut"],prov:"UT",med_inc:62000, lat:40.76, lng:-111.89,country:"us", estimated:true },
  { display:"West Valley City, UT",aliases:["west valley city"],prov:"UT",med_inc:60000, lat:40.69, lng:-112.00,country:"us", estimated:true },
  { display:"Provo, UT",          aliases:["provo ut"],        prov:"UT", med_inc:52000, lat:40.23, lng:-111.66,country:"us", estimated:true },
  { display:"West Jordan, UT",    aliases:["west jordan"],     prov:"UT", med_inc:72000, lat:40.60, lng:-111.94,country:"us", estimated:true },
  { display:"Sandy, UT",          aliases:["sandy ut"],        prov:"UT", med_inc:72000, lat:40.57, lng:-111.88,country:"us", estimated:true },
  { display:"Orem, UT",           aliases:["orem ut"],         prov:"UT", med_inc:60000, lat:40.30, lng:-111.70,country:"us", estimated:true },
  { display:"Ogden, UT",          aliases:["ogden ut"],        prov:"UT", med_inc:50000, lat:41.23, lng:-111.97,country:"us", estimated:true },
  { display:"St. George, UT",     aliases:["st george ut","saint george ut"], prov:"UT", med_inc:58000, lat:37.10, lng:-113.58,country:"us", estimated:true },
  { display:"Layton, UT",         aliases:["layton ut"],       prov:"UT", med_inc:72000, lat:41.06, lng:-111.97,country:"us", estimated:true },
  { display:"South Jordan, UT",   aliases:["south jordan"],    prov:"UT", med_inc:88000, lat:40.56, lng:-111.93,country:"us", estimated:true },
  { display:"Lehi, UT",           aliases:["lehi ut"],         prov:"UT", med_inc:82000, lat:40.39, lng:-111.85,country:"us", estimated:true },
  { display:"Taylorsville, UT",   aliases:["taylorsville"],    prov:"UT", med_inc:60000, lat:40.67, lng:-111.94,country:"us", estimated:true },
  { display:"Logan, UT",          aliases:["logan ut"],        prov:"UT", med_inc:48000, lat:41.73, lng:-111.83,country:"us", estimated:true },
  { display:"Millcreek, UT",      aliases:["millcreek ut"],    prov:"UT", med_inc:68000, lat:40.69, lng:-111.88,country:"us", estimated:true },
  // VERMONT
  { display:"Burlington, VT",     aliases:["burlington vt"],   prov:"VT", med_inc:60000, lat:44.48, lng:-73.21, country:"us", estimated:true },
  { display:"Rutland, VT",        aliases:["rutland vt"],      prov:"VT", med_inc:46000, lat:43.61, lng:-72.97, country:"us", estimated:true },
  { display:"Montpelier, VT",     aliases:["montpelier vt"],   prov:"VT", med_inc:64000, lat:44.26, lng:-72.58, country:"us", estimated:true },
  // VIRGINIA
  { display:"Virginia Beach, VA", aliases:["virginia beach va"],prov:"VA",med_inc:74000, lat:36.85, lng:-75.98, country:"us", estimated:true },
  { display:"Norfolk, VA",        aliases:["norfolk va"],      prov:"VA", med_inc:52000, lat:36.85, lng:-76.29, country:"us", estimated:true },
  { display:"Chesapeake, VA",     aliases:["chesapeake va"],   prov:"VA", med_inc:76000, lat:36.82, lng:-76.28, country:"us", estimated:true },
  { display:"Richmond, VA",       aliases:["richmond va"],     prov:"VA", med_inc:50000, lat:37.54, lng:-77.43, country:"us", estimated:true },
  { display:"Newport News, VA",   aliases:["newport news"],    prov:"VA", med_inc:60000, lat:37.09, lng:-76.47, country:"us", estimated:true },
  { display:"Alexandria, VA",     aliases:["alexandria va"],   prov:"VA", med_inc:96000, lat:38.80, lng:-77.05, country:"us", estimated:true },
  { display:"Hampton, VA",        aliases:["hampton va"],      prov:"VA", med_inc:58000, lat:37.03, lng:-76.35, country:"us", estimated:true },
  { display:"Roanoke, VA",        aliases:["roanoke va"],      prov:"VA", med_inc:46000, lat:37.27, lng:-79.94, country:"us", estimated:true },
  { display:"Portsmouth, VA",     aliases:["portsmouth va"],   prov:"VA", med_inc:52000, lat:36.84, lng:-76.30, country:"us", estimated:true },
  { display:"Suffolk, VA",        aliases:["suffolk va"],      prov:"VA", med_inc:72000, lat:36.73, lng:-76.59, country:"us", estimated:true },
  { display:"Lynchburg, VA",      aliases:["lynchburg va"],    prov:"VA", med_inc:46000, lat:37.41, lng:-79.14, country:"us", estimated:true },
  { display:"Harrisonburg, VA",   aliases:["harrisonburg"],    prov:"VA", med_inc:50000, lat:38.45, lng:-78.87, country:"us", estimated:true },
  { display:"Charlottesville, VA",aliases:["charlottesville"], prov:"VA", med_inc:58000, lat:38.03, lng:-78.48, country:"us", estimated:true },
  { display:"Fredericksburg, VA", aliases:["fredericksburg va"],prov:"VA",med_inc:64000, lat:38.30, lng:-77.46, country:"us", estimated:true },
  { display:"Arlington, VA",      aliases:["arlington va"],    prov:"VA", med_inc:110000,lat:38.88, lng:-77.11, country:"us", estimated:true },
  // WASHINGTON
  { display:"Seattle, WA",        aliases:["seattle wa"],      prov:"WA", med_inc:92000, lat:47.61, lng:-122.33,country:"us", estimated:true },
  { display:"Spokane, WA",        aliases:["spokane wa"],      prov:"WA", med_inc:52000, lat:47.66, lng:-117.43,country:"us", estimated:true },
  { display:"Tacoma, WA",         aliases:["tacoma"],          prov:"WA", med_inc:62000, lat:47.25, lng:-122.46,country:"us", estimated:true },
  { display:"Vancouver, WA",      aliases:["vancouver wa"],    prov:"WA", med_inc:64000, lat:45.64, lng:-122.66,country:"us", estimated:true },
  { display:"Bellevue, WA",       aliases:["bellevue wa"],     prov:"WA", med_inc:110000,lat:47.61, lng:-122.20,country:"us", estimated:true },
  { display:"Kent, WA",           aliases:["kent wa"],         prov:"WA", med_inc:70000, lat:47.38, lng:-122.23,country:"us", estimated:true },
  { display:"Everett, WA",        aliases:["everett wa"],      prov:"WA", med_inc:68000, lat:47.98, lng:-122.20,country:"us", estimated:true },
  { display:"Renton, WA",         aliases:["renton wa"],       prov:"WA", med_inc:76000, lat:47.48, lng:-122.19,country:"us", estimated:true },
  { display:"Kirkland, WA",       aliases:["kirkland wa"],     prov:"WA", med_inc:96000, lat:47.68, lng:-122.21,country:"us", estimated:true },
  { display:"Bellingham, WA",     aliases:["bellingham wa"],   prov:"WA", med_inc:56000, lat:48.75, lng:-122.47,country:"us", estimated:true },
  { display:"Kennewick, WA",      aliases:["kennewick"],       prov:"WA", med_inc:58000, lat:46.21, lng:-119.13,country:"us", estimated:true },
  { display:"Yakima, WA",         aliases:["yakima"],          prov:"WA", med_inc:48000, lat:46.60, lng:-120.51,country:"us", estimated:true },
  { display:"Federal Way, WA",    aliases:["federal way"],     prov:"WA", med_inc:66000, lat:47.32, lng:-122.31,country:"us", estimated:true },
  { display:"Redmond, WA",        aliases:["redmond wa"],      prov:"WA", med_inc:110000,lat:47.67, lng:-122.12,country:"us", estimated:true },
  { display:"Marysville, WA",     aliases:["marysville wa"],   prov:"WA", med_inc:72000, lat:48.05, lng:-122.18,country:"us", estimated:true },
  { display:"Sammamish, WA",      aliases:["sammamish"],       prov:"WA", med_inc:130000,lat:47.62, lng:-122.04,country:"us", estimated:true },
  { display:"South Hill, WA",     aliases:["south hill wa"],   prov:"WA", med_inc:74000, lat:47.12, lng:-122.30,country:"us", estimated:true },
  { display:"Shoreline, WA",      aliases:["shoreline wa"],    prov:"WA", med_inc:80000, lat:47.76, lng:-122.34,country:"us", estimated:true },
  { display:"Richland, WA",       aliases:["richland wa"],     prov:"WA", med_inc:80000, lat:46.28, lng:-119.28,country:"us", estimated:true },
  // WEST VIRGINIA
  { display:"Charleston, WV",     aliases:["charleston wv"],   prov:"WV", med_inc:44000, lat:38.35, lng:-81.63, country:"us", estimated:true },
  { display:"Huntington, WV",     aliases:["huntington wv"],   prov:"WV", med_inc:36000, lat:38.42, lng:-82.44, country:"us", estimated:true },
  { display:"Morgantown, WV",     aliases:["morgantown wv"],   prov:"WV", med_inc:42000, lat:39.63, lng:-79.96, country:"us", estimated:true },
  { display:"Parkersburg, WV",    aliases:["parkersburg"],     prov:"WV", med_inc:42000, lat:39.27, lng:-81.56, country:"us", estimated:true },
  // WISCONSIN
  { display:"Milwaukee, WI",      aliases:["milwaukee wi"],    prov:"WI", med_inc:42000, lat:43.04, lng:-87.91, country:"us", estimated:true },
  { display:"Madison, WI",        aliases:["madison wi"],      prov:"WI", med_inc:66000, lat:43.07, lng:-89.40, country:"us", estimated:true },
  { display:"Green Bay, WI",      aliases:["green bay"],       prov:"WI", med_inc:52000, lat:44.51, lng:-88.02, country:"us", estimated:true },
  { display:"Kenosha, WI",        aliases:["kenosha"],         prov:"WI", med_inc:56000, lat:42.58, lng:-87.82, country:"us", estimated:true },
  { display:"Racine, WI",         aliases:["racine wi"],       prov:"WI", med_inc:46000, lat:42.73, lng:-87.78, country:"us", estimated:true },
  { display:"Appleton, WI",       aliases:["appleton wi"],     prov:"WI", med_inc:60000, lat:44.26, lng:-88.41, country:"us", estimated:true },
  { display:"Waukesha, WI",       aliases:["waukesha"],        prov:"WI", med_inc:68000, lat:43.01, lng:-88.23, country:"us", estimated:true },
  { display:"Oshkosh, WI",        aliases:["oshkosh wi"],      prov:"WI", med_inc:52000, lat:44.02, lng:-88.54, country:"us", estimated:true },
  { display:"Eau Claire, WI",     aliases:["eau claire"],      prov:"WI", med_inc:50000, lat:44.81, lng:-91.50, country:"us", estimated:true },
  { display:"Janesville, WI",     aliases:["janesville"],      prov:"WI", med_inc:54000, lat:42.68, lng:-89.02, country:"us", estimated:true },
  { display:"La Crosse, WI",      aliases:["la crosse"],       prov:"WI", med_inc:50000, lat:43.80, lng:-91.24, country:"us", estimated:true },
  { display:"Sheboygan, WI",      aliases:["sheboygan"],       prov:"WI", med_inc:54000, lat:43.75, lng:-87.71, country:"us", estimated:true },
  { display:"Wauwatosa, WI",      aliases:["wauwatosa"],       prov:"WI", med_inc:74000, lat:43.05, lng:-88.00, country:"us", estimated:true },
  { display:"Fond du Lac, WI",    aliases:["fond du lac"],     prov:"WI", med_inc:52000, lat:43.77, lng:-88.45, country:"us", estimated:true },
  { display:"Wausau, WI",         aliases:["wausau"],          prov:"WI", med_inc:52000, lat:44.96, lng:-89.63, country:"us", estimated:true },
  // WYOMING
  { display:"Cheyenne, WY",       aliases:["cheyenne wy"],     prov:"WY", med_inc:62000, lat:41.14, lng:-104.82,country:"us", estimated:true },
  { display:"Casper, WY",         aliases:["casper wy"],       prov:"WY", med_inc:60000, lat:42.87, lng:-106.31,country:"us", estimated:true },
  { display:"Laramie, WY",        aliases:["laramie wy"],      prov:"WY", med_inc:50000, lat:41.31, lng:-105.59,country:"us", estimated:true },
  { display:"Gillette, WY",       aliases:["gillette wy"],     prov:"WY", med_inc:68000, lat:44.29, lng:-105.50,country:"us", estimated:true },
  { display:"Rock Springs, WY",   aliases:["rock springs wy"], prov:"WY", med_inc:68000, lat:41.59, lng:-109.20,country:"us", estimated:true },
];

const ALL_METROS = [...US_CITIES, ...CA_CITIES];

function findMetro(q) {
  const clean = q.toLowerCase().trim();
  // 1. Exact alias match
  let m = ALL_METROS.find(m => m.aliases.some(a => a === clean));
  if (m) return m;
  // 2. Display starts with query
  m = ALL_METROS.find(m => m.display.toLowerCase().startsWith(clean));
  if (m) return m;
  // 3. Display contains query
  m = ALL_METROS.find(m => m.display.toLowerCase().includes(clean));
  if (m) return m;
  // 4. Alias contains query (min length 4 to avoid short false matches like "la" in "kirkland lake")
  m = ALL_METROS.find(m => m.aliases.some(a => a.length >= 4 && a.includes(clean)));
  return m || null;
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

async function fredHistory(id, key, limit=20) {
  try {
    const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${key}&file_type=json&sort_order=asc&limit=${limit}`);
    const j = await r.json();
    return (j.observations||[])
      .filter(o => o.value !== '.' && o.value !== '')
      .map(o => ({ date: o.date, value: parseFloat(o.value) }));
  } catch { return []; }
}

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
  const [natMortgage,natTreasury,natAfford,natInventory,natDelinq,natVacancy,natCPI,cityHPI,cityUnemp,hpiHistory]=await Promise.all([
    fredVal('MORTGAGE30US',key),fredVal('DGS10',key),fredVal('FIXHAI',key),fredVal('ACTLISCOUUS',key),
    fredVal('DRSFRMACBS',key),fredVal('RVACRATE',key),fredVal('CPIAUCSL',key),
    metro.hpi?fredVal(metro.hpi,key):Promise.resolve(null),
    metro.unemp?fredVal(metro.unemp,key):Promise.resolve(null),
    metro.hpi?fredHistory(metro.hpi,key,20):Promise.resolve([]),
  ]);
  const cityPrice=cityHPI?(cityHPI/550)*420000:420000;
  const priceRatio=cityPrice/420000;
  const cityInvProxy=(natInventory||750000)/Math.max(1,priceRatio*1.2);
  const supplyScore=parseFloat(Math.min((cityInvProxy/(1500000*0.05))*100,100).toFixed(2));
  const r={mortgageRate:natMortgage,treasury10y:natTreasury,affordIndex:natAfford?(natAfford*(420000/cityPrice)):null,medianIncome:metro.med_inc,medianPrice:cityPrice,delinquency:natDelinq,vacancyRate:natVacancy,unemployRate:cityUnemp,cpi:natCPI,cityHPI,hpiHistory};
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
