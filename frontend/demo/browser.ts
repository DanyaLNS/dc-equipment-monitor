import { createDemoHandler } from './api';

export function createDemoFetch(origin = location.origin): typeof fetch {
  const handle = createDemoHandler();
  let cookie = '';
  return async (input, init) => {
    const request = new Request(typeof input === 'string' ? new URL(input, origin) : input, init);
    const url = new URL(request.url);
    if (url.origin !== origin || !url.pathname.startsWith('/api/v1/')) {
      throw new TypeError('Unsupported demo request');
    }
    const body = request.body ? await request.text() : '';
    request.signal.throwIfAborted();
    const headers = new Headers();
    let status = 200;
    let payload: string | undefined;
    await handle({
      method: request.method,
      headers: { ...Object.fromEntries(request.headers), cookie, host: url.host },
      async *[Symbol.asyncIterator]() { if (body) yield body; },
    }, {
      setHeader(name, value) {
        if (name.toLowerCase() === 'set-cookie') cookie = value.split(';')[0];
        else headers.set(name, value);
      },
      writeHead(code, fields) {
        status = code;
        for (const [name, value] of Object.entries(fields ?? {})) headers.set(name, value);
        return { end(value) { payload = value; } };
      },
    }, url);
    request.signal.throwIfAborted();
    return new Response(payload, { status, headers });
  };
}
