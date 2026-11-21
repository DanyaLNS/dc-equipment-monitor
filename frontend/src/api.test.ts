import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi, currentState, query, type Reply, type TargetRow } from './api';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('API transport', () => {
  it('uses cookies, opaque ETag, and memory CSRF on a 204', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const api = createApi(vi.fn(), () => '/racks');
    api.setCsrf('session-csrf');
    await api.request('/racks/90071992547409931', { method: 'DELETE', etag: '"opaque"', });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/racks/90071992547409931');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers.get('If-Match')).toBe('"opaque"');
    expect(init.headers.get('X-CSRF-Token')).toBe('session-csrf');
  });

  it('does not restart a failed write or report telemetry failures recursively', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('network'));
    vi.stubGlobal('fetch', fetch);
    const api = createApi(vi.fn(), () => '/equipment/:id');
    api.setCsrf('csrf');
    await expect(api.request('/equipment/42', { method: 'PATCH', body: { name: 'device' }, etag: '"v1"' }))
      .rejects.toMatchObject({ code: 'API_UNAVAILABLE' });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/v1/equipment/42', '/api/v1/client-events']);
    const payload = JSON.parse(fetch.mock.calls[1][1].body);
    expect(payload.events[0]).toMatchObject({ code: 'API_UNAVAILABLE', route_template: '/equipment/:id', request_id: null });
  });

  it('retains Retry-After and field messages, and clears authorization on 401', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: {
      code: 'RATE_LIMITED', fields: {}, request_id: 'req-1',
    } }), { status: 429, headers: { 'Retry-After': '12' } })).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'VALIDATION_ERROR', fields: { tcp_port: 'Invalid' } } }), { status: 422 }),
    ).mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const unauthorized = vi.fn();
    const api = createApi(unauthorized, () => '/');
    await expect(api.request('/auth/login', { method: 'POST' })).rejects.toMatchObject({ retryAt: Date.now() + 12000 });
    await expect(api.request('/targets/7', { method: 'PATCH' })).rejects.toMatchObject({ fields: { tcp_port: 'Invalid' } });
    await expect(api.request('/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledOnce();
  });
  it('times out a request after five seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('', 'AbortError')));
    })));
    const api = createApi(vi.fn(), () => '/');
    const check = expect(api.request('/summary')).rejects.toMatchObject({ code: 'API_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(5000);
    await check;
  });
});

it('encodes filters without dropping false or precision of IDs', () => {
  expect(query('/equipment', { monitoring_enabled: 'false', rack_id: '90071992547409931', q: 'a & b', type: '' }))
    .toBe('/equipment?monitoring_enabled=false&rack_id=90071992547409931&q=a+%26+b');
});
it('uses monotonic elapsed server time and keeps non-observed states', () => {
  const reply = { meta: { server_time: '2026-11-21T12:00:00Z' }, received: 500 } as Reply<unknown>;
  const row = { state: 'AVAILABLE', stale_at: '2026-11-21T12:00:02Z' } as TargetRow;
  expect(currentState(row, reply, 2499)).toBe('AVAILABLE');
  expect(currentState(row, reply, 2500)).toBe('STALE');
  expect(currentState({ ...row, state: 'DISABLED' }, reply, 5000)).toBe('DISABLED');
  expect(currentState({ ...row, state: 'NOT_CHECKED' }, reply, 5000)).toBe('NOT_CHECKED');
});
