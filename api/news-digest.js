// /api/news-digest.js
// Fetches recent architecture news from RSS feeds + NewsAPI,
// merges + dedupes them, and emails a digest via Resend.
//
// Triggered daily by Vercel Cron (see vercel.json).
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
// Sources are tagged with a region so you can filter/style the digest by it if you want later.
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
  // Google News RSS needs no API key and aggregates across dozens of outlets —
  // this tends to surface far more Nigerian coverage day-to-day than the
  // smaller institutional feeds above manage on their own.
  { name: 'Google News (Nigeria architecture)', url: 'https://news.google.com/rss/search?q=architecture%20Nigeria%20when:2d&hl=en-NG&gl=NG&ceid=NG:en', region: 'nigeria' },
  { name: 'Google News (Africa architecture)', url: 'https://news.google.com/rss/search?q=architecture%20Africa%20when:2d&hl=en-NG&gl=NG&ceid=NG:en', region: 'africa' },
  // Broader/higher-volume sources — safe to add now that LOCAL_TOPIC_KEYWORDS
  // filters out anything that isn't actually about architecture/building/urban topics.
  { name: 'AllAfrica (Construction)', url: 'https://allafrica.com/tools/headlines/rdf/construction/headlines.rdf', region: 'africa' },
  { name: 'AllAfrica (Nigeria)', url: 'https://allafrica.com/tools/headlines/rdf/nigeria/headlines.rdf', region: 'nigeria' },
  { name: 'ConstructAfrica', url: 'https://constructafrica.com/rss-feed', region: 'africa' },
  { name: 'Guardian Nigeria (Property)', url: 'https://guardian.ng/category/property/feed/', region: 'nigeria' },
  { name: 'BusinessDay Nigeria', url: 'https://businessday.ng/feed/', region: 'nigeria' },
  { name: 'Nairametrics', url: 'https://nairametrics.com/feed/', region: 'nigeria' },
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
//
// NIA and ARCON are WordPress sites, so their /feed/ and /category/*/feed/
// URLs *should* work — but both sites block automated crawling, so we can't
// pre-verify the exact feed path resolves. Rather than wait to find out in
// production, each of these has a scrape fallback: if its RSS attempt above
// comes back with zero items, we fetch the actual news page HTML and pull
// article titles/links directly out of the markup instead.
//
// These listing pages don't expose a reliable publish date, so scraped
// items skip the normal recency filter — instead we track which URLs have
// already been sent in a Supabase table, so the same headline doesn't keep
// reappearing every day just because it's still at the top of the page.
const SCRAPE_FALLBACKS = [
  {
    // Matches any RSS_FEEDS entries whose `name` starts with this prefix —
    // if none of them yielded items, this scrape fallback kicks in.
    sourcePrefix: 'NIA',
    name: 'NIA (scraped)',
    url: 'https://www.nia.ng/news/',
    region: 'nigeria',
  },
  {
    sourcePrefix: 'ARCON',
    name: 'ARCON (scraped)',
    url: 'https://arconigeria.gov.ng/news-journals/',
    region: 'nigeria',
  },
];

// Common WordPress/Elementor title-link patterns, tried in order. The first
// selector that yields at least 3 matches is used. If the site's theme
// changes, this may need a new selector added — see README.
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
    return urls; // fail open — better a possible repeat than a silently empty section
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
    if (alreadyHasItems) continue; // RSS worked for this source, no fallback needed

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
          // No reliable date from a listing page — treat as fresh now and
          // rely on the Supabase "seen" table (not the age filter) to stop
          // repeats.
          publishedAt: new Date().toISOString(),
          summary: '',
        }))
      );

      // Mark these seen now, before send — if the email fails downstream,
      // we'd rather skip a repeat than spam a duplicate on the retry.
      await markScrapedUrlsSeen_(unseen.map((s) => s.url));
    } catch (err) {
      console.error(`Scrape fallback failed for ${fallback.name}:`, err.message);
    }
  }
  return results;
}

const MAX_ITEMS_PER_SECTION = 15;
const MAX_AGE_HOURS_GLOBAL = 30; // widen slightly beyond 24h to tolerate cron drift / slow feeds
const MAX_AGE_HOURS_LOCAL = 96; // Nigeria/Africa sources post far less often, so a 30h window
                                 // often leaves that section empty — widen to ~4 days instead.

// The global sources (ArchDaily, Dezeen, etc.) are dedicated architecture
// outlets end-to-end, so everything they publish is already on-topic.
// The Nigeria/Africa sources are broader (general Africa news tags, a
// property section, Google News) and pull in off-topic items — so those
// get filtered down to ones that actually mention architecture/building
// topics before they're included.
const LOCAL_TOPIC_KEYWORDS = [
  'architect',
  'architecture',
  'building',
  'urban',
  'construction',
  'design competition',
  'design',
  'professional exam',
  'development',
  'developer',
  'ARCON',
  'NIA', // Nigerian Institute of Architects
];

