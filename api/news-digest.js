// /api/news-digest.js
// Fetches recent architecture/built-environment news from RSS feeds +
// NewsAPI, categorizes it into a topical taxonomy, publishes a
// "zero-scroll" accordion webpage to the ADA site (via a GitHub commit,
// which Vercel auto-deploys), and emails a short notification with a
// "View Digest" link and a "Share to WhatsApp" link.
//
// Triggered on your external cron schedule (currently 3x/day: 7am, noon,
// 3pm), since Vercel's
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
// `dedicated: true` means every article this source publishes is
// inherently architecture/construction/property content by definition
// of the outlet — these skip topic-keyword filtering entirely,
// regardless of region. `dedicated: false` means the source is
// general-purpose or search-based (a news search query, a general
// headlines feed) and needs keyword filtering to stay relevant — this
// now applies uniformly across ALL regions, not just Nigeria/Africa
// (see mergeAndDedupe): a broad NewsAPI "architecture" search can match
// a totally unrelated politics story that uses "architecture" as a
// throwaway metaphor somewhere in its body text, and that's just as
// true whether the item ends up tagged nigeria/africa/global.
const RSS_FEEDS = [
  { name: 'ArchDaily', url: 'https://www.archdaily.com/rss/', region: 'global', dedicated: true },
  { name: 'Dezeen', url: 'https://www.dezeen.com/architecture/feed/', region: 'global', dedicated: true },
  { name: 'Designboom', url: 'https://www.designboom.com/architecture/feed/', region: 'global', dedicated: true },
  { name: 'e-architect', url: 'https://www.e-architect.com/feed', region: 'global', dedicated: true },
  { name: 'Dezeen Africa', url: 'https://www.dezeen.com/tag/africa/feed/', region: 'africa', dedicated: true },
  { name: 'ArchDaily Africa', url: 'https://www.archdaily.com/tag/africa/rss/', region: 'africa', dedicated: true },
  { name: 'Architect Africa', url: 'https://architectafrica.com/aarss/', region: 'africa', dedicated: true },
  { name: 'Livin Spaces (Nigeria)', url: 'https://livinspaces.net/category/projects/feed/', region: 'nigeria', dedicated: true },
  { name: 'IJNIA (NIA Journal)', url: 'https://ijnia.org/index.php/journal/gateway/plugin/RssGatewayPlugin/rss', region: 'nigeria', dedicated: true },
  { name: 'NIA (Nigerian Institute of Architects)', url: 'https://www.nia.ng/feed/', region: 'nigeria', dedicated: true },
  { name: 'ARCON (Architecture category)', url: 'https://arconigeria.gov.ng/category/architecture/feed/', region: 'nigeria', dedicated: true },
  { name: 'ARCON (Journal category)', url: 'https://arconigeria.gov.ng/category/journal/feed/', region: 'nigeria', dedicated: true },
  { name: 'Vanguard Homes & Property', url: 'https://www.vanguardngr.com/category/homes-property/feed/', region: 'nigeria', dedicated: true },
  { name: 'Google News (Nigeria architecture)', url: 'https://news.google.com/rss/search?q=architecture%20Nigeria%20when:2d&hl=en-NG&gl=NG&ceid=NG:en', region: 'nigeria', dedicated: false },
  { name: 'Google News (Africa architecture)', url: 'https://news.google.com/rss/search?q=architecture%20Africa%20when:2d&hl=en-NG&gl=NG&ceid=NG:en', region: 'africa', dedicated: false },
  { name: 'AllAfrica (Construction)', url: 'https://allafrica.com/tools/headlines/rdf/construction/headlines.rdf', region: 'africa', dedicated: true },
  { name: 'AllAfrica (Nigeria)', url: 'https://allafrica.com/tools/headlines/rdf/nigeria/headlines.rdf', region: 'nigeria', dedicated: false },
  { name: 'ConstructAfrica', url: 'https://constructafrica.com/rss-feed', region: 'africa', dedicated: true },
  { name: 'Guardian Nigeria (Property)', url: 'https://guardian.ng/category/property/feed/', region: 'nigeria', dedicated: true },
  { name: 'BusinessDay Nigeria', url: 'https://businessday.ng/feed/', region: 'nigeria', dedicated: false },
  { name: 'Nairametrics', url: 'https://nairametrics.com/feed/', region: 'nigeria', dedicated: false },
  { name: 'ENR (Engineering News-Record)', url: 'https://www.enr.com/rss/articles', region: 'global', dedicated: true },
  { name: 'Construction Dive', url: 'https://www.constructiondive.com/feeds/news/', region: 'global', dedicated: true },
  { name: 'PropertyPro.ng', url: 'https://www.propertypro.ng/blog/feed/', region: 'nigeria', dedicated: true },
  { name: 'NIQS (Nigerian Institute of Quantity Surveyors)', url: 'https://niqs.org.ng/feed/', region: 'nigeria', dedicated: true },
  { name: 'World Architecture Community', url: 'https://worldarchitecture.org/feed', region: 'global', dedicated: true },
  { name: 'Global Cement (Africa)', url: 'https://www.globalcement.com/rss', region: 'africa', dedicated: true },
  { name: 'FMHUD (Federal Ministry of Housing)', url: 'https://fmhud.gov.ng/feed/', region: 'nigeria', dedicated: true },
  { name: 'Lagos MPPUD', url: 'https://mppud.lagosstate.gov.ng/feed/', region: 'nigeria', dedicated: true },
  { name: 'NITP (Nigerian Institute of Town Planners)', url: 'https://nitpng.org/feed/', region: 'nigeria', dedicated: true },
  { name: 'Design Indaba', url: 'https://www.designindaba.com/feed', region: 'africa', dedicated: true },
  { name: 'Punch Nigeria', url: 'https://punchng.com/feed/', region: 'nigeria', dedicated: false },
  { name: 'Channels TV', url: 'https://www.channelstv.com/feed/', region: 'nigeria', dedicated: false },
];

// Two NewsAPI queries: one broad, one focused on Nigeria/Africa so those
// stories don't get drowned out by higher-volume global sources. Both are
// search-based (not a dedicated publication), so both need topic filtering
// — a broad keyword search can match a story that only uses "architecture"
// as a throwaway metaphor somewhere in its full body text.
const NEWSAPI_QUERIES = [
  { query: 'architecture', region: 'global', dedicated: false },
  { query: 'architecture AND (Nigeria OR Lagos OR Abuja OR Africa OR African)', region: 'africa', dedicated: false },
];

function buildNewsApiUrl(query) {
  return `https://newsapi.org/v2/everything?q=${encodeURIComponent(
    query
  )}&language=en&sortBy=publishedAt&pageSize=20`;
}

// --- Scraping fallback (for sites with no reliable RSS) --------------------
// All institutional/dedicated sources — same reasoning as `dedicated: true`
// above (Channels TV is the one exception, matching its RSS entry).
const SCRAPE_FALLBACKS = [
  { sourcePrefix: 'NIA', name: 'NIA (scraped)', url: 'https://www.nia.ng/news/', region: 'nigeria', dedicated: true },
  { sourcePrefix: 'ARCON', name: 'ARCON (scraped)', url: 'https://arconigeria.gov.ng/news-journals/', region: 'nigeria', dedicated: true },
  { sourcePrefix: 'NIQS', name: 'NIQS (scraped)', url: 'https://niqs.org.ng/news/', region: 'nigeria', dedicated: true },
  { sourcePrefix: 'FMHUD', name: 'FMHUD (scraped)', url: 'https://fmhud.gov.ng/', region: 'nigeria', dedicated: true },
  { sourcePrefix: 'Lagos MPPUD', name: 'Lagos MPPUD (scraped)', url: 'https://mppud.lagosstate.gov.ng/news/', region: 'nigeria', dedicated: true },
  { sourcePrefix: 'NITP', name: 'NITP (scraped)', url: 'https://nitpng.org/category/news/', region: 'nigeria', dedicated: true },
  { sourcePrefix: 'Design Indaba', name: 'Design Indaba (scraped)', url: 'https://www.designindaba.com/articles', region: 'africa', dedicated: true },
  { sourcePrefix: 'Channels TV', name: 'Channels TV (scraped)', url: 'https://www.channelstv.com/category/headlines/', region: 'nigeria', dedicated: false },
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

// Generic Supabase-backed "already shown" tracking — used for every item
// in the digest now, not just the scraped institutional sources. RSS
// feeds and NewsAPI have real publishedAt dates, so age alone used to be
// the only thing stopping a repeat — but a global item stays inside its
// 30-hour window across two consecutive 12-hour runs, and a Nigeria/Africa
// item stays inside its 96-hour window across up to eight runs, so a
// story could resurface on the digest for days without this.
async function getUnseenUrls_(urls) {
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

async function markUrlsSeen_(urls) {
  if (!supabase || urls.length === 0) return;
  const { error } = await supabase
    .from('digest_seen_articles')
    .upsert(urls.map((url) => ({ url })), { onConflict: 'url' });

  if (error) {
    console.error('Supabase seen-articles insert failed:', error.message);
  }
}

async function getNewsletterSubscribers_() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('digest_subscribers')
    .select('email, unsubscribe_token');

  if (error) {
    console.error('Supabase subscriber lookup failed:', error.message);
    return [];
  }
  return data || [];
}

// --- Rolling 3-day news archive ---------------------------------------
// The published page shows everything that was fresh at some point in
// the last NEWS_ARCHIVE_WINDOW_DAYS, not just the current run's items —
// this is what actually makes it a "news page" rather than a
// single-run snapshot. Category/subcategory are captured once, at
// archive time, so an item doesn't jump categories if keyword lists
// change while it's still within its 3-day window.
async function archiveNewsItems_(items) {
  if (!supabase || items.length === 0) return;
  const rows = items.map((item) => {
    const { category, subcategory } = categorizeItem_(item);
    return {
      url: item.url,
      title: item.title,
      region: REGION_KEYS.includes(item.region) ? item.region : 'global',
      category,
      subcategory: subcategory || null,
      source: item.source,
      also_reported_by: item.alsoReportedBy && item.alsoReportedBy.length > 0 ? item.alsoReportedBy : null,
      published_at: item.publishedAt,
    };
  });
  const { error } = await supabase
    .from('digest_news_archive')
    .upsert(rows, { onConflict: 'url' });

  if (error) {
    console.error('Supabase news-archive insert failed:', error.message);
  }
}

async function pruneOldArchivedNews_() {
  if (!supabase) return;
  const cutoff = new Date(Date.now() - NEWS_ARCHIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('digest_news_archive')
    .delete()
    .lt('archived_at', cutoff);

  if (error) {
    console.error('Supabase news-archive prune failed:', error.message);
  }
}

async function getArchivedNews_() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('digest_news_archive')
    .select('url, title, region, category, subcategory, source, also_reported_by, published_at')
    .order('published_at', { ascending: false });

  if (error) {
    console.error('Supabase news-archive lookup failed:', error.message);
    return [];
  }
  return (data || []).map((row) => ({
    url: row.url,
    title: row.title,
    region: row.region,
    category: row.category,
    subcategory: row.subcategory || undefined,
    source: row.source,
    alsoReportedBy: row.also_reported_by || undefined,
    publishedAt: row.published_at,
  }));
}

function chunk_(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
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
      // No per-source seen-check here anymore — scraped items get a fake
      // publishedAt of "now" (the source page has no real per-item date),
      // so they'd otherwise pass the recency filter on every run forever.
      // The universal seen-check in the handler (after the full
      // filter/dedup pipeline) now covers this instead, in one place,
      // for every source type.
      results.push(
        ...scraped.map((s) => ({
          title: s.title,
          url: s.url,
          source: fallback.name,
          region: fallback.region,
          dedicated: fallback.dedicated,
          publishedAt: new Date().toISOString(),
          summary: '',
        }))
      );
    } catch (err) {
      console.error(`Scrape fallback failed for ${fallback.name}:`, err.message);
    }
  }
  return results;
}

