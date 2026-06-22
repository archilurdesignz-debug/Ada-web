import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Initialize Supabase SECURELY on the server side using an environment variable
  const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_ROLE_KEY // Handled safely by Vercel's backend env dashboard
  );

  const { title, slug, content, media_type, hero_media_url } = req.body;

  const { data, error } = await supabase
    .from('posts')
    .insert([{ title, slug, content, media_type, hero_media_url }]);

  if (error) return res.status(400).json({ error: error.message });
  return res.status(200).json({ success: true, data });
}
