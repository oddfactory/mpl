// /api/gemini.js (Vercel Serverless Function Proxy with Self-Healing Auto-Discovery)

// Helper: Query available models for the user's API Key dynamically
async function discoverModelName(apiKey) {
  try {
    // 1. Try v1 API first
    let res = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
    let apiVersion = 'v1';
    
    if (!res.ok) {
      // 2. Try v1beta API fallback
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      apiVersion = 'v1beta';
    }

    if (res.ok) {
      const data = await res.json();
      if (data.models && Array.isArray(data.models)) {
        // Filter models that support generateContent
        const candidates = data.models.filter(m => 
          m.supportedGenerationMethods && 
          m.supportedGenerationMethods.includes('generateContent')
        );

        // Look for flash models first, sorted descending to prefer newer versions (e.g. 2.5, 2.0, 1.5)
        const flashCandidates = candidates.filter(m => m.name.toLowerCase().includes('flash'));
        if (flashCandidates.length > 0) {
          flashCandidates.sort((a, b) => b.name.localeCompare(a.name));
          const name = flashCandidates[0].name.replace('models/', '');
          return { modelName: name, apiVersion };
        }

        // Fallback to any model that supports generateContent
        if (candidates.length > 0) {
          const name = candidates[0].name.replace('models/', '');
          return { modelName: name, apiVersion };
        }
      }
    }
  } catch (e) {
    console.error("Auto-discovery failed inside serverless proxy:", e);
  }

  // Fallback defaults if discovery fails completely
  return { modelName: 'gemini-1.5-flash', apiVersion: 'v1' };
}

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
    // Discover the best model name and apiVersion for the key dynamically
    const { modelName, apiVersion } = await discoverModelName(apiKey);
    
    const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();

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