const MAX_ITEMS_PER_CATEGORY = 15;
// The rendered news page (3-day rolling window) can reasonably hold more
// per category than a single run's fresh items would — this only affects
// how many items get RENDERED on the page, not what gets archived/pruned.
const MAX_ITEMS_PER_CATEGORY_NEWS_PAGE = 30;
const NEWS_ARCHIVE_WINDOW_DAYS = 3;
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
  'architect', 'architecture', 'ARCON', 'NIQS', 'NITP', 'IJNIA',
  'coren', 'nse', 'niob', 'corbon', 'toprec', 'qsrb',
  'quantity survey', 'quantity surveyor', 'bill of quantities', 'boq',
  'town planning', 'town planner', 'spatial planning', 'zoning',
  'cost management', 'procurement', 'professional exam', 'design competition',
  'afdb', 'renewed hope housing', 'federal ministry of housing', 'shelter afrique',
  'fidic', 'epc contract', 'groundbreaking', 'topping out',
  // Compound "development" phrases — specific enough to be unambiguous,
  // unlike the bare word (see note below on why 'development' isn't in
  // AMBIGUOUS_TOPIC_KEYWORDS).
  'real estate development', 'property development', 'housing development',
  'urban development', 'estate development', 'residential development',
  'commercial development', 'mixed-use development', 'infrastructure development',
  'real estate developer', 'property developer', 'land developer',
];

// 'NIA' (Nigerian Institute of Architects) is NOT in the case-insensitive
// list above — word-boundary matching alone doesn't help here, because
// "Nia" is also a genuine whole word: a product name ("LLM Nia 1.0"), a
// person's name, a Swahili/Kwanzaa term. Case-insensitive \bnia\b matches
// all of those equally. A real institutional acronym is almost always
// written in full caps in running text, unlike a title-case product or
// person name, so this one keyword is checked case-SENSITIVELY instead —
// see CASE_SENSITIVE_STRONG_KEYWORDS / includesCaseSensitiveKeyword_.
const CASE_SENSITIVE_STRONG_KEYWORDS = ['NIA'];

function includesCaseSensitiveKeyword_(rawText, keyword) {
  const pattern = new RegExp(`\\b${escapeRegExp_(keyword)}\\b`); // no 'i' flag — case matters
  return pattern.test(rawText);
}

// Generic enough to need a negative-phrase check before counting.
// Note: bare geographic terms (Lagos, Nigeria, Abuja, Africa...) are
// deliberately NOT in this list — region-tagging already establishes
// geography, and since virtually every article from a Nigerian outlet
// mentions one of these place names, treating them as a topic signal
// would defeat the filter entirely for general news sources.
//
// 'development' and 'developer' are ALSO deliberately not in this list,
// even generic-with-a-check. Nigerian ministries and agencies routinely
// have "Development" in their official name with zero architectural
// connection (Ministry of Solid Minerals Development, Niger Delta
// Development Commission, Ministry of Youth Development, Rural
// Development, Human Capital Development...) — there are too many
// non-architectural collocations to list as negative phrases, so the
// bare word isn't a usable signal at all. The specific compound phrases
// that DO mean something ("real estate development", "housing
// development"...) are covered as exact phrases in
// STRONG_TOPIC_KEYWORDS instead.
const AMBIGUOUS_TOPIC_KEYWORDS = [
  'building', 'design', 'construction', 'urban', 'engineer', 'housing',
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
  // "architecture" used as a metaphor for a system/structure of institutions
  // or policy, not a building — extremely common in Nigerian policy and
  // defence journalism ("defence architecture", "security architecture"),
  // and 'architecture' is otherwise the single strongest unconditional
  // keyword, so this class of false positive needs explicit stripping.
  'defence architecture', 'defense architecture', 'security architecture',
  'financial architecture', 'economic architecture', 'institutional architecture',
  'governance architecture', 'policy architecture', 'network architecture',
  'software architecture', 'system architecture', 'systems architecture',
  'cyber architecture', 'cybersecurity architecture', 'it architecture',
  'data architecture', 'global financial architecture', 'peace architecture',
  'health architecture', 'social architecture', 'political architecture',
  'diplomatic architecture', 'legal architecture', 'regulatory architecture',
  'tax architecture', 'trade architecture', 'monetary architecture',
];

// Same idea as the negative phrases above, but for the mirror-image
// phrasing: "architecture OF X" (architecture of governance, architecture
// of global growth) instead of "X architecture" (governance architecture).
// This needs a regex rather than a plain phrase list because real headlines
// insert adjectives between "of" and the noun ("architecture of global
// governance", "architecture of African growth") — a fixed substring list
// would miss those. Matches up to 2 words between "of" and the noun.
const ARCHITECTURE_OF_METAPHOR_PATTERN =
  /\barchitecture of(?:\s+\w+){0,2}\s+(governance|growth|peace|security|defence|defense|finance|the economy|economic\s+\w+|power|democracy|diplomacy|trade|cooperation|regulation|policy|institutions?|the state|international relations)\b/gi;

// General-purpose news feeds (broad national/broadcast coverage, not
// dedicated to architecture/construction/property) sometimes carry
// syndication boilerplate or unrelated teaser text in their RSS
// description/summary field that can coincidentally contain a keyword
// match, even when the actual headline has nothing to do with the built
// environment — e.g. an AllAfrica "Nigeria" general-headlines item whose
// description field happens to contain a stray match. For these sources,
// only the title itself is checked — the one field guaranteed to
// reflect what the story is actually about.
const GENERAL_NEWS_SOURCE_PREFIXES = [
  'Punch', 'Channels TV', 'AllAfrica', 'BusinessDay', 'Nairametrics', 'Google News',
];

function isGeneralNewsSource_(item) {
  return GENERAL_NEWS_SOURCE_PREFIXES.some((prefix) => item.source?.startsWith(prefix));
}

