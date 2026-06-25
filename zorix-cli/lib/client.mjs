'use strict';

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const VERSION = '1.0.0';
export const DEFAULT_BASE_URL = 'https://zorix.it';

export const MODELS = Object.freeze([
  { id: 'model-flash', name: 'Zorix Star Flash 2', apiModel: 'qwen3.5-flash', endpoint: '/api/ai/chat', thinking: false },
  { id: 'model-nex-plus', name: 'Zorix Nex Plus', apiModel: 'qwen3.7-plus', endpoint: '/api/ai/chat', thinking: true },
  { id: 'model-nex26-coder', name: 'Zorix Nex 2.6 Coder', apiModel: 'qwen3.7-max', endpoint: '/api/ai/chat', thinking: true },
  { id: 'model-nexcoder3', name: 'Zorix Nex Coder 3 Preview', apiModel: 'model-nexcoder3', endpoint: '/api/ai/nexcoder3/chat-v1', thinking: false }
]);

const MODEL_ALIASES = Object.freeze({
  flash: 'model-flash',
  star: 'model-flash',
  'nex-plus': 'model-nex-plus',
  plus: 'model-nex-plus',
  nex: 'model-nex-plus',
  coder: 'model-nex26-coder',
  nex26: 'model-nex26-coder',
  'nex-2.6-coder': 'model-nex26-coder',
  nex3: 'model-nexcoder3',
  coder3: 'model-nexcoder3',
  nexcoder3: 'model-nexcoder3'
});

export class ZorixError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ZorixError';
    this.code = options.code || 'zorix_error';
    this.status = options.status || 0;
    this.exitCode = options.exitCode || 1;
    this.details = options.details;
  }
}

export function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new ZorixError(`Invalid URL: ${value}`, { code: 'invalid_url', exitCode: 2 });
  }

  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new ZorixError('HTTPS is required except for localhost.', { code: 'insecure_url', exitCode: 2 });
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export function resolveModel(value) {
  const raw = String(value || 'model-flash').trim().toLowerCase();
  const id = MODEL_ALIASES[raw] || raw;
  const model = MODELS.find(item => item.id === id);
  if (!model) {
    throw new ZorixError(`Unknown model: ${value}`, { code: 'invalid_model', exitCode: 2 });
  }
  return model;
}

function safeJson(text) {
  try { return JSON.parse(String(text || '')); } catch { return null; }
}

function configRoot(profile = 'default') {
  const base = process.env.ZORIX_CLI_HOME
    ? path.resolve(process.env.ZORIX_CLI_HOME)
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'zorix-cli');
  const safe = String(profile || 'default').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64) || 'default';
  return safe === 'default' ? base : path.join(base, 'profiles', safe);
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await fsp.chmod(dir, 0o700).catch(() => {});
}

async function atomicWrite(file, data, mode = 0o600) {
  await ensureDir(path.dirname(file));
  const next = `${file}.${process.pid}.${Date.now()}.next`;
  await fsp.writeFile(next, data, { mode });
  if (process.platform !== 'win32') await fsp.chmod(next, mode).catch(() => {});
  await fsp.rename(next, file);
}

export class CookieJar {
  constructor(cookies = {}) {
    this.cookies = {};
    for (const [name, item] of Object.entries(cookies || {})) {
      if (typeof item === 'string') this.cookies[name] = { value: item, expiresAt: null };
      else if (item && typeof item.value === 'string') this.cookies[name] = { value: item.value, expiresAt: item.expiresAt || null };
    }
    this.prune();
  }

  prune() {
    const now = Date.now();
    for (const [name, item] of Object.entries(this.cookies)) {
      if (item.expiresAt && Number(item.expiresAt) <= now) delete this.cookies[name];
    }
  }

  names() { this.prune(); return Object.keys(this.cookies).sort(); }
  header() { this.prune(); return Object.entries(this.cookies).map(([name, item]) => `${name}=${item.value}`).join('; '); }
  toJSON() { this.prune(); return this.cookies; }
  clear() { this.cookies = {}; }

