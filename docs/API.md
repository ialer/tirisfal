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

#### Create Machine Account

```
POST /api/machine-accounts
Content-Type: application/json

{
  "name": "agent-name",
  "description": "Agent description"
}
```

Response:
```json
{
  "id": "uuid",
  "name": "agent-name",
  "user_id": "user-uuid",
  "status": "active",
  "created_at": "2026-06-12T00:00:00.000Z"
}
```

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

#### Create Project

```
POST /api/projects
Content-Type: application/json

{
  "name": "project-name",
  "description": "Project description"
}
```

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

## Error Responses

```json
{
  "error": "Error message",
  "error_description": "Detailed error description",
  "ErrorModel": {
    "Message": "Error message",
    "Object": "error"
  }
}
```

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| Public API | 60 requests/minute |
| Authenticated API | 200 requests/minute |
| Login | 10 attempts/2 minutes |
| Register | 5 requests/minute |
