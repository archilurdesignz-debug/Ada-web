// /api/news-digest.js
// Fetches recent architecture/built-environment news from RSS feeds +
// NewsAPI, categorizes it into a topical taxonomy, publishes a
// "zero-scroll" accordion webpage to the ADA site (via a GitHub commit,
// which Vercel auto-deploys), and emails a short notification with a
// "View Digest" link and a "Share to WhatsApp" link.
//
// Triggered twice daily (see your external cron scheduler, since Vercel's
// free plan only allows once-daily native cron).
// Can also be hit manually: GET /api/news-digest?manual=1

import Parser from 'rss-parser';
import { Resend } from 'resend';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

const parser = new Parser({
  timeout: 8000,
  headers: { 'User-Agent': 'Mozilla/5.0 (ADA News Digest Bot)' },
});

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

// --- Config ---------------------------------------------------------------

// Add or remove feeds freely. Each just needs a working RSS URL.
// `region` is still used as a fast-path: anything region 'africa'/'nigeria'
// is routed straight into the "Nigeria & Africa" taxonomy category below,
// regardless of topic — see categorizeItem_().
const RSS_FEEDS = [
  { name: 'ArchDaily', url: 'https://www.archdaily.com/rss/', region: 'global' },
  { name: 'Dezeen', url: 'https://www.dezeen.com/architecture/feed/', region: 'global' },
  { name: 'Designboom', url: 'https://www.designboom.com/architecture/feed/', region: 'global' },
  { name: 'e-architect', url: 'https://www.e-architect.com/feed', region: 'global' },
  { name: 'Dezeen Africa', url: 'https://www.dezeen.com/tag/africa/feed/', region: 'africa' },
  { name: 'ArchDaily Africa', url: 'https://www.archdaily.com/tag/africa/rss/', region: 'africa' },
  { name: 'Architect Africa', url: 'https://architectafrica.com/aarss/', region: 'africa' },
  { name: 'Livin Spaces (Nigeria)', url: 'https://livinspaces.net/category/projects/feed/', region: 'nigeria' },
  { name: 'IJNIA (NIA Journal)', url: 'https://ijnia.org/index.php/journal/gateway/plugin/RssGatewayPlugin/rss', region: 'nigeria' },
  { name: 'NIA (Nigerian Institute of Architects)', url: 'https://www.nia.ng/feed/', region: 'nigeria' },
  { name: 'ARCON (Architecture category)', url: 'https://arconigeria.gov.ng/category/architecture/feed/', region: 'nigeria' },
  { name: 'ARCON (Journal category)', url: 'https://arconigeria.gov.ng/category/journal/feed/', region: 'nigeria' },
  { name: 'Vanguard Homes & Property', url: 'https://www.vanguardngr.com/category/homes-property/feed/', region: 'nigeria' },
  { name: 'Google News (Nigeria architecture)', url: 'https://news.google.com/rss/search?q=architecture%20Nigeria%20when:2d&hl=en-NG&gl=NG&ceid=NG:en', region: 'nigeria' },
  { name: 'Google News (Africa architecture)', url: 'https://news.google.com/rss/search?q=architecture%20Africa%20when:2d&hl=en-NG&gl=NG&ceid=NG:en', region: 'africa' },
  { name: 'AllAfrica (Construction)', url: 'https://allafrica.com/tools/headlines/rdf/construction/headlines.rdf', region: 'africa' },
  { name: 'AllAfrica (Nigeria)', url: 'https://allafrica.com/tools/headlines/rdf/nigeria/headlines.rdf', region: 'nigeria' },
  { name: 'ConstructAfrica', url: 'https://constructafrica.com/rss-feed', region: 'africa' },
  { name: 'Guardian Nigeria (Property)', url: 'https://guardian.ng/category/property/feed/', region: 'nigeria' },
  { name: 'BusinessDay Nigeria', url: 'https://businessday.ng/feed/', region: 'nigeria' },
  { name: 'Nairametrics', url: 'https://nairametrics.com/feed/', region: 'nigeria' },
  { name: 'ENR (Engineering News-Record)', url: 'https://www.enr.com/rss/articles', region: 'global' },
  { name: 'Construction Dive', url: 'https://www.constructiondive.com/feeds/news/', region: 'global' },
  { name: 'PropertyPro.ng', url: 'https://www.propertypro.ng/blog/feed/', region: 'nigeria' },
  { name: 'NIQS (Nigerian Institute of Quantity Surveyors)', url: 'https://niqs.org.ng/feed/', region: 'nigeria' },
  { name: 'World Architecture Community', url: 'https://worldarchitecture.org/feed', region: 'global' },
  { name: 'Global Cement (Africa)', url: 'https://www.globalcement.com/rss', region: 'africa' },
  { name: 'FMHUD (Federal Ministry of Housing)', url: 'https://fmhud.gov.ng/feed/', region: 'nigeria' },
  { name: 'Lagos MPPUD', url: 'https://mppud.lagosstate.gov.ng/feed/', region: 'nigeria' },
  { name: 'NITP (Nigerian Institute of Town Planners)', url: 'https://nitpng.org/feed/', region: 'nigeria' },
  { name: 'Design Indaba', url: 'https://www.designindaba.com/feed', region: 'africa' },
  { name: 'Punch Nigeria', url: 'https://punchng.com/feed/', region: 'nigeria' },
  { name: 'Channels TV', url: 'https://www.channelstv.com/feed/', region: 'nigeria' },
];

