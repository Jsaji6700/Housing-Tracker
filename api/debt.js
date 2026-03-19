export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  try {
    const [usData, caData] = await Promise.all([
      scrapeCountry('united-states'),
      scrapeCountry('canada'),
    ]);

    res.status(200).json({
      source: 'debtclock.io (IMF / World Bank / ECB)',
      updated: new Date().toISOString(),
      us: usData,
      ca: caData,
    });
  } catch (err) {
    console.error('Debt API error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function scrapeCountry(slug) {
  const url = `https://debtclock.io/${slug}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HousingTracker/1.0)' },
  });
  if (!resp.ok) throw new Error(`${slug} fetch failed: ${resp.status}`);
  const html = await resp.text();

  // Pull stats from the HTML stat cards — debtclock.io uses consistent structure
  function stat(label) {
    // Match the label, then find the first number-like value following it
    const re = new RegExp(
      label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '[\\s\\S]{0,600}?([\\d]{1,3}(?:[,\\d]*)(?:\\.\\d+)?)',
      'i'
    );
    const m = html.match(re);
    if (!m) return null;
    return parseFloat(m[1].replace(/,/g, ''));
  }

  // Debt as % of GDP — appears right after the big header number
  const debtGdpMatch = html.match(/Debt as % of GDP[\s\S]{0,200}?([\d.]+)%/i);
  const debtGdp = debtGdpMatch ? parseFloat(debtGdpMatch[1]) : null;

  // Nominal debt — the large h1 figure
  const debtMatch = html.match(/\$([\s\d,]+)<\/h1>|<h1[^>]*>\s*([\d,]+)\s*\$/i);
  const debtRaw = debtMatch ? (debtMatch[1] || debtMatch[2]) : null;
  const debtNominal = debtRaw ? parseFloat(debtRaw.replace(/[\s,]/g, '')) : null;

  const gdpMatch = html.match(/GDP \(nominal\)[\s\S]{0,300}?\$([\s\d,]+)/i);
  const gdp = gdpMatch ? parseFloat(gdpMatch[1].replace(/[\s,]/g, '')) : null;

  const popMatch = html.match(/Population[\s\S]{0,200}?([\d,]+)\s*<\/(?:p|dd|td)/i);
  const population = popMatch ? parseFloat(popMatch[1].replace(/,/g, '')) : null;

  const intMatch = html.match(/Interest per Year[\s\S]{0,300}?\$([\s\d,]+)/i);
  const interestPerYear = intMatch ? parseFloat(intMatch[1].replace(/[\s,]/g, '')) : null;

  const debtCapMatch = html.match(/Debt per Citizen[\s\S]{0,300}?\$([\s\d,]+)/i);
  const debtPerCitizen = debtCapMatch ? parseFloat(debtCapMatch[1].replace(/[\s,]/g, '')) : null;

  const cpiMatch = html.match(/Inflation \(CPI[^)]*\)[\s\S]{0,200}?([\d.]+)%/i);
  const inflation = cpiMatch ? parseFloat(cpiMatch[1]) : null;

  const growthMatch = html.match(/GDP growth[^)]*[\s\S]{0,200}?([\d.]+)%/i);
  const gdpGrowth = growthMatch ? parseFloat(growthMatch[1]) : null;

  const unempMatch = html.match(/Unemployment[\s\S]{0,200}?([\d.]+)%/i);
  const unemployment = unempMatch ? parseFloat(unempMatch[1]) : null;

  const budgetMatch = html.match(/Budget balance[^)]*[\s\S]{0,200}?(-?[\d.]+)%/i);
  const budgetBalance = budgetMatch ? parseFloat(budgetMatch[1]) : null;

  const fxMatch = html.match(/FX \(USD[\s\S]{0,200}?([\d.]+)/i);
  const fx = fxMatch ? parseFloat(fxMatch[1]) : null;

  const yearMatch = html.match(/Latest year:\s*(\d{4})/i);
  const dataYear = yearMatch ? parseInt(yearMatch[1]) : 2024;

  return {
    slug,
    dataYear,
    debtGdpPct: debtGdp,
    debtNominal,
    gdp,
    population,
    interestPerYear,
    debtPerCitizen,
    inflation,
    gdpGrowth,
    unemployment,
    budgetBalance,
    fx,
  };
}
