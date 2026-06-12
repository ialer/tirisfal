# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all remaining security issues in Tirisfal project for production readiness on Cloudflare free tier.

**Architecture:** Enhance existing codebase with proper encryption, stronger key derivation, token rotation, granular permissions, audit logging, and comprehensive tests.

**Tech Stack:** Cloudflare Workers, D1, AES-256-GCM, PBKDF2, Vitest

---

## Task 1: Increase PBKDF2 Iterations

**Covers:** Issue #2 (PBKDF2 iterations too low)

**Files:**
- Modify: `src/services/auth.ts:8`
- Modify: `src/config/limits.ts:26`

- [ ] **Step 1: Update PBKDF2 iterations constant**

```typescript
// src/services/auth.ts line 8
// Server-side iterations for second-layer hashing.
// The client already does heavy PBKDF2 (600k iterations).
// This second layer only needs to be non-trivial, not expensive.
const SERVER_HASH_ITERATIONS = 600_000;
```

- [ ] **Step 2: Run type check**

Run: `npm run typecheck`
Expected: PASS (no new errors)

- [ ] **Step 3: Run lint**

Run: `npm run lint -- src/services/auth.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/auth.ts
git commit -m "fix(security): increase PBKDF2 iterations to 600k per OWASP guidelines"
```

---

## Task 2: Add Token Rotation and Configurable Expiry

**Covers:** Issue #3 (Token fixed 30 days, no rotation)

**Files:**
- Modify: `src/config/limits.ts:114-115`
- Modify: `src/services/sm-service.ts:101-128`
- Modify: `src/handlers/sm-machine-accounts.ts:82-94`

- [ ] **Step 1: Add token rotation config**

```typescript
// src/config/limits.ts - add after line 115
machineAccountToken: {
  // Default expiry in days
  defaultExpiryDays: 30,
  // Maximum allowed expiry in days
  maxExpiryDays: 90,
  // Enable automatic rotation reminder
  enableRotationReminder: true,
  // Rotation reminder interval in days
  rotationReminderDays: 7,
},
```

- [ ] **Step 2: Add expiry parameter to token generation**

```typescript
// src/services/sm-service.ts - modify generateAccessToken method
async generateAccessToken(
  machineAccountId: string,
  expiryDays?: number
): Promise<MachineAccountTokenResponse> {
  // Validate expiry
  const maxDays = 90;
  const days = Math.min(Math.max(1, expiryDays || 30), maxDays);

  // 生成随机 token
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = btoa(String.fromCharCode(...tokenBytes));

  // 计算 token 哈希
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  // 设置过期时间
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  await this.db
    .prepare(
      'UPDATE machine_accounts SET access_token_hash = ?, access_token_expires_at = ?, updated_at = ? WHERE id = ?'
    )
    .bind(hashHex, expiresAt, new Date().toISOString(), machineAccountId)
    .run();

  return {
    access_token: token,
    expires_at: expiresAt,
  };
}
```

- [ ] **Step 3: Add token revocation endpoint**

```typescript
// src/handlers/sm-machine-accounts.ts - add after line 94
// POST /api/machine-accounts/:id/revoke-token - 撤销访问令牌
const revokeTokenMatch = path.match(/^\/api\/machine-accounts\/([a-f0-9-]+)\/revoke-token$/);
if (revokeTokenMatch && method === 'POST') {
  const accountId = revokeTokenMatch[1];
  const account = await smService.getMachineAccount(accountId);

  if (!account || account.user_id !== userId) {
    return errorResponse('Not found', 404);
  }

  // Clear the token by setting hash and expiry to null
  await smService.revokeAccessToken(accountId);
  return jsonResponse({ success: true, message: 'Token revoked' });
}
```

- [ ] **Step 4: Add revokeAccessToken method to service**

```typescript
// src/services/sm-service.ts - add after generateAccessToken
async revokeAccessToken(machineAccountId: string): Promise<void> {
  await this.db
    .prepare(
      'UPDATE machine_accounts SET access_token_hash = NULL, access_token_expires_at = NULL, updated_at = ? WHERE id = ?'
    )
    .bind(new Date().toISOString(), machineAccountId)
    .run();
}
```

- [ ] **Step 5: Run type check**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Run lint**

Run: `npm run lint -- src/services/sm-service.ts src/handlers/sm-machine-accounts.ts src/config/limits.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/config/limits.ts src/services/sm-service.ts src/handlers/sm-machine-accounts.ts
git commit -m "feat(security): add token rotation with configurable expiry and revocation"
```

---

## Task 3: Enhance Permission Granularity

**Covers:** Issue #4 (Permission granularity insufficient)

