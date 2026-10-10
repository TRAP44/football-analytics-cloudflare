// Transparent GET relay to API-Football for the MatchRadar Worker.
// Cloudflare Workers share outbound IPs, and API-Football throttles per IP
// before the key quota is applied. This function (deployed manually in
// Supabase, JWT verification OFF) forwards requests from a different network.
// The caller supplies its own x-apisports-key; nothing is stored here.
const UPSTREAM = 'https://v3.football.api-sports.io';
const ALLOWED = /^\/(fixtures|teams|standings|players|leagues|status|injuries|predictions|odds|coachs|transfers|sidelined|trophies|venues|countries|timezone)(\/[a-z]+)*$/;
const PASS_HEADERS = ['content-type', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-requests-limit', 'x-ratelimit-requests-remaining', 'retry-after'];

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const url = new URL(req.url);
  const marker = '/football-relay';
  const idx = url.pathname.indexOf(marker);
  const path = (idx >= 0 ? url.pathname.slice(idx + marker.length) : url.pathname).replace(/\/+$/, '') || '/';
  if (!ALLOWED.test(path)) return new Response('Path not allowed', { status: 400 });
  const key = req.headers.get('x-apisports-key') || '';
  if (!/^[A-Za-z0-9]{16,64}$/.test(key)) return new Response('Missing or invalid key', { status: 401 });

  const upstream = await fetch(`${UPSTREAM}${path}${url.search}`, {
    headers: { 'x-apisports-key': key, Accept: 'application/json' },
    signal: AbortSignal.timeout(9000),
  }).catch((error) => new Response(JSON.stringify({ errors: { relay: String(error?.message || error) } }), { status: 502, headers: { 'content-type': 'application/json' } }));

  const headers = new Headers();
  for (const name of PASS_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-relay', 'supabase');
  headers.set('cache-control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers });
});
