// Optional prospect-website enrichment.
//
// This is now fired the instant Step 1 is submitted and is NOT awaited
// before the rep moves to Step 2 -- there's nothing on Step 2 that depends
// on the result. It resolves quietly in the background while the rep fills
// in Step 2 (which reliably takes longer than this can take), and gets
// picked up only when the final read is generated. That removed the need to
// squeeze this into a tight, UI-facing timeout budget, which is what lets
// this version do more than the first pass: a same-request pull of any
// structured company data on the homepage, plus one follow-up fetch of a
// discovered news/press page if the time budget allows it.
//
// Still fails silently end to end. Bad URL, timeout, blocked bot, empty
// page, no news page found -- all resolve to { context: null } and the read
// proceeds on the form answers alone, exactly as if nothing were fetched.

const TOTAL_BUDGET_MS = 8500; // stay well under typical serverless function limits
const HOMEPAGE_TIMEOUT_MS = 5000;
const NEWS_TIMEOUT_MS = 3000;
const MAX_BYTES_READ = 60000; // enough to reach </head> and early <body> on virtually any page
const MAX_CONTEXT_LENGTH = 900;

function normalizeUrl(raw) {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const parsed = new URL(value);
    if (!parsed.hostname || !parsed.hostname.includes('.')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClearPipeBot/1.0)' }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let result = '';
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    result += decoder.decode(value, { stream: true });
  }
  try { await reader.cancel(); } catch { /* no-op */ }
  return result;
}

// Title + meta/og description. The baseline signal, always attempted.
function extractTitleDescription(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]) : '';

  const descPatterns = [
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i,
    /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:description["']/i
  ];
  let description = '';
  for (const pattern of descPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      description = decodeEntities(match[1]);
      break;
    }
  }

  return [title, description].filter(Boolean).join(' — ');
}

// schema.org Organization structured data, if the site publishes it. Built
// for search engines, but factual when present -- employee count, founding
// year, location. Same request as the title/description pull, no extra cost.
function extractOrgData(html) {
  const scriptMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of scriptMatches) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const candidates = Array.isArray(data) ? data : (Array.isArray(data['@graph']) ? data['@graph'] : [data]);
    for (const item of candidates) {
      if (!item || typeof item !== 'object') continue;
      const type = item['@type'];
      const typeStr = Array.isArray(type) ? type.join(',') : (type || '');
      if (!/organization|corporation|localbusiness/i.test(typeStr)) continue;

      const bits = [];
      if (item.numberOfEmployees) {
        const emp = item.numberOfEmployees;
        const val = typeof emp === 'object' ? (emp.value || emp.minValue || '') : emp;
        if (val) bits.push(`${val} employees`);
      }
      if (item.foundingDate) bits.push(`founded ${item.foundingDate}`);
      if (item.address) {
        const addr = item.address;
        const locality = typeof addr === 'object' ? (addr.addressLocality || addr.addressCountry || '') : addr;
        if (locality) bits.push(String(locality));
      }
      if (bits.length) return bits.join(', ');
    }
  }
  return '';
}

// Finds a same-origin news/press link on the homepage. Deliberately narrow:
// one candidate, same hostname only, no following to third-party PR sites.
function findNewsLink(html, baseUrl) {
  const hrefMatches = [...html.matchAll(/<a[^>]+href=["']([^"'#][^"']*)["']/gi)].map(m => m[1]);
  const keywordPattern = /news|press|media|newsroom/i;
  const base = new URL(baseUrl);
  for (const href of hrefMatches) {
    if (!keywordPattern.test(href)) continue;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname !== base.hostname) continue;
      return resolved.toString();
    } catch {
      continue;
    }
  }
  return null;
}

// A handful of plausible headlines from the news/press page. Heuristic, not
// exact -- pulls h1/h2/h3 text in a sane length range and dedupes.
function extractHeadlines(html) {
  const headingMatches = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map(m => decodeEntities(m[1].replace(/<[^>]+>/g, ' ')))
    .filter(t => t.length >= 12 && t.length <= 140);
  const unique = [...new Set(headingMatches)].slice(0, 3);
  return unique.join('; ');
}

function buildCombinedContext(titleDesc, orgData, newsSnippet) {
  const segments = [];
  if (titleDesc) segments.push(titleDesc);
  if (orgData) segments.push(`Company data: ${orgData}`);
  if (newsSnippet) segments.push(`Recent from their newsroom: ${newsSnippet}`);
  return segments.join(' | ').slice(0, MAX_CONTEXT_LENGTH);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).json({ context: null });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const url = normalizeUrl(body && body.url);
  if (!url) {
    res.status(200).json({ context: null });
    return;
  }

  const startedAt = Date.now();

  try {
    const homepageRes = await fetchWithTimeout(url, HOMEPAGE_TIMEOUT_MS);
    if (!homepageRes.ok) {
      res.status(200).json({ context: null });
      return;
    }

    const html = await readLimited(homepageRes, MAX_BYTES_READ);
    const titleDesc = extractTitleDescription(html);
    const orgData = extractOrgData(html);

    let newsSnippet = '';
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (remaining > 2500) {
      const newsUrl = findNewsLink(html, url);
      if (newsUrl) {
        try {
          const newsRes = await fetchWithTimeout(newsUrl, Math.min(NEWS_TIMEOUT_MS, remaining - 500));
          if (newsRes.ok) {
            const newsHtml = await readLimited(newsRes, MAX_BYTES_READ);
            newsSnippet = extractHeadlines(newsHtml);
          }
        } catch {
          // The homepage signal is still useful even if the news fetch fails.
        }
      }
    }

    const context = buildCombinedContext(titleDesc, orgData, newsSnippet);
    res.status(200).json({ context: context || null });
  } catch {
    res.status(200).json({ context: null });
  }
}
