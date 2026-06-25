# Zorix CLI

Official command-line client for `https://zorix.it`.

It logs in through the Zorix website API, captures the returned session cookies, verifies the account, stores the session encrypted with AES-256-GCM, and sends authenticated streaming chat requests with the same cookie session.

## Requirements

- Node.js 20 or newer
- A Zorix account you are authorized to use

## Install

From the generated npm package:

```bash
npm install -g ./zorix-cli-1.0.0.tgz
```

From the extracted folder:

```bash
npm install -g .
```

## Login

```bash
zorix login
```

The CLI requests your email or username and password interactively. The password is never stored. On successful login it:

1. requests `/login?next=/chat`;
2. sends credentials to `/api/zorix-auth-v802/login`;
3. captures `Set-Cookie` values;
4. verifies the session through `/api/user/full-status`;
5. stores the cookies encrypted locally.

### Google/browser login

Browser HttpOnly cookies cannot be read automatically by a normal external CLI.

```bash
zorix login --browser
zorix cookie import
```

You can also import a Netscape cookie file exported from your own browser:

```bash
zorix cookie import-file cookies.txt
```

Only import cookies that belong to your own account.

## Chat

One request:

```bash
zorix chat "Ciao Zorix"
```

Interactive mode:

```bash
zorix chat
```

From a file or stdin:

```bash
zorix chat --file prompt.txt
cat prompt.txt | zorix chat --stdin
```

JSON output:

```bash
zorix chat --json "Return JSON"
```

## Models

```bash
zorix models
zorix model use flash
zorix model use nex-plus
zorix model use nex26
zorix model use nex3
```

Included aliases:

- `flash` — Zorix Star Flash 2
- `nex-plus` — Zorix Nex Plus
- `nex26` — Zorix Nex 2.6 Coder
- `nex3` — Zorix Nex Coder 3 Preview

Nex Coder 3 may require a Max or administrator account.

## Account and diagnostics

```bash
zorix status
zorix whoami
zorix quota
zorix doctor
zorix logout
```

## Cookie commands

```bash
zorix cookie list
zorix cookie import
zorix cookie import-file cookies.txt
zorix cookie clear
```

Cookie values are never printed by `cookie list`; only names are shown.

## Local history

```bash
zorix history list
zorix history show ID
zorix history export history.json
zorix history clear
```

Disable history for one request:

```bash
zorix chat --no-history "message"
```

## Configuration

```bash
zorix config list
zorix config get model
zorix config set model model-flash
zorix config set timeoutMs 90000
zorix config set thinking true
```

Default configuration directory on Linux and Termux:

```text
~/.config/zorix-cli
```

Files:

- `key.bin` — local encryption key
- `session.enc` — encrypted cookie session
- `config.json` — CLI preferences
- `history.jsonl` — optional local chat history

Use independent profiles:

```bash
zorix --profile personal login
zorix --profile work login
```

## Open website pages

```bash
zorix open home
zorix open login
zorix open chat
zorix open account
zorix open history
zorix open community
zorix open worldcup
```

## Shell completion

```bash
zorix completion bash
zorix completion zsh
zorix completion fish
```

## Security

- HTTPS is required except for localhost tests.
- Requests and redirects are restricted to the configured Zorix origin.
- Passwords are not stored.
- Cookies are encrypted locally with AES-256-GCM.
- Cookie values are not printed by normal commands.
- The package contains no telemetry.
- The package is marked `private` to prevent accidental npm publication.

Local encryption reduces accidental exposure, but cannot protect a session on an already-compromised device.