  importHeader(raw) {
    const input = String(raw || '').replace(/^cookie\s*:\s*/i, '').trim();
    for (const part of input.split(';')) {
      const index = part.indexOf('=');
      if (index <= 0) continue;
      const name = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (name) this.cookies[name] = { value, expiresAt: null };
    }
    if (!this.names().length) throw new ZorixError('No valid cookies found.', { code: 'invalid_cookie', exitCode: 2 });
  }

  importNetscape(text) {
    let count = 0;
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;
      const fields = line.replace(/^#HttpOnly_/, '').split('\t');
      if (fields.length < 7) continue;
      const expires = Number(fields[4]) || 0;
      const name = fields[5];
      const value = fields[6];
      if (!name) continue;
      this.cookies[name] = { value, expiresAt: expires > 0 ? expires * 1000 : null };
      count++;
    }
    this.prune();
    if (!count) throw new ZorixError('No valid Netscape cookies found.', { code: 'invalid_cookie_file', exitCode: 2 });
    return count;
  }

  ingest(headers) {
    let values = [];
    if (headers && typeof headers.getSetCookie === 'function') values = headers.getSetCookie();
    if (!values.length) {
      const combined = headers?.get?.('set-cookie') || '';
      values = combined ? combined.split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/) : [];
    }

    for (const raw of values) {
      const segments = String(raw).split(';').map(item => item.trim());
      const first = segments.shift() || '';
      const index = first.indexOf('=');
      if (index <= 0) continue;
      const name = first.slice(0, index).trim();
      const value = first.slice(index + 1);
      let expiresAt = null;
      let remove = !value;
      for (const attribute of segments) {
        const [keyRaw, ...rest] = attribute.split('=');
        const key = keyRaw.trim().toLowerCase();
        const attrValue = rest.join('=').trim();
        if (key === 'max-age' && Number(attrValue) <= 0) remove = true;
        if (key === 'expires') {
          const parsed = Date.parse(attrValue);
          if (Number.isFinite(parsed)) {
            expiresAt = parsed;
            if (parsed <= Date.now()) remove = true;
          }
        }
      }
      if (remove) delete this.cookies[name];
      else this.cookies[name] = { value, expiresAt };
    }
    this.prune();
  }
}

export class SessionStore {
  constructor({ profile = process.env.ZORIX_CLI_PROFILE || 'default' } = {}) {
    this.root = configRoot(profile);
    this.profile = profile;
    this.keyFile = path.join(this.root, 'key.bin');
    this.sessionFile = path.join(this.root, 'session.enc');
    this.configFile = path.join(this.root, 'config.json');
    this.historyFile = path.join(this.root, 'history.jsonl');
  }

  async key() {
    await ensureDir(this.root);
    try {
      const key = await fsp.readFile(this.keyFile);
      if (key.length === 32) return key;
    } catch {}
    const key = crypto.randomBytes(32);
    await atomicWrite(this.keyFile, key);
    return key;
  }

