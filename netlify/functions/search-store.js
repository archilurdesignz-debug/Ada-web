const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const _db = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_KEY
    );

    const q = event.queryStringParameters?.q || '';

    const { data, error } = await _db
        .from('plans')
        .select('*')
        .or(`title.ilike.%${q}%,meta.ilike.%${q}%,category.ilike.%${q}%`)
        .limit(20);

    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data || [])
    };
};