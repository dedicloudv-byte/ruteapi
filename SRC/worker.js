const memStore = {
  routes: new Map(),
  logs: [],
  tokens: new Map()
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

const nowIso = () => new Date().toISOString();

const generateId = (prefix = "r") =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

const generateUserToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};


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

async function saveRoute(env, route) {
  if (env.vpsai) {
    await env.vpsai.put(`routes/${route.id}.json`, JSON.stringify(route), {
      httpMetadata: { contentType: "application/json" }
    });
    return;
  }
  memStore.routes.set(route.id, route);
}

async function getRoute(env, id) {
  if (env.vpsai) {
    const object = await env.vpsai.get(`routes/${id}.json`);
    if (!object) return null;
    const raw = await object.text();
    return raw ? JSON.parse(raw) : null;
  }
  return memStore.routes.get(id) || null;
}

async function listRoutes(env) {
  if (env.vpsai) {
    const listed = await env.vpsai.list({ prefix: "routes/" });
    const routes = await Promise.all(
      listed.objects.map(async (obj) => {
        const item = await env.vpsai.get(obj.key);
        if (!item) return null;
        const raw = await item.text();
        return raw ? JSON.parse(raw) : null;
      })
    );
    return routes.filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  return Array.from(memStore.routes.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function deleteRoute(env, id) {
  if (env.vpsai) {
    await env.vpsai.delete(`routes/${id}.json`);
    return;
  }
  memStore.routes.delete(id);
}

async function saveUserToken(env, routeId, token) {
  const payload = JSON.stringify({ token, updatedAt: nowIso() });
  if (env.vpsai) {
    await env.vpsai.put(`token/${routeId}.json`, payload, {
      httpMetadata: { contentType: "application/json" }
    });
    return;
  }
  memStore.tokens.set(routeId, payload);
}

async function getUserToken(env, routeId) {
  if (env.vpsai) {
    const object = await env.vpsai.get(`token/${routeId}.json`);
    if (!object) return null;
    const raw = await object.text();
    return raw ? JSON.parse(raw).token : null;
  }
  const raw = memStore.tokens.get(routeId);
  return raw ? JSON.parse(raw).token : null;
}

async function deleteUserToken(env, routeId) {
  if (env.vpsai) {
    await env.vpsai.delete(`token/${routeId}.json`);
    return;
  }
  memStore.tokens.delete(routeId);
}

async function addLog(env, log) {
  if (env.vpsai) {
    const key = `logs/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.json`;
    await env.vpsai.put(key, JSON.stringify(log), {
      httpMetadata: { contentType: "application/json" }
    });
    return;
  }
  memStore.logs.unshift(log);
  memStore.logs = memStore.logs.slice(0, 500);
}

async function listLogs(env, limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  if (env.vpsai) {
    const listed = await env.vpsai.list({ prefix: "logs/", limit: safeLimit });
    const logs = await Promise.all(
      listed.objects.map(async (obj) => {
        const item = await env.vpsai.get(obj.key);
        if (!item) return null;
        const raw = await item.text();
        return raw ? JSON.parse(raw) : null;
      })
    );
    return logs.filter(Boolean).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
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

function requireAdmin(request, env) {
  const token = request.headers.get("x-admin-token") || "";
  const expected = env.ADMIN_TOKEN || "";
  return expected && token === expected;
}

async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Body JSON tidak valid");
  }
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-admin-token,x-user-token"
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

const appHtml = `<!doctype html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>API Relay Control Center</title>
  <style>
    :root {
      --bg: #030712;
      --card: rgba(15, 23, 42, 0.72);
      --accent: #60a5fa;
      --accent-2: #a78bfa;
      --text: #dbeafe;
      --muted: #9ca3af;
      --danger: #fb7185;
      --success: #34d399;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        radial-gradient(circle at 10% 20%, #312e81 0%, transparent 45%),
        radial-gradient(circle at 80% 0%, #0f766e 0%, transparent 35%),
        var(--bg);
      padding: 2rem;
    }
    .container { max-width: 1150px; margin: 0 auto; }
    h1 { margin: 0 0 0.5rem; font-size: clamp(1.4rem, 4vw, 2.4rem); }
    p { color: var(--muted); margin: 0 0 1.2rem; }
    .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit,minmax(290px,1fr)); }
    .card {
      background: var(--card);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 20px;
      padding: 1rem;
      backdrop-filter: blur(20px);
      box-shadow: 0 14px 35px rgba(2, 6, 23, 0.45);
    }
    label { display:block; margin:.6rem 0 .2rem; font-size:.88rem; color:#bfdbfe; }
    input, select, textarea, button {
      width: 100%;
      border-radius: 12px;
      border: 1px solid rgba(96, 165, 250, 0.2);
      background: rgba(15,23,42,0.75);
      color: var(--text);
      padding: .68rem .8rem;
      font-size: .95rem;
    }
    button {
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
      border: none;
      color: #0b1020;
      font-weight: 700;
      margin-top: .9rem;
      cursor: pointer;
    }
    table { width:100%; border-collapse: collapse; font-size:.85rem; }
    th, td { padding:.52rem; border-bottom:1px solid rgba(148,163,184,.2); text-align:left; vertical-align:top; }
    .tag { padding:.15rem .55rem; border-radius:999px; background:rgba(52,211,153,.15); color:var(--success); font-weight:700; font-size:.75rem; }
    .danger { color: var(--danger); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace; word-break: break-all; }
    .small { font-size:.8rem; color:var(--muted); }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 API Relay Control Center</h1>
    <p>Kelola endpoint user secara aman, pantau error real-time, dan proxy request langsung ke API tujuan.</p>

    <div class="grid">
      <section class="card">
        <h3>Admin Login</h3>
        <label>Admin Token</label>
        <input id="adminToken" type="password" placeholder="Masukkan x-admin-token" />
        <p class="small">Token disimpan di browser session.</p>
      </section>

      <section class="card">
        <h3>Buat API User Baru</h3>
        <label>Nama API</label>
        <input id="routeName" placeholder="contoh: payment-core" />
        <label>Target URL</label>
        <input id="targetUrl" placeholder="https://api.tujuan.com/v1/endpoint" />
        <label>Metode</label>
        <select id="method"><option>ANY</option><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select>
        <button id="createBtn">Generate API User</button>
        <div id="createResult" class="small"></div>
      </section>
    </div>

    <section class="card" style="margin-top:1rem;">
      <h3>Daftar API User</h3>
      <button id="refreshRoutes">Refresh API</button>
      <div style="overflow:auto; margin-top:.7rem;">
        <table>
          <thead><tr><th>Nama</th><th>Endpoint User</th><th>Token User</th><th>Target</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody id="routeBody"></tbody>
        </table>
      </div>
    </section>

    <section class="card" style="margin-top:1rem;">
      <h3>Log Error API</h3>
      <div style="display: flex; gap: 0.5rem;">
        <button id="refreshLogs">Refresh Log</button>
        <button id="clearLogs" style="background: var(--danger);">Hapus Semua Log</button>
      </div>
      <div style="overflow:auto; margin-top:.7rem;">
        <table>
          <thead><tr><th>Waktu</th><th>Route</th><th>Status</th><th>Pesan</th><th>Target</th></tr></thead>
          <tbody id="logBody"></tbody>
        </table>
      </div>
    </section>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);

    const api = async (url, opts = {}) => {
      const adminToken = sessionStorage.getItem('adminToken') || '';
      const headers = { 'content-type': 'application/json', 'x-admin-token': adminToken, ...(opts.headers || {}) };
      const res = await fetch(url, { ...opts, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Request gagal');
      return data;
    };

    $('adminToken').value = sessionStorage.getItem('adminToken') || '';
    $('adminToken').addEventListener('change', (e) => {
      sessionStorage.setItem('adminToken', e.target.value.trim());
    });

    async function loadRoutes() {
      const routes = await api('/api/admin/routes');
      $('routeBody').innerHTML = routes.items.map((r) => {
        return '<tr>' +
          '<td>' + r.name + '</td>' +
          '<td class="mono">' + location.origin + '/u/' + r.id + '</td>' +
          '<td class="mono">' + (r.userToken || '-') + '</td>' +
          '<td class="mono">' + r.targetUrl + '</td>' +
          '<td><span class="tag">' + (r.active ? 'ACTIVE' : 'OFF') + '</span></td>' +
          '<td><button data-id="' + r.id + '" class="deleteBtn">Hapus</button></td>' +
          '</tr>';
      }).join('') || '<tr><td colspan="6">Belum ada API user.</td></tr>';
      document.querySelectorAll('.deleteBtn').forEach((btn) => {
        btn.onclick = async () => {
          if (!confirm('Hapus route ini?')) return;
          await api('/api/admin/routes/' + btn.dataset.id, { method: 'DELETE' });
          await loadRoutes();
        };
      });
    }

    async function loadLogs() {
      const logs = await api('/api/admin/logs?limit=100');
      $('logBody').innerHTML = logs.items.map((l) => {
        return '<tr>' +
          '<td>' + l.timestamp + '</td>' +
          '<td class="mono">' + (l.routeId || '-') + '</td>' +
          '<td class="danger">' + (l.status || '-') + '</td>' +
          '<td>' + l.message + '</td>' +
          '<td class="mono">' + (l.targetUrl || '-') + '</td>' +
          '</tr>';
      }).join('') || '<tr><td colspan="5">Belum ada error.</td></tr>';
    }

    $('createBtn').onclick = async () => {
      try {
        const payload = {
          name: $('routeName').value.trim(),
          targetUrl: $('targetUrl').value.trim(),
          method: $('method').value
        };
        const result = await api('/api/admin/routes', { method: 'POST', body: JSON.stringify(payload) });
        $('createResult').innerHTML = '✅ API user dibuat: <span class="mono">' + location.origin + '/u/' + result.item.id + '</span><br/>Token: <span class="mono">' + result.item.userToken + '</span>';
        await loadRoutes();
      } catch (err) {
        $('createResult').textContent = '❌ ' + err.message;
      }
    };

    $('refreshRoutes').onclick = () => loadRoutes().catch((e) => alert(e.message));
    $('refreshLogs').onclick = () => loadLogs().catch((e) => alert(e.message));
    $('clearLogs').onclick = async () => {
      if (!confirm('Hapus semua log secara permanen?')) return;
      try {
        await api('/api/admin/logs', { method: 'DELETE' });
        await loadLogs();
      } catch (e) {
        alert(e.message);
      }
    };

    Promise.all([loadRoutes(), loadLogs()]).catch((e) => {
      alert('Gagal load data admin: ' + e.message + '. Pastikan admin token benar.');
    });
  </script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204, headers: corsHeaders() }));
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/") {
        return withCors(new Response(appHtml, { headers: { "content-type": "text/html; charset=utf-8" } }));
      }

      if (url.pathname.startsWith("/api/admin")) {
        if (!requireAdmin(request, env)) {
          return withCors(json({ error: "Unauthorized admin" }, 401));
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

          const userToken = generateUserToken();
          const item = {
            id: generateId("api"),
            name,
            targetUrl,
            method,
            active: true,
            createdAt: nowIso()
          };

          await saveRoute(env, item);
          await saveUserToken(env, item.id, userToken);

          return withCors(json({ ok: true, item: { ...item, userToken } }, 201));
        }

        if (request.method === "GET" && url.pathname === "/api/admin/routes") {
          const items = await listRoutes(env);
          const withToken = await Promise.all(
            items.map(async (route) => ({ ...route, userToken: await getUserToken(env, route.id) }))
          );
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
          const items = await listLogs(env, limit);
          return withCors(json({ ok: true, items }));
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
        if (!route || !route.active) {
          return withCors(json({ error: "Route user tidak ditemukan" }, 404));
        }

        const expectedUserToken = await getUserToken(env, id);
        const userToken = request.headers.get("x-user-token") || "";
        if (!expectedUserToken || !userToken || userToken !== expectedUserToken) {
          return withCors(json({ error: "Unauthorized user token" }, 401));
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

          return new Response(upstream.body, {
            status: upstream.status,
            headers: proxyHeaders
          });
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