// Shared keyword-matching primitive. Plain substring matching (`.includes`)
// has a real collision problem for short acronyms: 'nse' (Nigerian Society
// of Engineers) matches inside "inSEcurity", "expENSE", "respONSE" —
// none of which have anything to do with engineering. Word-boundary regex
// matching fixes this for every keyword list, not just the one acronym
// that happened to get caught.
function escapeRegExp_(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function includesKeyword_(haystack, keyword) {
  const pattern = new RegExp(`\\b${escapeRegExp_(keyword.toLowerCase())}\\b`, 'i');
  return pattern.test(haystack);
}

function matchesTopic_(item) {
  const scopedItem = isGeneralNewsSource_(item) ? { title: item.title, summary: '' } : item;
  const haystack = textOf_(scopedItem);
  const rawText = `${scopedItem.title || ''} ${scopedItem.summary || ''}`;

  if (CASE_SENSITIVE_STRONG_KEYWORDS.some((kw) => includesCaseSensitiveKeyword_(rawText, kw))) {
    return true;
  }

  if (STRONG_TOPIC_KEYWORDS.some((kw) => includesKeyword_(haystack, kw))) {
    return true;
  }

  // AI-in-the-built-environment phrases are specific/compound enough to
  // count as a strong signal on their own (same reasoning as
  // STRONG_TOPIC_KEYWORDS) — this lets a genuine "digital twin for
  // infrastructure" or "construction robotics" story pass the topic
  // filter even if it doesn't also happen to say "architect" or
  // "building" somewhere.
  if (ARTIFICIAL_INTELLIGENCE_KEYWORDS.some((kw) => includesKeyword_(haystack, kw))) {
    return true;
  }

  // Ambiguous keywords are checked against the already-cleaned text —
  // if a keyword only appeared inside a negative phrase (e.g. "building"
  // inside "capacity building"), that exact occurrence was already
  // stripped out by textOf_(). If "building" still appears here, it's a
  // genuine standalone mention elsewhere in the text.
  return AMBIGUOUS_TOPIC_KEYWORDS.some((kw) => includesKeyword_(haystack, kw));
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
  return EXCLUDE_KEYWORDS.some((kw) => includesKeyword_(haystack, kw));
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
        dedicated: feed.dedicated,
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
    NEWSAPI_QUERIES.map(async ({ query, region, dedicated }) => {
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
        dedicated,
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

// --- Regional-tag reconciliation ---------------------------------------
//
// Region normally just comes from which feed/query fetched an item — but
// some "regional" feeds are really just a tag or search filter layered on
// top of a GLOBAL platform (ArchDaily's own "Africa" tag page, a Google
// News search for "architecture Africa"), and those tags/searches can
// occasionally mistag or cross-post content that has nothing to do with
// the region at all — e.g. an ArchDaily "Africa" tag entry that turns out
// to be a project in Thailand. Genuinely region-exclusive outlets (NIA,
// ConstructAfrica, Architect Africa...) can't have this problem — they
// simply don't publish anything else — so this check only applies to the
// tag/search-based sources below.
const REGION_TAG_SOURCE_PREFIXES = [
  'ArchDaily Africa', 'Dezeen Africa',
  'Google News (Africa architecture)', 'Google News (Nigeria architecture)',
];

// Deliberately not exhaustive — major countries, capitals, and a few
// architecturally-prominent cities. The goal is to catch "this mentions
// nothing African at all," not to geocode precisely.
const AFRICA_SIGNAL_KEYWORDS = [
  'africa', 'african', 'nigeria', 'nigerian', 'ghana', 'ghanaian', 'kenya', 'kenyan',
  'south africa', 'egypt', 'egyptian', 'morocco', 'moroccan', 'ethiopia', 'ethiopian',
  'senegal', 'senegalese', 'rwanda', 'rwandan', 'tanzania', 'tanzanian', 'uganda', 'ugandan',
  'zimbabwe', 'zambia', 'botswana', 'namibia', 'ivory coast', "cote d'ivoire", 'cameroon',
  'tunisia', 'tunisian', 'algeria', 'algerian', 'sub-saharan',
  'lagos', 'abuja', 'kano', 'ibadan', 'port harcourt', 'accra', 'nairobi', 'cairo',
  'johannesburg', 'cape town', 'kigali', 'dakar', 'addis ababa', 'lome', 'abidjan',
  'kampala', 'lusaka', 'harare', 'gaborone',
];

function hasRegionalSignal_(item) {
  const haystack = textOf_(item);
  return AFRICA_SIGNAL_KEYWORDS.some((kw) => includesKeyword_(haystack, kw));
}

function reconcileRegionTag_(item) {
  const isTagBasedSource = REGION_TAG_SOURCE_PREFIXES.some((prefix) => item.source?.startsWith(prefix));
  if (!isTagBasedSource || hasRegionalSignal_(item)) return item;
  // Tagged Africa/Nigeria by the feed, but nothing in the title or summary
  // mentions Africa or any African country/city — file it under Globe
  // instead of trusting a tag the content itself doesn't support. Still
  // kept (not dropped) since it's legitimate architecture content, just
  // misfiled by the upstream platform.
  return { ...item, region: 'global' };
}

// Cities/terms specific enough to Nigeria that finding one is a strong
// signal a story is really ABOUT Nigeria, not Africa broadly — e.g. "Big
// 5 Construct Nigeria" arriving via ConstructAfrica, a Google News Africa
// search, or any other pan-African source. Unlike reconcileRegionTag_
// above (which only downgrades a mistagged item that has NO regional
// signal at all, and only for tag/search-based sources), this is a
// promotion applied to ANY item still tagged 'africa' regardless of
// source — a genuinely pan-African outlet covering a Nigeria-specific
// story should still surface under Nigeria, since that's more useful to
// a Nigerian firm than leaving it in the broader continental bucket.
const NIGERIA_SIGNAL_KEYWORDS = [
  'nigeria', 'nigerian', 'naija', 'lagos', 'abuja', 'kano', 'ibadan',
  'port harcourt', 'kaduna', 'enugu', 'benin city', 'jos', 'owerri',
  'uyo', 'ilorin', 'abeokuta', 'warri', 'calabar', 'onitsha', 'aba',
  'zaria', 'sokoto', 'maiduguri', 'akure', 'osogbo', 'minna', 'bauchi',
  'yola', 'gombe', 'lokoja', 'awka',
];

function promoteNigeriaContent_(item) {
  if (item.region !== 'africa') return item;
  const haystack = textOf_(item);
  if (!NIGERIA_SIGNAL_KEYWORDS.some((kw) => includesKeyword_(haystack, kw))) return item;
  return { ...item, region: 'nigeria' };
}

function mergeAndDedupe(rssItems, newsApiItems) {
  const all = [...rssItems, ...newsApiItems]
    .map(reconcileRegionTag_)
    .map(promoteNigeriaContent_)
    .filter((item) => {
      if (!item.title || !item.url) return false;
      if (matchesExcludeKeywords_(item)) return false;
      const isLocal = item.region === 'africa' || item.region === 'nigeria';
      if (!isRecent(item.publishedAt, isLocal ? MAX_AGE_HOURS_LOCAL : MAX_AGE_HOURS_GLOBAL)) {
        return false;
      }
      // Dedicated architecture/construction publications are trusted as-is,
      // in every region — everything they publish is on-topic by definition
      // of the outlet. Everything else (general news feeds, and critically
      // the broad NewsAPI/Google News search queries) needs the topic filter
      // regardless of region — a keyword search can match a story that only
      // uses "architecture" as a metaphor somewhere in its full body text,
      // and that risk doesn't go away just because the item got tagged
      // 'global' instead of 'nigeria'/'africa'.
      if (!item.dedicated && !matchesTopic_(item)) {
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
  'architecture award', 'fellowship',
];

const EXHIBITIONS_KEYWORDS = [
  'exhibition', 'expo', 'trade show', 'trade fair', 'showcase',
  'gallery show', 'design exhibition', 'architecture exhibition',
  'building expo', 'construction expo', 'art exhibition', 'biennale',
  'triennial', 'building fair', 'housing fair', 'materials expo',
  'building and construction expo', 'open house architecture',
];

const PROFESSIONAL_PRACTICE_SUBCATEGORIES = [
  { key: 'architects', label: 'Architects', emoji: '👷', keywords: [
    // Note: bare 'nia' deliberately excluded — same collision risk as
    // the topic filter's CASE_SENSITIVE_STRONG_KEYWORDS entry ("Nia" the
    // product/person name vs "NIA" the institute). Genuine NIA-sourced
    // items are already routed here via the source-identity check in
    // categorizeItem_(), before any keyword matching runs.
    'architect', 'architecture firm', 'architectural practice', 'arcon',
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

const DEVELOPMENT_REAL_ESTATE_KEYWORDS = [
  'proptech', 'real estate development', 'property development', 'housing development',
  'urban development', 'estate development', 'residential development',
  'commercial development', 'mixed-use development', 'infrastructure development',
  'real estate developer', 'property developer', 'land developer',
];

const CONSTRUCTION_KEYWORDS = [
  'construction', 'groundbreaking', 'building site', 'infrastructure project',
  'completion', 'contractor', 'modular construction', 'prefab',
  'construction methodology', 'site work',
  'topping out', 'epc contract', 'fidic', 'dredging', 'heavy equipment',
  'concrete casting', 'precast', 'post-tensioning', 'site execution',
];

// Deliberately compound/specific phrases, NOT bare 'ai' or 'artificial
// intelligence' — those would match any generic tech-industry story
// (an LLM launch, a chatbot funding round) with zero connection to the
// built environment, exactly the kind of noise the rest of this filter
// exists to keep out. Every phrase here ties AI specifically to
// architecture, construction, planning, or property.
const ARTIFICIAL_INTELLIGENCE_KEYWORDS = [
  'ai in architecture', 'ai-powered design', 'ai architecture', 'architectural ai',
  'ai architect', 'architecture ai tool', 'ai design tool',
  'generative design', 'generative ai design', 'ai-generated design',
  'ai in construction', 'construction ai', 'construction robotics',
  'autonomous construction', 'robotic construction', '3d-printed building',
  '3d-printed house', 'ai in real estate', 'proptech ai', 'ai proptech',
  'ai-powered proptech', 'smart building ai', 'ai building management',
  'predictive maintenance ai', 'ai urban planning', 'ai in urban planning',
  'ai in planning', 'computational design', 'digital twin', 'bim ai',
  'ai in bim', 'machine learning architecture', 'ai in real estate valuation',
  'ai floor plan', 'ai site analysis',
];

function textOf_(item) {
  let text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
  // Strip known non-architectural collocations before any keyword
  // matching runs, so e.g. "capacity building" can't cause a story to
  // land in Construction just because it contains the word "building".
  for (const phrase of NEGATIVE_PHRASES) {
    text = text.split(phrase).join(' ');
  }
  text = text.replace(ARCHITECTURE_OF_METAPHOR_PATTERN, ' ');
  return text;
}

function matchesAny_(haystack, keywords) {
  return keywords.some((kw) => includesKeyword_(haystack, kw));
}

// Every item gets a CATEGORY here (region is handled separately — see
// buildTaxonomy_ — since region is just item.region already tagged on
// the feed/query config). The same category logic now applies uniformly
// regardless of region: a Nigeria item, an Africa item, and a Globe item
// all run through the identical rules below, so "Architects" news is
// Architects news whether it's Nigerian, African, or global.
function categorizeItem_(item) {
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

  // Professional-body sources are explicitly Professional Practice
  // content regardless of what words a given press release uses.
  if (item.source?.startsWith('NIQS')) {
    return { category: 'professionalPractice', subcategory: 'quantitySurveyors' };
  }
  if (item.source?.startsWith('NIA') || item.source?.startsWith('IJNIA') || item.source?.startsWith('ARCON')) {
    return { category: 'professionalPractice', subcategory: 'architects' };
  }

  const haystack = textOf_(item);

  if (matchesAny_(haystack, COMPETITIONS_EXAMS_KEYWORDS)) {
    return { category: 'competitionsExams' };
  }

  if (matchesAny_(haystack, EXHIBITIONS_KEYWORDS)) {
    return { category: 'exhibitions' };
  }

  if (matchesAny_(haystack, ARTIFICIAL_INTELLIGENCE_KEYWORDS)) {
    return { category: 'artificialIntelligence' };
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

  // Catch-all — on-topic (it passed the topic filter or came from an
  // architecture-focused feed) but doesn't fit a specific category.
  return { category: 'generalNews' };
}

// Region is the top-level grouping now. Every region gets the SAME
// category shape underneath it (Policy & Regulation, Professional
// Practice w/ 5 sub-categories, Development & Real Estate, Materials,
// Construction, Competitions & Exams, Design & Culture, plus a
// catch-all "News" bucket) — so "Architects" news, "Materials" news
// etc. are each split three ways: Nigeria, Africa, Globe.
const REGION_KEYS = ['nigeria', 'africa', 'global'];

function emptyRegionTaxonomy_() {
  return {
    policyRegulation: [],
    professionalPractice: {
      architects: [], engineers: [], quantitySurveyors: [], townPlanning: [], builders: [],
    },
    developmentRealEstate: [],
    materials: [],
    construction: [],
    competitionsExams: [],
    exhibitions: [],
    artificialIntelligence: [],
    designCulture: [],
    generalNews: [],
  };
}

function buildTaxonomy_(items, maxPerCategory = MAX_ITEMS_PER_CATEGORY) {
  const taxonomy = {
    nigeria: emptyRegionTaxonomy_(),
    africa: emptyRegionTaxonomy_(),
    global: emptyRegionTaxonomy_(),
  };

  for (const item of items) {
    const region = REGION_KEYS.includes(item.region) ? item.region : 'global';
    // Archived rows already carry their category/subcategory (decided
    // once, at the run that first fetched them) — reuse that instead of
    // re-running categorizeItem_, so an item's placement stays stable
    // for its whole 3 days on the page even if keyword lists change.
    const { category, subcategory } = item.category
      ? { category: item.category, subcategory: item.subcategory }
      : categorizeItem_(item);
    if (category === 'professionalPractice') {
      taxonomy[region].professionalPractice[subcategory].push(item);
    } else {
      taxonomy[region][category].push(item);
    }
  }

  // Cap each bucket so no single category runs away with the digest.
  for (const region of REGION_KEYS) {
    const t = taxonomy[region];
    t.policyRegulation = t.policyRegulation.slice(0, maxPerCategory);
    t.developmentRealEstate = t.developmentRealEstate.slice(0, maxPerCategory);
    t.materials = t.materials.slice(0, maxPerCategory);
    t.construction = t.construction.slice(0, maxPerCategory);
    t.competitionsExams = t.competitionsExams.slice(0, maxPerCategory);
    t.exhibitions = t.exhibitions.slice(0, maxPerCategory);
    t.artificialIntelligence = t.artificialIntelligence.slice(0, maxPerCategory);
    t.designCulture = t.designCulture.slice(0, maxPerCategory);
    t.generalNews = t.generalNews.slice(0, maxPerCategory);
    for (const key of Object.keys(t.professionalPractice)) {
      t.professionalPractice[key] = t.professionalPractice[key].slice(0, maxPerCategory);
    }
  }

  return taxonomy;
}

function regionCounts_(regionTaxonomy) {
  const professionalPractice = Object.values(regionTaxonomy.professionalPractice).reduce(
    (sum, arr) => sum + arr.length,
    0
  );
  const counts = {
    policyRegulation: regionTaxonomy.policyRegulation.length,
    professionalPractice,
    developmentRealEstate: regionTaxonomy.developmentRealEstate.length,
    materials: regionTaxonomy.materials.length,
    construction: regionTaxonomy.construction.length,
    competitionsExams: regionTaxonomy.competitionsExams.length,
    exhibitions: regionTaxonomy.exhibitions.length,
    artificialIntelligence: regionTaxonomy.artificialIntelligence.length,
    designCulture: regionTaxonomy.designCulture.length,
    generalNews: regionTaxonomy.generalNews.length,
  };
  counts.total = Object.values(counts).reduce((a, b) => a + b, 0);
  return counts;
}

function taxonomyCounts_(taxonomy) {
  const nigeria = regionCounts_(taxonomy.nigeria);
  const africa = regionCounts_(taxonomy.africa);
  const global = regionCounts_(taxonomy.global);
  return {
    nigeria,
    africa,
    global,
    total: nigeria.total + africa.total + global.total,
  };
}

// --- Digest page HTML (the "zero-scroll" accordion webpage) ----------------

function itemDateLabel_(item) {
  if (!item.publishedAt) return '';
  const d = new Date(item.publishedAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos',
  });
}

function itemLi_(item) {
  const alsoReported =
    item.alsoReportedBy && item.alsoReportedBy.length > 0
      ? `<span class="also-reported">+${item.alsoReportedBy.length} more source${
          item.alsoReportedBy.length === 1 ? '' : 's'
        }</span>`
      : '';
  const dateLabel = itemDateLabel_(item);
  const dateHtml = dateLabel ? `<span class="item-date">${escapeHtml(dateLabel)}</span>` : '';
  const safeUrl = escapeHtml(item.url);
  return `<li data-url="${safeUrl}">
    <a class="item-link" href="${safeUrl}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>
    <span class="src">${escapeHtml(item.source)}${alsoReported}${dateHtml}</span>
    <div class="item-actions">
      <button type="button" class="like-btn" aria-label="Like this story">
        <span class="like-icon">♡</span><span class="like-count">0</span>
      </button>
      <span class="view-count" title="Views"><span class="view-icon">👁</span> <span class="view-num">0</span></span>
      <button type="button" class="comments-toggle" aria-label="Show comments">
        💬 <span class="comment-count">0</span>
      </button>
    </div>
    <div class="comment-box" hidden>
      <div class="comment-list"></div>
      <form class="comment-form">
        <input type="text" class="comment-name" maxlength="60" placeholder="Name (optional)">
        <textarea class="comment-text" maxlength="500" placeholder="Add a comment…" required></textarea>
        <div class="cf-turnstile-slot"></div>
        <p class="turnstile-msg" hidden></p>
        <button type="submit">Post</button>
      </form>
    </div>
  </li>`;
}

function accordionSection_(emoji, label, items, cls) {
  if (!items.length) return '';
  const clsAttr = cls ? ` class="${cls}"` : '';
  return `
    <details${clsAttr}>
      <summary><span>${emoji} ${escapeHtml(label)}</span><span class="count">${items.length}</span></summary>
      <ul>${items.map(itemLi_).join('')}</ul>
    </details>`;
}

// Professional Practice sub-categories render one level deeper than the
// other categories (region > Professional Practice > Architects/Engineers/...),
// so they get their own slightly-more-indented style (.nested2).
function professionalPracticeSection_(regionTaxonomy, regionCounts) {
  if (!regionCounts.professionalPractice) return '';
  const nested = PROFESSIONAL_PRACTICE_SUBCATEGORIES.map((sub) =>
    accordionSection_(sub.emoji, sub.label, regionTaxonomy.professionalPractice[sub.key], 'nested2')
  ).join('');

  return `
    <details class="nested">
      <summary><span>🧑‍💼 Professional Practice</span><span class="count">${regionCounts.professionalPractice}</span></summary>
      ${nested}
    </details>`;
}

// The full category breakdown for one region — same shape every time,
// just fed a different region's taxonomy/counts/label.
function regionCategorySections_(regionTaxonomy, regionCounts, regionLabel) {
  return [
    accordionSection_('🏛️', 'Policy & Regulation', regionTaxonomy.policyRegulation, 'nested'),
    professionalPracticeSection_(regionTaxonomy, regionCounts),
    accordionSection_('🏘️', 'Development & Real Estate', regionTaxonomy.developmentRealEstate, 'nested'),
    accordionSection_('🧱', 'Building Materials', regionTaxonomy.materials, 'nested'),
    accordionSection_('🏗️', 'Construction', regionTaxonomy.construction, 'nested'),
    accordionSection_('🏆', 'Competitions & Exams', regionTaxonomy.competitionsExams, 'nested'),
    accordionSection_('🖼️', 'Exhibitions', regionTaxonomy.exhibitions, 'nested'),
    accordionSection_('🤖', 'Artificial Intelligence', regionTaxonomy.artificialIntelligence, 'nested'),
    accordionSection_('🎨', 'Design & Culture', regionTaxonomy.designCulture, 'nested'),
    accordionSection_('📰', `${regionLabel} News`, regionTaxonomy.generalNews, 'nested'),
  ].join('');
}

function regionSection_(emoji, label, regionTaxonomy, regionCounts) {
  if (!regionCounts.total) return '';
  return `
    <details>
      <summary><span>${emoji} ${escapeHtml(label)}</span><span class="count">${regionCounts.total}</span></summary>
      ${regionCategorySections_(regionTaxonomy, regionCounts, label)}
    </details>`;
}

function buildDigestPageHtml_(taxonomy, counts, { dateLabel, timeLabel, digestUrl }) {
  const ogDescription = `${counts.total} architecture & built-environment stories from the last 3 days, organized by Nigeria, Africa, and Globe — each covering Policy & Regulation, Professional Practice, Development & Real Estate, Materials, Construction, Competitions & Exams, Exhibitions, Artificial Intelligence, and Design & Culture.`;
  const ogImage = process.env.DIGEST_OG_IMAGE_URL || 'https://archilurdesignz.com/assets/og-digest-cover.jpg';
  // Public site key — safe to embed in the page (this is how Turnstile is
  // designed to work; only the SECRET key, used server-side in
  // api/digest-interactions.js, must stay private). If this isn't set yet,
  // the comment form renders without a verification widget and the server
  // skips verification too — see README for setup steps.
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || '';
  // Widgets are rendered lazily (one per comment box, only once that box
  // is actually opened) rather than all up front, so a digest with
  // hundreds of items doesn't initialize hundreds of Turnstile widgets on
  // load. This queue/onload pattern handles the case where a box is
  // opened before the (async) Turnstile script has finished loading.
  const turnstileHead = turnstileSiteKey
    ? `
<script>
  window.__TURNSTILE_SITE_KEY__ = ${JSON.stringify(turnstileSiteKey)};
  window.__turnstileQueue = [];
  window.onTurnstileLoad = function () {
    window.__turnstileReady = true;
    var q = window.__turnstileQueue;
    window.__turnstileQueue = [];
    q.forEach(function (fn) { fn(); });
  };
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit" async defer></script>`
    : '';

  const sections = [
    regionSection_('🇳🇬', 'Nigeria', taxonomy.nigeria, counts.nigeria),
    regionSection_('🌍', 'Africa', taxonomy.africa, counts.africa),
    regionSection_('🌐', 'Globe', taxonomy.global, counts.global),
  ].join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<!-- Vercel Web Analytics -->
<script defer src="/_vercel/insights/script.js"></script>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, shrink-to-fit=no">
<title>ADA Architecture Digest — ${dateLabel}</title>
<meta name="description" content="${escapeHtml(ogDescription)}">
<link rel="canonical" href="${digestUrl}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="Archilurdesignz and Architecture">
<meta property="og:title" content="ADA Architecture Digest — ${dateLabel}">
<meta property="og:description" content="${escapeHtml(ogDescription)}">
<meta property="og:url" content="${digestUrl}">
<meta property="og:image" content="${ogImage}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="ADA Architecture Digest — ${dateLabel}">
<meta name="twitter:description" content="${escapeHtml(ogDescription)}">
<meta name="twitter:image" content="${ogImage}">

<!-- Favicons -->
<link rel="icon" type="image/png" href="/favicon-96x96.png" sizes="96x96">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="shortcut icon" href="/favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">

<!-- Set theme before first paint to avoid a flash of the wrong theme -->
<script>
  (function () {
    try {
      var saved = localStorage.getItem('ada-site-theme');
      document.documentElement.setAttribute('data-theme', saved || 'light');
    } catch (e) {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  })();
</script>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,700;1,400;1,500&family=Outfit:wght@200;300;400;500&display=swap" rel="stylesheet">

<style>
/* ── DESIGN TOKENS (same as index.html / journal.html) ────────────────── */
:root, [data-theme="dark"] {
  --ink:     #0d0c0a;
  --ink2:    #1c1a17;
  --ink3:    #2e2b26;
  --mist:    #7a7570;
  --sand:    #c9bfb0;
  --paper:   #f3ede4;
  --paper2:  #ede5d8;
  --gold:    #b09070;
  --gold2:   #d4b896;
  --accent:  #c8a87a;
  --white:   #faf8f4;
  --shadow:  0 8px 40px rgba(26,23,20,0.12);
  --line-rgb:    201,191,176;
  --mist-rgb:    122,117,112;
  --gold-rgb:    176,144,112;
  --good:    #6fae76;
  --bad:     #d98a7a;
  --f-display: 'Playfair Display', Georgia, serif;
  --f-body:    'Outfit', sans-serif;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
[data-theme="light"] {
  --ink:     #f5f1ea;
  --ink2:    #ffffff;
  --ink3:    #ece5d8;
  --mist:    #5f5346;
  --sand:    #55493c;
  --paper:   #1c1712;
  --paper2:  #241f18;
  --gold:    #8a6a45;
  --gold2:   #9c6b2e;
  --accent:  #a97c4a;
  --white:   #0d0c0a;
  --shadow:  0 8px 30px rgba(26,23,20,0.08);
  --line-rgb:    13,12,10;
  --mist-rgb:    95,83,70;
  --gold-rgb:    138,106,69;
  --good:    #3f7a49;
  --bad:     #b1503d;
}

* { box-sizing: border-box; transition: background-color 0.25s ease, border-color 0.25s ease, color 0.25s ease; }
html { scroll-behavior: smooth; }
body {
  margin: 0; width:100%; max-width:100%; overflow-x:hidden;
  background: var(--ink); color: var(--paper);
  font-family: var(--f-body); font-weight: 300;
}
a { color: inherit; }

/* ── NAV (identical to index.html/journal.html) ─────────────────────── */
nav {
  position: fixed; top:0; left:0; right:0; z-index:1000;
  height:72px;
  display:flex; align-items:center; justify-content:space-between;
  padding: 0 4%;
  background: rgba(13,12,10,0.94);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(201,191,176,0.08);
}
.nav-left { display:flex; gap:28px; align-items:center; }
.nav-left a {
  font-family: var(--f-body); font-size:0.62rem; font-weight:400;
  letter-spacing:2.5px; text-transform:uppercase; color: #c9bfb0;
  text-decoration:none; transition: color 0.3s; position:relative;
}
.nav-left a::after {
  content:''; position:absolute; bottom:-3px; left:0;
  width:0; height:1px; background:#c8a87a;
  transition: width 0.35s var(--ease-out);
}
.nav-left a:hover, .nav-left a.active { color:#f3ede4; }
.nav-left a:hover::after, .nav-left a.active::after { width:100%; }
.nav-center {
  position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  display:flex; align-items:center; gap:10px;
}
.nav-logomark {
  width:38px; height:38px; border:1px solid rgba(201,191,176,0.3);
  display:flex; align-items:center; justify-content:center;
  font-family: var(--f-display); font-size:1.1rem; color: #d4b896; letter-spacing:1px;
}
.nav-wordmark { line-height:1; }
.nav-wordmark .w1 {
  font-family: var(--f-display); font-size:1rem; font-weight:500;
  letter-spacing:5px; text-transform:uppercase; color:#f3ede4; display:block;
}
.nav-wordmark .w2 {
  font-family: var(--f-body); font-size:0.75rem; font-weight:300;
  letter-spacing:2px; color:#b09070; display:block; margin-top:2px;
}
.nav-right { display:flex; gap:14px; align-items:center; }
.nav-rc {
  font-size:0.55rem; letter-spacing:2px; color:#7a7570;
  border:1px solid rgba(122,117,112,0.3); padding:5px 10px;
}
.theme-toggle {
  display:flex; align-items:center; justify-content:center;
  width:36px; height:36px; flex-shrink:0;
  background:transparent; border:1px solid rgba(201,191,176,0.25);
  color:#c9bfb0; font-size:0.95rem; line-height:1; cursor:pointer; transition:all 0.3s;
}
.theme-toggle:hover { border-color:#b09070; color:#d4b896; }
.nav-cta-btn {
  font-family:var(--f-body); font-size:0.6rem; font-weight:400;
  letter-spacing:2px; text-transform:uppercase; padding:10px 22px;
  background:transparent; border:1px solid #c9bfb0; color:#f3ede4;
  text-decoration:none; display:inline-block; cursor:pointer; transition:all 0.3s;
}
.nav-cta-btn:hover { background:#f3ede4; color:#0d0c0a; }

/* ── PAGE HEADER ────────────────────────────────────────────────────── */
.digest-header { padding: 160px 5% 40px; max-width: 900px; }
.back-crumb {
  display:inline-block; font-family:var(--f-body); font-size:0.62rem; font-weight:400;
  letter-spacing:2px; text-transform:uppercase; color:var(--mist);
  text-decoration:none; margin-bottom:22px; transition:color 0.3s;
}
.back-crumb:hover { color:var(--gold2); }
.eyebrow {
  display:flex; align-items:center; gap:10px;
  font-family:var(--f-body); font-size:0.58rem; font-weight:400;
  letter-spacing:4px; text-transform:uppercase; color:var(--gold);
  margin-bottom:14px;
}
.eyebrow::before { content:''; width:24px; height:1px; background:var(--gold); }
.digest-title {
  font-family:var(--f-display); font-size:clamp(2rem,4.5vw,3.2rem);
  font-weight:400; letter-spacing:1px; text-transform:uppercase;
  color:var(--white); line-height:1.1; margin: 0 0 16px;
}
.digest-tagline {
  font-size:0.92rem; font-weight:200; line-height:1.75;
  color:var(--mist); max-width:640px; margin: 0 0 18px;
}
.digest-meta {
  font-family:var(--f-body); font-size:0.7rem; letter-spacing:0.5px;
  color:var(--sand);
}

/* ── SUBSCRIBE BOX ──────────────────────────────────────────────────── */
.digest-body { padding: 0 5% 100px; max-width: 900px; }
.subscribe-box {
  background: var(--ink2); border: 1px solid rgba(var(--line-rgb),0.1);
  padding: 24px 28px; margin: 0 0 32px;
}
.subscribe-title {
  font-family:var(--f-display); font-size:1.1rem; font-weight:500;
  color:var(--white); margin-bottom:6px;
}
.subscribe-copy { font-size: 0.8rem; font-weight:200; color: var(--mist); margin: 0 0 16px; line-height:1.6; }
.subscribe-form { display: flex; gap: 10px; flex-wrap: wrap; }
.subscribe-email {
  flex: 1 1 220px; font-family: inherit; font-size: 13px; padding: 11px 14px;
  border: 1px solid rgba(var(--line-rgb),0.2); background: var(--ink3); color: var(--paper);
}
.subscribe-email::placeholder { color: var(--mist); }
.subscribe-form button {
  font-family:var(--f-body); font-size:0.62rem; font-weight:500;
  letter-spacing:2px; text-transform:uppercase;
  background: var(--paper); color: var(--ink); border: none; padding: 11px 26px;
  cursor: pointer; transition: all 0.3s var(--ease-out);
}
.subscribe-form button:hover { background: var(--accent); color: var(--white); }
.subscribe-form button:disabled { opacity: 0.5; cursor: default; }
.subscribe-msg { font-size: 12px; margin: 12px 0 0; letter-spacing:0.3px; }
.subscribe-msg.success { color: var(--good); }
.subscribe-msg.error { color: var(--bad); }

/* ── CTA PANEL (back to the firm's site) ──────────────────────────────── */
.cta-panel {
  display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:24px;
  background: var(--ink2); border: 1px solid rgba(var(--line-rgb),0.1);
  padding: 32px 34px; margin-top: 32px;
}
.cta-copy { flex: 1 1 340px; }
.cta-copy p {
  font-size:0.85rem; font-weight:200; line-height:1.75; color:var(--mist);
  max-width: 480px; margin: 10px 0 0;
}
.cta-actions { display:flex; flex-direction:column; align-items:flex-start; gap:12px; }
.cta-link {
  font-size:0.62rem; letter-spacing:2px; text-transform:uppercase;
  color:var(--gold); text-decoration:none;
  border-bottom:1px solid rgba(var(--gold-rgb),0.3); padding-bottom:2px;
  transition:color 0.3s, border-color 0.3s;
}
.cta-link:hover { color:var(--gold2); border-color:var(--gold2); }
.btn-fill {
  padding:14px 32px; background:var(--paper); color:var(--ink);
  font-family:var(--f-body); font-size:0.62rem; font-weight:500;
  letter-spacing:2.5px; text-transform:uppercase;
  text-decoration:none; border:none; cursor:pointer;
  transition:all 0.35s var(--ease-out); display:inline-block; width:fit-content;
}
.btn-fill:hover { background:var(--accent); color:var(--white); transform:translateY(-3px); }

/* ── ACCORDION / REGIONS ────────────────────────────────────────────── */
details {
  background: var(--ink2); border: 1px solid rgba(var(--line-rgb),0.08);
  margin-bottom: 14px; overflow: hidden;
}
details[open] { border-color: rgba(var(--gold-rgb),0.5); }
summary {
  cursor: pointer; padding: 18px 22px; font-size: 15px; font-weight: 500;
  font-family: var(--f-display);
  list-style: none; display: flex; justify-content: space-between; align-items: center;
  color: var(--white);
}
summary::-webkit-details-marker { display: none; }
summary::after { content: '+'; font-size: 18px; color: var(--mist); margin-left: 12px; font-family: var(--f-body); }
details[open] > summary::after { content: '−'; }
.count {
  background: rgba(var(--gold-rgb),0.15); color: var(--gold2); font-size: 11px; font-weight: 600;
  font-family: var(--f-body); letter-spacing:0.5px;
  padding: 3px 11px; border-radius: 999px; margin-left: auto; margin-right: 8px;
}
ul { list-style: none; margin: 0; padding: 0 22px 18px; }
li {
  padding: 14px 0; border-top: 1px solid rgba(var(--line-rgb),0.08); font-size: 13.5px; line-height: 1.5;
  display: flex; flex-direction: column; gap: 4px;
}
li:first-child { border-top: none; }
a.item-link { color: var(--paper); text-decoration: none; font-weight: 400; }
a.item-link:hover { color: var(--gold2); }
.src { color: var(--mist); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; font-family: var(--f-body); }
.also-reported { color: var(--gold); font-weight: 600; margin-left: 6px; text-transform: none; letter-spacing: normal; }
.item-date { color: var(--mist); margin-left: 6px; }
.item-date::before { content: "· "; }
.item-actions { display: flex; align-items: center; gap: 16px; margin-top: 5px; }
.like-btn, .comments-toggle {
  display: inline-flex; align-items: center; gap: 4px; background: none; border: none;
  color: var(--mist); font-size: 12px; cursor: pointer; padding: 3px 8px; border-radius: 6px;
  font-family: var(--f-body);
}
.like-btn:hover, .comments-toggle:hover { background: rgba(var(--line-rgb),0.08); color: var(--paper); }
.like-btn.liked { color: var(--bad); }
.like-btn:disabled { cursor: default; }
.view-count { display: inline-flex; align-items: center; gap: 4px; color: var(--mist); font-size: 12px; font-family: var(--f-body); }
.comment-box {
  margin-top: 8px; padding: 14px 16px; background: var(--ink3); border-radius: 4px;
  border: 1px solid rgba(var(--line-rgb),0.08);
}
.comment-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 10px; }
.comment-item { border-bottom: 1px solid rgba(var(--line-rgb),0.08); padding-bottom: 8px; }
.comment-item:last-child { border-bottom: none; padding-bottom: 0; }
.comment-head { display: flex; justify-content: space-between; font-size: 11px; color: var(--mist); margin-bottom: 2px; font-family: var(--f-body); }
.comment-name { font-weight: 600; color: var(--paper); }
.comment-text { margin: 0; font-size: 13px; color: var(--sand); line-height: 1.4; }
.comment-empty { font-size: 12px; color: var(--mist); font-style: italic; margin: 0; }
.comment-form { display: flex; flex-direction: column; gap: 8px; }
.comment-form input, .comment-form textarea {
  font-family: var(--f-body); font-size: 13px; padding: 9px 11px; border: 1px solid rgba(var(--line-rgb),0.15);
  background: var(--ink2); color: var(--paper); border-radius: 4px;
}
.comment-form input::placeholder, .comment-form textarea::placeholder { color: var(--mist); }
.comment-form textarea { resize: vertical; min-height: 50px; }
.comment-form button {
  align-self: flex-end; background: var(--paper); color: var(--ink); border: none; padding: 8px 20px;
  font-size: 11px; font-weight: 600; letter-spacing:1px; text-transform:uppercase;
  cursor: pointer; font-family: var(--f-body); transition: all 0.3s;
}
.comment-form button:hover { background: var(--accent); color: var(--white); }
.comment-form button:disabled { opacity: 0.6; cursor: default; }
details.nested {
  border: none; background: transparent; margin: 0 18px 12px; border-left: 2px solid rgba(var(--line-rgb),0.12);
}
details.nested summary { padding: 12px 16px; font-size: 14px; font-weight: 500; font-family: var(--f-body); color: var(--sand); }
details.nested2 {
  border: none; background: rgba(var(--line-rgb),0.03); margin: 0 16px 10px 28px; border-left: 2px dotted rgba(var(--line-rgb),0.15);
}
details.nested2 summary { padding: 10px 14px; font-size: 13px; font-weight: 400; font-family: var(--f-body); color: var(--mist); }
.cf-turnstile-slot { margin: 2px 0; }
.turnstile-msg { margin: 0; font-size: 12px; color: var(--bad); }

/* ── FOOTER (identical to index.html/journal.html) ─────────────────── */
footer { background:var(--ink2); padding:64px 5% 28px; border-top:1px solid rgba(var(--line-rgb),0.06); }
.footer-top {
  display:grid; grid-template-columns:1.4fr 1fr 1fr 1fr; gap:40px;
  padding-bottom:50px; border-bottom:1px solid rgba(var(--line-rgb),0.06); margin-bottom:28px;
}
.footer-brand .fb-name {
  font-family:var(--f-display); font-size:1.5rem; font-weight:400;
  letter-spacing:5px; text-transform:uppercase; color:var(--paper);
  display:block; margin-bottom:6px;
}
.footer-brand .fb-rc { font-size:0.55rem; letter-spacing:2px; color:var(--gold); display:block; margin-bottom:18px; }
.footer-brand p { font-size:0.75rem; color:var(--mist); font-weight:200; line-height:1.8; max-width:240px; }
.footer-col h5 {
  font-family:var(--f-body); font-size:0.58rem; font-weight:500;
  letter-spacing:3px; text-transform:uppercase; color:var(--sand); margin-bottom:20px;
}
.footer-col a {
  display:block; font-size:0.72rem; color:var(--mist); font-weight:200;
  text-decoration:none; margin-bottom:10px; transition:color 0.3s; letter-spacing:0.3px;
}
.footer-col a:hover { color:var(--paper); }
.footer-bottom { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; }
.footer-copy { font-size:0.58rem; color:rgba(var(--mist-rgb),0.5); letter-spacing:1px; }
.footer-ig {
  display:inline-flex; align-items:center; gap:8px; margin-top:20px;
  font-size:0.68rem; font-weight:300; letter-spacing:1.5px;
  color:var(--mist); text-decoration:none; transition:color 0.3s;
}
.footer-ig svg { width:16px; height:16px; flex-shrink:0; }
.footer-ig:hover { color:var(--gold2); }

@media (max-width: 768px) {
  .nav-center .nav-wordmark { display:none; }
  .nav-right .nav-rc { display:none; }
  .digest-header { padding:140px 6% 32px; }
  .digest-body { padding: 0 6% 80px; }
  .cta-panel { padding: 26px 22px; }
  .cta-actions { width:100%; }
  .cta-actions .btn-fill { width:100%; text-align:center; }
  .footer-top { grid-template-columns:1fr 1fr; }
}
@media (max-width: 480px) {
  .footer-top { grid-template-columns:1fr; }
}
</style>${turnstileHead}
</head>
<body>

<!-- ── NAV ────────────────────────────────────────────────────────────── -->
<nav id="navbar">
  <div class="nav-left">
    <a href="portfolio">Portfolio</a>
    <a href="store">Store</a>
    <a href="journal" class="active">Journal</a>
  </div>
  <div class="nav-center">
    <div class="nav-logomark">A</div>
    <div class="nav-wordmark">
      <span class="w1">ADA</span>
      <span class="w2">Archilurdesignz</span>
    </div>
  </div>
  <div class="nav-right">
    <span class="nav-rc">RC: 9176834</span>
    <button class="theme-toggle" id="siteThemeToggle" onclick="toggleSiteTheme()" aria-label="Toggle day and night mode">☾</button>
    <a href="connect" class="nav-cta-btn">Enquire</a>
  </div>
</nav>

<!-- ── HEADER ─────────────────────────────────────────────────────────── -->
<header class="digest-header">
  <a class="back-crumb" href="journal">← ADA Journal</a>
  <div class="eyebrow">ADA Journal · News</div>
  <h1 class="digest-title">Architecture Digest</h1>
  <p class="digest-tagline">Architecture, construction, and property news from Nigeria, Africa, and around the world — sorted by region and topic, covering the last 3 days, refreshed several times a day by Archilurdesignz and Architecture.</p>
  <div class="digest-meta">Updated ${dateLabel} · ${timeLabel} · ${counts.total} stories from the last 3 days</div>
</header>

<!-- ── DIGEST BODY ────────────────────────────────────────────────────── -->
<div class="digest-body">
  <div class="subscribe-box">
    <div class="subscribe-title">Get this digest by email</div>
    <p class="subscribe-copy">Subscribe once, and every future digest lands straight in your inbox.</p>
    <form class="subscribe-form">
      <input type="email" class="subscribe-email" placeholder="you@email.com" maxlength="254" required>
      <button type="submit">Subscribe</button>
    </form>
    <p class="subscribe-msg" hidden></p>
  </div>
  ${sections || '<p style="color:var(--mist);">No new stories this run.</p>'}
  <div class="cta-panel">
    <div class="cta-copy">
      <span class="eyebrow" style="margin-bottom:0;">Archilurdesignz and Architecture</span>
      <p>This digest is brought to you by ADA — a Nigerian architectural practice designing bespoke residential, commercial, and hospitality spaces across Lagos, Abuja, and Port Harcourt.</p>
    </div>
    <div class="cta-actions">
      <a href="portfolio" class="btn-fill">View Our Portfolio →</a>
      <a href="connect" class="cta-link">Start a Project →</a>
    </div>
  </div>
</div>

<!-- ── FOOTER ─────────────────────────────────────────────────────────── -->
<footer>
  <div class="footer-top">
    <div class="footer-brand">
      <span class="fb-name">ADA</span>
      <span class="fb-rc">RC: 9176834</span>
      <p>Archilurdesignz and Architecture — crafting bespoke luxury spaces across Lagos, Abuja, and Port Harcourt to clients across Nigeria and beyond since 2012.</p>
      <a href="https://www.instagram.com/archilurdesignz?igsh=YzEwaHVyNzY0aTZv"
         target="_blank" rel="noopener noreferrer" class="footer-ig">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
          <circle cx="12" cy="12" r="4"/>
          <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none"/>
        </svg>
        <span>@archilurdesignz</span>
      </a>
    </div>
    <div class="footer-col">
      <h5>Company</h5>
      <a href="about">About Us</a>
      <a href="portfolio">Portfolio</a>
      <a href="connect">Contact</a>
      <a href="journal">Journal</a>
    </div>
    <div class="footer-col">
      <h5>Services</h5>
      <a href="#">Architecture</a>
      <a href="#">3D Visualization</a>
      <a href="#">Engineering</a>
      <a href="#">Quantity Surveying</a>
    </div>
    <div class="footer-col">
      <h5>Plans Store</h5>
      <a href="store">Browse Plans</a>
      <a href="policy">Privacy Policy</a>
      <a href="faq">FAQs</a>
    </div>
  </div>
  <div class="footer-bottom">
    <p class="footer-copy">© 2026 Archilurdesignz and Architecture. All rights reserved.</p>
    <p class="footer-copy">contactus@archilurdesignz.com</p>
  </div>
</footer>

  <script>
  /* ── THEME TOGGLE (same mechanism as index.html/journal.html) ────────── */
  function syncSiteThemeToggleIcon(theme) {
    var btn = document.getElementById('siteThemeToggle');
    if (!btn) return;
    btn.textContent = theme === 'light' ? '☀' : '☾';
    btn.setAttribute('aria-label', theme === 'light' ? 'Switch to night mode' : 'Switch to day mode');
  }
  function toggleSiteTheme() {
    var root = document.documentElement;
    var current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    var next = current === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('ada-site-theme', next); } catch (e) {}
    syncSiteThemeToggleIcon(next);
  }
  syncSiteThemeToggleIcon(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  </script>
  <script>
  (function () {
    var API = '/api/digest-interactions';
    var NEWSLETTER_API = '/api/newsletter-subscribe';
    var LIKED_KEY = 'ada_digest_liked_urls';
    var VIEWED_KEY = 'ada_digest_viewed_urls';

    function getStoredSet(key) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? new Set(JSON.parse(raw)) : new Set();
      } catch (e) {
        return new Set();
      }
    }
    function saveStoredSet(key, set) {
      try {
        localStorage.setItem(key, JSON.stringify(Array.from(set)));
      } catch (e) {}
    }
    function getLikedSet() { return getStoredSet(LIKED_KEY); }
    function saveLikedSet(set) { saveStoredSet(LIKED_KEY, set); }
    function getViewedSet() { return getStoredSet(VIEWED_KEY); }
    function saveViewedSet(set) { saveStoredSet(VIEWED_KEY, set); }
    function formatDate(iso) {
      try {
        return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      } catch (e) {
        return '';
      }
    }
    function renderComment(list, c) {
      var item = document.createElement('div');
      item.className = 'comment-item';
      var head = document.createElement('div');
      head.className = 'comment-head';
      var name = document.createElement('span');
      name.className = 'comment-name';
      name.textContent = c.name || 'Anonymous';
      var date = document.createElement('span');
      date.className = 'comment-date';
      date.textContent = formatDate(c.created_at);
      head.appendChild(name);
      head.appendChild(date);
      var text = document.createElement('p');
      text.className = 'comment-text';
      text.textContent = c.comment || '';
      item.appendChild(head);
      item.appendChild(text);
      list.prepend(item);
    }

    document.addEventListener('DOMContentLoaded', function () {
      var items = Array.prototype.slice.call(document.querySelectorAll('li[data-url]'));
      var urls = items.map(function (li) { return li.getAttribute('data-url'); });
      if (urls.length === 0) return;

      var liked = getLikedSet();
      items.forEach(function (li) {
        var url = li.getAttribute('data-url');
        if (liked.has(url)) {
          var btn = li.querySelector('.like-btn');
          if (btn) {
            btn.classList.add('liked');
            btn.disabled = true;
            var icon = btn.querySelector('.like-icon');
            if (icon) icon.textContent = '♥';
          }
        }
      });

      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stats', urls: urls }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var stats = data.stats || {};
          items.forEach(function (li) {
            var url = li.getAttribute('data-url');
            var s = stats[url] || { likes: 0, views: 0, comments: 0 };
            var likeCount = li.querySelector('.like-count');
            var viewNum = li.querySelector('.view-num');
            var commentCount = li.querySelector('.comment-count');
            if (likeCount) likeCount.textContent = s.likes;
            if (viewNum) viewNum.textContent = s.views;
            if (commentCount) commentCount.textContent = s.comments;
          });
        })
        .catch(function () {});
    });

    function ensureTurnstileReady(cb) {
      if (window.__turnstileReady && window.turnstile) {
        cb();
      } else {
        window.__turnstileQueue = window.__turnstileQueue || [];
        window.__turnstileQueue.push(cb);
      }
    }

    function renderTurnstileForBox(box) {
      if (!window.__TURNSTILE_SITE_KEY__) return; // not configured — form works without verification
      var slot = box.querySelector('.cf-turnstile-slot');
      if (!slot || slot.getAttribute('data-rendered')) return;
      slot.setAttribute('data-rendered', '1');
      ensureTurnstileReady(function () {
        var widgetId = turnstile.render(slot, {
          sitekey: window.__TURNSTILE_SITE_KEY__,
          callback: function (token) { box.setAttribute('data-turnstile-token', token); },
          'expired-callback': function () { box.removeAttribute('data-turnstile-token'); },
          'error-callback': function () { box.removeAttribute('data-turnstile-token'); },
        });
        slot.setAttribute('data-widget-id', widgetId);
      });
    }

    document.addEventListener('click', function (e) {
      var likeBtn = e.target.closest('.like-btn');
      if (likeBtn) {
        if (likeBtn.disabled) return;
        var likeLi = likeBtn.closest('li[data-url]');
        var likeUrl = likeLi.getAttribute('data-url');
        likeBtn.disabled = true;
        fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'like', url: likeUrl }),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var countEl = likeBtn.querySelector('.like-count');
            if (countEl && typeof data.likes === 'number') countEl.textContent = data.likes;
            likeBtn.classList.add('liked');
            var iconEl = likeBtn.querySelector('.like-icon');
            if (iconEl) iconEl.textContent = '♥';
            var liked = getLikedSet();
            liked.add(likeUrl);
            saveLikedSet(liked);
          })
          .catch(function () { likeBtn.disabled = false; });
        return;
      }

      var link = e.target.closest('.item-link');
      if (link) {
        var linkLi = link.closest('li[data-url]');
        var linkUrl = linkLi ? linkLi.getAttribute('data-url') : null;
        if (linkUrl) {
          var viewed = getViewedSet();
          if (!viewed.has(linkUrl)) {
            try {
              fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'view', url: linkUrl }),
                keepalive: true,
              }).catch(function () {});
            } catch (e2) {}
            viewed.add(linkUrl);
            saveViewedSet(viewed);
            var viewNumEl = linkLi.querySelector('.view-num');
            if (viewNumEl) viewNumEl.textContent = (parseInt(viewNumEl.textContent, 10) || 0) + 1;
          }
        }
        return;
      }

      var toggle = e.target.closest('.comments-toggle');
      if (toggle) {
        var toggleLi = toggle.closest('li[data-url]');
        var toggleUrl = toggleLi.getAttribute('data-url');
        var box = toggleLi.querySelector('.comment-box');
        var opening = box.hasAttribute('hidden');
        if (opening) {
          box.removeAttribute('hidden');
        } else {
          box.setAttribute('hidden', '');
        }
        if (opening) {
          renderTurnstileForBox(box);
        }
        if (opening && !box.getAttribute('data-loaded')) {
          var list = box.querySelector('.comment-list');
          list.textContent = 'Loading…';
          fetch(API + '?action=comments&url=' + encodeURIComponent(toggleUrl))
            .then(function (r) { return r.json(); })
            .then(function (data) {
              list.textContent = '';
              var comments = data.comments || [];
              if (comments.length === 0) {
                var empty = document.createElement('p');
                empty.className = 'comment-empty';
                empty.textContent = 'No comments yet — be the first.';
                list.appendChild(empty);
              } else {
                comments.slice().reverse().forEach(function (c) { renderComment(list, c); });
              }
              box.setAttribute('data-loaded', '1');
            })
            .catch(function () { list.textContent = 'Could not load comments.'; });
        }
        return;
      }
    });

    document.addEventListener('submit', function (e) {
      var subscribeForm = e.target.closest('.subscribe-form');
      if (subscribeForm) {
        e.preventDefault();
        var emailInput = subscribeForm.querySelector('.subscribe-email');
        var msgEl = subscribeForm.parentElement.querySelector('.subscribe-msg');
        var email = emailInput.value.trim();
        var subBtn = subscribeForm.querySelector('button[type="submit"]');
        subBtn.disabled = true;
        fetch(NEWSLETTER_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'subscribe', email: email }),
        })
          .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
          .then(function (result) {
            if (result.ok && result.data.success) {
              msgEl.textContent = "Subscribed! You'll get the next digest by email.";
              msgEl.className = 'subscribe-msg success';
              emailInput.value = '';
            } else {
              msgEl.textContent = (result.data && result.data.error) || 'Something went wrong — please try again.';
              msgEl.className = 'subscribe-msg error';
            }
            msgEl.removeAttribute('hidden');
          })
          .catch(function () {
            msgEl.textContent = 'Something went wrong — please try again.';
            msgEl.className = 'subscribe-msg error';
            msgEl.removeAttribute('hidden');
          })
          .finally(function () { subBtn.disabled = false; });
        return;
      }

      var form = e.target.closest('.comment-form');
      if (!form) return;
      e.preventDefault();
      var box = form.closest('.comment-box');
      var li = form.closest('li[data-url]');
      var url = li.getAttribute('data-url');
      var nameInput = form.querySelector('.comment-name');
      var textInput = form.querySelector('.comment-text');
      var msgEl = form.querySelector('.turnstile-msg');
      var text = textInput.value.trim();
      if (!text) return;

      var turnstileToken = box.getAttribute('data-turnstile-token') || '';
      if (window.__TURNSTILE_SITE_KEY__ && !turnstileToken) {
        if (msgEl) { msgEl.textContent = 'Please complete the verification above.'; msgEl.removeAttribute('hidden'); }
        return;
      }
      if (msgEl) msgEl.setAttribute('hidden', '');

      var submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'comment', url: url, name: nameInput.value.trim(), comment: text,
          turnstileToken: turnstileToken,
        }),
      })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (result) {
          var data = result.data;
          if (result.ok && data.comment) {
            var list = box.querySelector('.comment-list');
            var emptyMsg = list.querySelector('.comment-empty');
            if (emptyMsg) emptyMsg.remove();
            renderComment(list, data.comment);
            textInput.value = '';
            var countEl = li.querySelector('.comment-count');
            if (countEl) countEl.textContent = (parseInt(countEl.textContent, 10) || 0) + 1;
            var slot = box.querySelector('.cf-turnstile-slot');
            var widgetId = slot ? slot.getAttribute('data-widget-id') : null;
            if (widgetId && window.turnstile) turnstile.reset(widgetId);
            box.removeAttribute('data-turnstile-token');
          } else if (msgEl) {
            msgEl.textContent = data.error === 'verification_failed'
              ? 'Verification failed — please try again.'
              : 'Could not post your comment — please try again.';
            msgEl.removeAttribute('hidden');
            var slot2 = box.querySelector('.cf-turnstile-slot');
            var widgetId2 = slot2 ? slot2.getAttribute('data-widget-id') : null;
            if (widgetId2 && window.turnstile) turnstile.reset(widgetId2);
            box.removeAttribute('data-turnstile-token');
          }
        })
        .catch(function () {})
        .finally(function () { submitBtn.disabled = false; });
    });
  })();
  </script>
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

