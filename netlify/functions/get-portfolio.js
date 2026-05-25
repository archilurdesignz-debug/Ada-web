const { createClient } = require('@supabase/supabase-js');

exports.handler = async () => {
    const _db = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_KEY
    );

    const { data, error } = await _db
        .from('portfolio')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data || [])
    };
};