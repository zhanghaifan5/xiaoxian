/**
 * 八卦占卜 - 数据收集前端 SDK
 * 数据同时存储到 localStorage（本地备份）和 Supabase（云端汇总）
 * 
 * 安全说明：
 * - SUPABASE_KEY 是 publishable key，Supabase 官方设计为公开
 * - 安全防护依靠 Supabase 后台 RLS 策略：匿名用户只能 INSERT，不能 SELECT/DELETE
 * - 客户端不做 SELECT 操作，仅写入
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'bagua_tracker_data';
  const SESSION_ID = 'bg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  let visitStartTime = Date.now();
  let visitRecorded = false;
  let leaveRecorded = false;
  let insertCount = 0;
  const MAX_INSERTS_PER_SESSION = 50; // 每个 session 最多 50 次写入（防滥用）

  // ===== Supabase 配置 =====
  // publishable key 是 Supabase 设计上公开的，安全靠 RLS 策略
  const SUPABASE_URL = 'https://vaxqenkobsflatavmpta.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2jhVpFm1-1XsGTggIaGzog_m4l1Zihf';

  async function supabaseInsert(table, record) {
    // 写入频率限制
    if (insertCount >= MAX_INSERTS_PER_SESSION) {
      console.warn('Supabase: 写入次数已达上限，忽略本次请求');
      return;
    }
    insertCount++;
    try {
      const resp = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(record)
      });
      if (!resp.ok) console.warn('Supabase insert failed:', table, resp.status);
    } catch(e) {
      console.warn('Supabase network error:', e.message);
    }
  }

  // ===== 浏览器/设备检测 =====
  function detectBrowser(ua) {
    if (ua.includes('Edg/')) return 'Edge';
    if (ua.includes('Chrome/')) return 'Chrome';
    if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari';
    if (ua.includes('Firefox/')) return 'Firefox';
    if (ua.includes('OPR/') || ua.includes('Opera/')) return 'Opera';
    if (ua.includes('Trident/') || ua.includes('MSIE ')) return 'IE';
    return 'Other';
  }

  function detectOS(ua) {
    if (ua.includes('Windows NT')) return 'Windows';
    if (ua.includes('Mac OS X')) return 'macOS';
    if (ua.includes('Android')) return 'Android';
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
    if (ua.includes('Linux')) return 'Linux';
    return 'Other';
  }

  function detectDevice(ua) {
    if (ua.includes('iPhone') || ua.includes('Android') && ua.includes('Mobile')) return 'Mobile';
    if (ua.includes('iPad') || ua.includes('Android') && !ua.includes('Mobile')) return 'Tablet';
    return 'Desktop';
  }

  // ===== localStorage 存储（本地备份） =====
  function loadData() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { visits: [], divinations: [], leaves: [] };
    } catch(e) { return { visits: [], divinations: [], leaves: [] }; }
  }

  function saveData(data) {
    try {
      if (data.visits.length > 500) data.visits = data.visits.slice(-500);
      if (data.divinations.length > 500) data.divinations = data.divinations.slice(-500);
      if (data.leaves.length > 500) data.leaves = data.leaves.slice(-500);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch(e) {
      localStorage.removeItem(STORAGE_KEY);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(e2) {}
    }
  }

  function getTime() {
    const d = new Date();
    // 转为北京时间 UTC+8
    const bj = new Date(d.getTime() + 8 * 3600000);
    return bj.toISOString().replace('T', ' ').slice(0, 19);
  }

  // IP 地理位置查询（免费 API，无需 Key）
  async function fetchGeo() {
    try {
      const resp = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return null;
      const d = await resp.json();
      return {
        ip: d.ip || '',
        country: d.country_name || '',
        country_code: d.country_code || '',
        region: d.region || '',
        city: d.city || '',
        isp: d.org || '',
        latitude: d.latitude || null,
        longitude: d.longitude || null,
        timezone: d.timezone || ''
      };
    } catch(e) {
      console.warn('Geo lookup failed:', e.message);
      return null;
    }
  }

  // 记录访问（localStorage + Supabase）
  async function recordVisit() {
    if (visitRecorded) return;
    visitRecorded = true;

    // 并行：设备检测 + 地理位置查询
    const ua = navigator.userAgent;
    const geo = await fetchGeo();

    const record = {
      session_id: SESSION_ID,
      time: getTime(),
      user_agent: ua,
      browser: detectBrowser(ua),
      os: detectOS(ua),
      device: detectDevice(ua),
      screen_size: screen.width + 'x' + screen.height,
      language: navigator.language,
      referrer: document.referrer || 'direct',
      ip: geo ? geo.ip : '',
      country: geo ? geo.country : '',
      country_code: geo ? geo.country_code : '',
      region: geo ? geo.region : '',
      city: geo ? geo.city : '',
      isp: geo ? geo.isp : '',
      latitude: geo ? geo.latitude : null,
      longitude: geo ? geo.longitude : null,
      timezone: geo ? geo.timezone : ''
    };
    // 本地存储
    const data = loadData();
    data.visits.push(record);
    saveData(data);
    // 上报 Supabase
    supabaseInsert('visits', record);
  }

  // 记录离开
  function recordLeave() {
    if (leaveRecorded) return;
    leaveRecorded = true;
    const duration = Math.floor((Date.now() - visitStartTime) / 1000);
    const record = {
      session_id: SESSION_ID,
      time: getTime(),
      duration_seconds: duration
    };
    const data = loadData();
    data.leaves.push(record);
    saveData(data);
  }

  // 记录占卜（localStorage + Supabase）
  function recordDivination(info) {
    const record = {
      session_id: SESSION_ID,
      time: getTime(),
      ...info
    };
    // 本地存储
    const data = loadData();
    data.divinations.push(record);
    saveData(data);
    // 上报 Supabase
    supabaseInsert('divinations', record);
  }

  // ===== 事件监听 =====
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(recordVisit, 2000);
  });

  window.addEventListener('beforeunload', recordLeave);
  window.addEventListener('pagehide', recordLeave);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') recordLeave();
  });

  // ===== 暴露 API =====
  window.BaguaTracker = {
    getSessionId: function() { return SESSION_ID; },
    recordDivination: recordDivination,
    recordVisit: recordVisit,
    recordLeave: recordLeave
  };

  console.log('📊 八卦数据收集已就绪 | Session:', SESSION_ID, '| Supabase: 已连接');
})();
