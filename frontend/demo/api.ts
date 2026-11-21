import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import type { Auth, Counts, Equipment, Probe, Rack, Settings, Target, TargetRow } from '../src/api';

const accounts = [
  { id: '1', login: 'admin', role: 'ADMIN' },
  { id: '2', login: 'observer', role: 'OBSERVER' },
] as const;
const password = 'demo1234';
const iso = (timestamp = Date.now()) => new Date(timestamp).toISOString();
const initialMetadata = { version: 1, created_at: iso(), updated_at: iso() };
const types = ['SERVER', 'NETWORK', 'STORAGE', 'OTHER'];
type Config = Rack | Equipment | Target | Settings;
type Body = Record<string, unknown>;
type Collection = 'racks' | 'equipment' | 'targets' | 'settings';

class Failure extends Error {
  constructor(public status: number, public code: string, public fields: Record<string, string> = {},
    public headers: Record<string, string> = {}) { super(code); }
}
const invalid = (key: string, message = 'Недопустимое значение'): never => { throw new Failure(422, 'VALIDATION_ERROR', { [key]: message }); };
const missing = (): never => { throw new Failure(404, 'NOT_FOUND'); };
const conflict = (code: string): never => { throw new Failure(409, code); };
const etag = (kind: Collection, row: Config) => `"${kind}-${'id' in row ? row.id : '1'}-v${row.version}"`;
const keys = {
  racks: ['name', 'location', 'description'],
  equipment: ['name', 'rack_id', 'inventory_number', 'type', 'address', 'monitoring_enabled'],
  targets: ['tcp_port', 'label', 'monitoring_enabled'],
  settings: ['interval_seconds', 'timeout_ms', 'concurrency', 'stale_after_seconds', 'retention_days'],
};

type DemoRequest = Pick<IncomingMessage, 'method' | 'headers' | typeof Symbol.asyncIterator>;
type DemoResponse = {
  setHeader(name: string, value: string): unknown;
  writeHead(status: number, headers?: Record<string, string>): { end(body?: string): unknown };
};

async function readBody(request: DemoRequest): Promise<Body> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new Failure(415, 'UNSUPPORTED_MEDIA_TYPE');
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let body = '';
  let bytes = 0;
  for await (const chunk of request) {
    const data = typeof chunk === 'string' ? encoder.encode(chunk) : chunk as Uint8Array;
    bytes += data.byteLength;
    if (bytes <= 1048576) body += decoder.decode(data, { stream: true });
  }
  if (bytes > 1048576) throw new Failure(413, 'PAYLOAD_TOO_LARGE');
  let value: unknown;
  try { value = JSON.parse(body + decoder.decode()); } catch { throw new Failure(400, 'INVALID_JSON'); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Failure(422, 'VALIDATION_ERROR');
  return value as Body;
}

function text(value: unknown, key: string, max: number, optional = false) {
  if (optional && value == null) return null;
  if (typeof value !== 'string') return invalid(key);
  const normalized = optional ? value : value.trim();
  if ((!optional && !normalized) || [...normalized].length > max) return invalid(key);
  return normalized;
}
function integer(value: unknown, key: string, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return invalid(key);
  return value;
}
function enabled(value: unknown) {
  return typeof value === 'boolean' ? value : invalid('monitoring_enabled');
}
function validateAddress(value: string) {
  const dns = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?$/i;
  if (dns.test(value)) return value;
  if (/^[0-9a-f:.]+$/i.test(value) && value.includes(':')) {
    try { return new URL(`http://[${value}]/`).hostname ? value : invalid('address'); }
    catch { return invalid('address'); }
  }
  return invalid('address');
}