// Two NewsAPI queries: one broad, one focused on Nigeria/Africa so those
// stories don't get drowned out by higher-volume global sources.
const NEWSAPI_QUERIES = [
  { query: 'architecture', region: 'global' },
  { query: 'architecture AND (Nigeria OR Lagos OR Abuja OR Africa OR African)', region: 'africa' },
];

function buildNewsApiUrl(query) {
  return `https://newsapi.org/v2/everything?q=${encodeURIComponent(
    query
  )}&language=en&sortBy=publishedAt&pageSize=20`;
}

// --- Scraping fallback (for sites with no reliable RSS) --------------------
const SCRAPE_FALLBACKS = [
  { sourcePrefix: 'NIA', name: 'NIA (scraped)', url: 'https://www.nia.ng/news/', region: 'nigeria' },
  { sourcePrefix: 'ARCON', name: 'ARCON (scraped)', url: 'https://arconigeria.gov.ng/news-journals/', region: 'nigeria' },
  { sourcePrefix: 'NIQS', name: 'NIQS (scraped)', url: 'https://niqs.org.ng/news/', region: 'nigeria' },
  { sourcePrefix: 'FMHUD', name: 'FMHUD (scraped)', url: 'https://fmhud.gov.ng/', region: 'nigeria' },
  { sourcePrefix: 'Lagos MPPUD', name: 'Lagos MPPUD (scraped)', url: 'https://mppud.lagosstate.gov.ng/news/', region: 'nigeria' },
  { sourcePrefix: 'NITP', name: 'NITP (scraped)', url: 'https://nitpng.org/category/news/', region: 'nigeria' },
  { sourcePrefix: 'Design Indaba', name: 'Design Indaba (scraped)', url: 'https://www.designindaba.com/articles', region: 'africa' },
  { sourcePrefix: 'Channels TV', name: 'Channels TV (scraped)', url: 'https://www.channelstv.com/category/headlines/', region: 'nigeria' },
];

const SCRAPE_SELECTOR_CANDIDATES = [
  '.elementor-post__title a',
  'article h2 a',
  'article h3 a',
  '.entry-title a',
  'h2.entry-title a',
  '.post-title a',
];

