'use strict';
/* 공통: 서버 호출, 표시 도우미 */
async function api(path, opts = {}) {
  const r = await fetch(path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin'
  });
  let j = {};
  try { j = await r.json(); } catch (_) {}
  if (!r.ok) { const e = new Error(j.error || '요청을 처리하지 못했습니다.'); e.status = r.status; e.reason = j.reason; throw e; }
  return j;
}
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');
function toast(msg, ms = 2800) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }
function dday(ymd, today) { const a = new Date(today + 'T00:00:00Z'), b = new Date(ymd + 'T00:00:00Z'); return Math.round((b - a) / 86400000); }
async function logout() { try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) {} location.href = '/login'; }
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('복사했습니다'); } catch (_) { toast(t, 6000); } }
