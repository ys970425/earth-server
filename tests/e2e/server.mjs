// 가짜 Supabase (PGlite) + 정적 파일 서버
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const APP = new URL('../../app/', import.meta.url).pathname;
const { PGlite } = await import(process.env.PGLITE_PATH || '@electric-sql/pglite');
export const db = new PGlite();
await db.exec(`create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;`);
await db.exec(readFileSync(new URL('../../supabase/setup.sql', import.meta.url), 'utf8'));
await db.query(`select priv.set_admin_password('test-pw')`);

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(sub) { const exp = Math.floor(Date.now() / 1000) + 36000; return b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub, exp, role: 'authenticated', is_anonymous: true, aud: 'authenticated' }) + '.sig'; }
const PORT = Number(process.env.PORT || 8787);
let q = Promise.resolve();
const serial = fn => (q = q.then(fn, fn));

export async function call(uid, fn, args) {
  return serial(async () => {
    await db.query(`select set_config('request.uid', $1, false)`, [uid || '']);
    const keys = Object.keys(args || {});
    const params = keys.map(k => { const v = args[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; });
    const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    const r = await db.query(sql, params);
    return r.rows[0].r;
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = '';
  for await (const c of req) body += c;
  if (url.pathname === '/auth/v1/signup') {
    const id = randomUUID();
    const s = { access_token: jwt(id), token_type: 'bearer', expires_in: 36000, expires_at: Math.floor(Date.now() / 1000) + 36000, refresh_token: 'r' + id,
      user: { id, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
    res.writeHead(200, { 'content-type': 'application/json', ...cors }); return res.end(JSON.stringify(s));
  }
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = url.pathname.split('/').pop();
    const tok = (req.headers.authorization || '').replace('Bearer ', '');
    let uid = null;
    try { uid = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).sub || null; } catch (e) {}
    try {
      const r = await call(uid, fn, body ? JSON.parse(body) : {});
      res.writeHead(200, { 'content-type': 'application/json', ...cors }); return res.end(JSON.stringify(r));
    } catch (e) {
      console.log('RPC ERR', fn, e.message);
      res.writeHead(400, { 'content-type': 'application/json', ...cors }); return res.end(JSON.stringify({ code: 'P0001', message: e.message, details: null, hint: null }));
    }
  }
  if (url.pathname === '/js/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(`window.APP_CONFIG={SUPABASE_URL:'http://localhost:${PORT}',SUPABASE_KEY:'test'};`);
  }
  let p = path.join(APP, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!existsSync(p)) { res.writeHead(404, cors); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
}).listen(PORT, () => console.log('listening', PORT));
