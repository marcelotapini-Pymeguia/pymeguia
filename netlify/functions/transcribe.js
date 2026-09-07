// Proxy server-side hacia la API de transcripcion de Groq (compatible con OpenAI).
// La API key vive solo aca (process.env.GROQ_API_KEY), nunca en el cliente.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: { message: 'Method not allowed' } })
    };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: 'Falta configurar GROQ_API_KEY en el servidor.' } })
    };
  }

  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: { message: 'Falta el audio en el body.' } })
    };
  }

  try {
    const audioBuffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || 'audio/webm';
    const type = contentType.split(';')[0].trim();
    const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';

    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type }), `audio.${ext}`);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('language', 'es');

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData
    });

    const data = await groqRes.json();

    return {
      statusCode: groqRes.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (e) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: { message: 'Error contactando a Groq: ' + e.message } })
    };
  }
};
