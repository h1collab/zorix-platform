#!/usr/bin/env node
'use strict';

import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import {
  VERSION,
  MODELS,
  ZorixClient,
  ZorixError,
  resolveModel,
  isLoggedIn
} from '../lib/client.mjs';

function parse(argv) {
  const flags = {};
  const args = [];
  const valueFlags = new Set(['profile', 'model', 'file', 'limit', 'output', 'timeout', 'base-url', 'account']);
  const aliases = { h: 'help', v: 'version', j: 'json', m: 'model', f: 'file', o: 'output' };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === '--') { args.push(...argv.slice(i + 1)); break; }
    if (item.startsWith('--no-')) { flags[item.slice(5)] = false; continue; }
    if (item.startsWith('--')) {
      const eq = item.indexOf('=');
      const name = item.slice(2, eq >= 0 ? eq : undefined);
      if (eq >= 0) flags[name] = item.slice(eq + 1);
      else if (valueFlags.has(name) && argv[i + 1] != null) flags[name] = argv[++i];
      else flags[name] = true;
      continue;
    }
    if (/^-[a-zA-Z]$/.test(item) && aliases[item.slice(1)]) {
      const name = aliases[item.slice(1)];
      if (valueFlags.has(name) && argv[i + 1] != null) flags[name] = argv[++i];
      else flags[name] = true;
      continue;
    }
    args.push(item);
  }
  return { flags, args };
}

function json(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }

function help() {
  console.log(`Zorix CLI ${VERSION}

Usage:
  zorix login [--account EMAIL]
  zorix login --browser
  zorix status | whoami | logout
  zorix chat "message"
  zorix chat --model nex-plus --thinking "message"
  zorix chat --file prompt.txt
  cat prompt.txt | zorix chat --stdin
  zorix chat                       Interactive mode
  zorix models
  zorix model get
  zorix model use flash|nex-plus|nex26|nex3
  zorix quota
  zorix cookie list
  zorix cookie import
  zorix cookie import-file cookies.txt
  zorix cookie clear
  zorix history list [--limit 20]
  zorix history show ID
  zorix history export history.json
  zorix history clear
  zorix config list
  zorix config get KEY
  zorix config set KEY VALUE
  zorix doctor
  zorix open home|login|chat|account|history|community|worldcup
  zorix completion bash|zsh|fish

Global options:
  --profile NAME
  --base-url URL
  --json
  --timeout MS
  --help
  --version

Default website: https://zorix.it
`);
}

async function ask(label, hidden = false) {
  if (!hidden || !process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { return await new Promise(resolve => rl.question(`${label}: `, resolve)); }
    finally { rl.close(); }
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const input = process.stdin;
    const oldRaw = Boolean(input.isRaw);
    process.stdout.write(`${label}: `);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();
    function cleanup() {
      input.off('data', onData);
      try { input.setRawMode(oldRaw); } catch {}
      input.pause();
    }
    function onData(chunk) {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') { cleanup(); process.stdout.write('\n'); resolve(value); return; }
        if (char === '\u0003') { cleanup(); process.stdout.write('\n'); reject(new ZorixError('Cancelled.', { exitCode: 130 })); return; }
        if (char === '\u007f' || char === '\b') {
          if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
          continue;
        }
        if (char >= ' ') { value += char; process.stdout.write('*'); }
      }
    }
    input.on('data', onData);
  });
}