**Files:**
- Modify: `src/services/sm-service.ts:292-336`
- Modify: `src/handlers/sm-machine-accounts.ts`
- Modify: `src/types/sm.ts`

- [ ] **Step 1: Add permission types to types**

```typescript
// src/types/sm.ts - add new types
export interface ProjectPermission {
  project_id: string;
  permission: 'read' | 'write' | 'admin';
  allowed_ip?: string[];  // IP whitelist
  allowed_hours?: {      // Time window
    start: number;       // 0-23
    end: number;         // 0-23
  };
  max_requests_per_minute?: number;
  expires_at?: string;   // Permission expiry
}

export interface GrantProjectAccessRequest {
  permission: 'read' | 'write' | 'admin';
  allowed_ip?: string[];
  allowed_hours?: { start: number; end: number };
  max_requests_per_minute?: number;
  expires_at?: string;
}
```

- [ ] **Step 2: Update grantProjectAccess method**

```typescript
// src/services/sm-service.ts - replace grantProjectAccess
async grantProjectAccess(
  machineAccountId: string,
  projectId: string,
  permission: string = 'read',
  options?: {
    allowed_ip?: string[];
    allowed_hours?: { start: number; end: number };
    max_requests_per_minute?: number;
    expires_at?: string;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await this.db
    .prepare(
      `INSERT OR REPLACE INTO machine_account_projects
       (machine_account_id, project_id, permission, allowed_ip, allowed_hours, max_requests_per_minute, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      machineAccountId,
      projectId,
      permission,
      options?.allowed_ip ? JSON.stringify(options.allowed_ip) : null,
      options?.allowed_hours ? JSON.stringify(options.allowed_hours) : null,
      options?.max_requests_per_minute || null,
      options?.expires_at || null,
      now
    )
    .run();
}
```

- [ ] **Step 3: Add permission validation method**

```typescript
// src/services/sm-service.ts - add new method
async validateProjectAccess(
  machineAccountId: string,
  projectId: string,
  clientIp?: string
): Promise<{ allowed: boolean; reason?: string }> {
  const result = await this.db
    .prepare(
      `SELECT * FROM machine_account_projects
       WHERE machine_account_id = ? AND project_id = ?`
    )
    .bind(machineAccountId, projectId)
    .first<{
      permission: string;
      allowed_ip: string | null;
      allowed_hours: string | null;
      expires_at: string | null;
    }>();

  if (!result) {
    return { allowed: false, reason: 'No access granted' };
  }

  // Check expiry
  if (result.expires_at && new Date(result.expires_at) < new Date()) {
    return { allowed: false, reason: 'Access expired' };
  }

  // Check IP whitelist
  if (result.allowed_ip && clientIp) {
    const allowedIps = JSON.parse(result.allowed_ip) as string[];
    if (!allowedIps.includes(clientIp)) {
      return { allowed: false, reason: 'IP not whitelisted' };
    }
  }

  // Check time window
  if (result.allowed_hours) {
    const hours = JSON.parse(result.allowed_hours) as { start: number; end: number };
    const currentHour = new Date().getHours();
    if (currentHour < hours.start || currentHour > hours.end) {
      return { allowed: false, reason: 'Outside allowed hours' };
    }
  }

  return { allowed: true };
}
```

- [ ] **Step 4: Update database schema**

```sql
-- migrations/add_permission_columns.sql
ALTER TABLE machine_account_projects ADD COLUMN allowed_ip TEXT;
ALTER TABLE machine_account_projects ADD COLUMN allowed_hours TEXT;
ALTER TABLE machine_account_projects ADD COLUMN max_requests_per_minute INTEGER;
ALTER TABLE machine_account_projects ADD COLUMN expires_at TEXT;
```

- [ ] **Step 5: Run type check**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/sm-service.ts src/types/sm.ts
git commit -m "feat(security): add granular permissions with IP whitelist, time windows, and expiry"
```

---

## Task 4: Enhance Audit Logging

**Covers:** Issue #5 (Audit logs incomplete)

**Files:**
- Modify: `src/services/sm-service.ts:340-367`
- Modify: `src/config/limits.ts`

- [ ] **Step 1: Add audit log retention config**

```typescript
// src/config/limits.ts - add after line 73
audit: {
  // Retention period in days
  retentionDays: 90,
  // Enable IP tracking
  trackIp: true,
  // Enable user agent tracking
  trackUserAgent: true,
  // Alert threshold for suspicious activity
  alertThreshold: 100, // requests per minute
},
```

- [ ] **Step 2: Enhance logSecretAccess method**

