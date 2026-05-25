exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { filename, filedata } = JSON.parse(event.body);
    
    if (!filedata || !filename) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing file data or filename" }) };
    }

    // Grab your Dropbox Access Token safely from Netlify's environment variables
    const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
    
    if (!DROPBOX_ACCESS_TOKEN) {
      return { statusCode: 500, body: JSON.stringify({ error: "Dropbox token missing on server configuration" }) };
    }

    // 1. Upload the raw binary file data to Dropbox
    const fileBuffer = Buffer.from(filedata, 'base64');
    const cleanFilename = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.]/g, "_")}`;
    
    const uploadResponse = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DROPBOX_ACCESS_TOKEN}`,
        "Dropbox-API-Arg": JSON.stringify({
          path: `/${cleanFilename}`,
          mode: "add",
          autorename: true,
          mute: false
        }),
        "Content-Type": "application/octet-stream"
      },
      body: fileBuffer
    });

    const uploadData = await uploadResponse.json();
    if (!uploadResponse.ok) throw new Error(uploadData.error_summary || "Failed to upload to Dropbox");

    // 2. Ask Dropbox to create a public sharing link for this new file
    const shareResponse = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DROPBOX_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ path: uploadData.path_lower })
    });

    let shareData = await shareResponse.json();
    
    // If a link already exists for some reason, grab the existing one
    if (shareResponse.status === 409) {
      const listResponse = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${DROPBOX_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ path: uploadData.path_lower, direct_only: true })
      });
      const listData = await listResponse.json();
      shareData = listData.links[0];
    } else if (!shareResponse.ok) {
      throw new Error(shareData.error_summary || "Failed to create shared link");
    }

    // 3. Convert the standard Dropbox link to a direct streaming web image link (raw=1)
    const directUrl = shareData.url.replace("dl=0", "raw=1");

    return {
      statusCode: 200,
      body: JSON.stringify({ url: directUrl })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
