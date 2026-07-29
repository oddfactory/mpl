// /api/gemini.js (Vercel Serverless Function Proxy)

export default async function handler(req, res) {
  // 1. GET Request: Check if Gemini API key is configured on the server
  if (req.method === 'GET') {
    const hasKey = !!process.env.GEMINI_API_KEY;
    return res.status(200).json({ configured: hasKey });
  }

  // 2. POST Request: Proxy client questions to Gemini securely
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt } = req.body || {};
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: '서버 환경 변수에 GEMINI_API_KEY가 설정되지 않았습니다.' });
  }

  try {
    // Try using gemini-3.1-flash as preferred version
    let modelName = 'gemini-3.1-flash';
    let url = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${apiKey}`;
    
    let response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    let data = await response.json();

    // Fallback: If gemini-3.1-flash is not available/supported, fall back to stable gemini-1.5-flash
    if (!response.ok && data.error?.message && 
        (data.error.message.includes('not found') || data.error.message.includes('not supported'))) {
      modelName = 'gemini-1.5-flash';
      url = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${apiKey}`;
      
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });
      data = await response.json();
    }

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: data.error?.message || 'Gemini API 호출 중 에러가 발생했습니다.' 
      });
    }

    const replyText = data.candidates[0].content.parts[0].text;
    return res.status(200).json({ text: replyText, model: modelName });
  } catch (error) {
    console.error("Vercel Proxy Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
