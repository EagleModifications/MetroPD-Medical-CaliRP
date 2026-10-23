const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DEFAULT_DATA_FILE = path.join(ROOT, 'data', 'db.json');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const APP_ID = 'medcad';

function ensureDataFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    if (DATA_FILE !== DEFAULT_DATA_FILE && fs.existsSync(DEFAULT_DATA_FILE)) {
      fs.copyFileSync(DEFAULT_DATA_FILE, DATA_FILE);
    } else {
      fs.writeFileSync(DATA_FILE, JSON.stringify({users:[], patients:[], medicalRecords:[], sessions:{}, pendingOtps:{}}, null, 2));
    }
  }
}
function loadDb() {
  ensureDataFile();
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (error) {
    console.error('Could not read db.json:', error);
    return {users:[], patients:[], medicalRecords:[], sessions:{}, pendingOtps:{}};
  }
}
let db = loadDb();
function saveDb() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function id() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function validPassword(password, user) {
  if (!user || !password) return false;
  return crypto.scryptSync(password, user.passwordSalt, 64).toString('hex') === user.passwordHash;
}
function token() { return crypto.randomBytes(32).toString('hex'); }
function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(body);
}
function noContent(res) { res.writeHead(204); res.end(); }
function unauthorized(res) { send(res, 401, {message:'Authentication required'}); }
function getAuth(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  return t && db.sessions[t] ? db.users.find(u => u.id === db.sessions[t]) || null : null;
}
function publicUser(u) {
  if (!u) return null;
  const {passwordHash,passwordSalt,...safe} = u;
  return safe;
}
function parseUrl(req) { return new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
function readBody(req) {
  return new Promise((resolve,reject)=>{
    let raw=''; req.on('data',c=>{raw+=c; if(raw.length>2e6) req.destroy();});
    req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch(e){reject(e);}});
    req.on('error',reject);
  });
}
function sortRows(rows, sort) {
  if (!sort) return rows;
  const desc = sort.startsWith('-'); const key = desc ? sort.slice(1) : sort;
  return [...rows].sort((a,b)=>{
    const av=a[key] ?? '', bv=b[key] ?? '';
    return (av < bv ? -1 : av > bv ? 1 : 0) * (desc ? -1 : 1);
  });
}
function entityStore(name) { return name === 'Patient' ? db.patients : name === 'MedicalRecord' ? db.medicalRecords : null; }
function normalizeEntity(row, type) {
  return {...row, created_date: row.created_date || row.createdAt || now(), updated_date: row.updated_date || row.updatedAt || now(), entity: type};
}

