// api/places.js — server-side Overpass API proxy
// GET /api/places?lat=48.38&lng=-89.25&cat=attraction&radius=25000

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  const { lat, lng, cat = 'attraction', radius = 25000 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat/lng required', elements: [] });

  const r = parseFloat(radius);
  const queries = {
    attraction: `(node["tourism"~"attraction|museum|gallery|zoo|theme_park|viewpoint|monument"](around:${r},${lat},${lng});node["amenity"~"theatre|cinema|arts_centre"](around:${r},${lat},${lng});node["historic"~"monument|castle|ruins|memorial"](around:${r},${lat},${lng}););`,
    restaurant: `(node["amenity"~"restaurant|cafe|fast_food|bar|pub|food_court|ice_cream"](around:10000,${lat},${lng}););`,
    park: `(node["leisure"~"park|nature_reserve|garden|playground|beach_resort"](around:${r},${lat},${lng});node["natural"~"beach|wood|peak"](around:${r},${lat},${lng});way["leisure"~"park|nature_reserve|garden"](around:${r},${lat},${lng}););`,
    shop: `(node["shop"~"mall|supermarket|department_store|clothes|marketplace|convenience|hardware"](around:10000,${lat},${lng});node["amenity"="marketplace"](around:10000,${lat},${lng}););`,
  };

  const q = queries[cat] || queries.attraction;
  const body = `[out:json][timeout:20];${q}out center 30;`;

  try {
    const r2 = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(body),
      signal: AbortSignal.timeout(20000),
    });

    if (!r2.ok) throw new Error(`Overpass ${r2.status}`);
    const j = await r2.json();

    // Dedupe by name, add distance, filter unnamed
    const seen = new Set();
    const elements = (j.elements || [])
      .filter(e => {
        const name = e.tags?.name;
        if (!name || seen.has(name.toLowerCase())) return false;
        seen.add(name.toLowerCase());
        return true;
      })
      .map(e => {
        const eLat = e.lat || e.center?.lat;
        const eLng = e.lon || e.center?.lon;
        const dist = eLat && eLng ? haversine(parseFloat(lat), parseFloat(lng), eLat, eLng) : null;
        return {
          name: e.tags.name,
          type: detectType(e.tags),
          lat: eLat,
          lng: eLng,
          dist: dist ? Math.round(dist * 10) / 10 : null,
          website: e.tags.website || e.tags['contact:website'] || null,
          wikipedia: e.tags.wikipedia || null,
          wikidata: e.tags.wikidata || null,
          opening_hours: e.tags.opening_hours || null,
          phone: e.tags.phone || e.tags['contact:phone'] || null,
          cuisine: e.tags.cuisine || null,
        };
      })
      .sort((a, b) => (a.dist || 999) - (b.dist || 999))
      .slice(0, 16);

    return res.status(200).json({ elements, cat, count: elements.length });
  } catch (err) {
    return res.status(500).json({ error: err.message, elements: [] });
  }
}

function detectType(tags) {
  const checks = [
    ['tourism', ['museum','gallery','zoo','theme_park','viewpoint','attraction','monument','artwork']],
    ['amenity', ['theatre','cinema','arts_centre','restaurant','cafe','fast_food','bar','pub','food_court']],
    ['leisure', ['park','nature_reserve','garden','playground','stadium','sports_centre','beach_resort']],
    ['natural', ['beach','wood','peak','water']],
    ['shop',    ['mall','supermarket','department_store','clothes','marketplace','convenience']],
    ['historic',['monument','castle','ruins','memorial']],
  ];
  for (const [key, vals] of checks) {
    if (tags[key] && vals.includes(tags[key])) return tags[key];
  }
  return Object.keys(tags).find(k => ['tourism','amenity','leisure','shop','natural','historic'].includes(k) && tags[k]) ? tags[Object.keys(tags).find(k => ['tourism','amenity','leisure','shop','natural','historic'].includes(k))] : 'place';
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
