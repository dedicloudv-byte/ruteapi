const memStore = {
  routes: new Map(),
  logs: [],
  tokens: new Map(),
  users: new Map(),
  sessions: new Map(),
  products: new Map()
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

const nowIso = () => new Date().toISOString();

const generateId = (prefix = "r") => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

const generateSecret = (length = 24) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const sanitizeEmail = (email = "") => email.trim().toLowerCase();

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-admin-token,x-user-token,x-auth-token"
  };
}

function withCors(response) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));
  return new Response(response.body, { status: response.status, headers });
}

function notFound() {
  return json({ error: "Endpoint tidak ditemukan" }, 404);
}

async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Body JSON tidak valid");
  }
}

function normalizeTarget(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Protocol target wajib http/https");
    }
    return parsed.toString();
  } catch {
    throw new Error("targetUrl tidak valid");
  }
}

async function putObject(env, key, value) {
  if (env.vpsai) {
    await env.vpsai.put(key, JSON.stringify(value), {
      httpMetadata: { contentType: "application/json" }
    });
  }
}

async function readObject(env, key) {
  if (!env.vpsai) return null;
  const object = await env.vpsai.get(key);
  if (!object) return null;
  const raw = await object.text();
  return raw ? JSON.parse(raw) : null;
}

async function listObjects(env, prefix) {
  if (!env.vpsai) return [];
  const listed = await env.vpsai.list({ prefix });
  const items = await Promise.all(
    listed.objects.map(async (obj) => {
      const item = await readObject(env, obj.key);
      return item || null;
    })
  );
  return items.filter(Boolean);
}

async function saveRoute(env, route) {
  if (env.vpsai) return putObject(env, `routes/${route.id}.json`, route);
  memStore.routes.set(route.id, route);
}

async function getRoute(env, id) {
  if (env.vpsai) return readObject(env, `routes/${id}.json`);
  return memStore.routes.get(id) || null;
}

