const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const _db = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_KEY
    );

    const page  = parseInt(event.queryStringParameters?.page || '1');
    const limit = 6;
    const from  = (page - 1) * limit;
    const to    = from + limit - 1;

    const { data, error } = await _db
        .from('plans')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to);

    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data)
    };
};