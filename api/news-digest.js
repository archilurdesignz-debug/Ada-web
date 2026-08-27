// /api/news-digest.js
// Fetches recent architecture news from RSS feeds + NewsAPI,
// merges + dedupes them, and emails a digest via Resend.
//
// Triggered daily by Vercel Cron (see vercel.json).
// Can also be hit manually: GET /api/news-digest?manual=1

import Parser from 'rss-parser';
import { Resend } from 'resend';

const parser = new Parser({
  timeout: 8000,
  headers: { 'User-Agent': 'Mozilla/5.0 (ADA News Digest Bot)' },
});

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
  { name: 'ARCON', url: 'https://arconigeria.gov.ng/feed/', region: 'nigeria' },
  { name: 'ARCON Announcements', url: 'https://arconigeria.gov.ng/announcements/feed/', region: 'nigeria' },
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

const MAX_ITEMS_PER_SECTION = 15;
const MAX_AGE_HOURS = 30; // widen slightly beyond 24h to tolerate cron drift / slow feeds

// --- Helpers ----------------------------------------------------------------

function isRecent(dateStr) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  const hoursAgo = (Date.now() - date.getTime()) / (1000 * 60 * 60);
  return hoursAgo <= MAX_AGE_HOURS;
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
  const all = [...rssItems, ...newsApiItems].filter(
    (item) => item.title && item.url && isRecent(item.publishedAt)
  );

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

    const { africa, global } = mergeAndDedupe(rssItems, newsApiItems);
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
