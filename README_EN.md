<p align="center">
  <strong>English</strong> · <a href="README.md">简体中文</a>
</p>

# tirisfal

> **A credential gateway for AI agents, with a Bitwarden-compatible vault attached.**

<p align="center">
  <img src="https://img.shields.io/badge/version-1.6.0-blue" alt="version">
  <img src="https://img.shields.io/badge/license-LGPL--3.0-green" alt="license">
  <img src="https://img.shields.io/badge/runtime-workerd%20%2F%20Cloudflare%20Workers-orange" alt="runtime">
  <img src="https://img.shields.io/badge/deploy-Cloudflare%20%7C%20Docker-2496ED" alt="deploy">
</p>

What an agent actually needs is not "copy the API key into its context", but "let it call the API without ever seeing the key".
tirisfal closes that loop on the server: **authorize → read secret → inject upstream → redact response**.
The plaintext never leaves the server, never enters the agent context, and never lands in logs.

The vault (Bitwarden-compatible) is the companion: humans keep using the mature ecosystem, agents go through the credential gateway.

---

## Why

| Today | Consequence |
|---|---|
| Keys in env vars / prompts / temp files | One log leak or context spill and it is permanently exposed |
| Agents reading a secrets manager directly | Every agent needs its own SDK, scope and rotation logic |
| General-purpose Vault for injection | Capable but heavy: HA, seal/unseal, policy DSL — too much for a small team |

tirisfal's answer is one HTTP call:

```bash
curl -X POST https://your-host/api/secrets/use \
  -H "Authorization: Bearer <machine-token>" \
  -H "Content-Type: application/json" \
  -d '{"project_id":"<id>","name":"OPENAI_KEY","url":"https://api.openai.com/v1/chat/completions",
       "method":"POST","purpose":"chat completion","body":"{...}"}'
```

The server injects the real value into `Authorization`; the agent only sees the upstream response. If the upstream echoes the credential, it is replaced with `***REDACTED***`.

---

## Three ways to use a credential

| Mode | What the agent gets | When |
|---|---|---|
| **inject** (default) | Can call allow-listed upstreams only | Almost everything |
| **masked read** | `sk-a****9f2c`, to confirm which key is configured | Troubleshooting |
| **reveal** | Plaintext, bounded by a quota (atomic, default 1) | Migration / one-off debugging |

Scope chain: machine account → project → grant. A grant can carry `allowed_hosts` (SSRF allow-list), `allowed_ip`, `allowed_hours`, `max_requests_per_minute`, `reveal_limit`, and `permission` (read / write).

---

## Trust model (two separate domains)

| Domain | Encrypted by | Server can decrypt | Notes |
|---|---|---|---|
| **Vault** | client | ❌ | Master password → key via PBKDF2; the server stores only the wrapped user key and a verifier. Zero-knowledge |
| **Secrets Manager** | server | ✅ (holds `ENCRYPTION_KEY`) | The injection proxy must see plaintext to call upstream on your behalf. This is by design, not a flaw |

In one line: **the vault is zero-knowledge; agent credentials are not.** If you need E2E encryption for agent credentials too, an injection proxy cannot exist — use the vault-only mode or another tool.

---

## Quick start

### A. Cloudflare Workers

```bash
git clone https://github.com/ialer/tirisfal.git && cd tirisfal
npm install
cp .dev.vars.example .dev.vars

npx wrangler secret put JWT_SECRET        # openssl rand -hex 32
npx wrangler secret put ENCRYPTION_KEY    # openssl rand -base64 32 (immutable once used)
npx wrangler d1 migrations apply tirisfal-db --remote
npm run deploy
```

### B. Docker self-hosting

```bash
cd docker
cp -n env.example .env
mkdir -p secrets && cp secrets/dev.vars.example secrets/dev.vars
# fill JWT_SECRET / ENCRYPTION_KEY, then:
sudo chown 10001:10001 secrets/dev.vars && chmod 600 secrets/dev.vars

docker compose --profile proxy up -d --build            # internal TLS via Caddy
docker compose --profile proxy --profile tunnel up -d   # plus Cloudflare Tunnel
```

Runbook: **[docs/DOCKER.md](docs/DOCKER.md)**.

---

## Agent onboarding (4 steps)

```bash
API=https://your-host

# 1) machine account
curl -X POST $API/api/machine-accounts -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" -d '{"name":"my-agent"}'

# 2) issue a token (shown once; only a hash is stored)
curl -X POST $API/api/machine-accounts/<id>/token -H "Authorization: Bearer <user-token>"

# 3) project + secret
curl -X POST $API/api/projects -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" -d '{"name":"my-project"}'
curl -X POST $API/api/secrets -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"OPENAI_KEY","value":"sk-...","project_id":"<project-id>"}'

# 4) grant (inject mode + upstream allow-list)
curl -X POST $API/api/machine-accounts/<id>/projects/<project-id> \
  -H "Authorization: Bearer <user-token>" -H "Content-Type: application/json" \
  -d '{"permission":"read","mode":"inject","allowed_hosts":["api.openai.com"]}'
```

