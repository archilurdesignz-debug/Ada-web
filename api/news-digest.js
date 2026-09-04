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
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

function jaccardSimilarity_(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function consolidateFuzzyDuplicates_(items) {
  // Process highest-priority sources first, so a cluster's "kept" item
  // is always the most authoritative one encountered, not just the first
  // in feed order.
  const ordered = [...items].sort((a, b) => getSourcePriority_(a) - getSourcePriority_(b));

  const clusters = []; // { kept: item, wordSet: Set, alsoReportedBy: [source,...] }

  for (const item of ordered) {
    const words = significantWords_(item.title);

    if (words.size < MIN_SIGNIFICANT_WORDS) {
      clusters.push({ kept: item, wordSet: words, alsoReportedBy: [] });
      continue;
    }

    let matchedCluster = null;
    for (const cluster of clusters) {
      if (cluster.wordSet.size < MIN_SIGNIFICANT_WORDS) continue;
      if (jaccardSimilarity_(words, cluster.wordSet) >= SIMILARITY_THRESHOLD) {
        matchedCluster = cluster;
        break;
      }
    }

    if (matchedCluster) {
      matchedCluster.alsoReportedBy.push(item.source);
    } else {
      clusters.push({ kept: item, wordSet: words, alsoReportedBy: [] });
    }
  }

  return clusters.map((c) =>
    c.alsoReportedBy.length > 0
      ? { ...c.kept, alsoReportedBy: c.alsoReportedBy }
      : c.kept
  );
}

function mergeAndDedupe(rssItems, newsApiItems) {
  const all = [...rssItems, ...newsApiItems].filter((item) => {
    if (!item.title || !item.url) return false;
    if (matchesExcludeKeywords_(item)) return false;
    const isLocal = item.region === 'africa' || item.region === 'nigeria';
    if (!isRecent(item.publishedAt, isLocal ? MAX_AGE_HOURS_LOCAL : MAX_AGE_HOURS_GLOBAL)) {
      return false;
    }
    if (isLocal && !isInstitutionalSource_(item) && !matchesLocalTopic_(item)) {
      return false;
    }
    return true;
  });

  const seen = new Set();
  const deduped = [];
  for (const item of all) {
    const key = normalizeTitle(item.title);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  const consolidated = consolidateFuzzyDuplicates_(deduped);

  consolidated.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return consolidated;
}

// --- Taxonomy / categorization engine ---------------------------------------
//
// Every item is routed into exactly ONE of these top-level categories,
// checked in this priority order:
//   1. Policy & Regulation   — routed by source identity (FMHUD, Lagos
//      MPPUD, NITP) ahead of everything else, since a housing-ministry
//      press release is policy content regardless of what words it uses
//   2. Design & Culture      — routed by source identity (Design Indaba,
//      World Architecture Community's award/competition coverage still
//      flows through Competitions & Exams below, not here — this bucket
//      is for cultural/theory content specifically)
//   3. Nigeria & Africa      — anything else already tagged region
//      'africa'/'nigeria'
//   4. Competitions & Exams
//   5. Professional Practice (further split into 5 sub-categories)
//   6. Development & Real Estate — routed by source identity (PropertyPro.ng)
//   7. Building Materials
//   8. Construction
//   9. Global News           — catch-all for anything else global

const COMPETITIONS_EXAMS_KEYWORDS = [
  'competition', 'design competition', 'professional exam', 'licensure',
  'licensing exam', 'design award', 'award shortlist', 'shortlisted',
  'award winner', 'call for entries', 'ideas competition',
  'call for proposals', 'student competition', 'arcon ppe',
  'architecture award', 'biennale', 'fellowship',
];

const PROFESSIONAL_PRACTICE_SUBCATEGORIES = [
  { key: 'architects', label: 'Architects', emoji: '👷', keywords: [
    'architect', 'architecture firm', 'architectural practice', 'arcon', 'nia',
    'pritzker', 'architects registration council', 'professional practice exam',
    'ppe', 'design fee scale', 'riba', 'aia', 'bim', 'parametric',
  ] },
  { key: 'engineers', label: 'Engineers', emoji: '🛠️', keywords: [
    'engineer', 'engineering firm', 'structural engineer', 'civil engineer', 'mep engineer',
    'coren', 'nse', 'mep engineering', 'civil engineering', 'building services',
    'structural failure', 'eurocodes', 'nse conference',
  ] },
  { key: 'quantitySurveyors', label: 'Quantity Surveyors', emoji: '📐', keywords: [
    'quantity surveyor', 'quantity surveying', 'cost consultant', 'niqs', 'qsrb',
    'bill of quantities', 'boq', 'cost estimation', 'material takeoff',
    'value engineering', 'construction cost index',
  ] },
  { key: 'townPlanning', label: 'Town Planning', emoji: '🗺️', keywords: [
    'town planning', 'town planner', 'urban planning', 'urban planner', 'zoning', 'master plan',
    'nitp', 'toprec', 'zoning regulations', 'spatial planning', 'laspppa',
    'environmental impact assessment', 'eia',
  ] },
  { key: 'builders', label: 'Builders', emoji: '🧰', keywords: [
    'builder', 'building contractor', 'building firm', 'niob', 'corbon',
    'registered builder', 'building production management', 'site safety',
    'quality control', 'construction methodology', 'lasbca',
  ] },
];

const MATERIALS_KEYWORDS = [
  'cement', 'steel price', 'timber', 'concrete', 'brick', 'glass facade',
  'insulation', 'building material', 'supply chain', 'material cost',
  'prefab material', 'construction material',
  'cement price', 'dangote cement', 'buacement', 'lafarge', 'rebar cost',
  'steel prices', 'aggregates', 'granite', 'bitumen', 'fenestration',
  'composite cladding', 'import duty', 'building materials market',
  'mass timber', 'net zero building', 'embodied carbon',
];

const DEVELOPMENT_REAL_ESTATE_KEYWORDS = ['proptech', 'real estate development', 'property development'];

const CONSTRUCTION_KEYWORDS = [
  'construction', 'groundbreaking', 'building site', 'infrastructure project',
  'completion', 'contractor', 'modular construction', 'prefab',
  'construction methodology', 'site work',
  'topping out', 'epc contract', 'fidic', 'dredging', 'heavy equipment',
  'concrete casting', 'precast', 'post-tensioning', 'site execution',
];

function textOf_(item) {
  let text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
  // Strip known non-architectural collocations before any keyword
  // matching runs, so e.g. "capacity building" can't cause a story to
  // land in Construction just because it contains the word "building".
  for (const phrase of NEGATIVE_PHRASES) {
    text = text.split(phrase).join(' ');
  }
  return text;
}

function matchesAny_(haystack, keywords) {
  return keywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

function categorizeItem_(item) {
  const isLocal = item.region === 'africa' || item.region === 'nigeria';

  // Policy & Regulation — municipal/federal government sources are
  // unambiguous; a Lagos MPPUD press release is policy content no matter
  // what specific words it uses.
  if (
    item.source?.startsWith('FMHUD') ||
    item.source?.startsWith('Lagos MPPUD') ||
    item.source?.startsWith('NITP')
  ) {
    return { category: 'policyRegulation' };
  }

  // Design & Culture — cultural/theory platforms, routed by identity.
  if (item.source?.startsWith('Design Indaba')) {
    return { category: 'designCulture' };
  }

  // Development & Real Estate — market-intelligence sources, routed by
  // identity rather than keyword (a property listing rarely says
  // "development" or "real estate" explicitly).
  if (item.source?.startsWith('PropertyPro')) {
    return { category: 'developmentRealEstate' };
  }

  // Professional-body sources are explicitly called out in the strategy
  // doc as Professional Practice content ("ARCON and NIA developments"),
  // so they're routed there ahead of the geographic bucket. Every other
  // Nigeria/Africa source keeps the original behavior: straight into the
  // regional bucket regardless of topic.
  if (item.source?.startsWith('NIQS')) {
    return { category: 'professionalPractice', subcategory: 'quantitySurveyors' };
  }
  if (item.source?.startsWith('NIA') || item.source?.startsWith('IJNIA') || item.source?.startsWith('ARCON')) {
    return { category: 'professionalPractice', subcategory: 'architects' };
  }

  if (isLocal) {
    return { category: 'nigeriaAfrica' };
  }

  const haystack = textOf_(item);

  if (matchesAny_(haystack, COMPETITIONS_EXAMS_KEYWORDS)) {
    return { category: 'competitionsExams' };
  }

  for (const sub of PROFESSIONAL_PRACTICE_SUBCATEGORIES) {
    if (matchesAny_(haystack, sub.keywords)) {
      return { category: 'professionalPractice', subcategory: sub.key };
    }
  }

  if (matchesAny_(haystack, MATERIALS_KEYWORDS)) {
    return { category: 'materials' };
  }

  if (matchesAny_(haystack, DEVELOPMENT_REAL_ESTATE_KEYWORDS)) {
    return { category: 'developmentRealEstate' };
  }

  if (matchesAny_(haystack, CONSTRUCTION_KEYWORDS)) {
    return { category: 'construction' };
  }

  return { category: 'globalNews' };
}

function buildTaxonomy_(items) {
  const taxonomy = {
    policyRegulation: [],
    designCulture: [],
    nigeriaAfrica: [],
    professionalPractice: {
      architects: [], engineers: [], quantitySurveyors: [], townPlanning: [], builders: [],
    },
    developmentRealEstate: [],
    materials: [],
    construction: [],
    competitionsExams: [],
    globalNews: [],
  };

  for (const item of items) {
    const { category, subcategory } = categorizeItem_(item);
    if (category === 'professionalPractice') {
      taxonomy.professionalPractice[subcategory].push(item);
    } else {
      taxonomy[category].push(item);
    }
  }

  // Cap each bucket so no single category runs away with the whole digest.
  taxonomy.policyRegulation = taxonomy.policyRegulation.slice(0, MAX_ITEMS_PER_CATEGORY);
  taxonomy.designCulture = taxonomy.designCulture.slice(0, MAX_ITEMS_PER_CATEGORY);
  taxonomy.nigeriaAfrica = taxonomy.nigeriaAfrica.slice(0, MAX_ITEMS_PER_CATEGORY);
  taxonomy.developmentRealEstate = taxonomy.developmentRealEstate.slice(0, MAX_ITEMS_PER_CATEGORY);
  taxonomy.materials = taxonomy.materials.slice(0, MAX_ITEMS_PER_CATEGORY);
  taxonomy.construction = taxonomy.construction.slice(0, MAX_ITEMS_PER_CATEGORY);
  taxonomy.competitionsExams = taxonomy.competitionsExams.slice(0, MAX_ITEMS_PER_CATEGORY);
  taxonomy.globalNews = taxonomy.globalNews.slice(0, MAX_ITEMS_PER_CATEGORY);
  for (const key of Object.keys(taxonomy.professionalPractice)) {
    taxonomy.professionalPractice[key] = taxonomy.professionalPractice[key].slice(0, MAX_ITEMS_PER_CATEGORY);
  }

  return taxonomy;
}

function taxonomyCounts_(taxonomy) {
  const professionalPractice = Object.values(taxonomy.professionalPractice).reduce(
    (sum, arr) => sum + arr.length,
    0
  );
  const counts = {
    policyRegulation: taxonomy.policyRegulation.length,
    designCulture: taxonomy.designCulture.length,
    nigeriaAfrica: taxonomy.nigeriaAfrica.length,
    professionalPractice,
    developmentRealEstate: taxonomy.developmentRealEstate.length,
    materials: taxonomy.materials.length,
    construction: taxonomy.construction.length,
    competitionsExams: taxonomy.competitionsExams.length,
    globalNews: taxonomy.globalNews.length,
  };
  counts.total = Object.values(counts).reduce((a, b) => a + b, 0);
  return counts;
}

// --- Digest page HTML (the "zero-scroll" accordion webpage) ----------------

function itemLi_(item) {
  const alsoReported =
    item.alsoReportedBy && item.alsoReportedBy.length > 0
      ? `<span class="also-reported">+${item.alsoReportedBy.length} more source${
          item.alsoReportedBy.length === 1 ? '' : 's'
        }</span>`
      : '';
  return `<li><a href="${item.url}" target="_blank" rel="noopener">${escapeHtml(
    item.title
  )}</a><span class="src">${escapeHtml(item.source)}${alsoReported}</span></li>`;
}

function accordionSection_(emoji, label, items) {
  if (!items.length) return '';
  return `
    <details>
      <summary><span>${emoji} ${escapeHtml(label)}</span><span class="count">${items.length}</span></summary>
      <ul>${items.map(itemLi_).join('')}</ul>
    </details>`;
}

function professionalPracticeSection_(taxonomy, counts) {
  if (!counts.professionalPractice) return '';
  const nested = PROFESSIONAL_PRACTICE_SUBCATEGORIES.filter(
    (sub) => taxonomy.professionalPractice[sub.key].length
  )
    .map(
      (sub) => `
        <details class="nested">
          <summary><span>${sub.emoji} ${escapeHtml(sub.label)}</span><span class="count">${
        taxonomy.professionalPractice[sub.key].length
      }</span></summary>
          <ul>${taxonomy.professionalPractice[sub.key].map(itemLi_).join('')}</ul>
        </details>`
    )
    .join('');

  return `
    <details>
      <summary><span>🧑‍💼 Professional Practice</span><span class="count">${counts.professionalPractice}</span></summary>
      ${nested}
    </details>`;
}

function buildDigestPageHtml_(taxonomy, counts, { dateLabel, digestUrl }) {
  const ogDescription = `${counts.total} new architecture & built-environment stories — Policy & Regulation, Nigeria & Africa, Professional Practice, Development & Real Estate, Materials, Construction, Competitions & Exams, Design & Culture, and Global News.`;
  const ogImage = process.env.DIGEST_OG_IMAGE_URL || 'https://archilurdesignz.com/assets/og-digest-cover.jpg';

  const sections = [
    accordionSection_('🏛️', 'Policy & Regulation', taxonomy.policyRegulation),
    accordionSection_('🌍', 'Nigeria & Africa', taxonomy.nigeriaAfrica),
    professionalPracticeSection_(taxonomy, counts),
    accordionSection_('🏘️', 'Development & Real Estate', taxonomy.developmentRealEstate),
    accordionSection_('🧱', 'Building Materials', taxonomy.materials),
    accordionSection_('🏗️', 'Construction', taxonomy.construction),
    accordionSection_('🏆', 'Competitions & Exams', taxonomy.competitionsExams),
    accordionSection_('🎨', 'Design & Culture', taxonomy.designCulture),
    accordionSection_('📰', 'Global News', taxonomy.globalNews),
  ].join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ADA Architecture Digest — ${dateLabel}</title>

<meta property="og:title" content="ADA Architecture Digest — ${dateLabel}">
<meta property="og:description" content="${escapeHtml(ogDescription)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${digestUrl}">
<meta property="og:image" content="${ogImage}">
<meta property="og:site_name" content="Archilurdesignz and Architecture">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="ADA Architecture Digest — ${dateLabel}">
<meta name="twitter:description" content="${escapeHtml(ogDescription)}">
<meta name="twitter:image" content="${ogImage}">

<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    max-width: 720px; margin: 0 auto; padding: 32px 20px 60px;
    background: #faf8f4; color: #1a1a1a;
  }
  h1 { font-family: Georgia, serif; font-size: 26px; margin: 0 0 4px; }
  .date { color: #8a8378; font-size: 14px; margin-bottom: 28px; }
  details {
    background: #fff; border: 1px solid #e5e0d8; border-radius: 12px;
    margin-bottom: 12px; overflow: hidden;
  }
  details[open] { border-color: #c9a876; }
  summary {
    cursor: pointer; padding: 16px 20px; font-size: 16px; font-weight: 600;
    list-style: none; display: flex; justify-content: space-between; align-items: center;
  }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: '+'; font-size: 20px; color: #8a8378; margin-left: 12px; }
  details[open] > summary::after { content: '−'; }
  .count {
    background: #f0ece2; color: #8a6d3b; font-size: 12px; font-weight: 700;
    padding: 3px 11px; border-radius: 12px; margin-left: auto; margin-right: 8px;
  }
  ul { list-style: none; margin: 0; padding: 0 20px 16px; }
  li {
    padding: 12px 0; border-top: 1px solid #f0ece2; font-size: 14px; line-height: 1.5;
    display: flex; flex-direction: column; gap: 3px;
  }
  li:first-child { border-top: none; }
  a { color: #1a1a1a; text-decoration: none; font-weight: 500; }
  a:hover { text-decoration: underline; }
  .src { color: #a3a3a3; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .also-reported { color: #c9a876; font-weight: 700; margin-left: 6px; text-transform: none; letter-spacing: normal; }
  details.nested {
    border: none; background: #faf8f4; margin: 0 16px 12px; border-left: 3px solid #e5e0d8;
    border-radius: 0 8px 8px 0;
  }
  details.nested summary { padding: 10px 16px; font-size: 14px; font-weight: 500; }
  footer { text-align: center; color: #a3a3a3; font-size: 12px; margin-top: 32px; }
</style>
</head>
<body>
  <h1>ADA Architecture Digest</h1>
  <div class="date">${dateLabel} · ${counts.total} stories</div>
  ${sections || '<p>No new stories this run.</p>'}
  <footer>Archilurdesignz and Architecture</footer>
</body>
</html>`;
}

// --- Publish the digest page to GitHub (Vercel auto-deploys on push) -------

async function publishDigestToGitHub_(htmlContent) {
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;
  const token = process.env.GITHUB_TOKEN;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const path = process.env.GITHUB_DIGEST_PATH || 'digest.html';

  if (!owner || !repo || !token) {
    throw new Error(
      'GitHub publish config missing — set GITHUB_REPO_OWNER, GITHUB_REPO_NAME, GITHUB_TOKEN'
    );
  }

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  };

  // Fetch the current file's SHA if it exists, so we update instead of
  // creating a duplicate (GitHub's Contents API requires this for updates).
  let sha;
  const getRes = await fetch(`${apiUrl}?ref=${branch}`, { headers });
  if (getRes.ok) {
    const getData = await getRes.json();
    sha = getData.sha;
  } else if (getRes.status !== 404) {
    throw new Error(`GitHub GET failed (${getRes.status}): ${await getRes.text()}`);
  }

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Update architecture digest — ${new Date().toISOString()}`,
      content: Buffer.from(htmlContent, 'utf-8').toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!putRes.ok) {
    throw new Error(`GitHub PUT failed (${putRes.status}): ${await putRes.text()}`);
  }
  return putRes.json();
}

// --- Notification email (short, with View + Share buttons) -----------------

function buildNotificationEmailHtml_(counts, { dateLabel, digestUrl }) {
  const shareText = encodeURIComponent(
    `📐 ADA Architecture Digest — ${dateLabel}\n` +
      `${counts.total} new stories: Policy & Regulation (${counts.policyRegulation}), ` +
      `Nigeria & Africa (${counts.nigeriaAfrica}), ` +
      `Professional Practice (${counts.professionalPractice}), ` +
      `Development & Real Estate (${counts.developmentRealEstate}), Materials (${counts.materials}), ` +
      `Construction (${counts.construction}), Competitions & Exams (${counts.competitionsExams}), ` +
      `Design & Culture (${counts.designCulture}), Global (${counts.globalNews})\n\n${digestUrl}`
  );
  const whatsappShareUrl = `https://wa.me/?text=${shareText}`;

  return `
  <div style="max-width:480px;margin:0 auto;font-family:sans-serif;text-align:center;padding:32px 20px;">
    <h1 style="font-family:'Georgia',serif;font-size:20px;color:#1a1a1a;margin-bottom:4px;">Your Architecture Digest is ready</h1>
    <div style="font-size:13px;color:#8a8378;margin-bottom:24px;">${dateLabel}</div>
    <div style="font-size:14px;color:#4a4a4a;line-height:2;text-align:left;background:#f7f5f0;border-radius:10px;padding:18px 22px;margin-bottom:24px;">
      🏛️ Policy &amp; Regulation — <b>${counts.policyRegulation}</b><br>
      🌍 Nigeria &amp; Africa — <b>${counts.nigeriaAfrica}</b><br>
      🧑‍💼 Professional Practice — <b>${counts.professionalPractice}</b><br>
      🏘️ Development &amp; Real Estate — <b>${counts.developmentRealEstate}</b><br>
      🧱 Building Materials — <b>${counts.materials}</b><br>
      🏗️ Construction — <b>${counts.construction}</b><br>
      🏆 Competitions &amp; Exams — <b>${counts.competitionsExams}</b><br>
      🎨 Design &amp; Culture — <b>${counts.designCulture}</b><br>
      📰 Global News — <b>${counts.globalNews}</b>
    </div>
    <a href="${digestUrl}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:13px 32px;border-radius:8px;font-size:14px;font-weight:600;margin-bottom:14px;">View Digest</a>
    <br>
    <a href="${whatsappShareUrl}" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;padding:13px 32px;border-radius:8px;font-size:14px;font-weight:600;margin-top:6px;">Share to WhatsApp</a>
    <div style="font-size:11px;color:#a3a3a3;margin-top:28px;">Sent automatically for Archilurdesignz and Architecture.</div>
  </div>`;
}

// --- Handler ----------------------------------------------------------------

export default async function handler(req, res) {
  const isCron = req.headers['x-vercel-cron'] === '1' || req.headers['x-vercel-cron'] === 'true';
  const manualSecretOk =
    req.query?.manual === '1' && req.query?.key === process.env.DIGEST_MANUAL_KEY;

  if (!isCron && !manualSecretOk) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const [rssItems, newsApiItems] = await Promise.all([
      fetchRssItems(),
      fetchNewsApiItems(),
    ]);

    const scrapedItems = await fetchScrapeFallbacks_(rssItems);
    const items = mergeAndDedupe([...rssItems, ...scrapedItems], newsApiItems);

    const taxonomy = buildTaxonomy_(items);
    const counts = taxonomyCounts_(taxonomy);

    const dateLabel = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const digestUrl = process.env.DIGEST_PAGE_URL || 'https://archilurdesignz.com/digest';

    const pageHtml = buildDigestPageHtml_(taxonomy, counts, { dateLabel, digestUrl });
    await publishDigestToGitHub_(pageHtml);

    const emailHtml = buildNotificationEmailHtml_(counts, { dateLabel, digestUrl });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: process.env.DIGEST_FROM_EMAIL,
      to: process.env.DIGEST_TO_EMAIL,
      subject: `Architecture Digest ready — ${counts.total} new stor${counts.total === 1 ? 'y' : 'ies'}`,
      html: emailHtml,
    });

    if (error) {
      console.error('Resend send error:', error);
      return res.status(500).json({ error: 'Email send failed', details: error });
    }

    return res.status(200).json({
      ok: true,
      counts,
      digestUrl,
      emailId: data?.id,
    });
  } catch (err) {
    console.error('Digest handler error:', err);
    return res.status(500).json({ error: 'Digest generation failed', details: err.message });
  }
}
