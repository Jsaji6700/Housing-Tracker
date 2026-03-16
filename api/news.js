// api/news.js — Vercel serverless function
// GET /api/news?q=Canada+housing&country=ca

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate'); // 5min cache

  const q       = (req.query.q || 'housing market').trim();
  const country = (req.query.country || 'us').toLowerCase();
  const gl      = country === 'ca' ? 'CA' : 'US';
  const ceid    = country === 'ca' ? 'CA:en' : 'US:en';

  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en&gl=${gl}&ceid=${ceid}`;

  try {
    const r = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HousingTracker/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      }
    });

    if (!r.ok) throw new Error(`RSS fetch failed: ${r.status}`);
    const xml = await r.text();

    // Parse XML server-side with regex (no DOM available in Node)
    const items = [];
    const itemReg = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemReg.exec(xml)) !== null && items.length < 10) {
      const block = match[1];
      const get = (tag) => {
        const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`));
        return m ? (m[1] || m[2] || '').trim() : '';
      };
      const title  = get('title');
      const link   = get('link') || block.match(/<link>([^<]+)<\/link>/)?.[1] || '';
      const source = get('source');
      const pubDate= get('pubDate');
      if (title) items.push({ title, link, source, pubDate });
    }

    // Sort latest first
    items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    return res.status(200).json({ items, query: q, country });
  } catch (err) {
    return res.status(500).json({ error: err.message, items: [] });
  }
}