async function listRoutes(env) {
  if (env.vpsai) {
    const routes = await listObjects(env, "routes/");
    return routes.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  return Array.from(memStore.routes.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function deleteRoute(env, id) {
  if (env.vpsai) return env.vpsai.delete(`routes/${id}.json`);
  memStore.routes.delete(id);
}

async function saveUserToken(env, routeId, token) {
  const payload = { token, updatedAt: nowIso() };
  if (env.vpsai) return putObject(env, `token/${routeId}.json`, payload);
  memStore.tokens.set(routeId, payload);
}

async function getUserToken(env, routeId) {
  if (env.vpsai) {
    const data = await readObject(env, `token/${routeId}.json`);
    return data ? data.token : null;
  }
  const data = memStore.tokens.get(routeId);
  return data ? data.token : null;
}

async function deleteUserToken(env, routeId) {
  if (env.vpsai) return env.vpsai.delete(`token/${routeId}.json`);
  memStore.tokens.delete(routeId);
}

async function addLog(env, log) {
  if (env.vpsai) {
    const key = `logs/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.json`;
    return putObject(env, key, log);
  }
  memStore.logs.unshift(log);
  memStore.logs = memStore.logs.slice(0, 500);
}

async function listLogs(env, limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  if (env.vpsai) {
    const logs = await listObjects(env, "logs/");
    return logs.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, safeLimit);
  }
  return memStore.logs.slice(0, safeLimit);
}

async function deleteLogs(env) {
  if (env.vpsai) {
    const listed = await env.vpsai.list({ prefix: "logs/" });
    await Promise.all(listed.objects.map((obj) => env.vpsai.delete(obj.key)));
    return;
  }
  memStore.logs = [];
}

async function saveUser(env, user) {
  if (env.vpsai) return putObject(env, `users/${user.id}.json`, user);
  memStore.users.set(user.id, user);
}

async function listUsers(env) {
  if (env.vpsai) {
    const users = await listObjects(env, "users/");
    return users.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  return Array.from(memStore.users.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function getUserById(env, id) {
  if (env.vpsai) return readObject(env, `users/${id}.json`);
  return memStore.users.get(id) || null;
}

async function findUserByEmail(env, email) {
  const safeEmail = sanitizeEmail(email);
  const users = await listUsers(env);
  return users.find((u) => u.email === safeEmail) || null;
}

async function deleteUser(env, id) {
  if (env.vpsai) return env.vpsai.delete(`users/${id}.json`);
  memStore.users.delete(id);
}

async function saveSession(env, session) {
  if (env.vpsai) return putObject(env, `sessions/${session.token}.json`, session);
  memStore.sessions.set(session.token, session);
}

async function getSession(env, token) {
  if (!token) return null;
  if (env.vpsai) return readObject(env, `sessions/${token}.json`);
  return memStore.sessions.get(token) || null;
}

async function deleteSessionsByUserId(env, userId) {
  if (env.vpsai) {
    const sessions = await listObjects(env, "sessions/");
    const owned = sessions.filter((s) => s.userId === userId);
    await Promise.all(owned.map((s) => env.vpsai.delete(`sessions/${s.token}.json`)));
    return;
  }
  for (const [token, session] of memStore.sessions.entries()) {
    if (session.userId === userId) memStore.sessions.delete(token);
  }
}

async function saveProduct(env, product) {
  if (env.vpsai) return putObject(env, `products/${product.id}.json`, product);
  memStore.products.set(product.id, product);
}

async function listProducts(env) {
  if (env.vpsai) {
    const products = await listObjects(env, "products/");
    return products.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  return Array.from(memStore.products.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function deleteProduct(env, id) {
  if (env.vpsai) return env.vpsai.delete(`products/${id}.json`);
  memStore.products.delete(id);
}

function safeUser(user) {
  if (!user) return null;
  const { password, ...rest } = user;
  return rest;
}

async function getAuthUser(request, env) {
  const token = request.headers.get("x-auth-token") || "";
  if (!token) return null;
  const session = await getSession(env, token);
  if (!session) return null;
  const user = await getUserById(env, session.userId);
  if (!user) return null;
  return { ...safeUser(user), token, isAdmin: Boolean(user.isAdmin) };
}

function requireAdminToken(request, env) {
  const token = request.headers.get("x-admin-token") || "";
  const expected = env.ADMIN_TOKEN || "";
  return expected && token === expected;
}

async function requireAdmin(request, env) {
  if (requireAdminToken(request, env)) return true;
  const authUser = await getAuthUser(request, env);
  return Boolean(authUser?.isAdmin);
}

async function requireApprovedUser(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return { ok: false, response: withCors(json({ error: "Silakan login" }, 401)) };
  if (user.status !== "approved") {
    return { ok: false, response: withCors(json({ error: "Akun belum disetujui admin" }, 403)) };
  }
  return { ok: true, user };
}

const appHtml = `<!doctype html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RuteAPI Portal</title>
  <style>
    :root { --bg:#030712; --card:rgba(15,23,42,.72); --accent:#60a5fa; --text:#dbeafe; --muted:#94a3b8; --danger:#fb7185; --ok:#34d399; }
    *{box-sizing:border-box} body{margin:0;background:radial-gradient(circle at 0 0,#1e1b4b,transparent 45%),var(--bg);color:var(--text);font-family:Inter,system-ui;padding:1.2rem}
    .wrap{max-width:1200px;margin:auto}.grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
    .card{background:var(--card);border:1px solid rgba(148,163,184,.2);border-radius:14px;padding:1rem}.tabs{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem}
    button,input,select,textarea{width:100%;padding:.65rem;border-radius:10px;border:1px solid rgba(96,165,250,.3);background:#111827;color:var(--text)}
    button{background:linear-gradient(90deg,#60a5fa,#a78bfa);color:#020617;font-weight:700;cursor:pointer}
    .tab-btn{width:auto;padding:.5rem .8rem}.muted{color:var(--muted);font-size:.88rem}.mono{font-family:ui-monospace,monospace;word-break:break-all}
    table{width:100%;border-collapse:collapse;font-size:.84rem}th,td{padding:.45rem;border-bottom:1px solid rgba(148,163,184,.2);text-align:left;vertical-align:top}
    .pill{padding:.12rem .45rem;border-radius:999px;background:rgba(52,211,153,.15);color:var(--ok);font-size:.75rem}.danger{color:var(--danger)}
    .hidden{display:none}
  </style>
</head>
<body>
<div class="wrap">
  <h1>RuteAPI Control Portal</h1>
  <p class="muted">Portal user + admin: pendaftaran, approval, limit API, produk API, route relay, dan monitoring log error.</p>

  <div class="tabs">
    <button class="tab-btn" data-tab="public">Publik</button>
    <button class="tab-btn" data-tab="user">Dashboard User</button>
    <button class="tab-btn" data-tab="admin">Dashboard Admin</button>
  </div>

  <section id="tab-public" class="tab grid">
    <div class="card">
      <h3>Daftar User Baru</h3>
      <input id="regName" placeholder="Nama lengkap" />
      <input id="regEmail" placeholder="Email" />
      <input id="regPassword" type="password" placeholder="Password" />
      <button id="registerBtn">Daftar</button>
      <div id="registerMsg" class="muted"></div>
    </div>
    <div class="card">
      <h3>Login User/Admin</h3>
      <input id="loginEmail" placeholder="Email" />
      <input id="loginPassword" type="password" placeholder="Password" />
      <button id="loginBtn">Login</button>
      <div id="loginMsg" class="muted"></div>
      <div class="muted">Token Login: <span id="authTokenView" class="mono"></span></div>
    </div>
    <div class="card">
      <h3>Produk API Tersedia</h3>
      <button id="loadPublicProducts">Refresh Produk</button>
      <div id="publicProducts" class="muted"></div>
    </div>
  </section>

  <section id="tab-user" class="tab hidden">
    <div class="grid">
      <div class="card">
        <h3>Profil & Limit</h3>
        <button id="loadMe">Refresh Profil</button>
        <div id="meBox" class="muted"></div>
      </div>
      <div class="card">
        <h3>Produk API</h3>
        <button id="loadUserProducts">Refresh Produk</button>
        <div id="userProducts" class="muted"></div>
      </div>
    </div>
  </section>

  <section id="tab-admin" class="tab hidden">
    <div class="grid">
      <div class="card">
        <h3>Admin Token Fallback</h3>
        <input id="adminToken" type="password" placeholder="x-admin-token" />
        <p class="muted">Bisa pakai login admin ATAU admin token environment.</p>
      </div>
      <div class="card">
        <h3>Tambah Produk API</h3>
        <input id="prodName" placeholder="Nama produk API" />
        <textarea id="prodDesc" placeholder="Keterangan produk"></textarea>
        <button id="createProduct">Tambah Produk</button>
      </div>
      <div class="card">
        <h3>Buat Route Relay</h3>
        <input id="routeName" placeholder="Nama route" />
        <input id="targetUrl" placeholder="https://api.tujuan.com/endpoint" />
        <select id="method"><option>ANY</option><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select>
        <button id="createRoute">Buat Route</button>
      </div>
    </div>

    <div class="card" style="margin-top:1rem"><h3>Manajemen User</h3><button id="loadUsers">Refresh User</button><div style="overflow:auto"><table><thead><tr><th>Email</th><th>Status</th><th>Limit</th><th>Used</th><th>Aksi</th></tr></thead><tbody id="usersBody"></tbody></table></div></div>
    <div class="card" style="margin-top:1rem"><h3>List Produk API</h3><button id="loadProducts">Refresh Produk</button><div style="overflow:auto"><table><thead><tr><th>Nama</th><th>Keterangan</th><th>Aksi</th></tr></thead><tbody id="productsBody"></tbody></table></div></div>
    <div class="card" style="margin-top:1rem"><h3>List API Relay</h3><button id="loadRoutes">Refresh Route</button><div style="overflow:auto"><table><thead><tr><th>Nama</th><th>Endpoint</th><th>Token</th><th>Target</th><th>Aksi</th></tr></thead><tbody id="routesBody"></tbody></table></div></div>
    <div class="card" style="margin-top:1rem"><h3>Log Error API</h3><button id="loadLogs">Refresh Log</button><div style="overflow:auto"><table><thead><tr><th>Waktu</th><th>Route</th><th>Status</th><th>Pesan</th></tr></thead><tbody id="logsBody"></tbody></table></div></div>
  </section>
</div>

<script>
const $ = (id) => document.getElementById(id);
const getAuthToken = () => sessionStorage.getItem('authToken') || '';
const getAdminToken = () => sessionStorage.getItem('adminToken') || '';

const api = async (url, opts = {}) => {
  const headers = {
    'content-type': 'application/json',
    'x-auth-token': getAuthToken(),
    'x-admin-token': getAdminToken(),
    ...(opts.headers || {})
  };
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request gagal');
  return data;
};

function setTab(name) {
  document.querySelectorAll('.tab').forEach((el) => el.classList.add('hidden'));
  $('tab-' + name).classList.remove('hidden');
}
document.querySelectorAll('.tab-btn').forEach((btn) => btn.onclick = () => setTab(btn.dataset.tab));

$('adminToken').value = getAdminToken();
$('adminToken').onchange = (e) => sessionStorage.setItem('adminToken', e.target.value.trim());
$('authTokenView').textContent = getAuthToken();

$('registerBtn').onclick = async () => {
  try {
    const payload = { name: $('regName').value.trim(), email: $('regEmail').value.trim(), password: $('regPassword').value.trim() };
    await api('/api/public/register', { method: 'POST', body: JSON.stringify(payload) });
    $('registerMsg').textContent = '✅ Daftar berhasil, tunggu approval admin.';
  } catch (e) { $('registerMsg').textContent = '❌ ' + e.message; }
};

$('loginBtn').onclick = async () => {
  try {
    const payload = { email: $('loginEmail').value.trim(), password: $('loginPassword').value.trim() };
    const result = await api('/api/public/login', { method: 'POST', body: JSON.stringify(payload) });
    sessionStorage.setItem('authToken', result.token);
    $('authTokenView').textContent = result.token;
    $('loginMsg').textContent = '✅ Login berhasil sebagai ' + result.user.role;
  } catch (e) { $('loginMsg').textContent = '❌ ' + e.message; }
};

const renderProducts = (items) => items.map((p) => '<div><b>' + p.name + '</b><div class="muted">' + (p.description || '-') + '</div></div>').join('<hr/>') || '<div class="muted">Belum ada produk.</div>';
$('loadPublicProducts').onclick = async () => $('publicProducts').innerHTML = renderProducts((await api('/api/public/products')).items);
$('loadUserProducts').onclick = async () => $('userProducts').innerHTML = renderProducts((await api('/api/user/products')).items);

$('loadMe').onclick = async () => {
  const me = (await api('/api/user/me')).item;
  $('meBox').innerHTML = '<div><b>' + me.name + '</b> (' + me.email + ')</div><div>Status: <span class="pill">' + me.status + '</span></div><div>Limit: ' + me.limit + ' | Used: ' + me.used + ' | Sisa: ' + (me.limit - me.used) + '</div>';
};

$('createProduct').onclick = async () => {
  await api('/api/admin/products', { method: 'POST', body: JSON.stringify({ name: $('prodName').value.trim(), description: $('prodDesc').value.trim() }) });
  alert('Produk ditambah');
};

$('createRoute').onclick = async () => {
  await api('/api/admin/routes', { method: 'POST', body: JSON.stringify({ name: $('routeName').value.trim(), targetUrl: $('targetUrl').value.trim(), method: $('method').value }) });
  alert('Route dibuat');
};

$('loadUsers').onclick = async () => {
  const users = (await api('/api/admin/users')).items;
  $('usersBody').innerHTML = users.map((u) => '<tr><td>' + u.email + '</td><td>' + u.status + '</td><td>' + u.limit + '</td><td>' + u.used + '</td><td>' +
    '<button data-id="' + u.id + '" data-action="approve">Approve</button><button data-id="' + u.id + '" data-action="delete">Hapus</button><button data-id="' + u.id + '" data-action="limit">Set Limit</button></td></tr>').join('') || '<tr><td colspan="5">Belum ada user.</td></tr>';
  document.querySelectorAll('#usersBody button').forEach((btn) => btn.onclick = async () => {
    const id = btn.dataset.id;
    if (btn.dataset.action === 'approve') await api('/api/admin/users/' + id, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) });
    if (btn.dataset.action === 'delete') await api('/api/admin/users/' + id, { method: 'DELETE' });
    if (btn.dataset.action === 'limit') {
      const value = prompt('Limit baru?');
      if (!value) return;
      await api('/api/admin/users/' + id, { method: 'PATCH', body: JSON.stringify({ action: 'set-limit', limit: Number(value) }) });
    }
    $('loadUsers').click();
  });
};

$('loadProducts').onclick = async () => {
  const products = (await api('/api/admin/products')).items;
  $('productsBody').innerHTML = products.map((p) => '<tr><td>' + p.name + '</td><td>' + (p.description || '-') + '</td><td><button data-id="' + p.id + '">Hapus</button></td></tr>').join('') || '<tr><td colspan="3">Belum ada produk.</td></tr>';
  document.querySelectorAll('#productsBody button').forEach((btn) => btn.onclick = async () => { await api('/api/admin/products/' + btn.dataset.id, { method: 'DELETE' }); $('loadProducts').click(); });
};

$('loadRoutes').onclick = async () => {
  const routes = (await api('/api/admin/routes')).items;
  $('routesBody').innerHTML = routes.map((r) => '<tr><td>' + r.name + '</td><td class="mono">' + location.origin + '/u/' + r.id + '</td><td class="mono">' + (r.userToken || '-') + '</td><td class="mono">' + r.targetUrl + '</td><td><button data-id="' + r.id + '">Hapus</button></td></tr>').join('') || '<tr><td colspan="5">Belum ada route.</td></tr>';
  document.querySelectorAll('#routesBody button').forEach((btn) => btn.onclick = async () => { await api('/api/admin/routes/' + btn.dataset.id, { method: 'DELETE' }); $('loadRoutes').click(); });
};

$('loadLogs').onclick = async () => {
  const logs = (await api('/api/admin/logs?limit=100')).items;
  $('logsBody').innerHTML = logs.map((l) => '<tr><td>' + l.timestamp + '</td><td>' + (l.routeId || '-') + '</td><td class="danger">' + l.status + '</td><td>' + l.message + '</td></tr>').join('') || '<tr><td colspan="4">Belum ada log.</td></tr>';
};

$('loadPublicProducts').click();
</script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204, headers: corsHeaders() }));

    const url = new URL(request.url);

    try {
      if (url.pathname === "/") {
        return withCors(new Response(appHtml, { headers: { "content-type": "text/html; charset=utf-8" } }));
      }

      if (request.method === "POST" && url.pathname === "/api/public/register") {
        const body = await parseBody(request);
        const name = (body.name || "").trim();
        const email = sanitizeEmail(body.email || "");
        const password = (body.password || "").trim();
        if (!name || !email || !password) return withCors(json({ error: "name, email, password wajib" }, 400));
        if (password.length < 6) return withCors(json({ error: "password minimal 6 karakter" }, 400));
        const exists = await findUserByEmail(env, email);
        if (exists) return withCors(json({ error: "email sudah terdaftar" }, 409));

        const item = {
          id: generateId("usr"),
          name,
          email,
          password,
          status: "pending",
          isAdmin: false,
          limit: 1000,
          used: 0,
          createdAt: nowIso(),
          approvedAt: null
        };
        await saveUser(env, item);
        return withCors(json({ ok: true, item: safeUser(item) }, 201));
      }

      if (request.method === "POST" && url.pathname === "/api/public/login") {
        const body = await parseBody(request);
        const email = sanitizeEmail(body.email || "");
        const password = (body.password || "").trim();
        const user = await findUserByEmail(env, email);
        if (!user || user.password !== password) return withCors(json({ error: "email/password salah" }, 401));

        const token = generateSecret(18);
        await saveSession(env, { token, userId: user.id, createdAt: nowIso() });
        return withCors(json({ ok: true, token, user: { ...safeUser(user), role: user.isAdmin ? "admin" : "user" } }));
      }

      if (request.method === "GET" && url.pathname === "/api/public/products") {
        return withCors(json({ ok: true, items: await listProducts(env) }));
      }

      if (url.pathname.startsWith("/api/user")) {
        const auth = await requireApprovedUser(request, env);
        if (!auth.ok) return auth.response;
        const { user } = auth;

        if (request.method === "GET" && url.pathname === "/api/user/me") {
          return withCors(json({ ok: true, item: user }));
        }

        if (request.method === "GET" && url.pathname === "/api/user/products") {
          return withCors(json({ ok: true, items: await listProducts(env) }));
        }

        return withCors(notFound());
      }

      if (url.pathname.startsWith("/api/admin")) {
        if (!(await requireAdmin(request, env))) return withCors(json({ error: "Unauthorized admin" }, 401));

        if (request.method === "GET" && url.pathname === "/api/admin/users") {
          return withCors(json({ ok: true, items: (await listUsers(env)).map(safeUser) }));
        }

        if (request.method === "PATCH" && url.pathname.startsWith("/api/admin/users/")) {
          const id = url.pathname.split("/").pop();
          const body = await parseBody(request);
          const user = await getUserById(env, id);
          if (!user) return withCors(json({ error: "User tidak ditemukan" }, 404));

          if (body.action === "approve") {
            user.status = "approved";
            user.approvedAt = nowIso();
          } else if (body.action === "reject") {
            user.status = "rejected";
          } else if (body.action === "set-limit") {
            const limit = Number(body.limit);
            if (!Number.isFinite(limit) || limit < 0) return withCors(json({ error: "limit tidak valid" }, 400));
            user.limit = Math.floor(limit);
          } else if (body.action === "toggle-admin") {
            user.isAdmin = !user.isAdmin;
          } else {
            return withCors(json({ error: "action tidak valid" }, 400));
          }
          await saveUser(env, user);
          return withCors(json({ ok: true, item: safeUser(user) }));
        }

        if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/users/")) {
          const id = url.pathname.split("/").pop();
          await deleteUser(env, id);
          await deleteSessionsByUserId(env, id);
          return withCors(json({ ok: true }));
        }

        if (request.method === "POST" && url.pathname === "/api/admin/products") {
          const body = await parseBody(request);
          const name = (body.name || "").trim();
          if (!name) return withCors(json({ error: "name wajib diisi" }, 400));
          const item = { id: generateId("prod"), name, description: (body.description || "").trim(), createdAt: nowIso() };
          await saveProduct(env, item);
          return withCors(json({ ok: true, item }, 201));
        }

        if (request.method === "GET" && url.pathname === "/api/admin/products") {
          return withCors(json({ ok: true, items: await listProducts(env) }));
        }

        if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/products/")) {
          const id = url.pathname.split("/").pop();
          await deleteProduct(env, id);
          return withCors(json({ ok: true }));
        }

        if (request.method === "POST" && url.pathname === "/api/admin/routes") {
          const body = await parseBody(request);
          const name = (body.name || "").trim();
          const targetUrl = normalizeTarget(body.targetUrl || "");
          const method = (body.method || "ANY").toUpperCase();
          if (!name) return withCors(json({ error: "name wajib diisi" }, 400));
          if (!["ANY", "GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
            return withCors(json({ error: "method tidak valid" }, 400));
          }

          const item = { id: generateId("api"), name, targetUrl, method, active: true, createdAt: nowIso() };
          const userToken = generateSecret();
          await saveRoute(env, item);
          await saveUserToken(env, item.id, userToken);
          return withCors(json({ ok: true, item: { ...item, userToken } }, 201));
        }

        if (request.method === "GET" && url.pathname === "/api/admin/routes") {
          const items = await listRoutes(env);
          const withToken = await Promise.all(items.map(async (route) => ({ ...route, userToken: await getUserToken(env, route.id) })));
          return withCors(json({ ok: true, items: withToken }));
        }

        if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/routes/")) {
          const id = url.pathname.split("/").pop();
          await deleteRoute(env, id);
          await deleteUserToken(env, id);
          return withCors(json({ ok: true }));
        }

        if (request.method === "GET" && url.pathname === "/api/admin/logs") {
          const limit = Number(url.searchParams.get("limit") || 50);
          return withCors(json({ ok: true, items: await listLogs(env, limit) }));
        }

        if (request.method === "DELETE" && url.pathname === "/api/admin/logs") {
          await deleteLogs(env);
          return withCors(json({ ok: true }));
        }

        return withCors(notFound());
      }

      if (url.pathname.startsWith("/u/")) {
        const id = url.pathname.split("/")[2];
        const route = await getRoute(env, id);
        if (!route || !route.active) return withCors(json({ error: "Route user tidak ditemukan" }, 404));

        const expectedToken = await getUserToken(env, id);
        const givenToken = request.headers.get("x-user-token") || "";
        if (!expectedToken || givenToken !== expectedToken) return withCors(json({ error: "Unauthorized user token" }, 401));

        const authUser = await getAuthUser(request, env);
        if (authUser && authUser.status === "approved") {
          const user = await getUserById(env, authUser.id);
          if (user.used >= user.limit) return withCors(json({ error: "Limit API habis" }, 429));
          user.used += 1;
          await saveUser(env, user);
        }

        if (route.method !== "ANY" && request.method !== route.method) {
          return withCors(json({ error: `Method harus ${route.method}` }, 405));
        }

        const outgoingHeaders = new Headers(request.headers);
        outgoingHeaders.delete("host");
        outgoingHeaders.delete("x-user-token");

        const targetUrl = new URL(route.targetUrl);
        url.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));

        try {
          const upstream = await fetch(targetUrl.toString(), {
            method: request.method,
            headers: outgoingHeaders,
            body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
            redirect: "follow"
          });

          if (!upstream.ok) {
            await addLog(env, {
              timestamp: nowIso(),
              routeId: route.id,
              targetUrl: route.targetUrl,
              status: upstream.status,
              message: `Upstream returned ${upstream.status}`
            });
          }

          const proxyHeaders = new Headers(upstream.headers);
          Object.entries(corsHeaders()).forEach(([k, v]) => proxyHeaders.set(k, v));
          return new Response(upstream.body, { status: upstream.status, headers: proxyHeaders });
        } catch (err) {
          await addLog(env, {
            timestamp: nowIso(),
            routeId: route.id,
            targetUrl: route.targetUrl,
            status: 502,
            message: err.message || "Upstream connection failed"
          });
          return withCors(json({ error: "Gagal terhubung ke API tujuan" }, 502));
        }
      }

      return withCors(notFound());
    } catch (err) {
      await addLog(env, {
        timestamp: nowIso(),
        routeId: null,
        targetUrl: null,
        status: 500,
        message: err.message || "Unexpected internal error"
      });
      return withCors(json({ error: err.message || "Internal Server Error" }, 500));
    }
  }
};
