'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  SessionStore,
  ZorixClient,
  isLoggedIn
} from '../lib/client.mjs';

const runtime = path.resolve('.test-runtime');

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('login, encrypted cookie session, quota and SSE chat', async t => {
  await fsp.rm(runtime, { recursive: true, force: true });

  const server = http.createServer(async (req, res) => {
    const cookie = String(req.headers.cookie || '');

    if (req.url?.startsWith('/login')) {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Set-Cookie': 'preflight=1; Path=/; HttpOnly; SameSite=Lax'
      });
      res.end('<h1>Login</h1>');
      return;
    }

    if (req.url === '/api/zorix-auth-v802/login') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body);
      assert.equal(payload.account, 'demo');
      assert.equal(payload.password, 'secret');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'token=test-session-token; Path=/; HttpOnly; SameSite=Lax'
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url?.startsWith('/api/user/full-status')) {
      const logged = cookie.includes('token=test-session-token');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        logged_in: logged,
        authenticated: logged,
        user: logged ? { id: 'demo', username: 'demo', plan: 'test' } : null
      }));
      return;
    }

    if (req.url?.startsWith('/api/chat/quota-v69')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plan: 'test', used: 1, remaining: 99 }));
      return;
    }

    if (req.url === '/api/ai/chat') {
      assert.match(cookie, /token=test-session-token/);
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body);
      assert.equal(payload.content, 'hello');
      assert.equal(payload.model, 'qwen3.5-flash');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache'
      });
      res.write('event: analysis\n');
      res.write('data: {"phase":"analysis","content":"thinking"}\n\n');
      res.write('data: {"phase":"answer","content":"Hello"}\n\n');
      res.write('data: {"phase":"answer","content":" from Zorix"}\n\n');
      res.end('data: [DONE]\n\n');
      return;
    }

    if (req.url === '/' && req.method === 'HEAD') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url === '/logout') {
      res.writeHead(200, { 'Set-Cookie': 'token=; Max-Age=0; Path=/' });
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const baseUrl = await listen(server);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(runtime, { recursive: true, force: true });
  });

  process.env.ZORIX_CLI_HOME = runtime;
  const store = new SessionStore();
  await store.saveConfig({
    baseUrl,
    model: 'model-flash',
    timeoutMs: 10000,
    history: true,
    thinking: true
  });

  const client = new ZorixClient({ baseUrl });
  const status = await client.login('demo', 'secret');
  assert.equal(isLoggedIn(status), true);
  assert.deepEqual(client.jar.names(), ['preflight', 'token']);

  const quota = await client.quota();
  assert.equal(quota.remaining, 99);

  let streamed = '';
  let thought = '';
  const result = await client.chat('hello', {
    model: 'flash',
    thinking: true,
    onText: chunk => { streamed += chunk; },
    onThinking: chunk => { thought += chunk; }
  });

  assert.equal(streamed, 'Hello from Zorix');
  assert.equal(result.answer, 'Hello from Zorix');
  assert.equal(thought, 'thinking');
  assert.equal(result.thinking, 'thinking');

  const savedSession = await fsp.readFile(path.join(runtime, 'session.enc'), 'utf8');
  assert.equal(savedSession.includes('test-session-token'), false);

  const history = await store.history();
  assert.equal(history.length, 1);

  const doctor = await client.doctor();
  assert.equal(doctor.homepage.ok, true);
  assert.equal(doctor.login.logged_in, true);

  const logout = await client.logout();
  assert.equal(logout.logged_in, false);
});
