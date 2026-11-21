export type State = 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_CHECKED' | 'DISABLED' | 'STALE';
export type Outcome = 'AVAILABLE' | 'UNAVAILABLE';
export type EquipmentType = 'SERVER' | 'NETWORK' | 'STORAGE' | 'OTHER';
export type Counts = Record<Lowercase<State> | 'total', number>;
export type Auth = { user: { id: string; login: string; role: 'ADMIN' | 'OBSERVER' }; csrf_token: string; session_expires_at: string };
type Entity = { id: string; version: number; created_at: string; updated_at: string };
export type Rack = Entity & { name: string; location: string | null; description: string | null };
export type RackRow = Rack & { equipment_count: number };
export type Equipment = Entity & { rack_id: string; name: string; inventory_number: string; type: EquipmentType; address: string; monitoring_enabled: boolean };
export type EquipmentRow = Equipment & { rack_name: string; target_counts: Counts };
type Diagnostic = { status: Outcome; duration_ms: number; error_code: string | null; error_text: string | null; resolved_ip: string | null; run_id: string };
export type Target = Entity & { equipment_id: string; tcp_port: number; label: string | null; monitoring_enabled: boolean };
export type TargetRow = Target & { state: State; stale_at: string | null; next_due_at: string | null; effective_monitoring_enabled: boolean; monitor_revision: number; last_result: (Diagnostic & { checked_at: string }) | null };
export type EquipmentView = { equipment: Equipment; rack: Pick<Rack, 'id' | 'name'>; targets: TargetRow[]; target_counts: Counts };
export type Probe = Diagnostic & { id: string; target_id: string; monitor_revision: number; settings_version: number; address_snapshot: string; port_snapshot: number; started_at: string; finished_at: string };
export type Summary = { racks_total: number; equipment_total: number; targets: Counts };
export type Settings = { interval_seconds: number; timeout_ms: number; concurrency: number; stale_after_seconds: number; retention_days: number; version: number; updated_at: string };
export type List<T> = { items: T[] };
type Meta = { server_time: string; page?: number; page_size?: number; total?: number; retention_cutoff?: string; computed_at?: string };
export type Reply<T> = { data: T; meta: Meta; etag: string | null; received: number; receivedAt: number };
export type Route = '/' | '/equipment' | '/equipment/:id' | '/racks' | '/settings';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message = '', public fields: Record<string, string> = {},
    public requestId: string | null = null, public retryAt = 0) { super(message); }
}

export function query(path: string, values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== '' && value !== undefined) params.set(key, String(value));
  }
  return params.size ? `${path}?${params}` : path;
}

export function createApi(onUnauthorized: () => void, getRoute: () => Route) {
  let csrf: string | undefined;
  let nextEvent = 0;
  async function request<T = void>(path: string, options: {
    method?: 'POST' | 'PATCH' | 'DELETE'; body?: object; etag?: string; signal?: AbortSignal;
  } = {}): Promise<Reply<T>> {
    const { method, body, etag, signal } = options;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 5000);
    const session = csrf;
    function report(error: ApiError) {
      if ((error.status === 0 || error.status === 503) && path !== '/client-events') {
        event('API_UNAVAILABLE', error.requestId);
      }
    }
    try {
      const headers = new Headers({ Accept: 'application/json' });
      if (body) headers.set('Content-Type', 'application/json');
      if (method && session && path !== '/auth/login') headers.set('X-CSRF-Token', session);
      if (etag) headers.set('If-Match', etag);
      const response = await fetch('/api/v1' + path, {
        method, headers, credentials: 'same-origin', signal: controller.signal,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = response.status === 204 ? undefined : await response.json().catch(error => {
        if (controller.signal.aborted || response.ok) throw error;
      });
      if (signal?.aborted) throw new DOMException('', 'AbortError');
      if (!response.ok) {
        const details = payload?.error;
        const retry = response.headers.get('Retry-After');
        const retryAt = retry && /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry || '') || 0;
        const error = new ApiError(response.status, details?.code, details?.message, details?.fields,
          details?.request_id ?? response.headers.get('X-Request-ID'), retryAt);
        if (response.status === 401 && path !== '/auth/login' && session === csrf) {
          csrf = undefined;
          onUnauthorized();
        }
        report(error);
        throw error;
      }
      return { data: payload?.data, meta: payload?.meta, etag: response.headers.get('ETag'),
        received: performance.now(), receivedAt: Date.now() };
    } catch (error) {
      if (signal?.aborted || error instanceof ApiError) throw error;
      const failure = new ApiError(0, 'API_UNAVAILABLE');
      report(failure);
      throw failure;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  function event(code: 'API_UNAVAILABLE' | 'UI_ERROR', requestId: string | null = null) {
    if (!csrf || Date.now() < nextEvent) return;
    nextEvent = Date.now() + 5000;
    void request('/client-events', { method: 'POST', body: { events: [{
      code, route_template: getRoute(), occurred_at: new Date().toISOString(),
      request_id: requestId?.slice(0, 100) ?? null,
    }] } }).catch((error: ApiError) => { if (error.retryAt) nextEvent = Math.max(nextEvent, error.retryAt); });
  }
  return { request, setCsrf: (value?: string) => { csrf = value; }, event };
}
export type Api = ReturnType<typeof createApi>;

export function currentState(target: TargetRow, reply: Reply<unknown>, now: number): State {
  const serverNow = Date.parse(reply.meta.server_time) + (now - reply.received);
  return (target.state === 'AVAILABLE' || target.state === 'UNAVAILABLE') &&
    target.stale_at && serverNow >= Date.parse(target.stale_at) ? 'STALE' : target.state;
}