async function api(req,res,url) {
  if (url.pathname === '/api/health' && req.method === 'GET') {
    return send(res, 200, { ok: true, service: 'medcad' });
  }
  const parts = url.pathname.split('/').filter(Boolean);
  // /api/apps/:appId/...
  if (parts[0] !== 'api' || parts[1] !== 'apps' || parts[2] !== APP_ID) return false;
  const rest = parts.slice(3);
  if (rest[0] === 'auth') {
    const action = rest[1]; const body = await readBody(req);
    if (req.method === 'POST' && action === 'login') {
      const user = db.users.find(u => u.email.toLowerCase() === String(body.email||'').toLowerCase());
      if (!user || !validPassword(body.password, user)) return send(res,401,{message:'Invalid email or password'});
      const t=token(); db.sessions[t]=user.id; saveDb(); return send(res,200,{access_token:t,user:publicUser(user)});
    }
    if (req.method === 'POST' && action === 'register') {
      const email=String(body.email||'').trim().toLowerCase();
      if (!email || !body.password) return send(res,400,{message:'Email and password are required'});
      if (db.users.some(u=>u.email.toLowerCase()===email)) return send(res,409,{message:'An account with that email already exists'});
      const hp=hashPassword(String(body.password));
      const user={id:id(),email,passwordHash:hp.hash,passwordSalt:hp.salt,created_date:now(),verified:false,role:'user'};
      db.users.push(user); db.pendingOtps[email]='123456'; saveDb();
      return send(res,200,{message:'Verification code sent'});
    }
    if (req.method === 'POST' && action === 'verify-otp') {
      const email=String(body.email||'').trim().toLowerCase();
      if (db.pendingOtps[email] !== String(body.otp_code||'')) return send(res,400,{message:'Invalid verification code'});
      const user=db.users.find(u=>u.email.toLowerCase()===email); if(!user) return send(res,404,{message:'Account not found'});
      user.verified=true; delete db.pendingOtps[email]; const t=token(); db.sessions[t]=user.id; saveDb();
      return send(res,200,{access_token:t,user:publicUser(user)});
    }
    if (req.method === 'POST' && action === 'resend-otp') {
      const email=String(body.email||'').trim().toLowerCase(); if(db.users.some(u=>u.email.toLowerCase()===email)){db.pendingOtps[email]='123456';saveDb();}
      return send(res,200,{message:'Verification code sent'});
    }
    if (req.method === 'POST' && action === 'reset-password-request') return send(res,200,{message:'If an account exists with that email, a reset link will be sent.'});
    if (req.method === 'POST' && action === 'reset-password') return send(res,501,{message:'Password reset email delivery is not configured on this self-hosted installation.'});
    if (req.method === 'POST' && action === 'change-password') {
      const user=getAuth(req); if(!user) return unauthorized(res);
      if(!validPassword(body.current_password,user)) return send(res,401,{message:'Current password is incorrect'});
      const hp=hashPassword(String(body.new_password||'')); user.passwordHash=hp.hash; user.passwordSalt=hp.salt; saveDb(); return send(res,200,{message:'Password changed'});
    }
    if (req.method === 'GET' && action === 'me') { const user=getAuth(req); return user ? send(res,200,publicUser(user)) : unauthorized(res); }
    if (req.method === 'POST' && action === 'logout') { const h=req.headers.authorization||''; const t=h.startsWith('Bearer ')?h.slice(7):null; if(t) delete db.sessions[t]; saveDb(); return noContent(res); }
    return send(res,404,{message:'Auth endpoint not found'});
  }
  if (rest[0] === 'entities') {
    const type=rest[1]; const store=entityStore(type); if(!store) return send(res,404,{message:'Entity not found'});
    const entityId=rest[2];
    if(req.method==='GET' && !entityId){
      const q=url.searchParams.get('q'); let rows=[...store];
      if(q){try{const filters=JSON.parse(q); rows=rows.filter(r=>Object.entries(filters).every(([k,v])=>String(r[k]??'')===String(v)));}catch{}}
      rows=sortRows(rows,url.searchParams.get('sort'));
      const limit=Math.min(Number(url.searchParams.get('limit')||200),1000); const skip=Number(url.searchParams.get('skip')||0);
      return send(res,200,rows.slice(skip,skip+limit).map(r=>normalizeEntity(r,type)));
    }
    if(req.method==='GET' && entityId){const row=store.find(r=>r.id===entityId); return row?send(res,200,normalizeEntity(row,type)):send(res,404,{message:'Record not found'});}
    if(req.method==='POST'){const body=await readBody(req); const row=normalizeEntity({...body,id:id()},type); delete row.entity; store.push(row); saveDb(); return send(res,201,row);}
    if(req.method==='PUT' && entityId){const idx=store.findIndex(r=>r.id===entityId); if(idx<0)return send(res,404,{message:'Record not found'}); const body=await readBody(req); store[idx]={...store[idx],...body,id:entityId,updated_date:now()}; saveDb(); return send(res,200,store[idx]);}
    if(req.method==='DELETE' && entityId){const idx=store.findIndex(r=>r.id===entityId); if(idx<0)return send(res,404,{message:'Record not found'}); store.splice(idx,1); saveDb(); return noContent(res);}
    return send(res,405,{message:'Method not allowed'});
  }
  return send(res,404,{message:'API route not found'});
}

function serveStatic(req,res,url){
  let filePath = url.pathname === '/' ? path.join(PUBLIC,'index.html') : path.join(PUBLIC,decodeURIComponent(url.pathname));
  if (!filePath.startsWith(PUBLIC)) return send(res,403,{message:'Forbidden'});
  fs.stat(filePath,(err,st)=>{
    if(err || !st.isFile()) {
      // SPA fallback
      filePath=path.join(PUBLIC,'index.html');
    }
    const ext=path.extname(filePath).toLowerCase();
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
    res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream'}); fs.createReadStream(filePath).pipe(res);
  });
}

const server=http.createServer(async (req,res)=>{
  try {
    const url=parseUrl(req);
    if(url.pathname.startsWith('/api/')) { const handled=await api(req,res,url); if(handled!==false)return; }
    serveStatic(req,res,url);
  } catch(e) { console.error(e); send(res,500,{message:'Internal server error'}); }
});
server.listen(PORT,HOST,()=>{
  console.log(`MedCAD running on ${HOST}:${PORT}`);
  console.log(`Database file: ${DATA_FILE}`);
});
