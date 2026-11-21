import { Alert, Button, Card, ConfigProvider, Form, Input, Spin } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError, createApi, type Api, type Auth, type Route } from './api';
import { Editor, useRacks, type Edit } from './editor';
import { DetailScreen, EquipmentScreen, HistoryScreen, RacksScreen, SettingsScreen, SummaryScreen } from './screens';
import { ru, time } from './ru';
import { errorText } from './ui';
import 'antd/dist/reset.css';
import './style.css';

declare const __DEMO__: boolean;
declare const __STATIC_DEMO__: boolean;

const readPath = () => __STATIC_DEMO__ ? location.hash.slice(1) || '/' : location.pathname;
const href = (path: string) => __STATIC_DEMO__ ? '#' + path : path;

const menu = [['/', ru.summary], ['/racks', ru.racks], ['/equipment', ru.equipment], ['/settings', ru.settings]] as const;
function routeTemplate(path: string): Route {
  if (path.startsWith('/equipment/')) return '/equipment/:id';
  return menu.find(([route]) => route === path)?.[0] ?? '/';
}

class ErrorBoundary extends Component<{ api: Api; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.api.event('UI_ERROR'); }
  render() {
    return this.state.failed ? <Alert type="error" showIcon message={ru.uiError} /> : this.props.children;
  }
}

function Login({ api, onLogin }: { api: Api; onLogin: (auth: Auth) => void }) {
  const [form] = Form.useForm<{ login: string; password: string }>();
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const pending = useRef(false);
  const wait = Math.max(0, Math.ceil(((error?.retryAt ?? 0) - now) / 1000));
  useEffect(() => {
    if (!error?.retryAt) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= error.retryAt) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [error]);
  return <main className="login"><Card title={ru.title}>
    {__DEMO__ && <Alert className="login-error" type="info" message={ru.demo} description={ru.demoAccounts} />}
    <Form form={form} layout="vertical" disabled={busy} onFinish={async values => {
      if (pending.current || wait) return;
      if (new TextEncoder().encode(values.password).length > 1024) {
        form.setFields([{ name: 'password', errors: [ru.passwordSize] }]);
        return;
      }
      pending.current = true;
      setBusy(true);
      setError(undefined);
      try {
        const reply = await api.request<Auth>('/auth/login', { method: 'POST', body: { login: values.login.trim(), password: values.password } });
        onLogin(reply.data);
      } catch (failure) {
        const e = failure as ApiError;
        form.setFields((['login', 'password'] as const).filter(name => e.fields[name]).map(name => ({ name, errors: [e.fields[name]] })));
        setNow(Date.now());
        setError(e);
      } finally {
        form.setFieldValue('password', '');
        pending.current = false;
        setBusy(false);
      }
    }}>
      {error && <Alert className="login-error" type="error" showIcon message={errorText(error)}
        description={wait ? `${ru.wait} ${wait} ${ru.seconds}` : undefined} />}
      <Form.Item name="login" label={ru.login} rules={[{ required: true, whitespace: true, message: ru.required },
        { validator: (_, value: string) => !value || [...value.trim()].length <= 100 ? Promise.resolve() : Promise.reject(new Error(ru.max(100))) }]}>
        <Input autoComplete="username" autoFocus />
      </Form.Item>
      <Form.Item name="password" label={ru.password} rules={[{ required: true, message: ru.required }]}>
        <Input.Password autoComplete="current-password" />
      </Form.Item>
      <Button block type="primary" htmlType="submit" loading={busy} disabled={wait > 0}>{ru.signIn}</Button>
    </Form>
  </Card></main>;
}

