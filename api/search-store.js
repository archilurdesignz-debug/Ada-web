import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const q = req.query.q || '';

        const { data, error } = await supabase
            .from('plans')
            .select('*')
            .or(`title.ilike.%${q}%,meta.ilike.%${q}%,category.ilike.%${q}%`)
            .limit(20);

        if (error) throw error;

        return res.status(200).json(data || []);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}