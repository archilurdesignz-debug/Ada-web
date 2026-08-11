import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://ofaxbduvnhscxvoakeax.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Pzx108AGy0iP3HOranEbjg_dStxnuGK";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  const { slug } = req.query || {};

  // Fallback metadata for main blog view
  let title = "ADA Insights & Architecture Blog";
  let image = "https://yourdomain.com/path-to-default-ada-logo.png"; // Replace with your live ADA logo absolute URL
  let description = "Explore spatial compositions and architectural insights by Archilurdesignz and Architecture.";

  // Fetch post-specific dynamic metadata from Supabase
  if (slug) {
    const { data: post } = await supabase
      .from('posts')
      .select('title, hero_media_url, content')
      .eq('slug', slug)
      .maybeSingle();

    if (post) {
      title = `${post.title} | ADA Journal`;
      if (post.hero_media_url) image = post.hero_media_url;
      if (post.content) {
        description = post.content
          .replace(/<[^>]*>?/gm, '') // Strip HTML tags
          .replace(/\n/g, ' ')       // Clean line breaks
          .substring(0, 160) + '...';
      }
    }
  }

  // Generate HTML response with injected Open Graph tags
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  
  <!-- Dynamic Meta / Open Graph Tags -->
  <title>${title}</title>
  <meta name="description" content="${description}">
  
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  
  <!-- Twitter Card Meta Tags (YouTube Style Wide Image) -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${image}" />

  <!-- Standard Favicons -->
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  
  <style>
    #post-body { white-space: pre-line !important; }
    #post-body ul { margin-top: 0px !important; margin-bottom: 0px !important; padding-left: 1.25rem !important; display: block !important; }
    #post-body ul + ul { margin-top: -12px !important; }
    #post-body ul br, #post-body br + ul { display: none !important; }
    #post-body li { margin-top: 2px !important; margin-bottom: 2px !important; line-height: 1.4 !important; }
  </style>
