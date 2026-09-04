// /api/digest-interactions.js
// Backs the like / view / comment UI embedded in the published digest
// page (digest.html). Public, unauthenticated endpoint — every read and
// write is scoped to a single `url` value, which is already public on
// the digest page itself, so there's nothing sensitive exposed here.
//
// There is no rate-limiting or spam protection beyond basic length
// caps — this is fine for a small firm's digest traffic, but if abuse
// becomes an issue later, the next step would be something like
// Cloudflare Turnstile on the comment form.
//
// Requires the same SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars
// already configured for the digest_seen_articles table, plus a
// one-time SQL setup — see the README.

import { createClient } from '@supabase/supabase-js';

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

const MAX_URLS_PER_REQUEST = 300;
const MAX_NAME_LENGTH = 60;
const MAX_COMMENT_LENGTH = 500;
const MAX_COMMENTS_RETURNED = 200;
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';

function setCors_(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function isValidUrl_(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2000) return false;
  try {
    // eslint-disable-next-line no-new
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Verifies a Turnstile token with Cloudflare's siteverify endpoint. Only
// runs when TURNSTILE_SECRET_KEY is configured — if you haven't set up
// Turnstile yet, comments post without this check (matches the client,
// which doesn't render a widget either when the site key is unset).
async function verifyTurnstile_(token, remoteIp) {
  if (!TURNSTILE_SECRET_KEY) return true;
  if (typeof token !== 'string' || token.length === 0) return false;

  const body = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.success === true;
}

// --- Bulk stats (likes + views + comment count) for every item on the page ---
async function handleStats_(req, res) {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls.filter(isValidUrl_) : [];
  if (urls.length === 0) return res.status(200).json({ stats: {} });
  if (urls.length > MAX_URLS_PER_REQUEST) {
    return res.status(400).json({ error: `Too many urls (max ${MAX_URLS_PER_REQUEST})` });
  }

  const [statsRes, commentsRes] = await Promise.all([
    supabase.from('digest_item_stats').select('url, likes, views').in('url', urls),
    supabase.from('digest_item_comments').select('url').in('url', urls),
  ]);
  if (statsRes.error) throw statsRes.error;
  if (commentsRes.error) throw commentsRes.error;

  const commentCounts = {};
  for (const row of commentsRes.data || []) {
    commentCounts[row.url] = (commentCounts[row.url] || 0) + 1;
  }

  const stats = {};
  for (const url of urls) {
    stats[url] = { likes: 0, views: 0, comments: commentCounts[url] || 0 };
  }
  for (const row of statsRes.data || []) {
    stats[row.url] = {
      likes: row.likes || 0,
      views: row.views || 0,
      comments: commentCounts[row.url] || 0,
    };
  }

  return res.status(200).json({ stats });
}

// --- Like / view increments (atomic via a Postgres function — see README SQL) ---
async function handleIncrement_(req, res, column) {
  const { url } = req.body || {};
  if (!isValidUrl_(url)) return res.status(400).json({ error: 'Invalid url' });

  const { data, error } = await supabase.rpc('increment_digest_stat', {
    p_url: url,
    p_column: column,
  });
  if (error) throw error;
  return res.status(200).json({ [column]: data });
}

// --- Comments ---
async function handleGetComments_(req, res) {
  const url = req.query?.url;
  if (!isValidUrl_(url)) return res.status(400).json({ error: 'Invalid url' });

  const { data, error } = await supabase
    .from('digest_item_comments')
    .select('name, comment, created_at')
    .eq('url', url)
    .order('created_at', { ascending: false })
    .limit(MAX_COMMENTS_RETURNED);
  if (error) throw error;

  return res.status(200).json({ comments: data || [] });
}

async function handlePostComment_(req, res) {
  const { url, name, comment, turnstileToken } = req.body || {};
  if (!isValidUrl_(url)) return res.status(400).json({ error: 'Invalid url' });
  if (typeof comment !== 'string' || comment.trim().length === 0) {
    return res.status(400).json({ error: 'Comment text is required' });
  }
  if (comment.length > MAX_COMMENT_LENGTH) {
    return res.status(400).json({ error: `Comment too long (max ${MAX_COMMENT_LENGTH} chars)` });
  }

  const remoteIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined;
  const verified = await verifyTurnstile_(turnstileToken, remoteIp);
  if (!verified) {
    return res.status(400).json({ error: 'verification_failed' });
  }

  const cleanName =
    (typeof name === 'string' ? name : '').trim().slice(0, MAX_NAME_LENGTH) || 'Anonymous';

  const { data, error } = await supabase
    .from('digest_item_comments')
    .insert({ url, name: cleanName, comment: comment.trim() })
    .select('name, comment, created_at')
    .single();
  if (error) throw error;

  return res.status(200).json({ comment: data });
}

export default async function handler(req, res) {
  setCors_(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    if (req.method === 'POST' && req.body?.action === 'stats') return await handleStats_(req, res);
    if (req.method === 'POST' && req.body?.action === 'like') return await handleIncrement_(req, res, 'likes');
    if (req.method === 'POST' && req.body?.action === 'view') return await handleIncrement_(req, res, 'views');
    if (req.method === 'POST' && req.body?.action === 'comment') return await handlePostComment_(req, res);
    if (req.method === 'GET' && req.query?.action === 'comments') return await handleGetComments_(req, res);

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('digest-interactions error:', err);
    return res.status(500).json({ error: 'Request failed', details: err.message });
  }
}
