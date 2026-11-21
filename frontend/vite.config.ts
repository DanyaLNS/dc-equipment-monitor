import { defineConfig, loadEnv, type ProxyOptions } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'API_');
  const api: ProxyOptions = {
    target: env.API_PROXY_TARGET || 'http://127.0.0.1:8080',
    configure(proxy) {
      proxy.on('error', (_error, _request, response) => {
        if (response && 'writeHead' in response && !response.headersSent && !response.writableEnded) {
          response.writeHead(503, { 'Cache-Control': 'no-store' }).end();
        }
      });
    },
  };
  const proxy = { '/api/v1': api };
  return { server: { proxy }, preview: { proxy } };
});
