// api/places.js — server-side Overpass + Wikimedia photo proxy
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  const { lat, lng, cat = 'attraction', radius = 25000 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat/lng required', elements: [] });

  const r = Math.min(parseInt(radius) || 25000, 25000);
  const queries = {
    attraction: `(node["tourism"~"attraction|museum|gallery|zoo|theme_park|viewpoint|monument|artwork"](around:${r},${lat},${lng});node["amenity"~"theatre|cinema|arts_centre"](around:${r},${lat},${lng});node["historic"~"monument|castle|ruins|memorial"](around:${r},${lat},${lng}););`,
    restaurant:  `(node["amenity"~"restaurant|cafe|fast_food|bar|pub|food_court|ice_cream"](around:10000,${lat},${lng}););`,
    park:        `(node["leisure"~"park|nature_reserve|garden|playground"](around:${r},${lat},${lng});node["natural"~"beach|wood|peak"](around:${r},${lat},${lng});way["leisure"~"park|nature_reserve|garden"](around:${r},${lat},${lng}););`,
    shop:        `(node["shop"~"mall|supermarket|department_store|clothes|marketplace|convenience"](around:10000,${lat},${lng});node["amenity"="marketplace"](around:10000,${lat},${lng}););`,
  };

  const q = queries[cat] || queries.attraction;
  const body = `[out:json][timeout:20];${q}out center 30;`;

  try {
    const overpassRes = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!overpassRes.ok) throw new Error(`Overpass ${overpassRes.status}`);
    const j = await overpassRes.json();

    const seen = new Set();
    let elements = (j.elements || [])
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
          name:          e.tags.name,
          type:          detectType(e.tags),
          lat:           eLat,
          lng:           eLng,
          dist:          dist ? Math.round(dist * 10) / 10 : null,
          website:       e.tags.website || e.tags['contact:website'] || null,
          wikipedia:     e.tags.wikipedia || null,
          wikidata:      e.tags.wikidata || null,
          opening_hours: e.tags.opening_hours || null,
          phone:         e.tags.phone || e.tags['contact:phone'] || null,
          cuisine:       e.tags.cuisine || null,
          image:         null, // filled below
        };
      })
      .filter(p => p.lat && p.lng)
      .sort((a, b) => (a.dist || 999) - (b.dist || 999))
      .slice(0, 16);

    // Fetch Wikipedia thumbnail images in parallel for places that have a wikipedia tag
    const withWiki = elements.filter(e => e.wikipedia);
    if (withWiki.length) {
      const titles = withWiki.map(e => e.wikipedia.replace(/^[a-z]+:/, '')).join('|');
      try {
        const wikiRes = await fetch(
          `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=pageimages&piprop=thumbnail&pithumbsize=400&format=json&origin=*`,
          { signal: AbortSignal.timeout(8000) }
        );
        const wikiJ = await wikiRes.json();
        const pages = Object.values(wikiJ?.query?.pages || {});
        pages.forEach(page => {
          if (!page.thumbnail?.source) return;
          const title = page.title;
          const el = elements.find(e => e.wikipedia && e.wikipedia.replace(/^[a-z]+:/, '') === title);
          if (el) el.image = page.thumbnail.source;
        });
      } catch { /* photos optional */ }
    }

    // For places without wikipedia images, try Wikimedia Commons search by name
    const noImage = elements.filter(e => !e.image).slice(0, 6);
    await Promise.allSettled(noImage.map(async el => {
      try {
        const r2 = await fetch(
          `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(el.name)}&gsrnamespace=6&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*&gsrlimit=1`,
          { signal: AbortSignal.timeout(5000) }
        );
        const j2 = await r2.json();
        const pages = Object.values(j2?.query?.pages || {});
        const url = pages[0]?.imageinfo?.[0]?.thumburl;
        if (url) el.image = url;
      } catch { /* optional */ }
    }));

    return res.status(200).json({ elements, cat, count: elements.length });
  } catch (err) {
    return res.status(500).json({ error: err.message, elements: [] });
  }
}

function detectType(tags) {
  const order = ['tourism','amenity','leisure','natural','shop','historic'];
  for (const key of order) {
    if (tags[key]) return tags[key];
  }
  return 'place';
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