function Dashboard({ api, auth, onLogout }: { api: Api; auth: Auth; onLogout: () => void }) {
  const [path, setPath] = useState(readPath);
  const [revision, refresh] = useState(0);
  const [edit, setEdit] = useState<Edit>();
  const [exitError, setExitError] = useState<ApiError>();
  const [exiting, setExiting] = useState(false);
  const [exitWait, setExitWait] = useState(0);
  const exitPending = useRef(false);
  const leave = useRef<AbortController | undefined>(undefined);
  const active = routeTemplate(path);
  const detail = /^\/equipment\/([1-9]\d*)(?:\/ports\/([1-9]\d*)\/history)?\/?$/.exec(path);
  const racks = useRacks(api, active === '/equipment' || (edit?.kind === 'equipment' && edit.mode !== 'delete'));
  useEffect(() => {
    const pop = () => { setEdit(undefined); setPath(readPath()); };
    window.addEventListener('popstate', pop);
    if (__STATIC_DEMO__) window.addEventListener('hashchange', pop);
    return () => {
      window.removeEventListener('popstate', pop);
      if (__STATIC_DEMO__) window.removeEventListener('hashchange', pop);
    };
  }, []);
  useEffect(() => () => leave.current?.abort(), []);
  useEffect(() => {
    if (!exitWait) return;
    const timer = setTimeout(() => setExitWait(0), Math.max(0, exitWait - Date.now()));
    return () => clearTimeout(timer);
  }, [exitWait]);
  function navigate(next: string) {
    if (readPath() !== next) history.pushState(null, '', href(next));
    setEdit(undefined);
    setPath(next);
  }
  async function logout() {
    if (exitPending.current) return;
    exitPending.current = true;
    const controller = new AbortController();
    leave.current = controller;
    setExiting(true);
    setExitError(undefined);
    try {
      await api.request('/auth/logout', { method: 'POST', signal: controller.signal });
      if (!controller.signal.aborted) onLogout();
    } catch (failure) {
      if (!controller.signal.aborted) {
        const error = failure as ApiError;
        setExitError(error);
        setExitWait(error.retryAt);
      }
    } finally {
      exitPending.current = false;
      if (!controller.signal.aborted) setExiting(false);
    }
  }
  const common = { api, revision, admin: auth.user.role === 'ADMIN', edit: setEdit };
  return <ErrorBoundary api={api}>
    <header className="toolbar">
      <strong>{ru.title}</strong>
      {__DEMO__ && <span className="demo-label">{ru.demo}</span>}
      <nav aria-label={ru.title}>{menu.map(([destination, label]) =>
        <a key={destination} href={href(destination)} aria-current={active === destination ||
          (active === '/equipment/:id' && destination === '/equipment') ? 'page' : undefined}
          onClick={event => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault(); navigate(destination);
          }}>{label}</a>)}</nav>
      <div className="account"><span>{auth.user.login} · {common.admin ? ru.admin : ru.observer}</span>
        <Button loading={exiting} disabled={exitWait > Date.now()} onClick={() => void logout()}>{ru.signOut}</Button></div>
    </header>
    <main className="content">
      {exitError && <Alert type="error" showIcon message={errorText(exitError)}
        description={exitWait > Date.now() ? `${ru.wait} ${time(exitWait)}` : undefined} />}
      {detail && (detail[2] ?
        <HistoryScreen key={path} {...common} id={detail[1]} target={detail[2]} navigate={navigate} /> :
        <DetailScreen key={path} {...common} id={detail[1]} navigate={navigate} />)}
      {!detail && (active === '/racks' ? <RacksScreen {...common} /> :
        active === '/equipment' ? <EquipmentScreen {...common} racks={racks} navigate={navigate} /> :
        active === '/settings' ? <SettingsScreen {...common} /> : <SummaryScreen {...common} />)}
    </main>
    {edit && <Editor key={edit.mode + edit.path} edit={edit} api={api} racks={racks} onClose={() => setEdit(undefined)}
      onSaved={() => {
        if (edit.mode === 'delete' && edit.kind === 'equipment' && detail) navigate('/equipment');
        setEdit(undefined);
        refresh(value => value + 1);
      }} />}
  </ErrorBoundary>;
}

function App({ transport }: { transport?: typeof fetch }) {
  const [auth, setAuth] = useState<Auth | null>();
  const [error, setError] = useState<ApiError>();
  const [attempt, retry] = useState(0);
  const [retryAt, setRetryAt] = useState(0);
  const [api] = useState(() => createApi(() => setAuth(null), () => routeTemplate(readPath()), transport));
  function login(session: Auth) {
    api.setCsrf(session.csrf_token);
    setAuth(session);
  }
  useEffect(() => {
    const controller = new AbortController();
    void api.request<Auth>('/auth/me', { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) {
        api.setCsrf(data.csrf_token);
        setAuth(data);
      }
    }).catch((failure: ApiError) => {
      if (!controller.signal.aborted && failure.status !== 401) {
        setError(failure);
        setRetryAt(failure.retryAt);
      }
    });
    return () => controller.abort();
  }, [api, attempt]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [retryAt]);
  if (auth === undefined) return <main className="login">
    {error ? <Alert type="error" showIcon message={errorText(error)} action={<Button disabled={retryAt > Date.now()}
      onClick={() => { setError(undefined); retry(n => n + 1); }}>{ru.retry}</Button>} /> :
      <Spin tip={ru.checkSession}><div className="loading" /></Spin>}
  </main>;
  return auth ? <Dashboard api={api} auth={auth} onLogout={() => { api.setCsrf(); setAuth(null); }} /> : <Login api={api} onLogin={login} />;
}

function mount(transport?: typeof fetch) {
  createRoot(document.getElementById('root')!).render(<ConfigProvider locale={ruRU}
    theme={{ token: { colorPrimary: '#1d5489', borderRadius: 6 } }}><App transport={transport} /></ConfigProvider>);
}
if (__STATIC_DEMO__) void import('../demo/browser').then(({ createDemoFetch }) => mount(createDemoFetch()));
else mount();
