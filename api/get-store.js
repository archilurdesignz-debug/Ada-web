import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { id, page, search } = req.query;

        // Single plan by id
        if (id) {
            const { data, error } = await supabase
                .from('plans')
                .select('*')
                .eq('id', id)
                .single();

            if (error || !data) return res.status(404).json({ error: 'Plan not found' });
            return res.status(200).json(data);
        }

        // Full-text search across title, meta, category
        if (search) {
            const q = search.toLowerCase();
            const { data, error } = await supabase
                .from('plans')
                .select('*')
                .or(`title.ilike.%${q}%,meta.ilike.%${q}%,category.ilike.%${q}%,price.ilike.%${q}%`)
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) throw error;
            return res.status(200).json(data || []);
        }

        // Paginated listing
        const pageNum = parseInt(page || '1');
        const limit = 6;
        const from = (pageNum - 1) * limit;
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