> If an agent must manage secrets, grant `permission: "write"` explicitly. A `read` grant can read and inject, but any write returns 403.

---

## Comparison

| | tirisfal | Vaultwarden | HashiCorp Vault | Infisical / Doppler | AWS SM Agent |
|---|---|---|---|---|---|
| Vault | ✅ Bitwarden-compatible | ✅ | ❌ | ❌ | ❌ |
| Agent injection proxy (plaintext stays server-side) | ✅ built-in | ❌ | ⚠️ DIY/templates | ⚠️ partial | ❌ (local cache) |
| Masked read + one-shot reveal quota | ✅ | ❌ | ⚠️ policy | ❌ | ❌ |
| Self-hosting cost | one container / one Worker | one container | high (HA/seal) | medium | cloud |
| Operational complexity | low | low | high | medium | low |

---

## Security design

- **Vault zero-knowledge**: PBKDF2-600k client-side; the server only verifies a derived hash
- **Secret encryption**: v3 format, per-ciphertext salt + HKDF-SHA-256 (no key reuse across records); legacy v2/PBKDF2 ciphertext upgraded on read
- **Injection proxy**: https only, no IP literals / private hosts, single-label wildcards, optional per-request DoH resolution check (`OUTBOUND_DNS_GUARD=1`)
- **Redaction**: any secret length, covering raw / URL-encoded / base64 / base64url variants; upstream body streamed and capped at 512 KB
- **Downloads**: attachments and Send files forced to `octet-stream` + `Content-Disposition: attachment` + sandbox CSP (no same-origin XSS)
- **Tokens**: JWT enforces `typ=access`, `aud`, `alg=HS256`; machine tokens stored as SHA-256; refresh rotation with family reuse detection
- **Rate limiting**: atomic fixed-window counters with window reset; separate budgets for public/login/refresh/register/grants
- **Client IP trust chain**: only trusted proxy headers are accepted; `PROXY_SHARED_SECRET` makes direct-to-worker spoofing useless
- **Backups**: field-contract validation, pre-extraction zip-bomb limits, and SM data included (machine tokens excluded)

---

## Architecture

```
Browser / official clients ──▶ workerd (Workers or container) ──▶ D1 / R2 / Durable Objects
AI agent ──machine token──▶ /api/secrets/use ──▶ allow-listed upstream (inject + redact)
```

- Runtime: workerd (Cloudflare Workers, or `wrangler dev --local` in a container)
- Storage: D1 (SQLite), R2 (attachments/archives), Durable Objects (notifications)
- Frontend: Preact + Vite, self-hosted fonts, CSP `default-src 'self'`
- Deployment: `wrangler deploy`, or Docker Compose (Caddy internal TLS + optional CF Tunnel)

---

## Configuration

| Variable | Required | Description |
|---|:---:|---|
| `JWT_SECRET` | ✅ | Access-token signing (≥32 chars) |
| `ENCRYPTION_KEY` | ✅ | Secret encryption (immutable once used) |
| `TOTP_SECRET` | ❌ | TOTP encryption key |
| `BACKUP_ENCRYPTION_KEY` | ❌ | Backup runtime key; falls back to `JWT_SECRET` |
| `CLIENT_IP_HEADER` | ❌ | Client IP header, default `CF-Connecting-IP` |
| `PROXY_SHARED_SECRET` | ❌ | Proxy shared secret; blocks direct-to-worker spoofing |
| `OUTBOUND_DNS_GUARD` | ❌ | `1` enables per-request DNS resolution checks |

---

## Docs

| Doc | Contents |
|---|---|
| [docs/DOCKER.md](docs/DOCKER.md) | Self-hosting: image, Caddy/Tunnel, backup, upgrade/rollback, troubleshooting |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Cloud operations: keys, migrations, backup/restore, agent SOP, rollback |
| [docs/API.md](docs/API.md) | REST API reference |
| [docs/CODE-REVIEW-2026-11-08.md](docs/CODE-REVIEW-2026-11-08.md) | Multi-dimensional review and fix log |

---

## Roadmap

1. Credential lifecycle: versioning, rotation, expiry + per-project DEK
2. Storage/login-path consolidation + `db.batch` atomic writes
3. Observability: injection latency / denial reasons + structured logs
4. Frontend code-splitting and accessibility
5. MCP endpoint (pilot, reusing `/use`)

**Not doing**: multi-tenant/HA clusters, E2E encryption for Secrets Manager, frontend rewrite.

---

## License

LGPL-3.0-or-later.