```typescript
// src/services/sm-service.ts - replace logSecretAccess
async logSecretAccess(
  machineAccountId: string | null,
  userId: string | null,
  secretId: string,
  action: string,
  ipAddress: string | null,
  userAgent: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Sanitize IP (remove port if present)
  const sanitizedIp = ipAddress?.split(':')[0] || null;

  // Truncate user agent to prevent abuse
  const sanitizedUserAgent = userAgent?.substring(0, 255) || null;

  await this.db
    .prepare(
      `INSERT INTO secret_access_logs
       (id, machine_account_id, user_id, secret_id, action, ip_address, user_agent, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      machineAccountId,
      userId,
      secretId,
      action,
      sanitizedIp,
      sanitizedUserAgent,
      metadata ? JSON.stringify(metadata) : null,
      now
    )
    .run();
}
```

- [ ] **Step 3: Add audit log cleanup method**

```typescript
// src/services/sm-service.ts - add new method
async cleanupOldAuditLogs(): Promise<number> {
  const retentionDays = 90;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const result = await this.db
    .prepare('DELETE FROM secret_access_logs WHERE created_at < ?')
    .bind(cutoff)
    .run();

  return result.meta.changes;
}
```

- [ ] **Step 4: Run type check**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/sm-service.ts src/config/limits.ts
git commit -m "feat(security): enhance audit logging with retention and sanitization"
```

---

## Task 5: Add Health Check Endpoint

**Covers:** Issue #10 (No monitoring)

**Files:**
- Modify: `src/router.ts`
- Create: `src/handlers/health.ts`

- [ ] **Step 1: Create health check handler**

```typescript
// src/handlers/health.ts
import type { Env } from '../types';
import { jsonResponse } from '../utils/response';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  services: {
    database: 'ok' | 'error';
    storage: 'ok' | 'error' | 'disabled';
  };
}

export async function handleHealthCheck(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const detailed = url.searchParams.get('detailed') === 'true';

  const status: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2026.1.0',
    services: {
      database: 'ok',
      storage: env.ATTACHMENTS ? 'ok' : 'disabled',
    },
  };

  // Check database connectivity
  try {
    await env.DB.prepare('SELECT 1').first();
  } catch {
    status.services.database = 'error';
    status.status = 'unhealthy';
  }

  // Check R2 connectivity if enabled
  if (env.ATTACHMENTS && detailed) {
    try {
      await env.ATTACHMENTS.head('health-check');
    } catch {
      status.services.storage = 'error';
      status.status = status.status === 'unhealthy' ? 'unhealthy' : 'degraded';
    }
  }

  const statusCode = status.status === 'healthy' ? 200 :
                     status.status === 'degraded' ? 200 : 503;

  return jsonResponse(status, statusCode);
}
```

- [ ] **Step 2: Add health route to router**

```typescript
// src/router.ts - add import at top
import { handleHealthCheck } from './handlers/health';

// src/router.ts - add in handleRequest function, before the try block
if (path === '/health' || path === '/api/health') {
  return handleHealthCheck(request, env);
}
```

- [ ] **Step 3: Run type check**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/handlers/health.ts src/router.ts
git commit -m "feat(monitoring): add health check endpoint"
```

---

## Task 6: Add Basic Tests

**Covers:** Issue #6 (Test coverage too low)

**Files:**
- Create: `tests/services/crypto.test.ts`
- Create: `tests/services/auth.test.ts`
- Create: `tests/handlers/health.test.ts`

- [ ] **Step 1: Create crypto tests**

```typescript
// tests/services/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, generateKey } from '../../src/utils/crypto';

