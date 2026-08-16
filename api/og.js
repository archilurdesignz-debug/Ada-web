export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  const userAgent = req.headers.get('user-agent') || '';

  // Detect social media crawlers
  const isCrawler = /LinkedInBot|facebookexternalhit|WhatsApp|Twitterbot|Pinterest|TelegramBot|Slackbot|Discordbot/i.test(userAgent);

  let title = "ADA Insights & Architecture Blog";
  let image = "https://www.archilurdesignz.com/apple-touch-icon.png";
  let description = "Explore spatial compositions and architectural insights by Archilurdesignz and Architecture.";

  if (slug) {
    try {
      const supabaseUrl = "https://ofaxbduvnhscxvoakeax.supabase.co";
      const supabaseAnonKey = "sb_publishable_Pzx108AGy0iP3HOranEbjg_dStxnuGK";
      
      const cleanSlug = slug.trim();
      const endpoint = `${supabaseUrl}/rest/v1/posts?slug=eq.${encodeURIComponent(cleanSlug)}&select=title,hero_media_url,media_type,content`;
      
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const post = data[0];
          title = `${post.title} | ADA Journal`;

          if (post.hero_media_url) {
            let mediaUrl = post.hero_media_url.trim();

            if (post.media_type === 'video' || mediaUrl.includes('youtube.com') || mediaUrl.includes('youtu.be')) {
              const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
              const match = mediaUrl.match(regExp);
              if (match && match[2].length === 11) {
                mediaUrl = `https://img.youtube.com/vi/${match[2]}/hqdefault.jpg`;
              }
            }

            if (!mediaUrl.startsWith('http://') && !mediaUrl.startsWith('https://')) {
              mediaUrl = `https://www.archilurdesignz.com${mediaUrl.startsWith('/') ? '' : '/'}${mediaUrl}`;
            }

            image = mediaUrl;
          }

          if (post.content) {
            description = post.content
              .replace(/<[^>]*>?/gm, '')
              .replace(/\n/g, ' ')
              .trim()
              .substring(0, 160) + '...';
          }
        }
      }
    } catch (e) {
      console.error("OG Metadata Edge Error:", e);
    }
  }

  // If a human opens the link directly in a browser, redirect them to /blog
  if (!isCrawler) {
    return Response.redirect(`https://www.archilurdesignz.com/blog?slug=${encodeURIComponent(slug || '')}`, 302);
  }

  // If a crawler hits the link, return ONLY clean static HTML with populated Open Graph tags
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta name="description" content="${description}">
  
  <!-- Open Graph / LinkedIn / Facebook / WhatsApp -->
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Archilurdesignz" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:image:secure_url" content="${image}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${req.url}" />
  
  <!-- Twitter Cards -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${image}" />
</head>
<body>
  <h1>${title}</h1>
  <p>${description}</p>
  <img src="${image}" alt="Cover Image" />
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=3600'
    },
  });
}
