import { timingSafeEqual } from 'node:crypto';

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function middleware(event: { request: Request }, next: () => Promise<Response>) {
  const request = event.request;
  const url = new URL(request.url);
  const token = process.env.LIFEOS_TOKEN;
  if (url.pathname === '/auth') {
    if (!token || !equal(url.searchParams.get('token') ?? '', token)) return new Response('Unauthorized', { status: 401 });
    return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': `lifeos_session=${token}; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }
  if (url.pathname.startsWith('/_server') || url.pathname === '/api') {
    const cookie = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith('lifeos_session='))?.slice('lifeos_session='.length) ?? '';
    const bearer = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    const authorized = url.pathname === '/api' ? equal(bearer, token ?? '') : (equal(cookie, token ?? '') || equal(bearer, token ?? ''));
    if (!token || !authorized) return new Response('Unauthorized', { status: 401 });
  }
  if (url.pathname === '/api') {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    try {
      const body = await request.json() as { kind: string; name: string; args: unknown };
      if (body.kind === 'control' && body.name === 'stop') {
        setTimeout(() => process.emit('lifeos-stop' as NodeJS.Signals), 100);
        return Response.json({ result: true });
      }
      const backend = await import('../../server/backend.mjs');
      const result = body.kind === 'query' ? await backend.query(body.name, body.args) : body.kind === 'mutation' ? await backend.mutate(body.name, body.args) : (() => { throw new Error('Unknown request'); })();
      return Response.json({ result });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }
  return next();
}
