// Cloudflare Worker — Supabase proxy
// Секрети зберігаються в CF Dashboard:
//   Workers → your-worker → Settings → Variables → Add variable (encrypt!)
//   SUPABASE_URL = https://xxxx.supabase.co
//   SUPABASE_ANON_KEY = eyJ...

export default {
  async fetch(request, env) {

    // ── CORS preflight ────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204)
    }

    // ── Перевірка секретів ────────────────────────────────────
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return corsResponse(
        JSON.stringify({ error: 'Worker secrets not configured' }),
        500,
        { 'Content-Type': 'application/json' }
      )
    }

    const url = new URL(request.url)

    // ── Auth endpoints (/auth/v1/*) ───────────────────────────
    // Проксіюємо Supabase Auth (signIn, signUp, signOut, refresh, getUser…)
    if (url.pathname.startsWith('/auth/v1/')) {
      if (url.pathname === '/auth/v1/authorize' && request.method === 'GET') {
        return Response.redirect(env.SUPABASE_URL + url.pathname + url.search, 302)
      }
      return proxyTo(request, env, url.pathname + url.search)
    }

    // ── REST endpoints (/rest/v1/*) ───────────────────────────
    if (url.pathname.startsWith('/rest/v1/')) {
      return proxyTo(request, env, url.pathname + url.search)
    }

    return corsResponse('Not found', 404)
  }
}

// ── Proxy helper ──────────────────────────────────────────────
async function proxyTo(request, env, path) {
  const target = env.SUPABASE_URL + path

  const headers = new Headers(request.headers)

  // Підставляємо ключ з секретів — клієнт передає placeholder
  headers.set('apikey', env.SUPABASE_ANON_KEY)

  // Якщо клієнт вже надіслав Bearer JWT (авторизований запит) — лишаємо.
  // Якщо ні (анонімний) — підставляємо anon key.
  if (!headers.get('Authorization') ||
      headers.get('Authorization') === 'Bearer placeholder') {
    headers.set('Authorization', 'Bearer ' + env.SUPABASE_ANON_KEY)
  }

  // Прибираємо Origin/Host щоб Supabase не відкидав
  headers.delete('Origin')
  headers.delete('Host')

  const upstream = await fetch(target, {
    method:  request.method,
    headers,
    body: request.method !== 'GET' && request.method !== 'HEAD'
      ? request.body
      : undefined,
  })

  const respHeaders = new Headers(upstream.headers)
  respHeaders.set('Access-Control-Allow-Origin', '*')
  respHeaders.set('Access-Control-Allow-Headers',
    'Content-Type, Authorization, apikey, x-client-info, Prefer, Range')
  respHeaders.set('Access-Control-Expose-Headers',
    'Content-Range, X-Total-Count')

  return new Response(upstream.body, {
    status:  upstream.status,
    headers: respHeaders,
  })
}

// ── CORS helper ───────────────────────────────────────────────
function corsResponse(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, apikey, x-client-info, Prefer, Range',
      ...extraHeaders,
    },
  })
}
