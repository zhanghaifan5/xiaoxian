/**
 * 八卦占卜 - 数据收集前端 SDK（纯前端 localStorage 方案）
 * 数据存储在用户浏览器本地，通过 /admin 面板查看
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'bagua_tracker_data';
  const SESSION_ID = 'bg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  let visitStartTime = Date.now();
  let visitRecorded = false;
  let leaveRecorded = false;

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

  // ===== localStorage 存储 =====
  function loadData() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { visits: [], divinations: [], leaves: [] };
    } catch(e) { return { visits: [], divinations: [], leaves: [] }; }
  }

  function saveData(data) {
    try {
      // 限制最多保留 500 条记录
      if (data.visits.length > 500) data.visits = data.visits.slice(-500);
      if (data.divinations.length > 500) data.divinations = data.divinations.slice(-500);
      if (data.leaves.length > 500) data.leaves = data.leaves.slice(-500);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch(e) {
      // localStorage 满了就清空旧的
      localStorage.removeItem(STORAGE_KEY);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(e2) {}
    }
  }

  function getTime() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
  }

  // 记录访问
  function recordVisit() {
    if (visitRecorded) return;
    visitRecorded = true;
    const ua = navigator.userAgent;
    const record = {
      session_id: SESSION_ID,
      time: getTime(),
      user_agent: ua,
      browser: detectBrowser(ua),
      os: detectOS(ua),
      device: detectDevice(ua),
      screen_size: screen.width + 'x' + screen.height,
      language: navigator.language,
      referrer: document.referrer || 'direct'
    };
    const data = loadData();
    data.visits.push(record);
    saveData(data);
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

  // 记录占卜
  function recordDivination(info) {
    const record = {
      session_id: SESSION_ID,
      time: getTime(),
      ...info
    };
    const data = loadData();
    data.divinations.push(record);
    saveData(data);
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

  console.log('📊 八卦数据收集已就绪 | Session:', SESSION_ID);
})();
