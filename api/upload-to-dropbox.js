import fetch from 'node-fetch';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const clientId = process.env.DROPBOX_CLIENT_ID;
        const clientSecret = process.env.DROPBOX_CLIENT_SECRET;
        const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;

        if (!clientId || !clientSecret || !refreshToken) {
            return res.status(500).json({ 
                error: "Missing Dropbox configuration environment variables on Vercel." 
            });
        }

        // Fetch temporary short-lived access token
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
            return res.status(tokenResponse.status).json({ 
                error: "Token generation failed: " + (tokenData.error_description || tokenData.error) 
            });
        }

        const accessToken = tokenData.access_token;
        const { filename, filedata } = req.body; // Vercel automatically parses JSON bodies into req.body

        if (!filename || !filedata) {
            return res.status(400).json({ error: "Missing file payload headers parameters." });
        }

        const fileBuffer = Buffer.from(filedata, 'base64');
        const dropboxPath = `/portfolio/${Date.now()}_${filename}`;
        
        // Upload transmission to Dropbox
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

        // Generate public shared link
        const linkResponse = await fetch('https://api.dropbox.com/2/sharing/create_shared_link_with_settings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path: dropboxPath })
        });

        let linkData = await linkResponse.json();
        
        // Fallback if shared link already exists
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

        const directUrl = linkData.url.replace('?dl=0', '?raw=1');

        return res.status(200).json({ url: directUrl });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}