async function readStdin() {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function printStatus(status) {
  if (!isLoggedIn(status)) { console.log('Not authenticated'); return; }
  const user = status.user || status.account || status.profile || {};
  console.log('Authenticated');
  console.log(`User: ${user.displayName || user.name || user.username || user.email || status.email || 'Zorix account'}`);
  if (user.email) console.log(`Email: ${user.email}`);
  if (user.role || status.role) console.log(`Role: ${user.role || status.role}`);
  if (user.plan || status.plan) console.log(`Plan: ${user.plan || status.plan}`);
}

function openUrl(url) {
  const termux = process.env.PREFIX && /com\.termux/i.test(process.env.PREFIX);
  let command;
  let args;
  if (termux) { command = 'termux-open-url'; args = [url]; }
  else if (process.platform === 'darwin') { command = 'open'; args = [url]; }
  else if (process.platform === 'win32') { command = 'cmd'; args = ['/c', 'start', '', url]; }
  else { command = 'xdg-open'; args = [url]; }
  try { const child = spawn(command, args, { detached: true, stdio: 'ignore' }); child.unref(); } catch {}
}

function completion(shell) {
  if (shell === 'fish') return 'complete -c zorix -f -a "login status whoami logout chat models model quota cookie history config doctor open completion"';
  if (shell === 'zsh') return '#compdef zorix\n_arguments "1:command:(login status whoami logout chat models model quota cookie history config doctor open completion)"';
  return `_zorix_complete() {
  local commands="login status whoami logout chat models model quota cookie history config doctor open completion"
  COMPREPLY=( $(compgen -W "$commands" -- "\${COMP_WORDS[1]}") )
}
complete -F _zorix_complete zorix zrx`;
}

async function interactive(client, model, thinking) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'zorix> ' });
  console.log('Zorix interactive chat. Commands: /help /models /model ID /thinking on|off /status /quota /exit');
  rl.prompt();
  for await (const line of rl) {
    const text = line.trim();
    if (!text) { rl.prompt(); continue; }
    if (text === '/exit' || text === '/quit') break;
    if (text === '/help') { console.log('/models\n/model ID\n/thinking on|off\n/status\n/quota\n/exit'); rl.prompt(); continue; }
    if (text === '/models') { MODELS.forEach(item => console.log(`${item.id === model ? '*' : '-'} ${item.id}  ${item.name}`)); rl.prompt(); continue; }
    if (text.startsWith('/model ')) { model = resolveModel(text.slice(7)).id; console.log(`Model: ${model}`); rl.prompt(); continue; }
    if (text.startsWith('/thinking ')) { thinking = /^(on|true|1|yes|si|sì)$/i.test(text.slice(10).trim()); console.log(`Thinking: ${thinking ? 'on' : 'off'}`); rl.prompt(); continue; }
    if (text === '/status') { printStatus(await client.status()); rl.prompt(); continue; }
    if (text === '/quota') { json(await client.quota()); rl.prompt(); continue; }
    process.stdout.write('Zorix: ');
    try {
      await client.chat(line, { model, thinking, onText: chunk => process.stdout.write(chunk) });
      process.stdout.write('\n');
    } catch (error) { console.error(`\n${error.message}`); }
    rl.prompt();
  }
  rl.close();
}

