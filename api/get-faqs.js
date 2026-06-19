import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { category } = req.query;

        let query = supabase
            .from('faqs')
            .select('id, category, question, answer')
            .order('category', { ascending: true })
            .order('sort_order', { ascending: true });

        if (category) {
            query = query.eq('category', category);
        }

        const { data, error } = await query;
        if (error) throw error;

        return res.status(200).json(data || []);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
