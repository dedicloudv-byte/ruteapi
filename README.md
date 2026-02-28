# API Relay Worker (Cloudflare Workers)

Web admin modern untuk membuat **API user** yang mem-proxy request ke **API tujuan**, lengkap dengan otorisasi token dan logging error.

## Fitur utama

- Admin membuat route API user ke target API.
- Token random user API digenerate aman dan disimpan di **Cloudflare R2**.
- Proxy request dari user API ke target API (method dapat dibatasi).
- Log error upstream (status non-2xx atau gagal koneksi).
- Dashboard web modern (`/`) untuk kelola route + lihat log.
- Siap deploy ke Cloudflare Workers.

## Struktur endpoint

- `GET /` → dashboard admin.
- `POST /api/admin/routes` → buat route baru (butuh `x-admin-token`).
- `GET /api/admin/routes` → list route.
- `DELETE /api/admin/routes/:id` → hapus route + token route di R2.
- `GET /api/admin/logs?limit=100` → lihat log error.
- `ANY /u/:id` → endpoint user untuk relay ke target API.

## Konfigurasi

1. Buat KV namespace:
   - `CONFIG_KV` (menyimpan metadata route)
   - `LOG_KV` (menyimpan log error)
2. Buat R2 bucket:
   - `TOKEN_R2` (menyimpan token random route per object)
3. Isi `wrangler.toml` dengan ID KV dan nama bucket R2 yang benar.
4. Ubah `ADMIN_TOKEN` menjadi token kuat.

## Jalankan lokal

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run deploy
```

## Header keamanan

- Admin API wajib header: `x-admin-token: <ADMIN_TOKEN>`.
- User API wajib header: `x-user-token: <TOKEN_ROUTE_USER>`.
