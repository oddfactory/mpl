// /api/login.js (Vercel Serverless Function for Secure Password Verification)

export default async function handler(req, res) {
  const serverPassword = process.env.DASHBOARD_PASSWORD;

  // 1. GET Request: Check if password protection is enabled on the server
  if (req.method === 'GET') {
    return res.status(200).json({ required: !!serverPassword });
  }

  // 2. POST Request: Verify user-inputted password
  if (req.method === 'POST') {
    const { password } = req.body || {};
    
    if (!serverPassword) {
      // If no password is configured, login is always successful
      return res.status(200).json({ success: true });
    }

    if (password === serverPassword) {
      return res.status(200).json({ success: true });
    } else {
      return res.status(401).json({ success: false, error: '비밀번호가 올바르지 않습니다.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