  async saveSession(session) {
    const key = await this.key();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(session))), cipher.final()]);
    const envelope = {
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64')
    };
    await atomicWrite(this.sessionFile, JSON.stringify(envelope));
  }

  async loadSession() {
    try {
      const envelope = JSON.parse(await fsp.readFile(this.sessionFile, 'utf8'));
      const key = await this.key();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      return JSON.parse(Buffer.concat([
        decipher.update(Buffer.from(envelope.data, 'base64')),
        decipher.final()
      ]).toString('utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw new ZorixError('Stored session is invalid. Run: zorix cookie clear', { code: 'invalid_session' });
    }
  }

  async clearSession() { await fsp.unlink(this.sessionFile).catch(error => { if (error?.code !== 'ENOENT') throw error; }); }

  async config() {
    let stored = {};
    try { stored = JSON.parse(await fsp.readFile(this.configFile, 'utf8')); } catch {}
    return {
      baseUrl: normalizeBaseUrl(stored.baseUrl || DEFAULT_BASE_URL),
      model: resolveModel(stored.model || 'model-flash').id,
      timeoutMs: Math.max(5000, Math.min(300000, Number(stored.timeoutMs) || 60000)),
      history: stored.history !== false,
      thinking: stored.thinking === true
    };
  }

  async saveConfig(config) {
    const clean = {
      baseUrl: normalizeBaseUrl(config.baseUrl || DEFAULT_BASE_URL),
      model: resolveModel(config.model || 'model-flash').id,
      timeoutMs: Math.max(5000, Math.min(300000, Number(config.timeoutMs) || 60000)),
      history: config.history !== false,
      thinking: config.thinking === true
    };
    await atomicWrite(this.configFile, JSON.stringify(clean, null, 2) + '\n');
    return clean;
  }

  async appendHistory(item) {
    await ensureDir(this.root);
    await fsp.appendFile(this.historyFile, JSON.stringify(item) + '\n', { mode: 0o600 });
  }

  async history(limit = 20) {
    try {
      const rows = (await fsp.readFile(this.historyFile, 'utf8')).split(/\r?\n/).filter(Boolean).map(safeJson).filter(Boolean);
      return rows.slice(-Math.max(1, Math.min(500, Number(limit) || 20)));
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async clearHistory() { await fsp.unlink(this.historyFile).catch(error => { if (error?.code !== 'ENOENT') throw error; }); }
}

function loggedIn(status) {
  return Boolean(status && (status.logged_in || status.loggedIn || status.authenticated) && (status.user || status.account || status.profile || status.email || status.username));
}

async function parsePayload(response) {
  const text = await response.text();
  return { text, json: safeJson(text) };
}

async function fetchWithCookies({ baseUrl, jar, route, method = 'GET', body, headers = {}, timeoutMs = 60000 }) {
  const origin = new URL(normalizeBaseUrl(baseUrl));
  let target = new URL(route, origin);
  let currentMethod = method.toUpperCase();
  let currentBody = body;

  for (let redirects = 0; redirects <= 8; redirects++) {
    if (target.origin !== origin.origin) throw new ZorixError('Cross-origin redirect blocked.', { code: 'external_redirect' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      const cookie = jar.header();
      response = await fetch(target, {
        method: currentMethod,
        body: ['GET', 'HEAD'].includes(currentMethod) ? undefined : currentBody,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'application/json, text/event-stream, text/plain;q=0.8, */*;q=0.5',
          'Accept-Language': 'it-IT,it;q=0.9,en;q=0.7',
          'Cache-Control': 'no-cache',
          Referer: `${origin.origin}/chat`,
          Origin: origin.origin,
          'User-Agent': `ZorixCLI/${VERSION}`,
          'X-Zorix-CLI': VERSION,
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers
        }
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new ZorixError(`Request timeout after ${timeoutMs} ms.`, { code: 'timeout' });
      throw new ZorixError(`Network error: ${error?.message || error}`, { code: 'network_error' });
    } finally {
      clearTimeout(timer);
    }

    jar.ingest(response.headers);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    target = new URL(location, target);
    if (response.status === 303 || ([301, 302].includes(response.status) && currentMethod === 'POST')) {
      currentMethod = 'GET';
      currentBody = undefined;
    }
  }
  throw new ZorixError('Too many redirects.', { code: 'redirect_loop' });
}

function packetText(value) {
  if (typeof value === 'string') return { phase: '', text: value, error: '' };
  if (!value || typeof value !== 'object') return { phase: '', text: '', error: '' };
  const phase = String(value.phase || value.type || value.event || value.kind || '').toLowerCase();
  const error = String(value.error || value.detail || (value.ok === false ? value.message || '' : '') || '');
  const candidates = [value.content, value.text, value.answer, value.output, value.output_text, value.response, value.token];
  if (typeof value.message === 'string') candidates.push(value.message);
  if (value.message && typeof value.message === 'object') candidates.push(value.message.content, value.message.text);
  if (value.delta && typeof value.delta === 'object') candidates.push(value.delta.content, value.delta.text);
  if (Array.isArray(value.choices) && value.choices[0]) {
    const choice = value.choices[0];
    candidates.push(choice.text, choice.message?.content, choice.delta?.content);
  }
  return { phase, text: candidates.find(item => typeof item === 'string' && item) || '', error };
}

async function consumeResponse(response, handlers = {}) {
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (type.includes('application/json')) {
    const payload = await parsePayload(response);
    const packet = packetText(payload.json || payload.text);
    if (packet.error) throw new ZorixError(packet.error, { code: 'api_error' });
    handlers.onText?.(packet.text);
    return { answer: packet.text, thinking: '' };
  }

  if (!response.body) throw new ZorixError('Empty response stream.', { code: 'empty_stream' });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let answer = '';
  let thinking = '';

  function append(target, value) {
    const clean = String(value || '').replace(/__ZORIX_THINKING_ANIM__/g, '');
    if (!clean) return;
    if (target === 'thinking') {
      thinking += clean;
      handlers.onThinking?.(clean);
    } else {
      answer += clean;
      handlers.onText?.(clean);
    }
  }

  function consume(frame) {
    let event = '';
    const data = [];
    for (const line of String(frame).split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim().toLowerCase();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^\s/, ''));
    }
    const raw = data.join('\n');
    if (!raw || raw === '[DONE]') return;
    const value = safeJson(raw) ?? raw;
    const packet = packetText(value);
    const phase = packet.phase || event;
    if (packet.error) throw new ZorixError(packet.error, { code: 'stream_error' });
    if (/analysis|think|reason/.test(phase)) append('thinking', packet.text);
    else if (!/done|complete|ping|meta|queue/.test(phase)) append('answer', packet.text);
  }

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      pending += decoder.decode(value, { stream: !done });
      const frames = pending.split(/\r?\n\r?\n/);
      pending = frames.pop() || '';
      for (const frame of frames) consume(frame);
    }
    if (done) break;
  }
  pending += decoder.decode();
  if (pending.trim()) consume(pending);
  return { answer, thinking };
}

export class ZorixClient {
  constructor({ profile = 'default', baseUrl = '', timeoutMs = 0 } = {}) {
    this.store = new SessionStore({ profile });
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.jar = new CookieJar();
    this.config = null;
  }

  async init() {
    if (this.config) return this;
    this.config = await this.store.config();
    this.baseUrl = normalizeBaseUrl(this.baseUrl || this.config.baseUrl);
    this.timeoutMs = Number(this.timeoutMs || this.config.timeoutMs);
    const session = await this.store.loadSession();
    if (session?.cookies) this.jar = new CookieJar(session.cookies);
    return this;
  }

  async save(status = null) {
    await this.store.saveSession({
      savedAt: new Date().toISOString(),
      baseUrl: this.baseUrl,
      cookies: this.jar.toJSON(),
      account: status?.user || status?.account || status?.profile || null
    });
  }

  async request(options) {
    await this.init();
    return fetchWithCookies({
      baseUrl: this.baseUrl,
      jar: this.jar,
      timeoutMs: options.timeoutMs || this.timeoutMs,
      ...options
    });
  }

  async status({ required = false } = {}) {
    const response = await this.request({ route: `/api/user/full-status?t=${Date.now()}` });
    const payload = await parsePayload(response);
    const status = payload.json || { logged_in: false, error: payload.text };
    if (response.ok && loggedIn(status)) await this.save(status);
    else if (required) throw new ZorixError(status.message || status.error || 'Login required.', { code: 'login_required', status: response.status, exitCode: 3 });
    return status;
  }

  async login(account, password) {
    await this.init();
    if (!account || !password) throw new ZorixError('Account and password are required.', { code: 'missing_credentials', exitCode: 2 });
    this.jar.clear();
    await this.request({ route: '/login?next=%2Fchat', headers: { Accept: 'text/html' } }).catch(() => {});
    const response = await this.request({
      route: '/api/zorix-auth-v802/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, username: account, email: account, password })
    });
    const payload = await parsePayload(response);
    if (!response.ok) throw new ZorixError(payload.json?.message || payload.json?.error || `Login failed: HTTP ${response.status}`, { code: 'login_failed', status: response.status, exitCode: 3 });
    return this.status({ required: true });
  }

  async importCookie(cookieHeader) {
    await this.init();
    this.jar.clear();
    this.jar.importHeader(cookieHeader);
    return this.status({ required: true });
  }

  async importCookieFile(file) {
    await this.init();
    this.jar.clear();
    this.jar.importNetscape(await fsp.readFile(path.resolve(file), 'utf8'));
    return this.status({ required: true });
  }

  async quota() {
    const response = await this.request({ route: `/api/chat/quota-v69?t=${Date.now()}` });
    const payload = await parsePayload(response);
    if (!response.ok) throw new ZorixError(payload.json?.message || payload.json?.error || `Quota failed: HTTP ${response.status}`, { code: 'quota_failed' });
    return payload.json || { raw: payload.text };
  }

  async chat(prompt, options = {}) {
    await this.init();
    const text = String(prompt || '');
    if (!text.trim()) throw new ZorixError('Message is empty.', { code: 'empty_prompt', exitCode: 2 });
    if (!this.jar.names().length) throw new ZorixError('No session. Run: zorix login', { code: 'login_required', exitCode: 3 });
    const model = resolveModel(options.model || this.config.model);
    const thinkingEnabled = model.thinking && (options.thinking ?? this.config.thinking);
    const started = Date.now();
    const response = await this.request({
      route: model.endpoint,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zorix-Context-Scope': 'chat' },
      body: JSON.stringify({
        content: text,
        message: text,
        prompt: text,
        input: text,
        original: text,
        original_user_text: text,
        user_request: text,
        model: model.apiModel,
        zorix_model_alias: model.id,
        scope: 'chat',
        chat_scope: 'chat',
        mode: 'chat',
        client: `zorix-cli-v${VERSION}`,
        origin_path: '/chat',
        stream: true,
        thinking_enabled: Boolean(thinkingEnabled)
      })
    });
    if (!response.ok) {
      const payload = await parsePayload(response);
      throw new ZorixError(payload.json?.message || payload.json?.error || `Chat failed: HTTP ${response.status}`, { code: response.status === 401 || response.status === 403 ? 'login_required' : 'chat_failed', status: response.status, exitCode: response.status === 401 || response.status === 403 ? 3 : 1 });
    }
    const result = await consumeResponse(response, options);
    if (!result.answer) throw new ZorixError('The model returned no answer.', { code: 'empty_response' });
    const record = {
      id: crypto.randomBytes(8).toString('hex'),
      createdAt: new Date().toISOString(),
      model: model.id,
      prompt: text,
      answer: result.answer,
      thinking: result.thinking,
      elapsedMs: Date.now() - started
    };
    if (options.saveHistory !== false && this.config.history !== false) await this.store.appendHistory(record);
    return record;
  }

  async logout() {
    await this.init();
    await this.request({ route: '/logout' }).catch(() => {});
    this.jar.clear();
    await this.store.clearSession();
    return { ok: true, logged_in: false };
  }

  async doctor() {
    await this.init();
    const report = {
      version: VERSION,
      node: process.versions.node,
      platform: process.platform,
      profile: this.store.profile,
      configDir: this.store.root,
      baseUrl: this.baseUrl,
      cookieNames: this.jar.names(),
      homepage: null,
      login: null
    };
    try {
      const response = await this.request({ route: '/', method: 'HEAD' });
      report.homepage = { ok: response.ok, status: response.status };
    } catch (error) {
      report.homepage = { ok: false, error: error.message };
    }
    try {
      const status = await this.status();
      report.login = { ok: true, logged_in: loggedIn(status), user: status.user || status.account || null };
    } catch (error) {
      report.login = { ok: false, error: error.message };
    }
    return report;
  }
}

export function isLoggedIn(status) { return loggedIn(status); }
