// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { ApiError, type Api, type Reply } from './api';
import { Editor, validateFields } from './editor';
import { usePoll } from './poll';
import { ru } from './ru';
import { Read, Status } from './ui';

beforeAll(() => {
  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = element => getComputedStyle(element);
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(() => ({
    matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const reply = <T,>(data: T, etag: string | null = null): Reply<T> => ({
  data, etag, meta: { server_time: '2026-11-21T12:00:00Z' }, received: 0, receivedAt: 0,
});

it('keeps previous results visible below a separate API error', () => {
  render(<Read result={{ data: reply('AVAILABLE'), error: new ApiError(503, 'SERVICE_UNAVAILABLE') }}>
    {() => <Status state="AVAILABLE" />}
  </Read>);
  expect(screen.getByText(ru.outdated)).toBeTruthy();
  expect(screen.getByText(ru.state.AVAILABLE)).toBeTruthy();
});

it('preserves draft after a conflict, rereads on request, and submits only intended fields', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(reply({ name: 'Old', location: 'A', description: null }, '"v1"'))
    .mockRejectedValueOnce(new ApiError(412, 'VERSION_CONFLICT'))
    .mockResolvedValueOnce(reply({ name: 'New server name', location: 'B', description: null }, '"v2"'))
    .mockResolvedValueOnce(reply({}));
  const onSaved = vi.fn();
  render(<Editor edit={{ kind: 'rack', mode: 'edit', path: '/racks/1' }} api={{ request } as unknown as Api}
    racks={{ rows: [], loading: false }} onClose={vi.fn()} onSaved={onSaved} />);
  const name = await screen.findByDisplayValue('Old');
  fireEvent.change(name, { target: { value: 'Draft' } });
  fireEvent.click(screen.getByRole('button', { name: ru.save }));
  await screen.findByText(ru.errors.VERSION_CONFLICT);
  expect(request).toHaveBeenCalledTimes(2);
  expect(screen.getByDisplayValue('Draft')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: ru.reread }));
  await screen.findByText('New server name');
  expect(screen.getByDisplayValue('Draft')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: ru.save }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(request.mock.calls[3][1]).toMatchObject({ method: 'PATCH', etag: '"v2"', body: { name: 'Draft' } });
  expect(Object.keys(request.mock.calls[3][1].body)).toEqual(['name']);
});

it('checks related settings and places returned validation errors by field', async () => {
  expect(validateFields('settings', { interval_seconds: 10, timeout_ms: 10000, concurrency: 10,
    stale_after_seconds: 12, retention_days: 3 })).toMatchObject({
    timeout_ms: ru.timeoutRange, stale_after_seconds: ru.staleRange,
  });
  const request = vi.fn().mockRejectedValue(new ApiError(422, 'VALIDATION_ERROR', '', { name: 'Ошибка имени' }));
  render(<Editor edit={{ kind: 'rack', mode: 'create', path: '/racks' }} api={{ request } as unknown as Api}
    racks={{ rows: [], loading: false }} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: ru.save }));
  await screen.findByText(ru.required);
  expect(request).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(ru.name), { target: { value: 'Rack' } });
  fireEvent.click(screen.getByRole('button', { name: ru.save }));
  expect(await screen.findByText('Ошибка имени')).toBeTruthy();
});

it('does not overlap polling, pauses when hidden and cancels an old filter', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const resolvers: ((value: Reply<string>) => void)[] = [];
  const request = vi.fn<(_path: string, _options: { signal: AbortSignal }) => Promise<Reply<string>>>(() =>
    new Promise<Reply<string>>(resolve => resolvers.push(resolve)));
  const api = { request } as unknown as Api;
  const hook = renderHook(({ path }) => usePoll<string>(api, path, 0), { initialProps: { path: '/a' } });
  await act(() => vi.advanceTimersByTimeAsync(6000));
  expect(request).toHaveBeenCalledOnce();
  hook.rerender({ path: '/b' });
  expect(request.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { resolvers[1](reply('new')); resolvers[0](reply('old')); });
  expect(hook.result.current.data?.data).toBe('new');
  hidden.mockReturnValue(true);
  document.dispatchEvent(new Event('visibilitychange'));
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(request).toHaveBeenCalledTimes(2);
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(request).toHaveBeenCalledTimes(3);
  hook.unmount();
  expect(request.mock.calls[2][1].signal.aborted).toBe(true);
});