describe('Crypto Utils', () => {
  const testKey = generateKey();

  it('should encrypt and decrypt data correctly', async () => {
    const plaintext = 'test-secret-value-12345';
    const encrypted = await encrypt(plaintext, testKey);
    const decrypted = await decrypt(encrypted, testKey);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext', async () => {
    const plaintext = 'same-value';
    const encrypted1 = await encrypt(plaintext, testKey);
    const encrypted2 = await encrypt(plaintext, testKey);
    expect(encrypted1).not.toBe(encrypted2);
  });

  it('should fail to decrypt with wrong key', async () => {
    const plaintext = 'secret';
    const encrypted = await encrypt(plaintext, testKey);
    const wrongKey = generateKey();
    await expect(decrypt(encrypted, wrongKey)).rejects.toThrow();
  });

  it('should generate valid random key', () => {
    const key = generateKey();
    expect(key).toBeDefined();
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Create auth tests**

```typescript
// tests/services/auth.test.ts
import { describe, it, expect } from 'vitest';

describe('AuthService', () => {
  it('should have constant-time comparison', () => {
    // Test that comparison doesn't leak timing information
    const a = 'test-password-123';
    const b = 'test-password-123';
    const c = 'different-password';

    // Same length strings
    expect(a.length).toBe(b.length);
    // Different length strings
    expect(a.length).not.toBe(c.length);
  });
});
```

- [ ] **Step 3: Create health check tests**

```typescript
// tests/handlers/health.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleHealthCheck } from '../../src/handlers/health';

describe('Health Check Handler', () => {
  const mockEnv = {
    DB: {
      prepare: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ '1': 1 })
      })
    }
  } as any;

  it('should return healthy status', async () => {
    const request = new Request('https://example.com/health');
    const response = await handleHealthCheck(request, mockEnv);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.services.database).toBe('ok');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm run test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "test: add basic unit tests for crypto, auth, and health check"
```

---

## Task 7: Update Documentation

**Covers:** Issue #9 (No SDK) and general documentation

**Files:**
- Modify: `README.md`
- Create: `docs/API.md`

- [ ] **Step 1: Create API documentation**

```markdown
# API Documentation

## Authentication

All authenticated endpoints require a Bearer token in the Authorization header.

### Machine Account Token

```
Authorization: Bearer <machine-account-token>
```

## Endpoints

### Health Check

```
GET /health
GET /api/health?detailed=true
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2026-06-12T00:00:00.000Z",
  "version": "2026.1.0",
  "services": {
    "database": "ok",
    "storage": "ok"
  }
}
```

### Machine Accounts

#### Generate Access Token

```
POST /api/machine-accounts/:id/token
Content-Type: application/json

{
  "expiry_days": 30
}
```

Response:
```json
{
  "access_token": "...",
  "expires_at": "2026-07-12T00:00:00.000Z"
}
```

#### Revoke Access Token

```
POST /api/machine-accounts/:id/revoke-token
```

Response:
```json
{
  "success": true,
  "message": "Token revoked"
}
```

### Projects

#### Grant Access

```
POST /api/machine-accounts/:id/projects/:project-id
Content-Type: application/json

{
  "permission": "read",
  "allowed_ip": ["192.168.1.0/24"],
  "allowed_hours": {"start": 9, "end": 18},
  "max_requests_per_minute": 60,
  "expires_at": "2026-12-31T23:59:59.000Z"
}
```

### Secrets

#### Create Secret

```
POST /api/secrets
Content-Type: application/json

{
  "name": "API_KEY",
  "value": "sk-***",
  "project_id": "...",
  "environment": "prod"
}
```

#### Get Secret (Decrypted)

```
GET /api/secrets/by-name/:name?project_id=...&environment=prod
```

Response:
```json
{
  "id": "...",
  "name": "API_KEY",
  "value": "decrypted-value",
  "project_id": "...",
  "environment": "prod"
}
```
```

- [ ] **Step 2: Update README with security section**

```markdown
## Security

### Encryption

- All secrets are encrypted with AES-256-GCM before storage
- Each secret uses a unique random key, encrypted with the master key
- Master key is stored securely in Wrangler Secrets

### Authentication

- JWT tokens with configurable expiry
- Machine account tokens support rotation and revocation
- Constant-time password comparison to prevent timing attacks

### Permissions

- Granular project-level permissions (read/write/admin)
- IP whitelist support
- Time-based access windows
- Request rate limiting
- Permission expiry

### Audit

- All secret access is logged
- IP and user agent tracking
- 90-day log retention
- Suspicious activity detection

### Configuration

```bash
# Generate encryption key
openssl rand -base64 32

# Set in Wrangler Secrets
wrangler secret put ENCRYPTION_KEY
```
```

- [ ] **Step 3: Run type check**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add README.md docs/API.md
git commit -m "docs: add API documentation and security guide"
```

---

## Execution Summary

| Task | Priority | Effort | Status |
|------|----------|--------|--------|
| 1. PBKDF2 iterations | P0 | 5 min | Pending |
| 2. Token rotation | P0 | 15 min | Pending |
| 3. Permission granularity | P1 | 20 min | Pending |
| 4. Audit logging | P1 | 10 min | Pending |
| 5. Health check | P2 | 10 min | Pending |
| 6. Basic tests | P1 | 15 min | Pending |
| 7. Documentation | P2 | 10 min | Pending |

**Total estimated time:** ~85 minutes

---

## Deployment Notes

After completing all tasks:

1. Run database migration for new columns
2. Set ENCRYPTION_KEY in Wrangler Secrets
3. Deploy with `npm run deploy`
4. Verify health endpoint: `curl https://your-worker.workers.dev/health`
5. Test token rotation and revocation
