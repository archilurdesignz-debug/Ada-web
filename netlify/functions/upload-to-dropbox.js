const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 1. Grab credentials securely from your Netlify Env variables
        const clientId = process.env.DROPBOX_CLIENT_ID;
        const clientSecret = process.env.DROPBOX_CLIENT_SECRET;
        const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;

        if (!clientId || !clientSecret || !refreshToken) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: "Missing Dropbox configuration environment variables on Netlify." })
            };
        }

        // 2. Fetch a temporary short-lived access token using your master refresh token
        const tokenResponse = await fetch('https://api.dropbox.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: clientId,
                client_secret: clientSecret
            })
        });

        const tokenData = await tokenResponse.json();
        
        if (!tokenResponse.ok) {
            return {
                statusCode: tokenResponse.status,
                body: JSON.stringify({ error: "Token generation failed: " + (tokenData.error_description || tokenData.error) })
            };
        }

        const accessToken = tokenData.access_token;

        // 3. Process the incoming image payload from your client control panel
        const body = JSON.parse(event.body);
        const { filename, filedata } = body; // Base64 raw image data string

        if (!filename || !filedata) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing file payload headers parameters." }) };
        }

        // Convert base64 data back into binary buffer payload
        const fileBuffer = Buffer.from(filedata, 'base64');

        // 4. Send the binary payload straight to Dropbox
        const dropboxPath = `/portfolio/${Date.now()}_${filename}`;
        const uploadResponse = await fetch('https://content.dropboxapi.com/2/files/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Dropbox-API-Arg': JSON.stringify({
                    path: dropboxPath,
                    mode: 'add',
                    autorename: true,
                    mute: false
                }),
                'Content-Type': 'application/octet-stream'
            },
            body: fileBuffer
        });

        const uploadData = await uploadResponse.json();

        if (!uploadResponse.ok) {
            throw new Error(uploadData.error_summary || "Dropbox raw upload transmission failure");
        }

        // 5. Generate a public shared link for your Supabase db database insertion path
        const linkResponse = await fetch('https://api.dropbox.com/2/sharing/create_shared_link_with_settings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path: dropboxPath })
        });

        let linkData = await linkResponse.json();
        
        // Handle fallback if shared link already exists
        if (!linkResponse.ok && linkData.error_summary?.includes('shared_link_already_exists')) {
            const listResponse = await fetch('https://api.dropbox.com/2/sharing/list_shared_links', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ path: dropboxPath, direct_only: true })
            });
            const listData = await listResponse.json();
            linkData = listData.links[0];
        } else if (!linkResponse.ok) {
            throw new Error(linkData.error_summary || "Sharing link generation breakdown");
        }

        // Convert standard link to direct downloadable image path string (swap dl=0 with raw=1)
        const directUrl = linkData.url.replace('?dl=0', '?raw=1');

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: directUrl })
        };

    } catch (err) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message })
        };
    }
};
