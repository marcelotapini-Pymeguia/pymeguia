// Proxy server-side hacia la API de Anthropic.
// La API key vive solo acá (process.env.ANTHROPIC_API_KEY), nunca en el cliente.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: { message: 'Method not allowed' } })
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' } })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: { message: 'Body inválido, se esperaba JSON.' } })
    };
  }

  const { system, messages } = payload;
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: { message: '"messages" debe ser un array no vacío.' } })
    };
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        // Cubre pensamiento + texto; el JSON final de resultados multi-producto es largo.
        max_tokens: 2048,
        // En Sonnet 5.5 sin este campo piensa antes de responder (mas latencia y costo);
        // "disabled" da error 400, "between_tools" es el ajuste mas bajo.
        thinking: { type: 'between_tools' },
        output_config: { effort: 'medium' },
        system: system || '',
        messages
      })
    });

    const data = await anthropicRes.json();

    return {
      statusCode: anthropicRes.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (e) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: { message: 'Error contactando a Anthropic: ' + e.message } })
    };
  }
};