export function createDemoHandler() {
  const racks = new Map<string, Rack>([
    ['1', { ...initialMetadata, id: '1', name: 'R-01', location: 'Зал 1', description: 'Демонстрационная стойка' }],
    ['2', { ...initialMetadata, id: '2', name: 'R-02', location: 'Зал 2', description: null }],
  ]);
  const equipment = new Map<string, Equipment>([
    ['1', { ...initialMetadata, id: '1', rack_id: '1', name: 'Сервер приложений', inventory_number: 'DEMO-001', type: 'SERVER', address: 'app.example.test', monitoring_enabled: true }],
    ['2', { ...initialMetadata, id: '2', rack_id: '1', name: 'Коммутатор', inventory_number: 'DEMO-002', type: 'NETWORK', address: 'switch.example.test', monitoring_enabled: false }],
  ]);
  const targets = new Map<string, Target>([
    ['1', { ...initialMetadata, id: '1', equipment_id: '1', tcp_port: 443, label: 'HTTPS', monitoring_enabled: true }],
    ['2', { ...initialMetadata, id: '2', equipment_id: '1', tcp_port: 8443, label: 'Тестовый сервис', monitoring_enabled: true }],
    ['3', { ...initialMetadata, id: '3', equipment_id: '2', tcp_port: 22, label: 'SSH', monitoring_enabled: true }],
  ]);
  const histories = new Map<string, Probe[]>();
  const revisions = new Map<string, number>();
  const sessions = new Map<string, Auth>();
  const attempts = new Map<string, { count: number; until: number }>();
  let settings: Settings = { interval_seconds: 60, timeout_ms: 3000, concurrency: 10, stale_after_seconds: 120, retention_days: 7, version: 1, updated_at: iso() };
  let nextId = 4;
  let nextResult = 1;

  function simulate(target: Target, device: Equipment, now: number) {
    const monitoring = target.monitoring_enabled && device.monitoring_enabled;
    const monitor_revision = revisions.get(target.id) ?? 1;
    const cutoff = now - settings.retention_days * 86400000;
    const results = (histories.get(target.id) ?? []).filter(item => Date.parse(item.finished_at) >= cutoff);
    let last = results.find(item => item.monitor_revision === monitor_revision);
    if (monitoring && (!last || Date.parse(last.finished_at) + settings.interval_seconds * 1000 <= now)) {
      const status = target.id === '2' ? 'UNAVAILABLE' : 'AVAILABLE';
      const initialDelay = 5000;
      const changedAt = Math.max(Date.parse(target.updated_at), Date.parse(device.updated_at));
      if (last || changedAt + initialDelay <= now || (monitor_revision === 1 && Number(target.id) <= 3)) {
        last = {
          id: String(nextResult++), run_id: globalThis.crypto.randomUUID(), target_id: target.id, monitor_revision,
          settings_version: settings.version, address_snapshot: device.address, port_snapshot: target.tcp_port,
          resolved_ip: '192.0.2.10', status, started_at: iso(now - 12), finished_at: iso(now), duration_ms: 12,
          error_code: status === 'UNAVAILABLE' ? 'CONNECTION_REFUSED' : null,
          error_text: status === 'UNAVAILABLE' ? 'Соединение отклонено (демо)' : null,
        };
        results.unshift(last);
      }
    }
    histories.set(target.id, results);
    const stale = last ? Date.parse(last.finished_at) + settings.stale_after_seconds * 1000 : null;
    const last_result = last ? {
      run_id: last.run_id, status: last.status, checked_at: last.finished_at, duration_ms: last.duration_ms,
      resolved_ip: last.resolved_ip, error_code: last.error_code, error_text: last.error_text,
    } : null;
    const state = !monitoring ? 'DISABLED' : !last ? 'NOT_CHECKED' : stale !== null && now >= stale ? 'STALE' : last.status;
    return { ...target, monitor_revision, effective_monitoring_enabled: monitoring, state, last_result,
      stale_at: monitoring && stale !== null ? iso(stale) : null,
      next_due_at: monitoring ? iso(last ? Date.parse(last.finished_at) + settings.interval_seconds * 1000 : now) : null,
    } satisfies TargetRow;
  }
  function counts(rows: TargetRow[]): Counts {
    const result = { total: rows.length, available: 0, unavailable: 0, not_checked: 0, disabled: 0, stale: 0 };
    for (const row of rows) result[row.state.toLowerCase() as Lowercase<TargetRow['state']>]++;
    return result;
  }
  const deviceTargets = (id: string) => [...targets.values()].filter(target => target.equipment_id === id);
  const bump = (target: Target) => { revisions.set(target.id, (revisions.get(target.id) ?? 1) + 1); };
  const removeTarget = (id: string) => { targets.delete(id); histories.delete(id); revisions.delete(id); };
  const find = <T,>(store: Map<string, T>, id: string) => store.get(id) ?? missing();

  async function handle(request: DemoRequest, response: DemoResponse, url: URL) {
    const method = request.method;
    const path = url.pathname.slice('/api/v1'.length);
    const q = url.searchParams;
    const now = Date.now();
    const server_time = iso(now);
    const request_id = globalThis.crypto.randomUUID();
    response.setHeader('X-Request-ID', request_id);
    response.setHeader('Cache-Control', 'no-store');
    const send = (data: unknown, meta = {}, status = 200) => {
      response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data, meta: { server_time, ...meta } }));
    };
    const done = () => { response.writeHead(204).end(); };
    const byPage = <T,>(rows: T[]) => {
      const page = integer(Number(q.get('page') ?? 1), 'page', 1, Number.MAX_SAFE_INTEGER);
      const page_size = integer(Number(q.get('page_size') ?? 20), 'page_size', 1, 100);
      return { items: rows.slice((page - 1) * page_size, page * page_size), meta: { page, page_size, total: rows.length } };
    };

    try {
      const token = request.headers.cookie?.match(/(?:^|;\s*)demo_session=([\w-]+)/)?.[1] ?? '';
      const session = sessions.get(token);
      if (method !== 'GET' && request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) {
        throw new Failure(403, 'CSRF_FAILED');
      }
      if (path === '/auth/login' && method === 'POST') {
        const body = await readBody(request);
        const login = text(body.login, 'login', 100)?.toLowerCase() ?? '';
        const limit = attempts.get(login);
        if (limit && limit.count >= 5 && limit.until > now) {
          throw new Failure(429, 'RATE_LIMITED', {}, { 'Retry-After': String(Math.ceil((limit.until - now) / 1000)) });
        }
        const user = accounts.find(account => account.login === login);
        if (!user || body.password !== password) {
          attempts.set(login, { count: (limit && limit.until > now ? limit.count : 0) + 1, until: now + 15000 });
          throw new Failure(401, 'INVALID_CREDENTIALS');
        }
        attempts.delete(login);
        sessions.delete(token);
        const newToken = globalThis.crypto.randomUUID();
        const auth = { user, csrf_token: globalThis.crypto.randomUUID(), session_expires_at: iso(now + 8 * 3600000) };
        sessions.set(newToken, auth);
        response.setHeader('Set-Cookie', `demo_session=${newToken}; HttpOnly; SameSite=Lax; Path=/api/v1`);
        return send(auth);
      }
      if (!session || Date.parse(session.session_expires_at) <= now) throw new Failure(401, 'UNAUTHENTICATED');
      if (method !== 'GET') {
        if (request.headers['x-csrf-token'] !== session.csrf_token) throw new Failure(403, 'CSRF_FAILED');
        if (path === '/auth/logout' && method === 'POST') {
          sessions.delete(token);
          response.setHeader('Set-Cookie', 'demo_session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/api/v1');
          return done();
        }
        if (path === '/client-events' && method === 'POST') { await readBody(request); return done(); }
        if (session.user.role !== 'ADMIN') throw new Failure(403, 'FORBIDDEN');
      }
      if (method === 'GET' && path === '/auth/me') return send(session);

      const rowsFor = (id: string) => deviceTargets(id).map(target => simulate(target, find(equipment, id), now));
      const idMatch = /^\/(racks|equipment|targets)\/([1-9]\d*)(?:\/(view|targets|history))?$/.exec(path);
      if (method === 'GET') {
        if (path === '/summary') {
          const rows = [...equipment.keys()].flatMap(rowsFor);
          return send({ racks_total: racks.size, equipment_total: equipment.size, targets: counts(rows) }, { computed_at: server_time });
        }
        if (path === '/racks' || path === '/equipment') {
          const search = (q.get('q') ?? '').toLowerCase();
          if (search.length > 200) invalid('q');
          const includes = (values: (string | null)[]) => values.some(value => value?.toLowerCase().includes(search));
          const rows = path === '/racks' ? [...racks.values()].filter(row => includes([row.name, row.location])).map(row => ({
            ...row, equipment_count: [...equipment.values()].filter(device => device.rack_id === row.id).length,
          })) : [...equipment.values()].filter(row =>
            includes([row.name, row.inventory_number, row.address]) &&
            (!q.has('rack_id') || row.rack_id === q.get('rack_id')) &&
            (!q.has('type') || row.type === q.get('type')) &&
            (!q.has('monitoring_enabled') || String(row.monitoring_enabled) === q.get('monitoring_enabled')),
          ).flatMap(row => {
            const ports = rowsFor(row.id);
            if (q.has('target_state') && !ports.some(port => port.state === q.get('target_state'))) return [];
            return [{ ...row, rack_name: find(racks, row.rack_id).name, target_counts: counts(ports) }];
          });
          const { items, meta } = byPage<unknown>(rows);
          return send({ items }, meta);
        }
        const id = idMatch?.[2];
        if (id && idMatch?.[1] === 'equipment' && idMatch[3] === 'view') {
          const device = find(equipment, id);
          const rack = find(racks, device.rack_id);
          const all = rowsFor(id).sort((a, b) => a.tcp_port - b.tcp_port || Number(a.id) - Number(b.id));
          const { items, meta } = byPage(all);
          return send({ equipment: device, rack: { id: rack.id, name: rack.name }, target_counts: counts(all), targets: items }, meta);
        }
        if (id && idMatch?.[1] === 'targets' && idMatch[3] === 'history') {
          const target = find(targets, id);
          simulate(target, find(equipment, target.equipment_id), now);
          const from = q.has('from') ? Date.parse(q.get('from')!) : -Infinity;
          const to = q.has('to') ? Date.parse(q.get('to')!) : Infinity;
          if (Number.isNaN(from)) invalid('from');
          if (Number.isNaN(to) || from >= to) invalid('to');
          const rows = (histories.get(id) ?? []).filter(row => {
            const ts = Date.parse(row.finished_at);
            return ts >= from && ts < to && (!q.has('status') || row.status === q.get('status'));
          });
          const { items, meta } = byPage(rows);
          return send({ target_id: id, items }, { ...meta, retention_cutoff: iso(now - settings.retention_days * 86400000) });
        }
      }

      const create = method === 'POST' && (path === '/racks' || path === '/equipment' ||
        (idMatch?.[1] === 'equipment' && idMatch[3] === 'targets'));
      const dest = path === '/settings' ? 'settings' : path === '/racks' ? 'racks' :
        path === '/equipment' ? 'equipment' : create ? 'targets' : idMatch && !idMatch[3] ? idMatch[1] as Collection : null;
      if (!dest || (method === 'POST' && !create) || (dest === 'settings' && method === 'DELETE') ||
        ((path === '/racks' || path === '/equipment') && !create)) return missing();
      if (method !== 'GET' && method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') return missing();

      const body = method === 'POST' || method === 'PATCH' ? await readBody(request) : {};
      const id = create ? String(nextId) : idMatch?.[2] ?? '1';
      const storage: Map<string, Config> | null = dest === 'settings' ? null : { racks, equipment, targets }[dest];
      const current = create ? undefined : storage ? find(storage, id) : settings;
      if (current) {
        const tag = etag(dest, current);
        if (method === 'GET') {
          response.setHeader('ETag', tag);
          return send(current);
        }
        if (!request.headers['if-match']) throw new Failure(428, 'PRECONDITION_REQUIRED');
        if (request.headers['if-match'] !== tag) throw new Failure(412, 'VERSION_CONFLICT');
      }
      if (method === 'DELETE') {
        if (dest === 'racks' && [...equipment.values()].some(device => device.rack_id === id)) conflict('RACK_NOT_EMPTY');
        if (dest === 'equipment') for (const target of deviceTargets(id)) removeTarget(target.id);
        if (dest === 'targets') removeTarget(id);
        storage?.delete(id);
        return done();
      }

      for (const key of Object.keys(body)) if (!keys[dest].includes(key)) invalid(key);
      if (method === 'PATCH' && !Object.keys(body).length) throw new Failure(422, 'VALIDATION_ERROR');
      const values: Body = { ...current, ...body };
      const version = { version: (current?.version ?? 0) + 1, updated_at: server_time };
      const base = { ...version, id, created_at: current && 'created_at' in current ? current.created_at : server_time };
      let row: Config;

      if (dest === 'racks') {
        const name = text(values.name, 'name', 100)!;
        if ([...racks.values()].some(other => other.id !== id && other.name === name)) conflict('DUPLICATE_RACK_NAME');
        row = { ...base, name, location: text(values.location, 'location', 200, true), description: text(values.description, 'description', 2000, true) };
      } else if (dest === 'equipment') {
        const rackId = values.rack_id;
        if (typeof rackId !== 'string' || !racks.has(rackId)) return invalid('rack_id');
        if (typeof values.type !== 'string' || !types.includes(values.type)) return invalid('type');
        const inventory = text(values.inventory_number, 'inventory_number', 100)!;
        if ([...equipment.values()].some(other => other.id !== id && other.inventory_number === inventory)) conflict('DUPLICATE_INVENTORY_NUMBER');
        row = { ...base, rack_id: rackId, inventory_number: inventory, name: text(values.name, 'name', 200)!,
          address: validateAddress(text(values.address, 'address', 253)!), type: values.type as Equipment['type'],
          monitoring_enabled: values.monitoring_enabled === undefined ? true : enabled(values.monitoring_enabled) };
        const previous = current as Equipment | undefined;
        if (previous && (previous.address !== row.address || previous.monitoring_enabled !== row.monitoring_enabled)) deviceTargets(id).forEach(bump);
      } else if (dest === 'targets') {
        const previous = current as Target | undefined;
        const deviceId = previous?.equipment_id ?? idMatch?.[2] ?? '';
        find(equipment, deviceId);
        const port = integer(values.tcp_port, 'tcp_port', 1, 65535);
        if (deviceTargets(deviceId).some(other => other.id !== id && other.tcp_port === port)) conflict('DUPLICATE_TCP_PORT');
        row = { ...base, equipment_id: deviceId, tcp_port: port, label: text(values.label, 'label', 100, true),
          monitoring_enabled: values.monitoring_enabled === undefined ? true : enabled(values.monitoring_enabled) };
        if (previous && (previous.tcp_port !== row.tcp_port || previous.monitoring_enabled !== row.monitoring_enabled)) bump(row);
      } else {
        const interval = integer(values.interval_seconds, 'interval_seconds', 10, 3600);
        const timeout = integer(values.timeout_ms, 'timeout_ms', 100, Math.min(10000, interval * 1000 - 1));
        row = { ...version, interval_seconds: interval, timeout_ms: timeout,
          stale_after_seconds: integer(values.stale_after_seconds, 'stale_after_seconds', interval + Math.ceil(timeout / 1000), 86400),
          retention_days: integer(values.retention_days, 'retention_days', 1, 30),
          concurrency: integer(values.concurrency, 'concurrency', 1, 200) };
        if (row.interval_seconds !== settings.interval_seconds || row.timeout_ms !== settings.timeout_ms || row.concurrency !== settings.concurrency) {
          targets.forEach(bump);
        }
      }
      const unchanged = current && keys[dest].every(key => (current as Body)[key] === (row as Body)[key]);
      if (unchanged) row = current;
      if (storage) storage.set(id, row);
      else settings = row as Settings;
      response.setHeader('ETag', etag(dest, row));
      if (create) {
        nextId++;
        response.setHeader('Location', `/api/v1/${dest}/${id}`);
      }
      return send(row, {}, create ? 201 : 200);
    } catch (cause) {
      const error = cause instanceof Failure ? cause : new Failure(500, 'INTERNAL_ERROR');
      response.writeHead(error.status, { 'Content-Type': 'application/json', ...error.headers }).end(JSON.stringify({
        error: { code: error.code, message: error.message, fields: error.fields, request_id },
        meta: { server_time },
      }));
    }
  }

  return handle;
}

export function demoApi(): Plugin {
  const handle = createDemoHandler();
  return {
    name: 'dc-equipment-demo-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/v1/')) return next();
        void handle(request, response, url);
      });
    },
  };
}
