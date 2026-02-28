const memStore = {
  routes: new Map(),
  logs: [],
  tokens: new Map(),
  users: new Map(),
  sessions: new Map(),
  products: new Map(),
  activities: []
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
  const items = await Promise.all(listed.objects.map((obj) => readObject(env, obj.key)));
  return items.filter(Boolean);
}

async function addActivity(env, activity) {
  const payload = { id: generateId("act"), timestamp: nowIso(), ...activity };
  if (env.vpsai) {
    const key = `activities/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.json`;
    return putObject(env, key, payload);
  }
  memStore.activities.unshift(payload);
  memStore.activities = memStore.activities.slice(0, 150);
}

async function listActivities(env, limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  if (env.vpsai) {
    const acts = await listObjects(env, "activities/");
    return acts.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, safeLimit);
  }
  return memStore.activities.slice(0, safeLimit);
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
  if (user.status !== "approved") return { ok: false, response: withCors(json({ error: "Akun belum disetujui admin" }, 403)) };
  return { ok: true, user };
}

const appHtml = `<!DOCTYPE html>
<html lang="id" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Relay Pro - Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
          colors: {
            primary: { 50: '#eff6ff', 100: '#dbeafe', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 900: '#1e3a8a' },
            dark: { 800: '#1e293b', 900: '#0f172a', 950: '#020617' }
          }
        }
      }
    };
  </script>
  <style>
    .glass-effect{background:rgba(30,41,59,.7);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.1)}
    .gradient-text{background:linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .status-dot{box-shadow:0 0 10px currentColor}
    .hover-lift{transition:transform .2s, box-shadow .2s}
    .hover-lift:hover{transform:translateY(-2px);box-shadow:0 10px 40px -10px rgba(0,0,0,.5)}
  </style>
</head>
<body class="bg-dark-950 text-gray-100 font-sans antialiased overflow-hidden">
<div id="loginOverlay" class="fixed inset-0 z-50 flex items-center justify-center bg-dark-950/95 backdrop-blur-sm">
  <div class="w-full max-w-md p-8 glass-effect rounded-2xl shadow-2xl">
    <div class="text-center mb-8"><h1 class="text-2xl font-bold gradient-text">API Relay Pro</h1><p class="text-gray-400 mt-2">Secure API Management Dashboard</p></div>
    <form id="loginForm" class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-300 mb-2">Admin Token</label>
        <input type="password" id="adminToken" class="w-full px-4 py-3 bg-dark-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none font-mono text-sm" placeholder="Enter your admin token...">
      </div>
      <button type="submit" class="w-full py-3 bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-500 hover:to-purple-500 rounded-lg font-semibold">Access Dashboard</button>
    </form>
    <div class="mt-4 text-xs text-gray-400">Tambahan fitur user/public tersedia di tab <b>Settings</b>.</div>
  </div>
</div>

<div id="mainApp" class="hidden h-screen flex">
  <aside class="w-64 bg-dark-900 border-r border-gray-800 flex flex-col">
    <div class="p-6 border-b border-gray-800"><h1 class="font-bold text-lg">API Relay Pro</h1><p class="text-xs text-gray-400">Dashboard Admin</p></div>
    <nav class="flex-1 p-4 space-y-2">
      <button onclick="switchTab('dashboard')" class="nav-item w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-primary-500/10 text-primary-400 border border-primary-500/20">Dashboard</button>
      <button onclick="switchTab('routes')" class="nav-item w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-gray-300">Routes <span id="routeCount" class="ml-auto bg-gray-700 text-xs px-2 py-1 rounded-full">0</span></button>
      <button onclick="switchTab('analytics')" class="nav-item w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-gray-300">Analytics</button>
      <button onclick="switchTab('logs')" class="nav-item w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-gray-300">Logs <span id="logCount" class="ml-auto bg-red-500/20 text-red-400 text-xs px-2 py-1 rounded-full">0</span></button>
      <button onclick="switchTab('settings')" class="nav-item w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 text-gray-300">Settings</button>
    </nav>
    <div class="p-4 border-t border-gray-800"><div class="glass-effect rounded-lg p-4"><div class="text-xs text-gray-400">System Status <span class="text-green-400">● Online</span></div></div></div>
  </aside>

  <main class="flex-1 overflow-hidden flex flex-col">
    <header class="h-16 bg-dark-900 border-b border-gray-800 flex items-center justify-between px-6"><h2 id="pageTitle" class="text-xl font-semibold">Dashboard</h2><button onclick="logout()" class="px-4 py-2 bg-red-500/10 text-red-400 rounded-lg">Logout</button></header>
    <div class="flex-1 overflow-y-auto p-6 space-y-6">
      <div id="dashboardTab" class="tab-content space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div class="glass-effect rounded-xl p-6 hover-lift"><h3 class="text-2xl font-bold" id="totalRoutes">0</h3><p class="text-gray-400 text-sm">Active Routes</p></div>
          <div class="glass-effect rounded-xl p-6 hover-lift"><h3 class="text-2xl font-bold" id="totalRequests">0</h3><p class="text-gray-400 text-sm">Total Requests</p></div>
          <div class="glass-effect rounded-xl p-6 hover-lift"><h3 class="text-2xl font-bold" id="errorRate">0%</h3><p class="text-gray-400 text-sm">Error Rate</p></div>
          <div class="glass-effect rounded-xl p-6 hover-lift"><h3 class="text-2xl font-bold" id="avgLatency">0ms</h3><p class="text-gray-400 text-sm">Response Time</p></div>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="glass-effect rounded-xl p-6"><h3 class="text-lg font-semibold mb-4">Request Traffic</h3><canvas id="trafficChart" height="220"></canvas></div>
          <div class="glass-effect rounded-xl p-6"><h3 class="text-lg font-semibold mb-4">Status Distribution</h3><canvas id="statusChart" height="220"></canvas></div>
        </div>
        <div class="glass-effect rounded-xl p-6"><h3 class="text-lg font-semibold mb-4">Recent Activity</h3><div class="space-y-2" id="recentActivity"></div></div>
      </div>

      <div id="routesTab" class="tab-content hidden space-y-4">
        <div class="flex justify-between items-center"><div class="flex gap-3"><input id="searchRoutes" placeholder="Search routes" class="px-4 py-2 bg-dark-800 border border-gray-700 rounded-lg"><select id="filterMethod" class="px-4 py-2 bg-dark-800 border border-gray-700 rounded-lg"><option value="">All</option><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>ANY</option></select></div><button onclick="openRouteModal()" class="px-5 py-2 bg-primary-600 rounded-lg">New Route</button></div>
        <div class="glass-effect rounded-xl overflow-hidden"><table class="w-full text-sm"><thead class="bg-dark-800"><tr><th class="text-left px-4 py-3">Route</th><th class="text-left">Target</th><th>Method</th><th>Req</th><th>Status</th><th class="text-right px-4">Action</th></tr></thead><tbody id="routesTable"></tbody></table></div>
      </div>

      <div id="analyticsTab" class="tab-content hidden space-y-6">
        <div class="glass-effect rounded-xl p-6"><h3 class="text-lg font-semibold mb-4">Performa Route</h3><canvas id="performanceChart" height="260"></canvas></div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="glass-effect rounded-xl p-6"><h3 class="text-lg font-semibold mb-4">Top Endpoints</h3><div id="topEndpoints" class="space-y-2"></div></div>
          <div class="glass-effect rounded-xl p-6"><h3 class="text-lg font-semibold mb-4">Distribusi Method</h3><div id="geoDistribution" class="space-y-2"></div></div>
        </div>
      </div>

      <div id="logsTab" class="tab-content hidden space-y-4">
        <div class="flex gap-3"><button onclick="refreshLogs()" class="px-4 py-2 bg-primary-600 rounded-lg">Refresh</button><button onclick="clearLogs()" class="px-4 py-2 bg-red-600 rounded-lg">Hapus Log</button></div>
        <div class="glass-effect rounded-xl overflow-hidden"><table class="w-full text-sm"><thead class="bg-dark-800"><tr><th class="text-left px-4 py-3">Waktu</th><th>Route</th><th>Status</th><th class="text-left">Pesan</th></tr></thead><tbody id="logsTable"></tbody></table></div>
      </div>

      <div id="settingsTab" class="tab-content hidden space-y-6">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="glass-effect rounded-xl p-6 space-y-3">
            <h3 class="font-semibold">Manajemen User</h3>
            <button onclick="loadUsers()" class="px-4 py-2 bg-primary-600 rounded-lg">Refresh User</button>
            <div class="max-h-80 overflow-auto"><table class="w-full text-sm"><thead><tr><th class="text-left">Email</th><th>Status</th><th>Limit</th><th>Aksi</th></tr></thead><tbody id="usersTable"></tbody></table></div>
          </div>
          <div class="glass-effect rounded-xl p-6 space-y-3">
            <h3 class="font-semibold">Produk API</h3>
            <input id="productName" placeholder="Nama produk" class="px-3 py-2 bg-dark-800 border border-gray-700 rounded-lg">
            <textarea id="productDesc" placeholder="Keterangan" class="px-3 py-2 bg-dark-800 border border-gray-700 rounded-lg"></textarea>
            <button onclick="createProduct()" class="px-4 py-2 bg-primary-600 rounded-lg">Tambah Produk</button>
            <div id="productsList" class="space-y-2"></div>
          </div>
        </div>
      </div>
    </div>
  </main>
</div>

<div id="routeModal" class="hidden fixed inset-0 bg-black/60 z-40 items-center justify-center">
  <div class="glass-effect rounded-xl p-6 w-full max-w-lg space-y-3">
    <h3 class="text-lg font-semibold">Create New Route</h3>
    <input id="routeName" placeholder="Nama route" class="px-4 py-2 bg-dark-800 border border-gray-700 rounded-lg">
    <input id="targetUrl" placeholder="https://api.tujuan.com/endpoint" class="px-4 py-2 bg-dark-800 border border-gray-700 rounded-lg">
    <select id="routeMethod" class="px-4 py-2 bg-dark-800 border border-gray-700 rounded-lg"><option>ANY</option><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select>
    <div class="flex gap-2"><button onclick="createRoute()" class="px-4 py-2 bg-primary-600 rounded-lg">Simpan</button><button onclick="closeRouteModal()" class="px-4 py-2 bg-gray-700 rounded-lg">Batal</button></div>
  </div>
</div>

<script>
  const state = { routes: [], logs: [], users: [], products: [], charts: {} };
  const $ = (id) => document.getElementById(id);

  const api = async (url, opts = {}) => {
    const token = sessionStorage.getItem('adminToken') || '';
    const headers = { 'content-type': 'application/json', 'x-admin-token': token, ...(opts.headers || {}) };
    const res = await fetch(url, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request gagal');
    return data;
  };

  function renderIcons(){ if (window.lucide) window.lucide.createIcons(); }

  function setActiveNav(name){
    document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('bg-primary-500/10','text-primary-400','border','border-primary-500/20'));
    const m = {dashboard:0,routes:1,analytics:2,logs:3,settings:4};
    const t = document.querySelectorAll('.nav-item')[m[name]];
    if (t) t.classList.add('bg-primary-500/10','text-primary-400','border','border-primary-500/20');
  }

  window.switchTab = (name) => {
    document.querySelectorAll('.tab-content').forEach((el) => el.classList.add('hidden'));
    $(name + 'Tab').classList.remove('hidden');
    $('pageTitle').textContent = name.charAt(0).toUpperCase() + name.slice(1);
    setActiveNav(name);
  };

  window.logout = () => { sessionStorage.removeItem('adminToken'); location.reload(); };
  window.openRouteModal = () => $('routeModal').classList.remove('hidden');
  window.closeRouteModal = () => $('routeModal').classList.add('hidden');

  async function refreshRoutes() {
    const res = await api('/api/admin/routes');
    state.routes = res.items || [];
    $('routeCount').textContent = state.routes.length;

    const search = ($('searchRoutes')?.value || '').toLowerCase();
    const method = $('filterMethod')?.value || '';
    const filtered = state.routes.filter((r) => (!search || r.name.toLowerCase().includes(search) || r.id.toLowerCase().includes(search)) && (!method || r.method === method));

    $('routesTable').innerHTML = filtered.map((r) => '<tr class="border-t border-gray-800"><td class="px-4 py-3"><div class="font-mono text-xs">' + r.id + '</div><div>' + r.name + '</div></td><td class="font-mono text-xs">' + r.targetUrl + '</td><td>' + r.method + '</td><td>' + (r.requests || 0) + '</td><td>' + (r.active ? 'ACTIVE' : 'OFF') + '</td><td class="text-right px-4"><button onclick="removeRoute(\'' + r.id + '\')" class="px-2 py-1 bg-red-600/20 text-red-400 rounded">Delete</button></td></tr>').join('') || '<tr><td colspan="6" class="px-4 py-4 text-gray-400">Belum ada route.</td></tr>';
  }

  window.removeRoute = async (id) => { await api('/api/admin/routes/' + id, { method: 'DELETE' }); await refreshData(); };
  window.createRoute = async () => {
    await api('/api/admin/routes', { method: 'POST', body: JSON.stringify({ name: $('routeName').value.trim(), targetUrl: $('targetUrl').value.trim(), method: $('routeMethod').value }) });
    closeRouteModal();
    await refreshData();
  };

  async function refreshLogs() {
    const res = await api('/api/admin/logs?limit=100');
    state.logs = res.items || [];
    $('logCount').textContent = state.logs.length;
    $('logsTable').innerHTML = state.logs.map((l) => '<tr class="border-t border-gray-800"><td class="px-4 py-3">' + l.timestamp + '</td><td>' + (l.routeId || '-') + '</td><td>' + l.status + '</td><td class="text-left">' + l.message + '</td></tr>').join('') || '<tr><td colspan="4" class="px-4 py-4 text-gray-400">Belum ada log error.</td></tr>';
  }
  window.refreshLogs = refreshLogs;
  window.clearLogs = async () => { await api('/api/admin/logs', { method: 'DELETE' }); await refreshLogs(); };

  async function loadActivity() {
    const metrics = await api('/api/admin/metrics');
    $('totalRoutes').textContent = metrics.totalRoutes;
    $('totalRequests').textContent = metrics.totalRequests;
    $('errorRate').textContent = metrics.errorRate + '%';
    $('avgLatency').textContent = metrics.avgLatencyMs + 'ms';
    $('recentActivity').innerHTML = (metrics.activities || []).map((a) => '<div class="p-3 rounded bg-dark-800/70 text-sm"><div class="font-medium">' + a.title + '</div><div class="text-xs text-gray-400">' + a.timestamp + ' • ' + (a.description || '') + '</div></div>').join('') || '<div class="text-gray-400 text-sm">Belum ada aktivitas.</div>';

    drawCharts(metrics);
    $('topEndpoints').innerHTML = (metrics.topEndpoints || []).map((t) => '<div class="flex justify-between"><span class="font-mono text-xs">' + t.name + '</span><span>' + t.requests + '</span></div>').join('') || '<div class="text-gray-400 text-sm">Belum ada data.</div>';
    $('geoDistribution').innerHTML = Object.entries(metrics.methodDistribution || {}).map(([k,v]) => '<div class="flex justify-between"><span>' + k + '</span><span>' + v + '</span></div>').join('') || '<div class="text-gray-400 text-sm">Belum ada data.</div>';
  }

  function resetChart(key){ if (state.charts[key]) { state.charts[key].destroy(); state.charts[key] = null; } }

  function drawCharts(metrics) {
    const trafficData = metrics.traffic24h || [];
    const statusData = metrics.statusDistribution || {};

    resetChart('traffic');
    state.charts.traffic = new Chart($('trafficChart').getContext('2d'), {
      type: 'line',
      data: { labels: trafficData.map((d) => d.hour), datasets: [{ label: 'Requests', data: trafficData.map((d) => d.count), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.2)', fill: true }] },
      options: { plugins: { legend: { labels: { color: '#cbd5e1' } } }, scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' } } } }
    });

    resetChart('status');
    state.charts.status = new Chart($('statusChart').getContext('2d'), {
      type: 'doughnut',
      data: { labels: Object.keys(statusData), datasets: [{ data: Object.values(statusData), backgroundColor: ['#22c55e', '#f59e0b', '#ef4444', '#3b82f6'] }] },
      options: { plugins: { legend: { labels: { color: '#cbd5e1' } } } }
    });

    resetChart('performance');
    state.charts.performance = new Chart($('performanceChart').getContext('2d'), {
      type: 'bar',
      data: { labels: (metrics.topEndpoints || []).map((i) => i.name), datasets: [{ label: 'Latency (ms)', data: (metrics.topEndpoints || []).map((i) => i.avgLatencyMs || 0), backgroundColor: '#8b5cf6' }] },
      options: { plugins: { legend: { labels: { color: '#cbd5e1' } } }, scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' } } } }
    });
  }

  window.loadUsers = async () => {
    const res = await api('/api/admin/users');
    state.users = res.items || [];
    $('usersTable').innerHTML = state.users.map((u) => '<tr class="border-t border-gray-800"><td class="py-2">' + u.email + '</td><td>' + u.status + '</td><td>' + u.limit + '</td><td><button class="px-2 py-1 bg-green-600/20 text-green-400 rounded mr-1" onclick="approveUser(\'' + u.id + '\')">Approve</button><button class="px-2 py-1 bg-yellow-600/20 text-yellow-400 rounded mr-1" onclick="setUserLimit(\'' + u.id + '\')">Limit</button><button class="px-2 py-1 bg-red-600/20 text-red-400 rounded" onclick="deleteUserById(\'' + u.id + '\')">Hapus</button></td></tr>').join('') || '<tr><td colspan="4" class="text-gray-400 py-3">Belum ada user.</td></tr>';
  };
  window.approveUser = async (id) => { await api('/api/admin/users/' + id, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) }); await loadUsers(); };
  window.setUserLimit = async (id) => { const value = prompt('Limit baru user?'); if (!value) return; await api('/api/admin/users/' + id, { method: 'PATCH', body: JSON.stringify({ action: 'set-limit', limit: Number(value) }) }); await loadUsers(); };
  window.deleteUserById = async (id) => { await api('/api/admin/users/' + id, { method: 'DELETE' }); await loadUsers(); };

  window.createProduct = async () => {
    await api('/api/admin/products', { method: 'POST', body: JSON.stringify({ name: $('productName').value.trim(), description: $('productDesc').value.trim() }) });
    $('productName').value = ''; $('productDesc').value = '';
    await loadProducts();
  };

  async function loadProducts() {
    const res = await api('/api/admin/products');
    state.products = res.items || [];
    $('productsList').innerHTML = state.products.map((p) => '<div class="p-3 rounded bg-dark-800/70 text-sm flex justify-between gap-3"><div><div class="font-medium">' + p.name + '</div><div class="text-gray-400 text-xs">' + (p.description || '-') + '</div></div><button onclick="deleteProduct(\'' + p.id + '\')" class="px-2 py-1 bg-red-600/20 text-red-400 rounded">Hapus</button></div>').join('') || '<div class="text-sm text-gray-400">Belum ada produk.</div>';
  }
  window.deleteProduct = async (id) => { await api('/api/admin/products/' + id, { method: 'DELETE' }); await loadProducts(); };

  window.refreshData = async () => {
    await Promise.all([refreshRoutes(), refreshLogs(), loadActivity(), loadProducts(), loadUsers()]);
  };

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = $('adminToken').value.trim();
    if (!token) return alert('Admin token wajib diisi');
    sessionStorage.setItem('adminToken', token);
    try {
      await api('/api/admin/routes');
      $('loginOverlay').classList.add('hidden');
      $('mainApp').classList.remove('hidden');
      await refreshData();
      renderIcons();
    } catch (err) {
      alert('Token admin tidak valid: ' + err.message);
      sessionStorage.removeItem('adminToken');
    }
  });

  $('searchRoutes').addEventListener('input', refreshRoutes);
  $('filterMethod').addEventListener('change', refreshRoutes);

  if (sessionStorage.getItem('adminToken')) {
    $('adminToken').value = sessionStorage.getItem('adminToken');
    $('loginForm').dispatchEvent(new Event('submit'));
  }
</script>
</body>
</html>`;

