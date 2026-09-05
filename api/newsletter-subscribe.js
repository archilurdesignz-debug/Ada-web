// /api/newsletter-subscribe.js
// Backs the "subscribe to this digest by email" form on the digest page.
// Two things happen here:
//   - POST {action:'subscribe', email} — adds an email to digest_subscribers.
//     Called via fetch from the page's subscribe form.
//   - GET ?action=unsubscribe&token=... — removes a subscriber by their
//     unique token. This is a plain link (not a fetch call), meant to be
//     clicked directly from an email client, so it returns a small HTML
//     confirmation page rather than JSON.
//
// Public, unauthenticated endpoint — same reasoning as
// api/digest-interactions.js: nothing sensitive is exposed by letting
// anyone submit an email address to a list, and unsubscribe tokens are
// long random strings, not guessable.
//
// Requires the same SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars
// already configured elsewhere, plus a one-time SQL setup — see the README.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

const MAX_EMAIL_LENGTH = 254; // the technical max length of an email address
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setCors_(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function isValidEmail_(email) {
  return (
    typeof email === 'string' &&
    email.length > 0 &&
    email.length <= MAX_EMAIL_LENGTH &&
    EMAIL_PATTERN.test(email)
  );
}

async function handleSubscribe_(req, res) {
  const rawEmail = req.body?.email;
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';

  if (!isValidEmail_(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  // Re-subscribing with the same email is a no-op success, not an error —
  // upsert on the primary key handles this without a separate lookup.
  // A fresh token is NOT generated on re-subscribe, so an old unsubscribe
  // link a person already has keeps working.
  const { data: existing } = await supabase
    .from('digest_subscribers')
    .select('email')
    .eq('email', email)
    .maybeSingle();

  if (!existing) {
    const unsubscribeToken = crypto.randomUUID();
    const { error } = await supabase
      .from('digest_subscribers')
      .insert({ email, unsubscribe_token: unsubscribeToken });
    if (error) throw error;
  }

  return res.status(200).json({ success: true });
}

async function handleUnsubscribe_(req, res) {
  const token = req.query?.token;
  const htmlPage = (message) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Unsubscribed — ADA Architecture Digest</title>
<style>body{font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#1a1a1a;padding:0 20px;}
a{color:#1a1a1a;}</style></head>
<body><h2>ADA Architecture Digest</h2><p>${message}</p></body></html>`;

  if (typeof token !== 'string' || token.length === 0) {
    return res.status(400).send(htmlPage('That unsubscribe link looks incomplete — please use the link from your email directly.'));
  }

  const { error } = await supabase
    .from('digest_subscribers')
    .delete()
    .eq('unsubscribe_token', token);

  if (error) throw error;

  return res.status(200).send(htmlPage("You've been unsubscribed. You won't receive further digest emails."));
}

export default async function handler(req, res) {
  setCors_(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    if (req.method === 'POST' && req.body?.action === 'subscribe') return await handleSubscribe_(req, res);
    if (req.method === 'GET' && req.query?.action === 'unsubscribe') return await handleUnsubscribe_(req, res);

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('newsletter-subscribe error:', err);
    return res.status(500).json({ error: 'Request failed', details: err.message });
  }
}
