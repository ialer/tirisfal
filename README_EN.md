# Tirisfal Secrets Manager

**Credential management service designed for AI Agents, running on Cloudflare Workers.**

---

## Core Features

| Feature | Description |
|---------|-------------|
| **Machine Accounts** | Create independent machine accounts for each Agent |
| **Projects** | Organize credentials by project |
| **Secrets** | Securely store API Keys, Tokens, passwords |
| **Access Tokens** | Agents access credentials via tokens |
| **Audit Logs** | Track all credential access behavior |

---

## Agent Integration

### 1. Create Machine Account

```bash
curl -X POST https://your-worker.workers.dev/api/machine-accounts \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "ningzhi", "description": "NingZhi Agent"}'
```

### 2. Get Access Token

```bash
curl -X POST https://your-worker.workers.dev/api/machine-accounts/<id>/token \
  -H "Authorization: Bearer <user-token>"
```

### 3. Create Project and Secrets

```bash
# Create project
curl -X POST https://your-worker.workers.dev/api/projects \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "SN-Team", "description": "SN Team Credentials"}'

# Create secret
curl -X POST https://your-worker.workers.dev/api/secrets \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "XIAOMI_API_KEY", "value": "sk-***", "project_id": "<project-id>"}'
```

### 4. Agent Gets Credentials

```bash
curl https://your-worker.workers.dev/api/secrets/by-name/XIAOMI_API_KEY \
  -H "Authorization: Bearer <machine-account-token>" \
  -d '{"project_id": "<project-id>", "environment": "prod"}'
```

---

## API Endpoints

### Machine Accounts

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/machine-accounts` | Create machine account |
| GET | `/api/machine-accounts` | List all machine accounts |
| GET | `/api/machine-accounts/:id` | Get machine account details |
| PUT | `/api/machine-accounts/:id` | Update machine account |
| DELETE | `/api/machine-accounts/:id` | Delete machine account |
| POST | `/api/machine-accounts/:id/token` | Generate access token |

### Projects

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects` | Create project |
| GET | `/api/projects` | List all projects |
| GET | `/api/projects/:id` | Get project details |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |

### Secrets

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/secrets` | Create secret |
| GET | `/api/secrets?project_id=<id>` | List project secrets |
| GET | `/api/secrets/:id` | Get secret details |
| PUT | `/api/secrets/:id` | Update secret |
| DELETE | `/api/secrets/:id` | Delete secret |
| GET | `/api/secrets/by-name/:name` | Get secret by name |

---

## Agent Integration Examples

### OpenClaw Agent

Add to Agent's TOOLS.md:

```markdown
## Credential Management

### Get Credential
```bash
VALUE=$(curl -s https://your-worker.workers.dev/api/secrets/by-name/<SECRET_NAME> \
  -H "Authorization: Bearer $NW_TOKEN" | jq -r .value)
```

### Environment Variables
- NW_TOKEN: Access Token
- NW_SERVER: Server URL
```

### Hermes Agent

Add to Agent's TOOLS.md:

```markdown
## Credential Management

### Get Credential
```bash
curl -s https://your-worker.workers.dev/api/secrets/by-name/<SECRET_NAME> \
  -H "Authorization: Bearer $NW_TOKEN" | jq -r .value
```
```

---

## Permission Control

| Role | Permissions |
|------|-------------|
| **User** | Create/manage Machine Account, Project, Secret |
| **Machine Account** | Read only authorized Project's Secrets |

### Authorization Example

```bash
# Grant Machine Account read access to project
curl -X POST https://your-worker.workers.dev/api/machine-accounts/<id>/projects/<project-id> \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"permission": "read"}'
```

---

## Security Features

- **End-to-end encryption** — Credentials encrypted at rest
- **Least privilege** — Agents only access authorized credentials
- **Audit logs** — All access behavior traceable
- **Token rotation** — Support periodic token replacement
- **Expiration** — Tokens can have expiry time

---

## Deployment

```bash
# Clone repository
git clone https://github.com/ialer/tirisfal.git
cd tirisfal

# Install dependencies
npm install

# Configure environment variables
cp .dev.vars.example .dev.vars
# Edit .dev.vars to set JWT_SECRET

# Local development
npm run dev

# Deploy to Cloudflare Workers
npm run deploy
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | ✅ | JWT signing secret (32+ chars) |
| `DB` | ✅ | D1 database binding |
| `ATTACHMENTS` | ❌ | R2 bucket (optional) |

---

## Documentation

- [Deployment Guide](#deployment)
- [API Documentation](#api-endpoints)
- [Agent Integration](#agent-integration-examples)
- [Security Features](#security-features)