async function scrapeSite_(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (ADA News Digest Bot)' },
  });
  if (!res.ok) {
    throw new Error(`Scrape fetch failed (${res.status}) for ${url}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  let picked = [];
  for (const selector of SCRAPE_SELECTOR_CANDIDATES) {
    const found = $(selector)
      .map((_, el) => ({
        title: $(el).text().trim(),
        href: $(el).attr('href'),
      }))
      .get()
      .filter((item) => item.title && item.href && item.title.length > 8);

    if (found.length >= 3) {
      picked = found;
      break;
    }
  }

  const seenUrls = new Set();
  const items = [];
  for (const item of picked) {
    let absoluteUrl;
    try {
      absoluteUrl = new URL(item.href, url).toString();
    } catch {
      continue;
    }
    if (seenUrls.has(absoluteUrl)) continue;
    seenUrls.add(absoluteUrl);
    items.push({ title: item.title, url: absoluteUrl });
    if (items.length >= 10) break;
  }
  return items;
}

async function getUnseenScrapedUrls_(urls) {
  if (!supabase || urls.length === 0) return urls;
  const { data, error } = await supabase
    .from('digest_seen_articles')
    .select('url')
    .in('url', urls);

  if (error) {
    console.error('Supabase seen-articles lookup failed:', error.message);
    return urls;
  }
  const seen = new Set((data || []).map((row) => row.url));
  return urls.filter((u) => !seen.has(u));
}

async function markScrapedUrlsSeen_(urls) {
  if (!supabase || urls.length === 0) return;
  const { error } = await supabase
    .from('digest_seen_articles')
    .upsert(urls.map((url) => ({ url })), { onConflict: 'url' });

  if (error) {
    console.error('Supabase seen-articles insert failed:', error.message);
  }
}

async function fetchScrapeFallbacks_(rssItemsBySource) {
  const results = [];
  for (const fallback of SCRAPE_FALLBACKS) {
    const alreadyHasItems = rssItemsBySource.some((item) =>
      item.source.startsWith(fallback.sourcePrefix)
    );
    if (alreadyHasItems) continue;

    try {
      const scraped = await scrapeSite_(fallback.url);
      const urls = scraped.map((s) => s.url);
      const unseenUrls = await getUnseenScrapedUrls_(urls);
      const unseen = scraped.filter((s) => unseenUrls.includes(s.url));

      if (unseen.length === 0) continue;

      results.push(
        ...unseen.map((s) => ({
          title: s.title,
          url: s.url,
          source: fallback.name,
          region: fallback.region,
          publishedAt: new Date().toISOString(),
          summary: '',
        }))
      );

      await markScrapedUrlsSeen_(unseen.map((s) => s.url));
    } catch (err) {
      console.error(`Scrape fallback failed for ${fallback.name}:`, err.message);
    }
  }
  return results;
}

const MAX_ITEMS_PER_CATEGORY = 15;
const MAX_AGE_HOURS_GLOBAL = 30;
const MAX_AGE_HOURS_LOCAL = 96;

// --- Contextual topic filtering ---------------------------------------------
//
// Some keywords are unambiguous — if "quantity surveyor" or "ARCON"
// appears, the story is relevant, full stop. Others are generic enough
// that they show up constantly in unrelated news: "building trust,"
// "capacity building," "personal development," "sustainable development
// goals," "policy design," "by design." A bare geographic mention
// ("Lagos," "Nigeria") is even less useful as a signal, since virtually
// every article from a Nigerian outlet mentions one of these — that's
// not a topic signal at all, just a byline.
//
// STRONG keywords pass the filter on their own. AMBIGUOUS keywords only
// pass if the surrounding text doesn't match one of the known
// non-architectural collocations in NEGATIVE_PHRASES.

const STRONG_TOPIC_KEYWORDS = [
  'architect', 'architecture', 'ARCON', 'NIA', 'NIQS', 'NITP', 'IJNIA',
  'coren', 'nse', 'niob', 'corbon', 'toprec', 'qsrb',
  'quantity survey', 'quantity surveyor', 'bill of quantities', 'boq',
  'town planning', 'town planner', 'spatial planning', 'zoning',
  'cost management', 'procurement', 'professional exam', 'design competition',
  'afdb', 'renewed hope housing', 'federal ministry of housing', 'shelter afrique',
  'fidic', 'epc contract', 'groundbreaking', 'topping out',
];

// Generic enough to need a negative-phrase check before counting.
// Note: bare geographic terms (Lagos, Nigeria, Abuja, Africa...) are
// deliberately NOT in this list — region-tagging already establishes
// geography, and since virtually every article from a Nigerian outlet
// mentions one of these place names, treating them as a topic signal
// would defeat the filter entirely for general news sources.
const AMBIGUOUS_TOPIC_KEYWORDS = [
  'building', 'design', 'development', 'developer', 'construction',
  'urban', 'engineer', 'housing',
];

// If one of these phrases is present, the ambiguous keyword it contains
// doesn't count as a topic match — these are the common non-architectural
// uses that would otherwise slip through.
const NEGATIVE_PHRASES = [
  // "building" used idiomatically, not about physical buildings
  'capacity building', 'building trust', 'building consensus', 'building momentum',
  'building a career', 'building bridges', 'building a brand', 'building relationships',
  // "development" used for people/policy/aid, not real estate or construction
  'personal development', 'child development', 'career development',
  'software development', 'skill development', 'capacity development',
  'human development', 'professional development', 'development partner',
  'developing country', 'developing nations', 'sustainable development goals',
  'developed and developing',
  // "design" used for non-architectural design
  'game design', 'policy design', 'by design', 'design flaw', 'curriculum design',
];

function matchesLocalTopic_(item) {
  const haystack = textOf_(item);

  if (STRONG_TOPIC_KEYWORDS.some((kw) => haystack.includes(kw.toLowerCase()))) {
    return true;
  }

  // Ambiguous keywords are checked against the already-cleaned text —
  // if a keyword only appeared inside a negative phrase (e.g. "building"
  // inside "capacity building"), that exact occurrence was already
  // stripped out by textOf_(). If "building" still appears here, it's a
  // genuine standalone mention elsewhere in the text.
  return AMBIGUOUS_TOPIC_KEYWORDS.some((kw) => haystack.includes(kw.toLowerCase()));
}

// Real-estate listing/advert spam — general Nigerian news outlets and
// property-adjacent feeds sometimes mix in classified-ad-style content
// alongside genuine news. Anything matching one of these gets dropped
// regardless of which other filters it would otherwise pass.
const EXCLUDE_KEYWORDS = [
  'for sale', 'for rent', 'for lease', 'to let', 'short let', 'shortlet',
  'bedroom flat', 'bedroom duplex', 'self contain', 'mini flat', 'boys quarters',
  'distressed sale', 'cheap land', 'plots of land', 'buy land', 'property for sale',
  'contact agent', 'whatsapp', 'call agent', 'realtor', 'real estate agent',
  'fully detached', 'semi detached', 'terrace duplex', 'title: c of o',
  'gated estate', 'inspect today', 'initial deposit', 'payment plan',
  'mortgage calculator', 'discounted price', 'promo price', 'book inspection',
];

function matchesExcludeKeywords_(item) {
  const haystack = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
  return EXCLUDE_KEYWORDS.some((kw) => haystack.includes(kw.toLowerCase()));
}

// --- Helpers ----------------------------------------------------------------

function isRecent(dateStr, maxAgeHours) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  const hoursAgo = (Date.now() - date.getTime()) / (1000 * 60 * 60);
  return hoursAgo <= maxAgeHours;
}

function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchRssItems() {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      const parsed = await parser.parseURL(feed.url);
      return (parsed.items || []).map((item) => ({
        title: item.title,
        url: item.link,
        source: feed.name,
        region: feed.region,
        publishedAt: item.isoDate || item.pubDate,
        summary: (item.contentSnippet || '').slice(0, 220),
      }));
    })
  );

  const items = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      items.push(...r.value);
    } else {
      console.error(`RSS feed failed: ${RSS_FEEDS[i].name}`, r.reason?.message);
    }
  });
  return items;
}

async function fetchNewsApiItems() {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
    console.warn('NEWSAPI_KEY not set — skipping NewsAPI source.');
    return [];
  }

  const results = await Promise.allSettled(
    NEWSAPI_QUERIES.map(async ({ query, region }) => {
      const res = await fetch(buildNewsApiUrl(query), {
        headers: { 'X-Api-Key': apiKey },
      });
      if (!res.ok) {
        throw new Error(`NewsAPI ${res.status}: ${await res.text()}`);
      }
      const data = await res.json();
      return (data.articles || []).map((a) => ({
        title: a.title,
        url: a.url,
        source: a.source?.name || 'NewsAPI',
        region,
        publishedAt: a.publishedAt,
        summary: (a.description || '').slice(0, 220),
      }));
    })
  );

  const items = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      items.push(...r.value);
    } else {
      console.error(`NewsAPI query failed (${NEWSAPI_QUERIES[i].region}):`, r.reason?.message);
    }
  });
  return items;
}

const INSTITUTIONAL_SOURCE_PREFIXES = [
  'NIA', 'IJNIA', 'ARCON', 'NIQS', 'FMHUD', 'Lagos MPPUD', 'NITP',
  'Design Indaba', 'PropertyPro',
];

function isInstitutionalSource_(item) {
  return INSTITUTIONAL_SOURCE_PREFIXES.some((prefix) => item.source?.startsWith(prefix));
}

// --- Source authority ranking -----------------------------------------------
//
// When multiple outlets cover the same event with different headlines,
// we keep the item from the most authoritative source and note how many
// others also covered it, rather than showing near-duplicate stories
// side by side. Lower number = higher priority. Anything not listed
// falls into the default tier.
const SOURCE_PRIORITY_TIERS = [
  // Tier 0: official/regulatory bodies — the primary source for their own news
  { prefixes: ['ARCON', 'NIA', 'NIQS', 'NITP', 'IJNIA', 'FMHUD', 'Lagos MPPUD'], tier: 0 },
  // Tier 1: dedicated global architecture/construction trade press
  { prefixes: ['ArchDaily', 'Dezeen', 'Designboom', 'e-architect', 'World Architecture Community', 'ENR', 'Construction Dive', 'Global Cement'], tier: 1 },
  // Tier 2: established Nigerian/African news organizations and specialist outlets
  { prefixes: ['Guardian Nigeria', 'Vanguard', 'BusinessDay', 'Punch', 'Nairametrics', 'ConstructAfrica', 'Architect Africa', 'Livin Spaces', 'PropertyPro', 'Design Indaba'], tier: 2 },
  // Tier 3: general broadcast news and syndicators/aggregators (lower confidence)
  { prefixes: ['Channels TV', 'AllAfrica'], tier: 3 },
  // Tier 4: search-based aggregators (Google News, NewsAPI) — lowest priority,
  // since these surface the same stories the sources above already cover
  { prefixes: ['NewsAPI', 'Google News'], tier: 4 },
];
const DEFAULT_SOURCE_TIER = 5;

function getSourcePriority_(item) {
  for (const { prefixes, tier } of SOURCE_PRIORITY_TIERS) {
    if (prefixes.some((prefix) => item.source?.startsWith(prefix))) {
      return tier;
    }
  }
  return DEFAULT_SOURCE_TIER;
}

// --- Fuzzy duplicate consolidation ------------------------------------------
//
// Exact-title dedup (below) catches syndicated copies of the same
// headline. This catches DIFFERENT headlines about the SAME event —
// e.g. "Dangote Cement Expands Kogi Plant" vs "Kogi Welcomes New Dangote
// Facility" — by comparing the significant (non-stopword) words in each
// title. Above SIMILARITY_THRESHOLD word-overlap, two items are treated
// as the same story; only the highest-priority source's version is kept,
// tagged with how many other outlets also reported it.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'with',
  'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'this', 'that', 'these', 'those', 'it', 'its', 'after', 'over', 'amid',
  'amidst', 'into', 'out', 'up', 'down', 'about', 'than', 'their', 'his',
  'her', 'has', 'have', 'had', 'will', 'would', 'can', 'could', 'should',
  'not', 'no', 'yes', 'you', 'your', 'we', 'our', 'they', 'them', 'he',
  'she', 'i', 'but', 'if', 'then', 'so', 'more', 'most', 'less', 'least',
  'via', 'per', 'across', 'within', 'between',
]);

// Below this many significant words, fuzzy matching is skipped entirely —
// short titles produce unreliable overlap scores (two unrelated 3-word
// titles can easily share 2 words by coincidence).
const MIN_SIGNIFICANT_WORDS = 4;
const SIMILARITY_THRESHOLD = 0.4;

function significantWords_(title) {
  return new Set(
    (title || '')
      .toLowerCase()
      .replace(/[^a-z
