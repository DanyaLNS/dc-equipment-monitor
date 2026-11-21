import { expect, it } from 'vitest';
import { createDemoFetch } from './browser';

it('serves static demo sessions in memory with separate visitors', async () => {
  const origin = 'https://example.github.io';
  const visit = createDemoFetch(origin);
  const other = createDemoFetch(origin);
  const login = await visit('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'demo1234' }),
  });
  expect(login.status).toBe(200);
  const { data } = await login.json();
  expect(data.user.role).toBe('ADMIN');
  expect((await visit('/api/v1/equipment/1/view')).status).toBe(200);
  expect((await other('/api/v1/auth/me')).status).toBe(401);
  const logout = await visit('/api/v1/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': data.csrf_token } });
  expect(logout.status).toBe(204);
  expect((await visit('/api/v1/auth/me')).status).toBe(401);
});
