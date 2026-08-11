module.exports = async function handler(req, res) {
  try {
    const slug = req.query ? req.query.slug : null;

    let title = "ADA Insights & Architecture Blog";
    let image = "https://www.archilurdesignz.com/apple-touch-icon.png";
    let description = "Explore spatial compositions and architectural insights by Archilurdesignz and Architecture.";

    // Fetch meta details directly via Supabase REST API (No external npm library required)
    if (slug) {
      try {
        const supabaseUrl = "https://ofaxbduvnhscxvoakeax.supabase.co";
        const supabaseAnonKey = "sb_publishable_Pzx108AGy0iP3HOranEbjg_dStxnuGK";
        
        const endpoint = `${supabaseUrl}/rest/v1/posts?slug=eq.${encodeURIComponent(slug)}&select=title,hero_media_url,content`;
        
        const response = await fetch(endpoint, {
          headers: {
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data && data.length > 0) {
            const post = data[0];
            title = post.title + " | ADA Journal";
            if (post.hero_media_url) image = post.hero_media_url;
            if (post.content) {
              description = post.content
                .replace(/<[^>]*>?/gm, '')
                .replace(/\n/g, ' ')
                .substring(0, 160) + '...';
            }
          }
        }
      } catch (dbErr) {
        console.error("Supabase REST Fetch Error:", dbErr);
      }
    }

    const html = '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'  <meta charset="UTF-8">\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'  <title>' + title + '</title>\n' +
'  <meta name="description" content="' + description + '">\n' +
'  <meta property="og:type" content="article" />\n' +
'  <meta property="og:title" content="' + title + '" />\n' +
'  <meta property="og:description" content="' + description + '" />\n' +
'  <meta property="og:image" content="' + image + '" />\n' +
'  <meta property="og:image:width" content="1200" />\n' +
'  <meta property="og:image:height" content="630" />\n' +
'  <meta name="twitter:card" content="summary_large_image" />\n' +
'  <meta name="twitter:title" content="' + title + '" />\n' +
'  <meta name="twitter:description" content="' + description + '" />\n' +
'  <meta name="twitter:image" content="' + image + '" />\n' +
'  <link rel="icon" type="image/x-icon" href="/favicon.ico">\n' +
'  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\n' +
'  <script src="https://cdn.tailwindcss.com"></script>\n' +
'  <style>\n' +
'    #post-body { white-space: pre-line !important; }\n' +
'    #post-body ul { margin-top: 0px !important; margin-bottom: 0px !important; padding-left: 1.25rem !important; display: block !important; }\n' +
'    #post-body ul + ul { margin-top: -12px !important; }\n' +
'    #post-body ul br, #post-body br + ul { display: none !important; }\n' +
'    #post-body li { margin-top: 2px !important; margin-bottom: 2px !important; line-height: 1.4 !important; }\n' +
'  </style>\n' +
'</head>\n' +
'<body class="bg-white text-neutral-900 font-sans selection:bg-neutral-200">\n' +
'  <div class="flex min-h-screen">\n' +
'    <aside class="w-80 border-r border-neutral-100 h-screen sticky top-0 p-6 hidden md:flex flex-col justify-between bg-neutral-50">\n' +
'      <div>\n' +
'        <div class="mb-10"><span class="text-xs uppercase tracking-widest font-semibold text-neutral-400">ADA Journal</span></div>\n' +
'        <h3 class="text-sm font-bold uppercase tracking-wider text-neutral-400 mb-4">Available Topics</h3>\n' +
'        <nav id="topics-list" class="space-y-3"><p class="text-xs text-neutral-400 italic">Loading topics...</p></nav>\n' +
'      </div>\n' +
'      <div class="text-xs text-neutral-400">&copy; 2026 Archilurdesignz and Architecture</div>\n' +
'    </aside>\n' +
'    <main class="flex-1 max-w-4xl mx-auto px-6 py-12 md:px-16">\n' +
'      <article class="prose prose-neutral max-w-none">\n' +
'        <div class="flex items-center gap-2 text-xs tracking-wider text-neutral-400 uppercase mb-4">\n' +
'          <span id="post-date">-- --, ----</span><span>&bull;</span><span id="post-time">--:-- --</span>\n' +
'        </div>\n' +
'        <h1 id="post-title" class="text-3xl md:text-5xl font-bold tracking-tight mb-6 leading-tight">Loading article...</h1>\n' +
'        <div class="mb-8 flex items-center justify-between">\n' +
'          <button onclick="copyShareLink()" class="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 rounded transition">\n' +
'            🔗 <span id="share-btn-text">Copy Unique Link</span>\n' +
'          </button>\n' +
'        </div>\n' +
'        <div id="hero-media-container" class="w-full rounded-xl overflow-hidden mb-10 bg-neutral-100 aspect-video md:aspect-auto md:h-[450px] flex items-center justify-center">\n' +
'          <span class="text-xs text-neutral-400 font-mono">Loading Media Element...</span>\n' +
'        </div>\n' +
'        <div id="post-body" class="text-neutral-700 leading-relaxed text-base space-y-6"></div>\n' +
'      </article>\n' +
'      <section class="mt-12 pt-6 border-t border-neutral-100 flex items-center gap-3">\n' +
'        <button id="like-btn" onclick="submitReaction(\'like\')" class="flex items-center gap-2 px-4 py-2 border border-neutral-200 hover:bg-neutral-50 rounded-full transition text-sm font-medium">👍 Like <span id="like-count" class="text-neutral-400 font-normal">0</span></button>\n' +
'        <button id="dislike-btn" onclick="submitReaction(\'dislike\')" class="flex items-center gap-2 px-4 py-2 border border-neutral-200 hover:bg-neutral-50 rounded-full transition text-sm font-medium">👎 Dislike <span id="dislike-count" class="text-neutral-400 font-normal">0</span></button>\n' +
'      </section>\n' +
'      <section class="mt-16">\n' +
'        <h3 class="text-xl font-bold tracking-tight mb-8">Discussion Panel</h3>\n' +
'        <div class="bg-neutral-50 border border-neutral-100 p-6 rounded-xl mb-10">\n' +
'          <h4 class="text-sm font-bold uppercase tracking-wider text-neutral-500 mb-4">Add a thought</h4>\n' +
'          <div class="grid grid-cols-1 gap-4">\n' +
'            <div>\n' +
'              <input type="text" id="commenter-name" oninput="validateInputName(this)" placeholder="Your Name (At least 4 alphanumeric characters)" class="w-full p-3 text-sm bg-white border border-neutral-200 rounded-lg focus:outline-none focus:border-black transition">\n' +
'              <p id="name-validation-warning" class="text-xs text-red-500 mt-1 hidden">Name must be at least 4 characters long (letters and numbers only).</p>\n' +
'            </div>\n' +
'            <textarea id="comment-text" rows="4" placeholder="Share your insight on this spatial composition..." class="w-full p-3 text-sm bg-white border border-neutral-200 rounded-lg focus:outline-none focus:border-black transition"></textarea>\n' +
'            <button onclick="postComment(null)" class="w-full bg-black text-white hover:bg-neutral-800 text-sm font-medium tracking-wide py-3 rounded-lg transition">Publish Comment</button>\n' +
'          </div>\n' +
'        </div>\n' +
'        <div id="comments-container" class="space-y-6"></div>\n' +
'      </section>\n' +
'    </main>\n' +
'  </div>\n' +
'  <script>\n' +
'    const SUPABASE_URL = "https://ofaxbduvnhscxvoakeax.supabase.co";\n' +
'    const SUPABASE_ANON_KEY = "sb_publishable_Pzx108AGy0iP3HOranEbjg_dStxnuGK";\n' +
'    const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);\n' +
'    let currentPost = null;\n' +
'    let currentPostComments = [];\n' +
'    let activeReplyTargetId = null;\n' +
'    function getPostSlugFromUrl() {\n' +
'      const params = new URLSearchParams(window.location.search);\n' +
'      return params.get("slug");\n' +
'    }\n' +
'    window.addEventListener("DOMContentLoaded", async () => {\n' +
'      const slug = getPostSlugFromUrl();\n' +
'      await fetchSidebarTopics(slug);\n' +
'      await loadBlogPostData(slug);\n' +
'    });\n' +
'    async function fetchSidebarTopics(activeSlug) {\n' +
'      const { data, error } = await _supabase.from("posts").select("title, slug, created_at").order("created_at", { ascending: false });\n' +
'      if (error) return;\n' +
'      const listContainer = document.getElementById("topics-list");\n' +
'      if (!listContainer) return;\n' +
'      listContainer.innerHTML = "";\n' +
'      if (!data || data.length === 0) {\n' +
'        listContainer.innerHTML = \'<p class="text-xs text-neutral-400 italic">No topics found.</p>\';\n' +
'        return;\n' +
'      }\n' +
'      const targetActiveSlug = activeSlug || data[0].slug;\n' +
'      data.forEach(topic => {\n' +
'        const isCurrent = topic.slug === targetActiveSlug;\n' +
'        const anchor = document.createElement("a");\n' +
'        anchor.href = "/blog?slug=" + topic.slug;\n' +
'        anchor.className = isCurrent\n' +
'          ? "block text-sm font-bold text-neutral-900 border-l-2 border-black pl-3 py-2 bg-neutral-100/50 rounded-r transition"\n' +
'          : "block text-sm font-medium text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100/30 border-l-2 border-transparent hover:border-neutral-300 pl-3 py-2 transition";\n' +
'        anchor.innerText = topic.title;\n' +
'        listContainer.appendChild(anchor);\n' +
'      });\n' +
'    }\n' +
'    async function loadBlogPostData(slug) {\n' +
'      let response;\n' +
'      if (slug) {\n' +
'        response = await _supabase.from("posts").select("*").eq("slug", slug).maybeSingle();\n' +
'      } else {\n' +
'        response = await _supabase.from("posts").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();\n' +
'      }\n' +
'      const { data: post, error } = response;\n' +
'      if (error || !post) {\n' +
'        document.getElementById("post-title").innerText = "Post Not Found";\n' +
'        document.getElementById("hero-media-container").innerHTML = "";\n' +
'        return;\n' +
'      }\n' +
'      currentPost = post;\n' +
'      if (!slug && post.slug) {\n' +
'        window.history.replaceState(null, "", "/blog?slug=" + post.slug);\n' +
'      }\n' +
'      const timestamp = new Date(post.created_at);\n' +
'      document.getElementById("post-date").innerText = timestamp.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });\n' +
'      document.getElementById("post-time").innerText = timestamp.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });\n' +
'      document.getElementById("post-title").innerText = post.title;\n' +
'      document.getElementById("post-body").innerHTML = post.content;\n' +
'      renderHeroMediaComponent(post);\n' +
'      await fetchReactionCounts();\n' +
'      await fetchPostComments();\n' +
'    }\n' +
'    function renderHeroMediaComponent(post) {\n' +
'      const container = document.getElementById("hero-media-container");\n' +
'      container.innerHTML = "";\n' +
'      if (post.media_type === "video") {\n' +
'        container.className = "w-full aspect-video rounded-xl overflow-hidden mb-10 bg-black shadow-inner";\n' +
'        container.innerHTML = \'<iframe src="\' + post.hero_media_url + \'" title="ADA Embedded Player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen class="w-full h-full"></iframe>\';\n' +
'      } else {\n' +
'        container.className = "w-full aspect-video md:aspect-auto md:h-[450px] overflow-hidden rounded-xl mb-10 bg-neutral-100 flex items-center justify-center";\n' +
'        container.innerHTML = \'<img src="\' + post.hero_media_url + \'" alt="Cover Framing Layout" class="w-full h-full object-cover">\';\n' +
'      }\n' +
'    }\n' +
'    function validateInputName(inputElement) {\n' +
'      const warning = document.getElementById("name-validation-warning");\n' +
'      const nameRegex = /^[a-zA-Z0-9 ]{4,}$/;\n' +
'      if (!nameRegex.test(inputElement.value.trim())) {\n' +
'        warning.classList.remove("hidden");\n' +
'        return false;\n' +
'      } else {\n' +
'        warning.classList.add("hidden");\n' +
'        return true;\n' +
'      }\n' +
'    }\n' +
'    async function fetchPostComments() {\n' +
'      const { data, error } = await _supabase.from("comments").select("*").eq("post_id", currentPost.id).order("created_at", { ascending: true });\n' +
'      if (error) return;\n' +
'      currentPostComments = data;\n' +
'      renderCommentThreadTree();\n' +
'    }\n' +
'    function renderCommentThreadTree() {\n' +
'      const container = document.getElementById("comments-container");\n' +
'      container.innerHTML = "";\n' +
'      const topLevelComments = currentPostComments.filter(c => !c.parent_id);\n' +
'      if(topLevelComments.length === 0) {\n' +
'        container.innerHTML = \'<p class="text-sm text-neutral-400 italic">No community remarks listed yet.</p>\';\n' +
'        return;\n' +
'      }\n' +
'      topLevelComments.forEach(comment => {\n' +
'        container.appendChild(buildCommentHTMLNode(comment, 0));\n' +
'      });\n' +
'    }\n' +
'    function buildCommentHTMLNode(comment, depth) {\n' +
'      const node = document.createElement("div");\n' +
'      node.className = "border-l-2 border-neutral-200 pl-4 py-2 relative my-4 " + (depth > 0 ? "ml-6 border-neutral-100" : "");\n' +
'      const dateStr = new Date(comment.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });\n' +
'      node.innerHTML = \'<div class="flex items-center justify-between mb-1"><span class="text-sm font-bold text-neutral-800">\' + comment.author_name + \'</span><span class="text-xs text-neutral-400">\' + dateStr + \'</span></div><p class="text-sm text-neutral-700 mt-1">\' + comment.content + \'</p><button onclick="instantiateReplyBox(\\\'\'+ comment.id +\'\\\', this)" class="text-xs font-semibold text-neutral-400 hover:text-black mt-2 uppercase tracking-wider block">Reply</button><div id="reply-box-mount-\' + comment.id + \'" class="mt-3"></div>\';\n' +
'      const subReplies = currentPostComments.filter(c => c.parent_id === comment.id);\n' +
'      subReplies.forEach(reply => {\n' +
'        node.appendChild(buildCommentHTMLNode(reply, depth + 1));\n' +
'      });\n' +
'      return node;\n' +
'    }\n' +
'    function instantiateReplyBox(parentId, buttonElement) {\n' +
'      document.querySelectorAll(\'[id^="reply-box-mount-"]\').forEach(box => box.innerHTML = "");\n' +
'      activeReplyTargetId = parentId;\n' +
'      const injectionTarget = document.getElementById("reply-box-mount-" + parentId);\n' +
'      injectionTarget.innerHTML = \'<div class="bg-neutral-50 p-4 border border-neutral-200 rounded-lg max-w-xl mt-2 space-y-3"><input type="text" id="reply-author-name" placeholder="Your Name (At least 4 chars)" class="w-full p-2 text-xs bg-white border border-neutral-200 rounded focus:outline-none focus:border-black"><textarea id="reply-body-text" rows="2" placeholder="Write reply choice..." class="w-full p-2 text-xs bg-white border border-neutral-200 rounded focus:outline-none focus:border-black"></textarea><div class="flex justify-end gap-2"><button onclick="this.parentElement.parentElement.innerHTML = \\\'\\\'" class="text-xs px-3 py-1 border border-neutral-200 rounded hover:bg-neutral-100">Cancel</button><button onclick="postComment(\\\'\'+ parentId +\'\\\')" class="text-xs bg-black text-white px-3 py-1 rounded hover:bg-neutral-800">Post Reply</button></div></div>\';\n' +
'    }\n' +
'    async function postComment(parentId = null) {\n' +
'      const isReply = parentId !== null;\n' +
'      const nameInput = document.getElementById(isReply ? "reply-author-name" : "commenter-name");\n' +
'      const textInput = document.getElementById(isReply ? "reply-body-text" : "comment-text");\n' +
'      const nameRegex = /^[a-zA-Z0-9 ]{4,}$/;\n' +
'      if (!nameRegex.test(nameInput.value.trim())) {\n' +
'        alert("Please ensure your author name contains at least 4 alphanumeric characters.");\n' +
'        return;\n' +
'      }\n' +
'      if (!textInput.value.trim()) {\n' +
'        alert("Comment text box cannot remain empty.");\n' +
'        return;\n' +
'      }\n' +
'      const { error } = await _supabase.from("comments").insert([{\n' +
'        post_id: currentPost.id,\n' +
'        parent_id: parentId,\n' +
'        author_name: nameInput.value.trim(),\n' +
'        content: textInput.value.trim()\n' +
'      }]);\n' +
'      if (error) {\n' +
'        alert("Error submitting text comment: " + error.message);\n' +
'      } else {\n' +
'        textInput.value = "";\n' +
'        if(!isReply) nameInput.value = "";\n' +
'        await fetchPostComments();\n' +
'      }\n' +
'    }\n' +
'    async function fetchReactionCounts() {\n' +
'      const { data: likes, error: e1 } = await _supabase.from("post_interactions").select("id", { count: "exact" }).eq("post_id", currentPost.id).eq("interaction_type", "like");\n' +
'      const { data: dislikes, error: e2 } = await _supabase.from("post_interactions").select("id", { count: "exact" }).eq("post_id", currentPost.id).eq("interaction_type", "dislike");\n' +
'      if (!e1 && !e2) {\n' +
'        document.getElementById("like-count").innerText = likes ? likes.length : 0;\n' +
'        document.getElementById("dislike-count").innerText = dislikes ? dislikes.length : 0;\n' +
'      }\n' +
'      updateReactionButtonsVisualState(localStorage.getItem("interaction_" + currentPost.id));\n' +
'    }\n' +
'    function updateReactionButtonsVisualState(choice) {\n' +
'      document.getElementById("like-btn").className = choice === "like"\n' +
'        ? "flex items-center gap-2 px-4 py-2 bg-black text-white rounded-full text-sm font-medium transition"\n' +
'        : "flex items-center gap-2 px-4 py-2 border border-neutral-200 hover:bg-neutral-50 rounded-full text-sm font-medium transition text-neutral-900";\n' +
'      document.getElementById("dislike-btn").className = choice === "dislike"\n' +
'        ? "flex items-center gap-2 px-4 py-2 bg-black text-white rounded-full text-sm font-medium transition"\n' +
'        : "flex items-center gap-2 px-4 py-2 border border-neutral-200 hover:bg-neutral-50 rounded-full text-sm font-medium transition text-neutral-900";\n' +
'    }\n' +
'    async function submitReaction(type) {\n' +
'      const storageKey = "interaction_" + currentPost.id;\n' +
'      const existingChoice = localStorage.getItem(storageKey);\n' +
'      if (existingChoice === type) return;\n' +
'      let clientIp = "anonymous-client";\n' +
'      try {\n' +
'        const res = await fetch("https://api.ipify.org?format=json");\n' +
'        const ipData = await res.json();\n' +
'        clientIp = ipData.ip;\n' +
'      } catch (err) {}\n' +
'      const { error } = await _supabase.from("post_interactions").upsert({ \n' +
'        post_id: currentPost.id, \n' +
'        ip_address: clientIp, \n' +
'        interaction_type: type,\n' +
'        updated_at: new Date().toISOString()\n' +
'      }, { onConflict: "post_id, ip_address" });\n' +
'      if (!error) {\n' +
'        localStorage.setItem(storageKey, type);\n' +
'        await fetchReactionCounts();\n' +
'      }\n' +
'    }\n' +
'    function copyShareLink() {\n' +
'      let shareableUrl = window.location.href;\n' +
'      if (currentPost && currentPost.slug) {\n' +
'        shareableUrl = window.location.origin + "/blog?slug=" + currentPost.slug;\n' +
'      }\n' +
'      navigator.clipboard.writeText(shareableUrl);\n' +
'      const textBtn = document.getElementById("share-btn-text");\n' +
'      if (textBtn) {\n' +
'        textBtn.innerText = "Link Copied!";\n' +
'        setTimeout(() => { textBtn.innerText = "Copy Unique Link"; }, 2500);\n' +
'      }\n' +
'    }\n' +
'  </script>\n' +
'</body>\n' +
'</html>';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    console.error("Fatal Handler Error:", err);
    return res.status(500).send("Serverless Function Error: " + err.message);
  }
};