function buildNotificationEmailHtml_(counts, { dateLabel, timeLabel, digestUrl, unsubscribeUrl }) {
  const shareText = encodeURIComponent(
    `📐 ADA Architecture Digest — ${dateLabel} · ${timeLabel}\n` +
      `${counts.total} new stories: 🇳🇬 Nigeria (${counts.nigeria.total}), ` +
      `🌍 Africa (${counts.africa.total}), 🌐 Globe (${counts.global.total})\n\n${digestUrl}`
  );
  const whatsappShareUrl = `https://wa.me/?text=${shareText}`;
  const unsubscribeHtml = unsubscribeUrl
    ? `<div style="font-size:11px;color:#a3a3a3;margin-top:6px;"><a href="${unsubscribeUrl}" style="color:#a3a3a3;">Unsubscribe</a> from this digest</div>`
    : '';

  return `
  <div style="max-width:480px;margin:0 auto;font-family:sans-serif;text-align:center;padding:32px 20px;">
    <h1 style="font-family:'Georgia',serif;font-size:20px;color:#1a1a1a;margin-bottom:4px;">Your Architecture Digest is ready</h1>
    <div style="font-size:13px;color:#8a8378;margin-bottom:24px;">${dateLabel} · ${timeLabel}</div>
    <div style="font-size:14px;color:#4a4a4a;line-height:2;text-align:left;background:#f7f5f0;border-radius:10px;padding:18px 22px;margin-bottom:24px;">
      🇳🇬 Nigeria — <b>${counts.nigeria.total}</b><br>
      🌍 Africa — <b>${counts.africa.total}</b><br>
      🌐 Globe — <b>${counts.global.total}</b>
    </div>
    <a href="${digestUrl}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:13px 32px;border-radius:8px;font-size:14px;font-weight:600;margin-bottom:14px;">View Digest</a>
    <br>
    <a href="${whatsappShareUrl}" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;padding:13px 32px;border-radius:8px;font-size:14px;font-weight:600;margin-top:6px;">Share to WhatsApp</a>
    <div style="font-size:11px;color:#a3a3a3;margin-top:28px;">Sent automatically for Archilurdesignz and Architecture.</div>
    ${unsubscribeHtml}
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
    const merged = mergeAndDedupe([...rssItems, ...scrapedItems], newsApiItems);

    // Cross-run "already shown" filter — covers every source now, not just
    // the scraped ones. Deliberately filtered here (before publish) but
    // only MARKED as seen after publish succeeds below — if the GitHub
    // publish step fails, these stories haven't actually appeared
    // anywhere yet, so a retry should still be able to show them, not
    // silently treat them as already-covered.
    const unseenUrls = await getUnseenUrls_(merged.map((item) => item.url));
    const unseenUrlSet = new Set(unseenUrls);
    const items = merged.filter((item) => unseenUrlSet.has(item.url));

    // counts/taxonomy here are FRESH-ONLY (just this run's new items) —
    // used for the email's "N new stories" breakdown, which should
    // reflect what's actually new since last time, not the whole 3-day
    // archive.
    const taxonomy = buildTaxonomy_(items);
    const counts = taxonomyCounts_(taxonomy);

    const now = new Date();
    const dateLabel = now.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Lagos',
    });
    const timeLabel = now.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos',
    });
    const digestUrl = process.env.DIGEST_PAGE_URL || 'https://archilurdesignz.com/digest';

    // The PUBLISHED PAGE is the rolling 3-day archive, not just this
    // run's fresh items — archive first, prune anything that's aged out,
    // then rebuild the page from everything currently in the window.
    await archiveNewsItems_(items);
    await pruneOldArchivedNews_();
    const archivedItems = await getArchivedNews_();
    const newsTaxonomy = buildTaxonomy_(archivedItems, MAX_ITEMS_PER_CATEGORY_NEWS_PAGE);
    const newsCounts = taxonomyCounts_(newsTaxonomy);

    const pageHtml = buildDigestPageHtml_(newsTaxonomy, newsCounts, { dateLabel, timeLabel, digestUrl });
    await publishDigestToGitHub_(pageHtml);

    // Only now that publish has actually succeeded — mark these URLs so
    // they won't resurface in a future run.
    await markUrlsSeen_(items.map((item) => item.url));

    // Build the full recipient list: the owner's own address (no
    // unsubscribe link — that's your personal inbox, not a subscription)
    // plus everyone who's signed up via the digest page's subscribe form,
    // each with their own personalized unsubscribe link.
    const subscribers = await getNewsletterSubscribers_();
    const recipients = [];
    if (process.env.DIGEST_TO_EMAIL) {
      recipients.push({ email: process.env.DIGEST_TO_EMAIL, unsubscribeUrl: null });
    }
    const siteOrigin = new URL(digestUrl).origin;
    for (const sub of subscribers) {
      const unsubscribeUrl = `${siteOrigin}/api/newsletter-subscribe?action=unsubscribe&token=${encodeURIComponent(sub.unsubscribe_token)}`;
      recipients.push({ email: sub.email, unsubscribeUrl });
    }

    const subject = `Architecture Digest ready — ${counts.total} new stor${counts.total === 1 ? 'y' : 'ies'}`;
    let sentCount = 0;
    let failedCount = 0;

    if (recipients.length > 0) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      // Resend's batch endpoint sends up to 100 personalized emails per
      // call — chunk the recipient list so subscriber counts beyond 100
      // don't hit that limit.
      for (const batch of chunk_(recipients, 100)) {
        const emails = batch.map((r) => ({
          from: process.env.DIGEST_FROM_EMAIL,
          to: r.email,
          subject,
          html: buildNotificationEmailHtml_(counts, { dateLabel, timeLabel, digestUrl, unsubscribeUrl: r.unsubscribeUrl }),
        }));
        const { data, error } = await resend.batch.send(emails);
        if (error) {
          console.error('Resend batch send error:', error);
          // The batch endpoint rejects the ENTIRE call if even one
          // recipient fails validation (e.g. a placeholder domain like
          // example.com that slipped past signup validation) — which
          // means one bad address would otherwise cost everyone in the
          // batch their digest, including your own copy. Falling back to
          // sending this batch one-by-one isolates the failure to just
          // the actually-bad address.
          for (const recipient of batch) {
            try {
              const single = await resend.emails.send({
                from: process.env.DIGEST_FROM_EMAIL,
                to: recipient.email,
                subject,
                html: buildNotificationEmailHtml_(counts, { dateLabel, timeLabel, digestUrl, unsubscribeUrl: recipient.unsubscribeUrl }),
              });
              if (single.error) {
                console.error(`Resend send failed for ${recipient.email}:`, single.error);
                failedCount += 1;
              } else {
                sentCount += 1;
              }
            } catch (singleErr) {
              console.error(`Resend send threw for ${recipient.email}:`, singleErr.message);
              failedCount += 1;
            }
          }
        } else {
          sentCount += (data || []).length;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      counts,
      newsPageTotal: newsCounts.total,
      digestUrl,
      emailsSent: sentCount,
      emailsFailed: failedCount,
      subscriberCount: subscribers.length,
    });
  } catch (err) {
    console.error('Digest handler error:', err);
    return res.status(500).json({ error: 'Digest generation failed', details: err.message });
  }
}