function matchesLocalTopic_(item) {
  const haystack = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
  return LOCAL_TOPIC_KEYWORDS.some((kw) => haystack.includes(kw.toLowerCase()));
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

function mergeAndDedupe(rssItems, newsApiItems) {
  const all = [...rssItems, ...newsApiItems].filter((item) => {
    if (!item.title || !item.url) return false;
    const isLocal = item.region === 'africa' || item.region === 'nigeria';
    if (!isRecent(item.publishedAt, isLocal ? MAX_AGE_HOURS_LOCAL : MAX_AGE_HOURS_GLOBAL)) {
      return false;
    }
    // Global sources are dedicated architecture outlets already — no
    // extra filtering needed. Local sources are broader, so only keep
    // items that actually mention an architecture/building topic.
    if (isLocal && !matchesLocalTopic_(item)) {
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

  deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  // Split into Nigeria/Africa vs. global so local stories get their own
  // section instead of being buried under higher-volume global sources.
  const africa = deduped.filter((i) => i.region === 'africa' || i.region === 'nigeria');
  const global = deduped.filter((i) => i.region === 'global');

  return {
    africa: africa.slice(0, MAX_ITEMS_PER_SECTION),
    global: global.slice(0, MAX_ITEMS_PER_SECTION),
  };
}

function buildItemRows(items) {
  return items
    .map(
      (item) => `
      <tr>
        <td style="padding:16px 0;border-bottom:1px solid #e5e0d8;">
          <div style="font-family:'Georgia',serif;font-size:17px;color:#1a1a1a;margin-bottom:4px;">
            <a href="${item.url}" style="color:#1a1a1a;text-decoration:none;">${escapeHtml(
        item.title
      )}</a>
          </div>
          <div style="font-family:sans-serif;font-size:12px;color:#8a8378;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">
            ${escapeHtml(item.source)}
          </div>
          ${
            item.summary
              ? `<div style="font-family:sans-serif;font-size:14px;color:#4a4a4a;line-height:1.5;">${escapeHtml(
                  item.summary
                )}...</div>`
              : ''
          }
        </td>
      </tr>`
    )
    .join('');
}

function buildSection(title, items) {
  if (!items.length) return '';
  return `
    <div style="margin-top:28px;">
      <h2 style="font-family:'Georgia',serif;font-size:15px;text-transform:uppercase;letter-spacing:0.08em;color:#8a6d3b;border-bottom:1px solid #e5e0d8;padding-bottom:8px;">
        ${escapeHtml(title)}
      </h2>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${buildItemRows(items)}
      </table>
    </div>`;
}

function buildEmailHtml({ africa, global }) {
  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const sections =
    buildSection('Nigeria & Africa', africa) + buildSection('Global', global);

  return `
  <div style="max-width:600px;margin:0 auto;font-family:sans-serif;">
    <div style="padding:24px 0;border-bottom:2px solid #1a1a1a;">
      <h1 style="font-family:'Georgia',serif;font-size:22px;margin:0;color:#1a1a1a;">Architecture Digest</h1>
      <div style="font-size:13px;color:#8a8378;margin-top:4px;">${dateLabel}</div>
    </div>
    ${sections || '<div style="padding:24px 0;">No new articles in the last day.</div>'}
    <div style="padding:20px 0;font-size:12px;color:#a3a3a3;">
      Sent automatically for Archilurdesignz and Architecture.
    </div>
  </div>`;
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Handler ----------------------------------------------------------------

export default async function handler(req, res) {
  // Basic protection: only Vercel Cron or a manual request with the secret can trigger this
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

    const { africa, global } = mergeAndDedupe([...rssItems, ...scrapedItems], newsApiItems);
    const totalCount = africa.length + global.length;
    const html = buildEmailHtml({ africa, global });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: process.env.DIGEST_FROM_EMAIL, // e.g. 'ADA Digest <digest@archilurdesignz.com>'
      to: process.env.DIGEST_TO_EMAIL, // your inbox
      subject: `Architecture News Digest — ${totalCount} new article${
        totalCount === 1 ? '' : 's'
      } (${africa.length} Nigeria/Africa)`,
      html,
    });

    if (error) {
      console.error('Resend send error:', error);
      return res.status(500).json({ error: 'Email send failed', details: error });
    }

    return res.status(200).json({
      ok: true,
      totalCount,
      africaCount: africa.length,
      globalCount: global.length,
      emailId: data?.id,
    });
  } catch (err) {
    console.error('Digest handler error:', err);
    return res.status(500).json({ error: 'Digest generation failed', details: err.message });
  }
};
