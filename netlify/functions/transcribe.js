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

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: { message: 'Body inválido, se esperaba JSON.' } })
    };
  }

  const { audio, mimeType } = payload;
  if (!audio) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: { message: '"audio" (base64) es obligatorio.' } })
    };
  }

  try {
    const audioBuffer = Buffer.from(audio, 'base64');
    const type = mimeType || 'audio/webm';
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
