/**
 * 八卦占卜 - 安全数据代理
 * 
 * 用途：代理 Supabase 查询，service_role key 不暴露在前端
 * 密码验证在服务端完成，前端无法绕过
 * 
 * 部署到 CloudStudio 后，admin 页面通过此代理访问数据
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

// ===== 配置（部署时修改） =====
const SUPABASE_URL = 'https://vaxqenkobsflatavmpta.supabase.co';
// ⚠️ 请去 Supabase Dashboard → Settings → API → service_role key 获取
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY || 'YOUR_SERVICE_ROLE_KEY_HERE';

// 密码 SHA-256 哈希（与 admin.html 相同密码）
// 默认密码的哈希，修改密码请改这个
const PASSWORD_HASH = 'c1a96a9aa5bbe75aae6ae522d122968b089c5d211e19ffb8d59462c615996b63';

// 有效 token 存储（登录后 24 小时有效）
const validTokens = new Map();
const TOKEN_TTL = 24 * 60 * 60 * 1000; // 24小时

// 清理过期 token（每10分钟）
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of validTokens) {
    if (now > expiry) validTokens.delete(token);
  }
}, 10 * 60 * 1000);

// ===== 工具函数 =====
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

function sendJSON(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

// 验证 token
function verifyAuth(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return false;
  const expiry = validTokens.get(token);
  if (!expiry || Date.now() > expiry) {
    validTokens.delete(token);
    return false;
  }
  return true;
}

// Supabase 查询（使用 service_role key）
function supabaseQuery(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + '/rest/v1/' + path);
    const options = {
      method: 'GET',
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + SERVICE_ROLE_KEY
      }
    };
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve([]); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ===== API 路由 =====
async function handleRequest(req, res) {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
    });
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  // POST /api/login — 密码登录，返回 token
  if (req.method === 'POST' && path === '/api/login') {
    const body = await parseBody(req);
    const pwdHash = sha256(body.password || '');
    if (pwdHash === PASSWORD_HASH) {
      const token = generateToken();
      validTokens.set(token, Date.now() + TOKEN_TTL);
      sendJSON(res, 200, { token });
    } else {
      sendJSON(res, 401, { error: '密码错误' });
    }
    return;
  }

  // GET /api/verify — 验证 token 是否有效
  if (req.method === 'GET' && path === '/api/verify') {
    sendJSON(res, 200, { valid: verifyAuth(req) });
    return;
  }

  // 以下 API 需要 token 验证
  if (!verifyAuth(req)) {
    sendJSON(res, 401, { error: '未登录或登录已过期' });
    return;
  }

  // GET /api/data/visits — 获取访问数据
  if (req.method === 'GET' && path === '/api/data/visits') {
    try {
      const data = await supabaseQuery('visits?select=*&order=time.desc&limit=5000');
      sendJSON(res, 200, data);
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  // GET /api/data/divinations — 获取占卜数据
  if (req.method === 'GET' && path === '/api/data/divinations') {
    try {
      const data = await supabaseQuery('divinations?select=*&order=time.desc&limit=5000');
      sendJSON(res, 200, data);
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  // 404
  sendJSON(res, 404, { error: 'Not Found' });
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`🔒 安全数据代理已启动: http://localhost:${PORT}`);
  console.log(`📡 Supabase: ${SUPABASE_URL}`);
  console.log(`🔑 Service Role Key: ${SERVICE_ROLE_KEY === 'YOUR_SERVICE_ROLE_KEY_HERE' ? '⚠️ 请设置 SERVICE_ROLE_KEY 环境变量' : '✅ 已配置'}`);
});
