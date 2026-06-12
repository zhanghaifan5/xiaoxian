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

// ===== 配置 =====
const SUPABASE_URL = 'https://vaxqenkobsflatavmpta.supabase.co';
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY;
// 密码哈希 + 盐值，均从环境变量读取
const PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const PASSWORD_SALT = process.env.ADMIN_PASSWORD_SALT || 'bagua_admin_salt_2024';

// 允许的 CORS 来源（限制为你的 GitHub Pages 域名）
const ALLOWED_ORIGINS = [
  'https://zhanghaifan5.github.io',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:3000'
];

// 登录频率限制
const loginAttempts = new Map(); // ip -> { count, resetTime }
const MAX_LOGIN_ATTEMPTS = 10;    // 每个 IP 最多尝试 10 次
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 分钟窗口

// 有效 token 存储
const validTokens = new Map();
const TOKEN_TTL = 8 * 60 * 60 * 1000; // 8 小时

// 清理过期数据
setInterval(() => {
  const now = Date.now();
  for (const [key, expiry] of validTokens) {
    if (now > expiry) validTokens.delete(key);
  }
  for (const [ip, record] of loginAttempts) {
    if (now > record.resetTime) loginAttempts.delete(ip);
  }
}, 10 * 60 * 1000);

// ===== 工具函数 =====
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function hashPassword(password) {
  // 带盐哈希：sha256(password + salt)
  return sha256(password + PASSWORD_SALT);
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

function getClientIP(req) {
  // 优先取代理转发的真实 IP
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket.remoteAddress
    || 'unknown';
}

function sendJSON(res, code, data, origin) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
  };
  // 只允许白名单来源
  if (origin && ALLOWED_ORIGINS.some(o => origin.startsWith(o))) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  res.writeHead(code, headers);
  res.end(JSON.stringify(data));
}

// 验证 token
function verifyAuth(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '');
  if (!token || token.length !== 64) return false; // 32字节hex = 64字符
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

// ===== 启动检查 =====
if (!SERVICE_ROLE_KEY) {
  console.error('❌ 致命错误：未设置 SERVICE_ROLE_KEY 环境变量');
  process.exit(1);
}
if (!PASSWORD_HASH) {
  console.error('❌ 致命错误：未设置 ADMIN_PASSWORD_HASH 环境变量');
  process.exit(1);
}

// ===== API 路由 =====
async function handleRequest(req, res) {
  const origin = req.headers['origin'] || '';

  // CORS 预检
  if (req.method === 'OPTIONS') {
    const headers = {
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
    };
    if (origin && ALLOWED_ORIGINS.some(o => origin.startsWith(o))) {
      headers['Access-Control-Allow-Origin'] = origin;
    }
    res.writeHead(200, headers);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const clientIP = getClientIP(req);

  // POST /api/login — 密码登录，返回 token（带频率限制）
  if (req.method === 'POST' && path === '/api/login') {
    // 频率限制检查
    const now = Date.now();
    let attempt = loginAttempts.get(clientIP);
    if (!attempt || now > attempt.resetTime) {
      attempt = { count: 0, resetTime: now + LOGIN_WINDOW_MS };
      loginAttempts.set(clientIP, attempt);
    }
    attempt.count++;
    if (attempt.count > MAX_LOGIN_ATTEMPTS) {
      console.warn(`[安全] IP ${clientIP} 登录尝试过多，已限制`);
      sendJSON(res, 429, { error: '尝试次数过多，请15分钟后再试' }, origin);
      return;
    }

    const body = await parseBody(req);
    const pwdHash = hashPassword(body.password || '');
    if (pwdHash === PASSWORD_HASH) {
      const token = generateToken();
      validTokens.set(token, Date.now() + TOKEN_TTL);
      // 登录成功，重置该 IP 的计数
      loginAttempts.delete(clientIP);
      sendJSON(res, 200, { token }, origin);
    } else {
      sendJSON(res, 401, { error: '密码错误' }, origin);
    }
    return;
  }

  // GET /api/verify — 验证 token 是否有效
  if (req.method === 'GET' && path === '/api/verify') {
    sendJSON(res, 200, { valid: verifyAuth(req) }, origin);
    return;
  }

  // GET /api/health — 健康检查（无需鉴权，不暴露敏感信息）
  if (req.method === 'GET' && path === '/api/health') {
    sendJSON(res, 200, { status: 'ok' }, origin);
    return;
  }

  // 以下 API 需要 token 验证
  if (!verifyAuth(req)) {
    sendJSON(res, 401, { error: '未登录或登录已过期' }, origin);
    return;
  }

  // GET /api/data/visits — 获取访问数据
  if (req.method === 'GET' && path === '/api/data/visits') {
    try {
      const data = await supabaseQuery('visits?select=*&order=time.desc&limit=5000');
      sendJSON(res, 200, data, origin);
    } catch (e) {
      sendJSON(res, 500, { error: e.message }, origin);
    }
    return;
  }

  // GET /api/data/divinations — 获取占卜数据
  if (req.method === 'GET' && path === '/api/data/divinations') {
    try {
      const data = await supabaseQuery('divinations?select=*&order=time.desc&limit=5000');
      sendJSON(res, 200, data, origin);
    } catch (e) {
      sendJSON(res, 500, { error: e.message }, origin);
    }
    return;
  }

  // 404
  sendJSON(res, 404, { error: 'Not Found' }, origin);
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`🔒 安全数据代理已启动: http://localhost:${PORT}`);
  console.log(`📡 Supabase: ${SUPABASE_URL}`);
  console.log(`🔐 安全配置: 带盐密码 | CORS白名单 | 登录频率限制 | Token 8h`);
});
