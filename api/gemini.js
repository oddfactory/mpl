// /api/gemini.js (Vercel Serverless Function Proxy with Cascading Retry Fallback)

// Helper: Query all available models for the user's API Key dynamically
async function discoverCandidates(apiKey) {
  const defaultList = [
    { modelName: 'gemini-1.5-flash', apiVersion: 'v1' }
  ];
  
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

        // Filter and sort flash models (newer first)
        const flashCandidates = candidates.filter(m => m.name.toLowerCase().includes('flash'));
        if (flashCandidates.length > 0) {
          flashCandidates.sort((a, b) => b.name.localeCompare(a.name));
          return flashCandidates.map(m => ({
            modelName: m.name.replace('models/', ''),
            apiVersion
          }));
        }

        // Fallback to any model that supports generateContent
        if (candidates.length > 0) {
          return candidates.map(m => ({
            modelName: m.name.replace('models/', ''),
            apiVersion
          }));
        }
      }
    }
  } catch (e) {
    console.error("Auto-discovery failed inside serverless proxy:", e);
  }

  return defaultList;
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
    // Get candidate list sorted by preference
    const candidates = await discoverCandidates(apiKey);
    
    let response;
    let data;
    let successfulModel;

    // Loop through candidates and retry on failure (high demand, rate limit, etc.)
    for (let i = 0; i < candidates.length; i++) {
      const { modelName, apiVersion } = candidates[i];
      console.log(`Trying model [${i + 1}/${candidates.length}]: ${modelName} (${apiVersion})`);
      
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;
      
      try {
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

        if (response.ok) {
          successfulModel = modelName;
          break; // Success! Exit loop
        }

        console.warn(`Model ${modelName} failed with error: ${data.error?.message || 'Unknown error'}. Trying next candidate...`);
      } catch (err) {
        console.error(`Request to ${modelName} crashed:`, err);
      }
    }

    if (!response || !response.ok) {
      return res.status(response ? response.status : 500).json({ 
        error: data?.error?.message || 'Gemini API 모든 모델이 현재 과부하 상태이거나 호출에 실패했습니다.' 
      });
    }

    const replyText = data.candidates[0].content.parts[0].text;
    return res.status(200).json({ text: replyText, model: successfulModel });
  } catch (error) {
    console.error("Vercel Proxy Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
