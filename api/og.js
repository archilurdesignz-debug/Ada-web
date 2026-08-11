export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');

  let title = "ADA Insights & Architecture Blog";
  let image = "https://www.archilurdesignz.com/apple-touch-icon.png"; // Fallback static preview image
  let description = "Explore spatial compositions and architectural insights by Archilurdesignz and Architecture.";

  if (slug) {
    try {
      const supabaseUrl = "https://ofaxbduvnhscxvoakeax.supabase.co";
      const supabaseAnonKey = "sb_publishable_Pzx108AGy0iP3HOranEbjg_dStxnuGK";
      
      const res = await fetch(`${supabaseUrl}/rest/v1/posts?slug=eq.${encodeURIComponent(slug)}&select=title,hero_media_url,media_type,content`, {
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`
        }
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const post = data[0];
          title = `${post.title} | ADA Journal`;

          // 1. Process Hero Media Image URL
          if (post.hero_media_url) {
            let mediaUrl = post.hero_media_url.trim();

            // Handle YouTube Video links -> Convert to YouTube Thumbnail Image
            if (post.media_type === 'video' || mediaUrl.includes('youtube.com') || mediaUrl.includes('youtu.be')) {
              const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
              const match = mediaUrl.match(regExp);
              if (match && match[2].length === 11) {
                mediaUrl = `https://img.youtube.com/vi/${match[2]}/hqdefault.jpg`;
              }
            }

            // Ensure the URL is absolute (includes domain)
            if (!mediaUrl.startsWith('http://') && !mediaUrl.startsWith('https://')) {
              mediaUrl = `https://www.archilurdesignz.com${mediaUrl.startsWith('/') ? '' : '/'}${mediaUrl}`;
            }

            image = mediaUrl;
          }

          // 2. Clean up Post Description
          if (post.content) {
            description = post.content
              .replace(/<[^>]*>?/gm, '')
              .replace(/\n/g, ' ')
              .substring(0, 160) + '...';
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta name="description" content="${description}">
  
  <!-- Open Graph / Facebook / WhatsApp Meta Tags -->
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:image:secure_url" content="${image}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  
  <!-- Twitter Card Meta Tags (YouTube Style Large Thumbnail) -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${image}" />

  <meta http-equiv="refresh" content="0;url=/blog?slug=${slug || ''}">
</head>
<body>
  <p>Redirecting to ADA Journal...</p>
</body>
</html>`;

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
