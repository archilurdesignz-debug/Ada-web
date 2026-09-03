// /api/plan-og.js
//
// Serves a lightweight HTML document with plan-specific Open Graph /
// Twitter Card meta tags for social-media crawlers (WhatsApp, Facebook,
// Twitter/X, LinkedIn, Telegram, Slack, Discord, search engines, ...).
//
// It is NOT meant to be visited directly by people — vercel.json routes
// only bot traffic hitting /store?plan=<id> here. Everyone else keeps
// getting the real interactive store.html untouched. A crawler that
// somehow lands here anyway gets a meta-refresh + visible link back to
// the real page.
//
// Requires the same Supabase project/table ("plans") already used by
// /api/get-store. Uses the anon/publishable key — same one already
// embedded client-side in store.html, so no new secret is introduced.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ofaxbduvnhscxvoakeax.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Pzx108AGy0iP3HOranEbjg_dStxnuGK';
const SITE_URL = 'https://www.archilurdesignz.com';

// Mirrors the two hardcoded defaultPlans in store.html so their deep
// links get proper previews too, without a database round trip.
const DEFAULT_PLANS = {
    'obsidian-2bed': {
        title: 'Obsidian',
        meta: '2 BEDS • 210 SQM',
        category: 'Tropical Contemporary 2 Bedrooms Bungalow',
        main_image: 'images/2BED2.webp'
    },
    'modeer-2bed': {
        title: 'Modeer',
        meta: '2 BEDS • 165 SQM',
        category: 'Tropical Contemporary Bungalow 2 Bedrooms',
        main_image: 'images/2BEDSTY2B.webp'
    }
};

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function toAbsoluteImageUrl(path) {
    if (!path) return `${SITE_URL}/og-default.jpg`;
    if (/^https?:\/\//i.test(path)) return path;
    return `${SITE_URL}/${path.replace(/^\/+/, '')}`;
}

export default async function handler(req, res) {
    const id = typeof req.query.plan === 'string' ? req.query.plan : '';
    const pageUrl = id
        ? `${SITE_URL}/store?plan=${encodeURIComponent(id)}`
        : `${SITE_URL}/store`;

    let title = 'Plan Store | ADA Archilurdesignz';
    let description = 'Ready-to-build architectural plans and custom design concepts from ADA Archilurdesignz.';
    let image = `${SITE_URL}/og-default.jpg`;

    if (id) {
        let plan = DEFAULT_PLANS[id] || null;

        if (!plan) {
            try {
                const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
                const { data, error } = await supabase
                    .from('plans')
                    .select('title, meta, category, main_image')
                    .eq('id', id)
                    .maybeSingle();
                if (!error && data) plan = data;
            } catch (err) {
                console.error('plan-og: Supabase lookup failed:', err);
            }
        }

        if (plan) {
            title = `${plan.title} | ADA Archilurdesignz Plan Store`;
            description = plan.category || plan.meta || description;
            image = toAbsoluteImageUrl(plan.main_image);
        }
    }

    const safeTitle = escapeHtml(title);
    const safeDesc = escapeHtml(description);
    const safeImage = escapeHtml(image);
    const safeUrl = escapeHtml(pageUrl);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Short cache: plan details rarely change, but shouldn't go stale for long.
    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600');
    res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${safeTitle}</title>
<meta name="description" content="${safeDesc}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="ADA Archilurdesignz">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDesc}">
<meta property="og:image" content="${safeImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${safeUrl}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDesc}">
<meta name="twitter:image" content="${safeImage}">

<link rel="canonical" href="${safeUrl}">
<meta http-equiv="refresh" content="0; url=${safeUrl}">
</head>
<body>
<p>Redirecting to <a href="${safeUrl}">${safeTitle}</a>&hellip;</p>
</body>
</html>`);
}