function buildMetrics(routes, logs, activities) {
  const totalRoutes = routes.length;
  const totalRequests = routes.reduce((sum, r) => sum + (r.requests || 0), 0);
  const totalErrors = routes.reduce((sum, r) => sum + (r.errorCount || 0), 0);
  const avgLatencyMs = totalRequests ? Math.round(routes.reduce((sum, r) => sum + (r.totalLatencyMs || 0), 0) / totalRequests) : 0;
  const errorRate = totalRequests ? Number(((totalErrors / totalRequests) * 100).toFixed(1)) : 0;

  const statusDistribution = {};
  for (const log of logs) {
    const key = String(log.status || "unknown");
    statusDistribution[key] = (statusDistribution[key] || 0) + 1;
  }

  const trafficMap = new Map();
  for (let i = 23; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 60 * 60 * 1000);
    const key = `${String(d.getHours()).padStart(2, "0")}:00`;
    trafficMap.set(key, 0);
  }
  for (const route of routes) {
    const bucket = route.lastRequestedHour;
    if (bucket && trafficMap.has(bucket)) trafficMap.set(bucket, trafficMap.get(bucket) + 1);
  }

  const topEndpoints = [...routes]
    .sort((a, b) => (b.requests || 0) - (a.requests || 0))
    .slice(0, 6)
    .map((r) => ({ name: r.name, requests: r.requests || 0, avgLatencyMs: r.requests ? Math.round((r.totalLatencyMs || 0) / r.requests) : 0 }));

  const methodDistribution = routes.reduce((acc, route) => {
    acc[route.method] = (acc[route.method] || 0) + 1;
    return acc;
  }, {});

  return {
    totalRoutes,
    totalRequests,
    errorRate,
    avgLatencyMs,
    statusDistribution,
    traffic24h: [...trafficMap.entries()].map(([hour, count]) => ({ hour, count })),
    activities,
    topEndpoints,
    methodDistribution
  };
}

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
        await addActivity(env, { title: "User baru mendaftar", description: `${email} menunggu persetujuan admin` });
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

        if (request.method === "GET" && url.pathname === "/api/user/me") return withCors(json({ ok: true, item: user }));
        if (request.method === "GET" && url.pathname === "/api/user/products") return withCors(json({ ok: true, items: await listProducts(env) }));

        return withCors(notFound());
      }

      if (url.pathname.startsWith("/api/admin")) {
        if (!(await requireAdmin(request, env))) return withCors(json({ error: "Unauthorized admin" }, 401));

        if (request.method === "GET" && url.pathname === "/api/admin/metrics") {
          const routes = await listRoutes(env);
          const logs = await listLogs(env, 100);
          const activities = await listActivities(env, 20);
          return withCors(json({ ok: true, ...buildMetrics(routes, logs, activities) }));
        }

        if (request.method === "GET" && url.pathname === "/api/admin/users") return withCors(json({ ok: true, items: (await listUsers(env)).map(safeUser) }));

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
          await addActivity(env, { title: "Update user", description: `${user.email} -> action: ${body.action}` });
          return withCors(json({ ok: true, item: safeUser(user) }));
        }

        if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/users/")) {
          const id = url.pathname.split("/").pop();
          const user = await getUserById(env, id);
          await deleteUser(env, id);
          await deleteSessionsByUserId(env, id);
          await addActivity(env, { title: "Hapus user", description: user ? user.email : id });
          return withCors(json({ ok: true }));
        }

        if (request.method === "POST" && url.pathname === "/api/admin/products") {
          const body = await parseBody(request);
          const name = (body.name || "").trim();
          if (!name) return withCors(json({ error: "name wajib diisi" }, 400));
          const item = { id: generateId("prod"), name, description: (body.description || "").trim(), createdAt: nowIso() };
          await saveProduct(env, item);
          await addActivity(env, { title: "Produk baru", description: `${item.name} ditambahkan` });
          return withCors(json({ ok: true, item }, 201));
        }

        if (request.method === "GET" && url.pathname === "/api/admin/products") return withCors(json({ ok: true, items: await listProducts(env) }));

        if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/products/")) {
          const id = url.pathname.split("/").pop();
          await deleteProduct(env, id);
          await addActivity(env, { title: "Hapus produk", description: id });
          return withCors(json({ ok: true }));
        }

        if (request.method === "POST" && url.pathname === "/api/admin/routes") {
          const body = await parseBody(request);
          const name = (body.name || "").trim();
          const targetUrl = normalizeTarget(body.targetUrl || "");
          const method = (body.method || "ANY").toUpperCase();
          if (!name) return withCors(json({ error: "name wajib diisi" }, 400));
          if (!["ANY", "GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return withCors(json({ error: "method tidak valid" }, 400));

          const item = {
            id: generateId("api"),
            name,
            targetUrl,
            method,
            active: true,
            requests: 0,
            errorCount: 0,
            totalLatencyMs: 0,
            lastStatus: null,
            lastRequestedHour: null,
            createdAt: nowIso(),
            updatedAt: nowIso()
          };
          const userToken = generateSecret();
          await saveRoute(env, item);
          await saveUserToken(env, item.id, userToken);
          await addActivity(env, { title: "Route baru", description: `${item.name} -> ${item.targetUrl}` });
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
          await addActivity(env, { title: "Hapus route", description: id });
          return withCors(json({ ok: true }));
        }

        if (request.method === "GET" && url.pathname === "/api/admin/logs") {
          const limit = Number(url.searchParams.get("limit") || 50);
          return withCors(json({ ok: true, items: await listLogs(env, limit) }));
        }

        if (request.method === "DELETE" && url.pathname === "/api/admin/logs") {
          await deleteLogs(env);
          await addActivity(env, { title: "Bersihkan logs", description: "Admin menghapus seluruh log error" });
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

        if (route.method !== "ANY" && request.method !== route.method) return withCors(json({ error: `Method harus ${route.method}` }, 405));

        const outgoingHeaders = new Headers(request.headers);
        outgoingHeaders.delete("host");
        outgoingHeaders.delete("x-user-token");

        const targetUrl = new URL(route.targetUrl);
        url.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));

        const start = Date.now();
        const markRoute = async (status, isError) => {
          route.requests = (route.requests || 0) + 1;
          route.errorCount = (route.errorCount || 0) + (isError ? 1 : 0);
          route.totalLatencyMs = (route.totalLatencyMs || 0) + (Date.now() - start);
          route.lastStatus = status;
          route.updatedAt = nowIso();
          const d = new Date();
          route.lastRequestedHour = `${String(d.getHours()).padStart(2, "0")}:00`;
          await saveRoute(env, route);
        };

        try {
          const upstream = await fetch(targetUrl.toString(), {
            method: request.method,
            headers: outgoingHeaders,
            body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
            redirect: "follow"
          });

          const isError = !upstream.ok;
          await markRoute(upstream.status, isError);

          if (isError) {
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
          await markRoute(502, true);
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
      await addLog(env, { timestamp: nowIso(), routeId: null, targetUrl: null, status: 500, message: err.message || "Unexpected internal error" });
      return withCors(json({ error: err.message || "Internal Server Error" }, 500));
    }
  }
};