</head>
<body class="bg-white text-neutral-900 font-sans selection:bg-neutral-200">
  <div class="flex min-h-screen">
    <aside class="w-80 border-r border-neutral-100 h-screen sticky top-0 p-6 hidden md:flex flex-col justify-between bg-neutral-50">
      <div>
        <div class="mb-10"><span class="text-xs uppercase tracking-widest font-semibold text-neutral-400">ADA Journal</span></div>
        <h3 class="text-sm font-bold uppercase tracking-wider text-neutral-400 mb-4">Available Topics</h3>
        <nav id="topics-list" class="space-y-3"><p class="text-xs text-neutral-400 italic">Loading topics...</p></nav>
      </div>
      <div class="text-xs text-neutral-400">&copy; 2026 Archilurdesignz and Architecture</div>
    </aside>

    <main class="flex-1 max-w-4xl mx-auto px-6 py-12 md:px-16">
      <article class="prose prose-neutral max-w-none">
        <div class="flex items-center gap-2 text-xs tracking-wider text-neutral-400 uppercase mb-4">
          <span id="post-date">-- --, ----</span><span>&bull;</span><span id="post-time">--:-- --</span>
        </div>
        <h1 id="post-title" class="text-3xl md:text-5xl font-bold tracking-tight mb-6 leading-tight">${title}</h1>
        <div class="mb-8 flex items-center justify-between">
          <button onclick="copyShareLink()" class="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 rounded transition">
            🔗 <span id="share-btn-text">Copy Unique Link</span>
          </button>
        </div>
        <div id="hero-media-container" class="w-full rounded-xl overflow-hidden mb-10 bg-neutral-100 aspect-video md:aspect-auto md:h-[450px] flex items-center justify-center">
          <span class="text-xs text-neutral-400 font-mono">Loading Media Element...</span>
        </div>
        <div id="post-body" class="text-neutral-700 leading-relaxed text-base space-y-6"></div>
      </article>

      <section class="mt-12 pt-6 border-t border-neutral-100 flex items-center gap-3">
        <button id="like-btn" onclick="submitReaction('like')" class="flex items-center gap-2 px-4 py-2 border border-neutral-200 hover:bg-neutral-50 rounded-full transition text-sm font-medium">👍 Like <span id="like-count" class="text-neutral-400 font-normal">0</span></button>
        <button id="dislike-btn" onclick="submitReaction('dislike')" class="flex items-center gap-2 px-4 py-2 border border-neutral-200 hover:bg-neutral-50 rounded-full transition text-sm font-medium">👎 Dislike <span id="dislike-count" class="text-neutral-400 font-normal">0</span></button>
      </section>

      <section class="mt-16">
        <h3 class="text-xl font-bold tracking-tight mb-8">Discussion Panel</h3>
        <div class="bg-neutral-50 border border-neutral-100 p-6 rounded-xl mb-10">
          <h4 class="text-sm font-bold uppercase tracking-wider text-neutral-500 mb-4">Add a thought</h4>
          <div class="grid grid-cols-1 gap-4">
            <div>
              <input type="text" id="commenter-name" oninput="validateInputName(this)" placeholder="Your Name (At least 4 alphanumeric characters)" class="w-full p-3 text-sm bg-white border border-neutral-200 rounded-lg focus:outline-none focus:border-black transition">
              <p id="name-validation-warning" class="text-xs text-red-500 mt-1 hidden">Name must be at least 4 characters long (letters and numbers only).</p>
            </div>
            <textarea id="comment-text" rows="4" placeholder="Share your insight on this spatial composition..." class="w-full p-3 text-sm bg-white border border-neutral-200 rounded-lg focus:outline-none focus:border-black transition"></textarea>
            <button onclick="postComment(null)" class="w-full bg-black text-white hover:bg-neutral-800 text-sm font-medium tracking-wide py-3 rounded-lg transition">Publish Comment</button>
          </div>
        </div>
        <div id="comments-container" class="space-y-6"></div>
      </section>
    </main>
  </div>

  <script>
    const SUPABASE_URL = "https://ofaxbduvnhscxvoakeax.supabase.co"; 
    const SUPABASE_ANON_KEY = "sb_publishable_Pzx108AGy0iP3HOranEbjg_dStxnuGK";
    const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let currentPost = null;
    let currentPostComments = [];
    let activeReplyTargetId = null;

    function getPostSlugFromUrl() {
      const params = new URLSearchParams(window.location.search);
      return params.get('slug'); 
    }

    window.addEventListener('DOMContentLoaded', async () => {
      const slug = getPostSlugFromUrl();
      await fetchSidebarTopics(slug);
      await loadBlogPostData(slug);
    });

    async function fetchSidebarTopics(activeSlug) {
      const { data, error } = await _supabase.from('posts').select('title, slug, created_at').order('created_at', { ascending: false });
      if (error) return;
      const listContainer = document.getElementById('topics-list');
      if (!listContainer) return;
      listContainer.innerHTML = '';
      if (!data || data.length === 0) {
        listContainer.innerHTML = '<p class="text-xs text-neutral-400 italic">No topics found.</p>';
        return;
      }
      const targetActiveSlug = activeSlug || data[0].slug;
      data.forEach(topic => {
        const isCurrent = topic.slug === targetActiveSlug;
        const anchor = document.createElement('a');
        anchor.href = \`?slug=\${topic.slug}\`;
        anchor.className = isCurrent 
          ? "block text-sm font-bold text-neutral-900 border-l-2 border-black pl-3 py-2 bg-neutral-100/50 rounded-r transition"
          : "block text-sm font-medium text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100/30 border-l-2 border-transparent hover:border-neutral-300 pl-3 py-2 transition";
        anchor.innerText = topic.title;
        listContainer.appendChild(anchor);
      });
    }

    async function loadBlogPostData(slug) {
      let response;
      if (slug) {
        response = await _supabase.from('posts').select('*').eq('slug', slug).maybeSingle();
      } else {
        response = await _supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
      }
      const { data: post, error } = response;
      if (error || !post) {
        document.getElementById('post-title').innerText = "Post Not Found";
        document.getElementById('hero-media-container').innerHTML = '';
        return;
      }
      currentPost = post;
      const timestamp = new Date(post.created_at);
      document.getElementById('post-date').innerText = timestamp.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      document.getElementById('post-time').innerText = timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      document.getElementById('post-title').innerText = post.title;
      document.getElementById('post-body').innerHTML = post.content;
      renderHeroMediaComponent(post);
      await fetchReactionCounts();
      await fetchPostComments();
    }

    function renderHeroMediaComponent(post) {
      const container = document.getElementById('hero-media-container');
      container.innerHTML = '';
      if (post.media_type === 'video') {
        container.className = "w-full aspect-video rounded-xl overflow-hidden mb-10 bg-black shadow-inner";
        container.innerHTML = \`<iframe src="\${post.hero_media_url}" title="ADA Embedded Player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen class="w-full h-full"></iframe>\`;
      } else {
        container.className = "w-full aspect-video md:aspect-auto md:h-[450px] overflow-hidden rounded-xl mb-10 bg-neutral-100 flex items-center justify-center";
        container.innerHTML = \`<img src="\${post.hero_media_url}" alt="Cover Framing Layout" class="w-full h-full object-cover">\`;
      }
    }

    function validateInputName(inputElement) {
      const warning = document.getElementById('name-validation-warning');
      const nameRegex = /^[a-zA-Z0-9 ]{4,}$/;
      if (!nameRegex.test(inputElement.value.trim())) {
        warning.classList.remove('hidden');
        return false;
      } else {
        warning.classList.add('hidden');
        return true;
      }
    }

    async function fetchPostComments() {
      const { data, error } = await _supabase.from('comments').select('*').eq('post_id', currentPost.id).order('created_at', { ascending: true });
      if (error) return;
      currentPostComments = data;
      renderCommentThreadTree();
    }

    function renderCommentThreadTree() {
      const container = document.getElementById('comments-container');
      container.innerHTML = '';
      const topLevelComments = currentPostComments.filter(c => !c.parent_id);
      if(topLevelComments.length === 0) {
        container.innerHTML = \`<p class="text-sm text-neutral-400 italic">No community remarks listed yet.</p>\`;
        return;
      }
      topLevelComments.forEach(comment => {
        container.appendChild(buildCommentHTMLNode(comment, 0));
      });
    }

    function buildCommentHTMLNode(comment, depth) {
      const node = document.createElement('div');
      node.className = \`border-l-2 border-neutral-200 pl-4 py-2 relative my-4 \${depth > 0 ? 'ml-6 border-neutral-100' : ''}\`;
      const dateStr = new Date(comment.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      node.innerHTML = \`
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm font-bold text-neutral-800">\${comment.author_name}</span>
          <span class="text-xs text-neutral-400">\${dateStr}</span>
        </div>
        <p class="text-sm text-neutral-700 mt-1">\${comment.content}</p>
        <button onclick="instantiateReplyBox('\${comment.id}', this)" class="text-xs font-semibold text-neutral-400 hover:text-black mt-2 uppercase tracking-wider block">Reply</button>
        <div id="reply-box-mount-\${comment.id}" class="mt-3"></div>
      \`;
      const subReplies = currentPostComments.filter(c => c.parent_id === comment.id);
      subReplies.forEach(reply => {
        node.appendChild(buildCommentHTMLNode(reply, depth + 1));
      });
      return node;
    }

    function instantiateReplyBox(parentId, buttonElement) {
      document.querySelectorAll('[id^="reply-box-mount-"]').forEach(box => box.innerHTML = '');
      activeReplyTargetId = parentId;
      const injectionTarget = document.getElementById(\`reply-box-mount-\${parentId}\`);
      injectionTarget.innerHTML = \`
        <div class="bg-neutral-50 p-4 border border-neutral-200 rounded-lg max-w-xl mt-2 space-y-3">
          <input type="text" id="reply-author-name" placeholder="Your Name (At least 4 chars)" class="w-full p-2 text-xs bg-white border border-neutral-200 rounded focus:outline-none focus:border-black">
          <textarea id="reply-body-text" rows="2" placeholder="Write reply choice..." class="w-full p-2 text-xs bg-white border border-neutral-200 rounded focus:outline-none focus:border-black"></textarea>
          <div class="flex justify-end gap-2">
            <button onclick="this.parentElement.parentElement.innerHTML = ''" class="text-xs px-3 py-1 border border-neutral-200 rounded hover:bg-neutral-100">Cancel</button>
            <button onclick="postComment('\${parentId}')" class="text-xs bg-black text-white px-3 py-1 rounded hover:bg-neutral-800">Post Reply</button>
          </div>
        </div>
      \`;
    }

    async function postComment(parentId = null) {
      const isReply = parentId !== null;
      const nameInput = document.getElementById(isReply ? 'reply-author-name' : 'commenter-name');
      const textInput = document.getElementById(isReply ? 'reply-body-text' : 'comment-text');
      const nameRegex = /^[a-zA-Z0-9 ]{4,}$/;
      if (!nameRegex.test(nameInput.value.trim())) {
        alert("Please ensure your author name contains at least 4 alphanumeric characters.");
        return;
      }
      if (!textInput.value.trim()) {
        alert("Comment text box cannot remain empty.");
        return;
      }
      const { error } = await _supabase.from('comments').insert([{
        post_id: currentPost.id,
        parent_id: parentId,
        author_name: nameInput.value.trim(),
        content: textInput.value.trim()
      }]);
      if (error) {
        alert("Error submitting text comment: " + error.message);
      } else {
        textInput.value = '';
        if(!isReply) nameInput.value = '';
        await fetchPostComments();
      }
    }

    async function fetchReactionCounts() {
      const { data: likes, error: e1 } = await _supabase.from('post_interactions').select('id', { count: 'exact' }).eq('post_id', currentPost.id).eq('interaction_type', 'like');
      const { data: dislikes, error: e2 } = await _supabase.from('post_interactions').select('id', { count: 'exact' }).eq('post_id', currentPost.id).eq('interaction_type', 'dislike');
      if (!e1 && !e2) {
        document.getElementById('like-count').innerText = likes.length || 0;
        document.getElementById('dislike-count').innerText = dislikes.length || 0;
      }
      updateReactionButtonsVisualState(localStorage.getItem(\`interaction_\${currentPost.id}\`));
    }

    function updateReactionButtonsVisualState(choice) {
      document.getElementById('like-btn').className = choice === 'like' 
        ? "flex items-center gap-2 px-4 py-2 bg-black text-white rounded-full text-sm font-medium transition"
        : "flex items-center gap-2 px-4 py-2 border border-neutral-200 hover:bg-neutral-50 rounded-full text-sm font-medium transition text-neutral-900";
      document.getElementById('dislike-btn').className = choice === 'dislike' 
        ? "flex items-center gap-2 px-4 py-2 bg-black text-white rounded-full text-sm font-medium transition"
        : "flex items-center gap-2 px-4 py-2 border border-neutral-200 hover:bg-neutral-50 rounded-full text-sm font-medium transition text-neutral-900";
    }

    async function submitReaction(type) {
      const storageKey = \`interaction_\${currentPost.id}\`;
      const existingChoice = localStorage.getItem(storageKey);
      if (existingChoice === type) return;

      let clientIp = "anonymous-client";
      try {
        const res = await fetch('https://api.ipify.org?format=json');
        const ipData = await res.json();
        clientIp = ipData.ip;
      } catch (err) {}

      const { error } = await _supabase.from('post_interactions').upsert({ 
        post_id: currentPost.id, 
        ip_address: clientIp, 
        interaction_type: type,
        updated_at: new Date().toISOString()
      }, { onConflict: 'post_id, ip_address' });

      if (!error) {
        localStorage.setItem(storageKey, type);
        await fetchReactionCounts();
      }
    }

    function copyShareLink() {
      navigator.clipboard.writeText(window.location.href);
      const textBtn = document.getElementById('share-btn-text');
      textBtn.innerText = "Link Copied!";
      setTimeout(() => { textBtn.innerText = "Copy Unique Link"; }, 2500);
    }
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}
