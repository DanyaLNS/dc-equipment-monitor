import { Readable } from 'node:stream';
import { expect, it } from 'vitest';
import type { Connect, ViteDevServer } from 'vite';
import { demoApi } from './api';

function harness() {
  let middleware: Connect.NextHandleFunction;
  const plugin = demoApi();
  const setup = plugin.configureServer;
  if (typeof setup !== 'function') throw new Error('Missing middleware');
  setup({
    middlewares: { use: (handler: Connect.NextHandleFunction) => { middleware = handler; } },
  } as unknown as ViteDevServer);

  return function request(path: string, options: { method?: string; body?: object; cookie?: string; csrf?: string; etag?: string } = {}) {
    const { method = 'GET', body, cookie, csrf, etag } = options;
    const input = Object.assign(Readable.from(body ? [JSON.stringify(body)] : []), {
      url: '/api/v1' + path, method, headers: {
        cookie, 'content-type': 'application/json', 'x-csrf-token': csrf, 'if-match': etag,
      },
    });
    return new Promise<{ status: number; headers: Record<string, string>; json: {
      data: { user?: { role: string }; csrf_token?: string; id?: string; targets?: { state: string }[] };
      error?: { code: string };
    } }>((resolve, reject) => {
      const headers: Record<string, string> = {};
      let status = 0;
      const output = {
        setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
        writeHead: (code: number, additional?: Record<string, string>) => {
          status = code;
          Object.assign(headers, additional);
          return output;
        },
        end: (payload?: string) => { resolve({ status, headers, json: payload ? JSON.parse(payload) : undefined }); },
      };
      middleware(input as unknown as Parameters<typeof middleware>[0],
        output as unknown as Parameters<typeof middleware>[1], () => reject(new Error('Unhandled route')));
    });
  };
}

it('supports demo authentication, independent port states and observer permissions', async () => {
  const request = harness();
  expect((await request('/auth/me')).status).toBe(401);
  const login = await request('/auth/login', { method: 'POST', body: { login: 'observer', password: 'demo1234' } });
  expect(login.json.data.user?.role).toBe('OBSERVER');
  const auth = { cookie: login.headers['set-cookie'].split(';')[0], csrf: login.json.data.csrf_token };
  expect((await request('/auth/me', auth)).status).toBe(200);
  const view = await request('/equipment/1/view', auth);
  expect(view.json.data.targets?.map(port => port.state)).toEqual(['AVAILABLE', 'UNAVAILABLE']);
  const denied = await request('/racks', { ...auth, method: 'POST', body: { name: 'test' } });
  expect(denied.json.error?.code).toBe('FORBIDDEN');
  expect((await request('/auth/logout', { ...auth, method: 'POST' })).status).toBe(204);
  expect((await request('/auth/me', auth)).status).toBe(401);
});

it('supports admin writes, protects nonempty racks and rejects outdated ETags', async () => {
  const request = harness();
  const login = await request('/auth/login', { method: 'POST', body: { login: 'admin', password: 'demo1234' } });
  const auth = { cookie: login.headers['set-cookie'].split(';')[0], csrf: login.json.data.csrf_token };
  const created = await request('/racks', { ...auth, method: 'POST', body: { name: 'test' } });
  expect(created.status).toBe(201);
  const path = '/racks/' + created.json.data.id;
  const edit = { ...auth, method: 'PATCH', etag: created.headers.etag, body: { name: 'updated' } };
  expect((await request(path, edit)).status).toBe(200);
  expect((await request(path, edit)).json.error?.code).toBe('VERSION_CONFLICT');
  const rack = await request('/racks/1', auth);
  expect((await request('/racks/1', { ...auth, method: 'DELETE', etag: rack.headers.etag })).json.error?.code).toBe('RACK_NOT_EMPTY');
});
