'use strict';
/*
 * 착공계 원스톱 — 판매용 서버
 * - 회원가입/로그인 (세션 쿠키)
 * - 라이선스 키 (만료일, 정지, 라이선스당 IP 최대 N개)
 * - 계좌이체 신청 → 관리자 입금확인 → 라이선스 자동 발급/연장
 * - 관리자 페이지 API
 * - 착공계 프로그램 데이터 저장 (회사정보, 프로젝트, 첨부 이미지)
 */
require('./env');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { db, getSettings, saveSettings } = require('./db');

const PORT = +(process.env.PORT || 3000);
const SESSION_DAYS = +(process.env.SESSION_DAYS || 30);
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const VIEWS = path.join(__dirname, 'views');

const app = express();
app.disable('x-powered-by');
// 리버스 프록시(nginx, 클라우드 로드밸런서) 뒤에서 실제 접속 IP를 얻으려면 TRUST_PROXY=1
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? +process.env.TRUST_PROXY : process.env.TRUST_PROXY);
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

/* ---------------- 공통 함수 ---------------- */
const todayKST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
function addMonths(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
function addDays(ymd, n) { const t = new Date(ymd + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
const isYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
function clientIp(req) {
  let ip = req.ip || req.socket.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}
const KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newLicenseKey() {
  for (;;) {
    const g = () => Array.from({ length: 4 }, () => KEY_CHARS[crypto.randomInt(KEY_CHARS.length)]).join('');
    const key = `CK-${g()}-${g()}-${g()}-${g()}`;
    if (!db.prepare('SELECT 1 FROM licenses WHERE license_key=?').get(key)) return key;
  }
}
const normKey = k => String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^CK/, '').replace(/(.{4})(?=.)/g, '$1-').replace(/^/, 'CK-');
function audit(req, action, detail) {
  try { db.prepare('INSERT INTO audit_log(actor_id,action,detail,ip) VALUES(?,?,?,?)').run(req.user ? req.user.id : null, action, typeof detail === 'string' ? detail : JSON.stringify(detail || {}), clientIp(req)); } catch (_) {}
}
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

/* ---------------- 세션 ---------------- */
function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, userId, exp);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, maxAge: SESSION_DAYS * 86400000, path: '/' });
}
app.use((req, res, next) => {
  const t = req.cookies.sid;
  if (t) {
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at > ?`).get(t, new Date().toISOString());
    if (row && !row.disabled) { req.user = row; req.sid = t; }
  }
  next();
});
// 다른 사이트에서 위조 요청을 보내지 못하도록, API 변경 요청에는 사용자 정의 헤더를 요구
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'fetch') return bad(res, '잘못된 요청입니다.', 403);
  next();
});

/* ---------------- 라이선스·IP 판정 ---------------- */
function licenseOf(userId) { return db.prepare('SELECT * FROM licenses WHERE user_id=?').get(userId); }
function ipsOf(licenseId) { return db.prepare('SELECT id, ip, label, created_at, last_seen_at FROM license_ips WHERE license_id=? ORDER BY id').all(licenseId); }
function accessFor(user, ip) {
  if (!user) return { ok: false, reason: 'login' };
  if (user.role === 'admin') return { ok: true, admin: true };
  const lic = licenseOf(user.id);
  if (!lic) return { ok: false, reason: 'no_license' };
  if (lic.status !== 'active') return { ok: false, reason: 'suspended', license: lic };
  const today = todayKST();
  if (today > lic.expires_at) return { ok: false, reason: 'expired', license: lic };
  if (today < lic.starts_at) return { ok: false, reason: 'not_started', license: lic };
  const ips = ipsOf(lic.id);
  const hit = ips.find(x => x.ip === ip);
  if (!hit) return { ok: false, reason: 'ip', license: lic, ips, canRegister: ips.length < lic.max_ips };
  return { ok: true, license: lic, ipRow: hit };
}
const lastSeenStmt = db.prepare(`UPDATE license_ips SET last_seen_at=datetime('now') WHERE id=? AND (last_seen_at IS NULL OR last_seen_at < datetime('now','-5 minutes'))`);
const REASON_MSG = {
  login: '로그인이 필요합니다.', no_license: '사용 중인 라이선스가 없습니다.', suspended: '라이선스가 정지되었습니다. 관리자에게 문의하세요.',
  expired: '라이선스 사용 기간이 끝났습니다. 연장 신청을 해주세요.', not_started: '라이선스 사용 시작일 전입니다.', ip: '등록되지 않은 IP에서 접속했습니다.'
};
function requireLogin(req, res, next) { if (!req.user) return bad(res, REASON_MSG.login, 401); next(); }
function requireAdmin(req, res, next) { if (!req.user || req.user.role !== 'admin') return bad(res, '관리자만 사용할 수 있습니다.', 403); next(); }
function requireAccess(req, res, next) {
  const a = accessFor(req.user, clientIp(req));
  if (!a.ok) return res.status(a.reason === 'login' ? 401 : 403).json({ error: REASON_MSG[a.reason], reason: a.reason });
  if (a.ipRow) lastSeenStmt.run(a.ipRow.id);
  next();
}

/* ---------------- 로그인 시도 제한 ---------------- */
const attempts = new Map();
function tooMany(key) {
  const now = Date.now(); const a = (attempts.get(key) || []).filter(t => now - t < 15 * 60000);
  attempts.set(key, a); return a.length >= 10;
}
const noteAttempt = key => { const a = attempts.get(key) || []; a.push(Date.now()); attempts.set(key, a); };

/* ================= 인증 API ================= */
app.post('/api/auth/signup', async (req, res) => {
  const email = str(req.body.email, 120).toLowerCase(), password = String(req.body.password || '');
  const name = str(req.body.name, 50), company = str(req.body.company, 100), phone = str(req.body.phone, 30);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, '이메일 형식을 확인하세요.');
  if (password.length < 8) return bad(res, '비밀번호는 8자 이상으로 정하세요.');
  if (!name) return bad(res, '이름을 입력하세요.');
  if (!req.body.agree) return bad(res, '이용약관과 개인정보 수집·이용에 동의해야 가입할 수 있습니다.');
  if (tooMany('signup:' + clientIp(req))) return bad(res, '잠시 후 다시 시도하세요.', 429);
  noteAttempt('signup:' + clientIp(req));
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return bad(res, '이미 가입된 이메일입니다.');
  const hash = await bcrypt.hash(password, 10);
  const r = db.prepare('INSERT INTO users(email,password_hash,name,company,phone) VALUES(?,?,?,?,?)').run(email, hash, name, company, phone);
  createSession(res, r.lastInsertRowid);
  res.json({ ok: true });
});
app.post('/api/auth/login', async (req, res) => {
  const email = str(req.body.email, 120).toLowerCase(), password = String(req.body.password || '');
  const k = 'login:' + clientIp(req);
  if (tooMany(k)) return bad(res, '로그인 시도가 너무 많습니다. 15분 후 다시 시도하세요.', 429);
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) { noteAttempt(k); return bad(res, '이메일 또는 비밀번호가 맞지 않습니다.', 401); }
  if (u.disabled) return bad(res, '사용이 중지된 계정입니다. 관리자에게 문의하세요.', 403);
  db.prepare(`UPDATE users SET last_login_at=datetime('now') WHERE id=?`).run(u.id);
  createSession(res, u.id);
  res.json({ ok: true, role: u.role });
});
app.post('/api/auth/logout', (req, res) => {
  if (req.sid) db.prepare('DELETE FROM sessions WHERE token=?').run(req.sid);
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});
app.post('/api/auth/password', requireLogin, async (req, res) => {
  const cur = String(req.body.current || ''), next = String(req.body.password || '');
  if (!(await bcrypt.compare(cur, req.user.password_hash))) return bad(res, '현재 비밀번호가 맞지 않습니다.');
  if (next.length < 8) return bad(res, '새 비밀번호는 8자 이상으로 정하세요.');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await bcrypt.hash(next, 10), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(req.user.id, req.sid);
  res.json({ ok: true });
});

/* ================= 내 정보·라이선스 ================= */
function publicLicense(lic) {
  if (!lic) return null;
  return { key: lic.license_key, plan: lic.plan_name, status: lic.status, startsAt: lic.starts_at, expiresAt: lic.expires_at, maxIps: lic.max_ips, ips: ipsOf(lic.id) };
}
app.get('/api/me', requireLogin, (req, res) => {
  const u = req.user; const ip = clientIp(req); const a = accessFor(u, ip);
  res.json({
    user: { id: u.id, email: u.email, name: u.name, company: u.company, phone: u.phone, role: u.role },
    ip, access: { ok: a.ok, reason: a.reason || null, message: a.ok ? '' : REASON_MSG[a.reason], canRegister: !!a.canRegister },
    license: publicLicense(licenseOf(u.id)), today: todayKST()
  });
});
app.post('/api/license/activate', requireLogin, (req, res) => {
  const key = normKey(req.body.key);
  if (tooMany('key:' + req.user.id)) return bad(res, '시도가 너무 많습니다. 잠시 후 다시 시도하세요.', 429);
  const lic = db.prepare('SELECT * FROM licenses WHERE license_key=?').get(key);
  if (!lic) { noteAttempt('key:' + req.user.id); return bad(res, '라이선스 키를 찾을 수 없습니다. 다시 확인하세요.'); }
  if (lic.user_id && lic.user_id !== req.user.id) return bad(res, '이미 다른 계정에서 사용 중인 키입니다.');
  const mine = licenseOf(req.user.id);
  if (mine && mine.id !== lic.id) return bad(res, '이 계정에는 이미 라이선스가 있습니다. 연장은 이용권 신청으로 하세요.');
  db.prepare(`UPDATE licenses SET user_id=?, updated_at=datetime('now') WHERE id=?`).run(req.user.id, lic.id);
  audit(req, 'license.activate', { key });
  res.json({ ok: true });
});
app.post('/api/license/ips', requireLogin, (req, res) => {
  const lic = licenseOf(req.user.id);
  if (!lic) return bad(res, '먼저 라이선스를 등록하세요.');
  const ip = clientIp(req); const label = str(req.body.label, 40) || '등록 IP';
  const ips = ipsOf(lic.id);
  if (ips.find(x => x.ip === ip)) return res.json({ ok: true });
  if (ips.length >= lic.max_ips) return bad(res, `IP는 최대 ${lic.max_ips}개까지 등록할 수 있습니다. 변경이 필요하면 관리자에게 문의하세요.`);
  db.prepare('INSERT INTO license_ips(license_id,ip,label) VALUES(?,?,?)').run(lic.id, ip, label);
  audit(req, 'license.ip.add', { ip, label });
  res.json({ ok: true });
});

/* ================= 이용권 신청 (계좌이체) ================= */
app.get('/api/shop', requireLogin, (req, res) => {
  const s = getSettings();
  res.json({ brand: s.brand, plans: s.plans.filter(p => p.active !== false), bank: s.bank, notice: s.notice, contact: s.contact });
});
app.post('/api/orders', requireLogin, (req, res) => {
  const s = getSettings(); const plan = s.plans.find(p => p.id === req.body.planId && p.active !== false);
  if (!plan) return bad(res, '이용권을 선택하세요.');
  const depositor = str(req.body.depositor, 40); if (!depositor) return bad(res, '입금자명을 입력하세요.');
  if (!s.bank.account) return bad(res, '아직 입금 계좌가 준비되지 않았습니다. 관리자에게 문의하세요.');
  const pending = db.prepare(`SELECT COUNT(*) n FROM orders WHERE user_id=? AND status='pending'`).get(req.user.id).n;
  if (pending >= 3) return bad(res, '확인 대기 중인 신청이 이미 있습니다. 입금 확인 후 다시 신청하세요.');
  const r = db.prepare('INSERT INTO orders(user_id,plan_id,plan_name,months,amount,depositor,biz_no,tax_email,memo) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(req.user.id, plan.id, plan.name, plan.months, plan.price, depositor, str(req.body.bizNo, 20), str(req.body.taxEmail, 120), str(req.body.memo, 500));
  audit(req, 'order.create', { id: r.lastInsertRowid, plan: plan.id });
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.get('/api/orders/mine', requireLogin, (req, res) => {
  res.json(db.prepare('SELECT id, plan_name, months, amount, depositor, status, created_at, processed_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id));
});
app.post('/api/orders/:id/cancel', requireLogin, (req, res) => {
  const r = db.prepare(`UPDATE orders SET status='cancelled', processed_at=datetime('now') WHERE id=? AND user_id=? AND status='pending'`).run(+req.params.id, req.user.id);
  if (!r.changes) return bad(res, '취소할 수 없는 신청입니다.');
  res.json({ ok: true });
});

/* ================= 착공계 데이터 (라이선스·IP 확인 필수) ================= */
const data = express.Router();
data.use(requireLogin, requireAccess);
data.get('/', (req, res) => {
  const c = db.prepare(`SELECT value FROM user_kv WHERE user_id=? AND key='company'`).get(req.user.id);
  const projects = db.prepare('SELECT data FROM projects WHERE user_id=? ORDER BY updated_at DESC').all(req.user.id).map(r => JSON.parse(r.data));
  res.json({ company: c ? JSON.parse(c.value) : null, projects });
});
data.put('/company', (req, res) => {
  db.prepare(`INSERT INTO user_kv(user_id,key,value) VALUES(?, 'company', ?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`).run(req.user.id, JSON.stringify(req.body || {}));
  res.json({ ok: true });
});
const idOk = s => /^[A-Za-z0-9_-]{1,64}$/.test(s);
data.put('/projects/:id', (req, res) => {
  if (!idOk(req.params.id)) return bad(res, '잘못된 프로젝트 ID');
  const n = db.prepare('SELECT COUNT(*) n FROM projects WHERE user_id=?').get(req.user.id).n;
  const exists = db.prepare('SELECT 1 FROM projects WHERE user_id=? AND id=?').get(req.user.id, req.params.id);
  if (!exists && n >= 500) return bad(res, '프로젝트는 500개까지 저장할 수 있습니다.');
  db.prepare(`INSERT INTO projects(id,user_id,data) VALUES(?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET data=excluded.data, updated_at=datetime('now')`).run(req.params.id, req.user.id, JSON.stringify(req.body || {}));
  res.json({ ok: true });
});
data.delete('/projects/:id', (req, res) => { db.prepare('DELETE FROM projects WHERE user_id=? AND id=?').run(req.user.id, req.params.id); res.json({ ok: true }); });
data.put('/images/:id', (req, res) => {
  if (!idOk(req.params.id)) return bad(res, '잘못된 이미지 ID');
  const d = String((req.body || {}).data || '');
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(d)) return bad(res, '이미지 형식이 아닙니다.');
  if (d.length > 6 * 1024 * 1024) return bad(res, '이미지가 너무 큽니다.');
  db.prepare('INSERT INTO images(id,user_id,data) VALUES(?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET data=excluded.data').run(req.params.id, req.user.id, d);
  res.json({ ok: true });
});
data.get('/images/:id', (req, res) => {
  const r = db.prepare('SELECT data FROM images WHERE user_id=? AND id=?').get(req.user.id, req.params.id);
  if (!r) return bad(res, '없음', 404);
  res.json({ data: r.data });
});
data.delete('/images/:id', (req, res) => { db.prepare('DELETE FROM images WHERE user_id=? AND id=?').run(req.user.id, req.params.id); res.json({ ok: true }); });
app.use('/api/data', data);

/* ================= 관리자 API ================= */
const admin = express.Router();
admin.use(requireAdmin);
admin.get('/summary', (req, res) => {
  const t = todayKST(), soon = addDays(t, 30);
  res.json({
    pendingOrders: db.prepare(`SELECT COUNT(*) n FROM orders WHERE status='pending'`).get().n,
    activeLicenses: db.prepare(`SELECT COUNT(*) n FROM licenses WHERE status='active' AND expires_at>=?`).get(t).n,
    expiringSoon: db.prepare(`SELECT COUNT(*) n FROM licenses WHERE status='active' AND expires_at>=? AND expires_at<=?`).get(t, soon).n,
    expired: db.prepare(`SELECT COUNT(*) n FROM licenses WHERE expires_at<?`).get(t).n,
    users: db.prepare(`SELECT COUNT(*) n FROM users WHERE role='user'`).get().n,
    monthRevenue: db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM orders WHERE status='confirmed' AND substr(processed_at,1,7)=substr(?,1,7)`).get(t).s,
    today: t
  });
});
admin.get('/orders', (req, res) => {
  const st = ['pending', 'confirmed', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const rows = db.prepare(`SELECT o.*, u.email, u.name AS user_name, u.company AS user_company, u.phone AS user_phone, l.license_key
    FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN licenses l ON l.id=o.license_id ${st ? 'WHERE o.status=?' : ''} ORDER BY o.id DESC LIMIT 300`).all(...(st ? [st] : []));
  res.json(rows);
});
admin.post('/orders/:id/confirm', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(+req.params.id);
  if (!o || o.status !== 'pending') return bad(res, '입금 대기 상태의 신청만 확인할 수 있습니다.');
  const s = getSettings(); const plan = s.plans.find(p => p.id === o.plan_id) || {};
  const t = todayKST();
  const tx = db.transaction(() => {
    let lic = licenseOf(o.user_id); let action;
    if (lic) { // 연장: 남은 기간이 있으면 만료일부터, 지났으면 오늘부터
      const base = lic.expires_at >= t ? addDays(lic.expires_at, 1) : t;
      db.prepare(`UPDATE licenses SET expires_at=?, plan_name=?, status='active', max_ips=MAX(max_ips, ?), updated_at=datetime('now') WHERE id=?`).run(addDays(addMonths(base, o.months), -1), o.plan_name, plan.maxIps || 3, lic.id);
      action = 'extend';
    } else {
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(o.user_id);
      const r = db.prepare('INSERT INTO licenses(license_key,user_id,plan_name,starts_at,expires_at,max_ips,customer_name,customer_company,customer_phone) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(newLicenseKey(), o.user_id, o.plan_name, t, addDays(addMonths(t, o.months), -1), plan.maxIps || 3, u.name, u.company, u.phone);
      lic = { id: r.lastInsertRowid }; action = 'issue';
    }
    db.prepare(`UPDATE orders SET status='confirmed', processed_at=datetime('now'), license_id=?, admin_memo=? WHERE id=?`).run(lic.id, str(req.body.memo, 300), o.id);
    return { action, license: db.prepare('SELECT * FROM licenses WHERE id=?').get(lic.id) };
  });
  const out = tx(); audit(req, 'order.confirm', { order: o.id, action: out.action });
  res.json({ ok: true, action: out.action, licenseKey: out.license.license_key, expiresAt: out.license.expires_at });
});
admin.post('/orders/:id/cancel', (req, res) => {
  const r = db.prepare(`UPDATE orders SET status='cancelled', processed_at=datetime('now'), admin_memo=? WHERE id=? AND status='pending'`).run(str(req.body.memo, 300), +req.params.id);
  if (!r.changes) return bad(res, '대기 중인 신청만 취소할 수 있습니다.');
  audit(req, 'order.cancel', { order: +req.params.id }); res.json({ ok: true });
});
admin.get('/licenses', (req, res) => {
  const q = '%' + str(req.query.q, 80) + '%';
  const rows = db.prepare(`SELECT l.*, u.email FROM licenses l LEFT JOIN users u ON u.id=l.user_id
    WHERE l.license_key LIKE ? OR l.customer_name LIKE ? OR l.customer_company LIKE ? OR IFNULL(u.email,'') LIKE ? OR l.memo LIKE ?
    ORDER BY l.id DESC LIMIT 500`).all(q, q, q, q, q);
  const ipStmt = db.prepare('SELECT id, ip, label, created_at, last_seen_at FROM license_ips WHERE license_id=? ORDER BY id');
  res.json(rows.map(r => ({ ...r, ips: ipStmt.all(r.id) })));
});
admin.post('/licenses', (req, res) => {
  const b = req.body || {}; const t = todayKST();
  const starts = isYmd(b.startsAt) ? b.startsAt : t;
  const expires = isYmd(b.expiresAt) ? b.expiresAt : addDays(addMonths(starts, Math.max(1, +b.months || 12)), -1);
  let userId = null;
  if (b.userEmail) {
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(str(b.userEmail, 120).toLowerCase());
    if (!u) return bad(res, '그 이메일로 가입한 회원이 없습니다. 비워두면 키만 발급됩니다.');
    if (licenseOf(u.id)) return bad(res, '그 회원은 이미 라이선스가 있습니다. 기존 라이선스를 연장하세요.');
    userId = u.id;
  }
  const key = newLicenseKey();
  const r = db.prepare('INSERT INTO licenses(license_key,user_id,plan_name,starts_at,expires_at,max_ips,customer_name,customer_company,customer_phone,memo) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(key, userId, str(b.planName, 50) || '수동 발급', starts, expires, Math.min(20, Math.max(1, +b.maxIps || 3)), str(b.customerName, 50), str(b.customerCompany, 100), str(b.customerPhone, 30), str(b.memo, 500));
  audit(req, 'license.create', { id: r.lastInsertRowid, key }); res.json({ ok: true, key });
});
admin.patch('/licenses/:id', (req, res) => {
  const lic = db.prepare('SELECT * FROM licenses WHERE id=?').get(+req.params.id); if (!lic) return bad(res, '없는 라이선스', 404);
  const b = req.body || {}; const f = {};
  if (b.status && ['active', 'suspended'].includes(b.status)) f.status = b.status;
  if (isYmd(b.expiresAt)) f.expires_at = b.expiresAt;
  if (isYmd(b.startsAt)) f.starts_at = b.startsAt;
  if (b.maxIps !== undefined) f.max_ips = Math.min(20, Math.max(1, +b.maxIps || 1));
  for (const [k, c, m] of [['customerName', 'customer_name', 50], ['customerCompany', 'customer_company', 100], ['customerPhone', 'customer_phone', 30], ['memo', 'memo', 500], ['planName', 'plan_name', 50]]) if (b[k] !== undefined) f[c] = str(b[k], m);
  if (!Object.keys(f).length) return bad(res, '바꿀 내용이 없습니다.');
  db.prepare(`UPDATE licenses SET ${Object.keys(f).map(k => k + '=?').join(',')}, updated_at=datetime('now') WHERE id=?`).run(...Object.values(f), lic.id);
  audit(req, 'license.update', { id: lic.id, ...f }); res.json({ ok: true });
});
admin.post('/licenses/:id/extend', (req, res) => {
  const lic = db.prepare('SELECT * FROM licenses WHERE id=?').get(+req.params.id); if (!lic) return bad(res, '없는 라이선스', 404);
  const months = Math.max(1, Math.min(120, +req.body.months || 0)); const t = todayKST();
  const base = lic.expires_at >= t ? addDays(lic.expires_at, 1) : t;
  const exp = addDays(addMonths(base, months), -1);
  db.prepare(`UPDATE licenses SET expires_at=?, updated_at=datetime('now') WHERE id=?`).run(exp, lic.id);
  audit(req, 'license.extend', { id: lic.id, months }); res.json({ ok: true, expiresAt: exp });
});
admin.post('/licenses/:id/unbind', (req, res) => {
  db.prepare(`UPDATE licenses SET user_id=NULL, updated_at=datetime('now') WHERE id=?`).run(+req.params.id);
  audit(req, 'license.unbind', { id: +req.params.id }); res.json({ ok: true });
});
admin.post('/licenses/:id/ips', (req, res) => {
  const lic = db.prepare('SELECT * FROM licenses WHERE id=?').get(+req.params.id); if (!lic) return bad(res, '없는 라이선스', 404);
  const ip = str(req.body.ip, 45); if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return bad(res, 'IP 형식을 확인하세요.');
  try { db.prepare('INSERT INTO license_ips(license_id,ip,label) VALUES(?,?,?)').run(lic.id, ip, str(req.body.label, 40) || '관리자 등록'); }
  catch (e) { return bad(res, '이미 등록된 IP입니다.'); }
  audit(req, 'license.ip.add.admin', { id: lic.id, ip }); res.json({ ok: true });
});
admin.delete('/licenses/:id/ips/:ipId', (req, res) => {
  db.prepare('DELETE FROM license_ips WHERE id=? AND license_id=?').run(+req.params.ipId, +req.params.id);
  audit(req, 'license.ip.delete', { id: +req.params.id, ipId: +req.params.ipId }); res.json({ ok: true });
});
admin.delete('/licenses/:id', (req, res) => {
  db.prepare('DELETE FROM licenses WHERE id=?').run(+req.params.id);
  audit(req, 'license.delete', { id: +req.params.id }); res.json({ ok: true });
});
admin.get('/users', (req, res) => {
  const q = '%' + str(req.query.q, 80) + '%';
  res.json(db.prepare(`SELECT u.id, u.email, u.name, u.company, u.phone, u.role, u.disabled, u.created_at, u.last_login_at, l.license_key, l.expires_at, l.status AS license_status,
    (SELECT COUNT(*) FROM projects p WHERE p.user_id=u.id) AS project_count
    FROM users u LEFT JOIN licenses l ON l.user_id=u.id WHERE u.email LIKE ? OR u.name LIKE ? OR u.company LIKE ? ORDER BY u.id DESC LIMIT 500`).all(q, q, q));
});
admin.patch('/users/:id', async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(+req.params.id); if (!u) return bad(res, '없는 회원', 404);
  if (u.id === req.user.id && (req.body.disabled || req.body.role === 'user')) return bad(res, '자기 자신의 관리자 권한은 바꿀 수 없습니다.');
  const b = req.body || {};
  if (b.disabled !== undefined) { db.prepare('UPDATE users SET disabled=? WHERE id=?').run(b.disabled ? 1 : 0, u.id); if (b.disabled) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id); }
  if (b.role && ['user', 'admin'].includes(b.role)) db.prepare('UPDATE users SET role=? WHERE id=?').run(b.role, u.id);
  if (b.password) {
    if (String(b.password).length < 8) return bad(res, '비밀번호는 8자 이상');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await bcrypt.hash(String(b.password), 10), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  }
  audit(req, 'user.update', { id: u.id, disabled: b.disabled, role: b.role, password: !!b.password }); res.json({ ok: true });
});
admin.get('/settings', (req, res) => res.json(getSettings()));
admin.put('/settings', (req, res) => {
  const b = req.body || {}; const out = {};
  if (b.brand !== undefined) out.brand = str(b.brand, 60) || '착공계 원스톱';
  if (b.bank) out.bank = { bank: str(b.bank.bank, 40), account: str(b.bank.account, 60), holder: str(b.bank.holder, 40) };
  if (b.notice !== undefined) out.notice = str(b.notice, 1000);
  if (b.contact !== undefined) out.contact = str(b.contact, 200);
  if (Array.isArray(b.plans)) {
    out.plans = b.plans.slice(0, 20).map((p, i) => ({ id: str(p.id, 20).replace(/[^A-Za-z0-9_-]/g, '') || 'p' + i, name: str(p.name, 50) || '이용권', months: Math.max(1, Math.min(120, +p.months || 12)), price: Math.max(0, Math.round(+p.price || 0)), maxIps: Math.max(1, Math.min(20, +p.maxIps || 3)), active: p.active !== false }));
    const ids = out.plans.map(p => p.id); if (new Set(ids).size !== ids.length) return bad(res, '이용권 코드가 겹칩니다.');
  }
  saveSettings(out); audit(req, 'settings.update', Object.keys(out)); res.json({ ok: true });
});
admin.get('/audit', (req, res) => {
  res.json(db.prepare(`SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 300`).all());
});
app.use('/api/admin', admin);
app.get('/api/public/brand', (req, res) => res.json({ brand: getSettings().brand }));
app.use('/api', (req, res) => bad(res, '없는 주소입니다.', 404));

