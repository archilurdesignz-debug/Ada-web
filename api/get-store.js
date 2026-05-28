import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const page = parseInt(req.query.page || '1');
        const limit = 6;
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        const { data, error } = await supabase
            .from('plans')
            .select('*')
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) throw error;

        return res.status(200).json(data || []);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}