async function main() {
  const { flags, args } = parse(process.argv.slice(2));
  const command = args[0] || 'help';
  if (flags.version || command === 'version') { console.log(VERSION); return; }
  if (flags.help || command === 'help') { help(); return; }

  const client = new ZorixClient({
    profile: flags.profile || 'default',
    baseUrl: flags['base-url'] || '',
    timeoutMs: flags.timeout ? Number(flags.timeout) : 0
  });
  await client.init();

  if (command === 'login') {
    if (flags.browser) {
      const url = `${client.baseUrl}/login?next=%2Fchat`;
      openUrl(url);
      console.log(url);
      console.log('After browser login, run: zorix cookie import');
      return;
    }
    const account = flags.account || await ask('Email or username');
    const password = await ask('Password', true);
    const status = await client.login(account, password);
    if (flags.json) json(status); else { console.log('Login successful. Password was not stored.'); printStatus(status); }
    return;
  }

  if (command === 'status' || command === 'whoami') {
    const status = await client.status();
    if (flags.json) json(status); else printStatus(status);
    return;
  }

  if (command === 'logout') {
    const result = await client.logout();
    if (flags.json) json(result); else console.log('Session removed.');
    return;
  }

  if (command === 'models') {
    if (flags.json) json(MODELS);
    else MODELS.forEach(item => console.log(`${item.id === client.config.model ? '*' : '-'} ${item.id}\n  ${item.name}\n  Thinking: ${item.thinking ? 'yes' : 'no'}\n`));
    return;
  }

  if (command === 'model') {
    const action = args[1] || 'get';
    if (action === 'get') { console.log(client.config.model); return; }
    if (action === 'use') {
      const selected = resolveModel(args[2]);
      client.config.model = selected.id;
      await client.store.saveConfig(client.config);
      console.log(`Active model: ${selected.name}`);
      return;
    }
    throw new ZorixError('Use: zorix model get | zorix model use MODEL', { exitCode: 2 });
  }

  if (command === 'quota') {
    const result = await client.quota();
    if (flags.json) json(result); else {
      console.log(`Plan: ${result.plan ?? 'n/a'}`);
      console.log(`Used: ${result.used ?? 'n/a'}`);
      console.log(`Remaining: ${result.remaining ?? 'n/a'}`);
      if (result.reset_at) console.log(`Reset: ${new Date(result.reset_at).toLocaleString()}`);
    }
    return;
  }

  if (command === 'cookie') {
    const action = args[1] || 'list';
    if (action === 'list') { if (flags.json) json({ names: client.jar.names() }); else console.log(client.jar.names().join('\n') || 'No cookies stored.'); return; }
    if (action === 'clear') { client.jar.clear(); await client.store.clearSession(); console.log('Cookies removed.'); return; }
    if (action === 'import') {
      const header = args.slice(2).join(' ') || await ask('Cookie header', true);
      const status = await client.importCookie(header);
      if (flags.json) json(status); else { console.log('Cookie imported and verified.'); printStatus(status); }
      return;
    }
    if (action === 'import-file') {
      if (!args[2]) throw new ZorixError('Use: zorix cookie import-file cookies.txt', { exitCode: 2 });
      const status = await client.importCookieFile(args[2]);
      if (flags.json) json(status); else { console.log('Cookie file imported and verified.'); printStatus(status); }
      return;
    }
    throw new ZorixError('Unknown cookie command.', { exitCode: 2 });
  }

  if (command === 'chat' || command === 'ask') {
    let prompt = args.slice(1).join(' ');
    if (flags.file) prompt = await fsp.readFile(path.resolve(flags.file), 'utf8');
    if (flags.stdin || prompt === '-') prompt = await readStdin();
    if (!prompt && !process.stdin.isTTY) prompt = await readStdin();
    const model = resolveModel(flags.model || client.config.model).id;
    const thinking = flags.thinking === true ? true : flags.thinking === false ? false : client.config.thinking;
    if (!prompt) { await interactive(client, model, thinking); return; }
    let wrote = false;
    const result = await client.chat(prompt, {
      model,
      thinking,
      saveHistory: flags.history !== false,
      onText: chunk => { if (!flags.json) { process.stdout.write(chunk); wrote = true; } },
      onThinking: chunk => { if (!flags.json && thinking) process.stderr.write(`[Think] ${chunk}`); }
    });
    if (flags.json) json(result); else if (wrote) process.stdout.write('\n');
    return;
  }

  if (command === 'history') {
    const action = args[1] || 'list';
    if (action === 'clear') { await client.store.clearHistory(); console.log('History removed.'); return; }
    const items = await client.store.history(Number(flags.limit) || 20);
    if (action === 'list') {
      if (flags.json) json(items);
      else items.slice().reverse().forEach(item => console.log(`${item.id}  ${item.createdAt}  ${item.model}\n  ${String(item.prompt).replace(/\s+/g, ' ').slice(0, 80)}`));
      return;
    }
    if (action === 'show') {
      const item = items.find(entry => entry.id === args[2]);
      if (!item) throw new ZorixError(`History item not found: ${args[2]}`, { exitCode: 2 });
      if (flags.json) json(item); else console.log(`User:\n${item.prompt}\n\nZorix:\n${item.answer}`);
      return;
    }
    if (action === 'export') {
      const output = path.resolve(args[2] || flags.output || 'zorix-history.json');
      await fsp.writeFile(output, JSON.stringify(items, null, 2) + '\n');
      console.log(output);
      return;
    }
    throw new ZorixError('Unknown history command.', { exitCode: 2 });
  }

  if (command === 'config') {
    const action = args[1] || 'list';
    if (action === 'list') { if (flags.json) json(client.config); else Object.entries(client.config).forEach(([key, value]) => console.log(`${key}=${value}`)); return; }
    if (action === 'get') { if (!(args[2] in client.config)) throw new ZorixError('Unknown config key.', { exitCode: 2 }); console.log(client.config[args[2]]); return; }
    if (action === 'set') {
      const key = args[2];
      const raw = args.slice(3).join(' ');
      if (!key || !raw) throw new ZorixError('Use: zorix config set KEY VALUE', { exitCode: 2 });
      if (key === 'model') client.config[key] = resolveModel(raw).id;
      else if (key === 'timeoutMs') client.config[key] = Number(raw);
      else if (key === 'history' || key === 'thinking') client.config[key] = /^(true|1|yes|on)$/i.test(raw);
      else if (key === 'baseUrl') client.config[key] = raw;
      else throw new ZorixError('Unknown config key.', { exitCode: 2 });
      await client.store.saveConfig(client.config);
      console.log(`${key}=${client.config[key]}`);
      return;
    }
    throw new ZorixError('Unknown config command.', { exitCode: 2 });
  }

  if (command === 'doctor') {
    const report = await client.doctor();
    if (flags.json) json(report); else Object.entries(report).forEach(([key, value]) => console.log(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`));
    return;
  }

  if (command === 'open') {
    const map = { home: '/', login: '/login?next=%2Fchat', chat: '/chat', account: '/account', history: '/zorix-one/chat-history', community: '/community', worldcup: '/world-cup-ai' };
    const target = args[1] || 'home';
    if (!map[target]) throw new ZorixError(`Unknown target: ${target}`, { exitCode: 2 });
    const url = `${client.baseUrl}${map[target]}`;
    openUrl(url);
    console.log(url);
    return;
  }

  if (command === 'completion') { console.log(completion(args[1] || 'bash')); return; }
  throw new ZorixError(`Unknown command: ${command}`, { exitCode: 2 });
}

main().catch(error => {
  console.error(`Zorix CLI error: ${error?.message || error}`);
  if (process.env.ZORIX_CLI_DEBUG === '1' && error?.stack) console.error(error.stack);
  process.exitCode = Number(error?.exitCode) || 1;
});