/* ================= 화면 ================= */
const sendView = name => (req, res) => res.sendFile(path.join(VIEWS, name));
app.get('/', (req, res) => res.redirect(req.user ? '/app' : '/login'));
app.get('/login', (req, res, next) => (req.user ? res.redirect('/app') : next()), sendView('login.html'));
app.get('/license', (req, res, next) => (req.user ? next() : res.redirect('/login')), sendView('license.html'));
app.get('/admin', (req, res, next) => (req.user && req.user.role === 'admin' ? next() : res.redirect(req.user ? '/app' : '/login')), sendView('admin.html'));
app.get('/app', (req, res, next) => {
  if (!req.user) return res.redirect('/login');
  if (!accessFor(req.user, clientIp(req)).ok) return res.redirect('/license');
  next();
}, sendView('app.html'));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use((req, res) => res.status(404).send('페이지를 찾을 수 없습니다.'));

/* ================= 시작 ================= */
function bootstrapAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim(), pw = process.env.ADMIN_PASSWORD || '';
  if (!email) { if (!db.prepare(`SELECT 1 FROM users WHERE role='admin'`).get()) console.warn('[주의] 관리자 계정이 없습니다. .env 에 ADMIN_EMAIL, ADMIN_PASSWORD 를 넣고 다시 시작하세요.'); return; }
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u) {
    if (pw.length < 8) { console.warn('[주의] ADMIN_PASSWORD 는 8자 이상이어야 합니다.'); return; }
    db.prepare(`INSERT INTO users(email,password_hash,name,role) VALUES(?,?,?, 'admin')`).run(email, bcrypt.hashSync(pw, 10), '관리자');
    console.log('[안내] 관리자 계정을 만들었습니다:', email);
  } else if (u.role !== 'admin') { db.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(u.id); console.log('[안내] 관리자 권한을 부여했습니다:', email); }
}
setInterval(() => { try { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString()); } catch (_) {} }, 3600000).unref();

if (require.main === module) {
  bootstrapAdmin();
  app.listen(PORT, () => console.log(`착공계 원스톱 서버 실행 중: http://localhost:${PORT}`));
}
module.exports = { app, bootstrapAdmin };
