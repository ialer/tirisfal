"""
Tirisfal Secrets Manager Python SDK

Simple client for accessing secrets from Tirisfal.

Usage:
    from tirisfal import TirisfalClient

    client = TirisfalClient(
        server="https://your-worker.workers.dev",
        token="your-machine-account-token"
    )

    # Get a secret
    secret = client.get_secret("API_KEY", project_id="xxx", environment="prod")
    print(secret.value)
"""

import json
from dataclasses import dataclass
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError


@dataclass
class Secret:
    """Represents a secret value."""
    id: str
    name: str
    value: str
    project_id: str
    environment: str
    note: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


@dataclass
class Project:
    """Represents a project."""
    id: str
    name: str
    description: Optional[str] = None
    user_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


@dataclass
class MachineAccount:
    """Represents a machine account."""
    id: str
    name: str
    user_id: Optional[str] = None
    status: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class TirisfalError(Exception):
    """Base exception for Tirisfal SDK errors."""
    def __init__(self, message: str, status_code: int = 0):
        super().__init__(message)
        self.status_code = status_code


class TirisfalClient:
    """
    Client for Tirisfal Secrets Manager.

    Args:
        server: Base URL of the Tirisfal server
        token: Machine account access token or user JWT token
    """

    def __init__(self, server: str, token: str):
        self.server = server.rstrip("/")
        self.token = token

    def _request(
        self,
        method: str,
        path: str,
        data: Optional[dict] = None,
        params: Optional[dict] = None
    ) -> dict:
        """Make an HTTP request to the API."""
        url = f"{self.server}{path}"

        if params:
            query_string = "&".join(f"{k}={v}" for k, v in params.items() if v)
            if query_string:
                url += f"?{query_string}"

        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

        body = json.dumps(data).encode() if data else None
        req = Request(url, data=body, headers=headers, method=method)

        try:
            with urlopen(req) as response:
                return json.loads(response.read().decode())
        except HTTPError as e:
            error_body = e.read().decode() if e.fp else str(e)
            try:
                error_data = json.loads(error_body)
                message = error_data.get("error", error_body)
            except json.JSONDecodeError:
                message = error_body
            raise TirisfalError(message, e.code)

    # ==================== Secrets ====================

    def get_secret(
        self,
        name: str,
        project_id: str,
        environment: str = "prod"
    ) -> Secret:
        """
        Get a secret by name.

        Args:
            name: Secret name
            project_id: Project ID
            environment: Environment (prod, staging, dev, test)

        Returns:
            Secret object with decrypted value
        """
        data = self._request(
            "GET",
            f"/api/secrets/by-name/{name}",
            params={"project_id": project_id, "environment": environment}
        )
        return Secret(
            id=data["id"],
            name=data["name"],
            value=data["value"],
            project_id=data["project_id"],
            environment=data["environment"],
            note=data.get("note"),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )

    def get_secrets(
        self,
        project_id: str,
        environment: Optional[str] = None
    ) -> list[Secret]:
        """
        List secrets in a project.

        Args:
            project_id: Project ID
            environment: Filter by environment (optional)

        Returns:
            List of Secret objects
        """
        params = {"project_id": project_id}
        if environment:
            params["environment"] = environment

        data = self._request("GET", "/api/secrets", params=params)
        return [
            Secret(
                id=s["id"],
                name=s["name"],
                value=s.get("value", ""),
                project_id=s["project_id"],
                environment=s["environment"],
                note=s.get("note"),
                created_at=s.get("created_at"),
                updated_at=s.get("updated_at"),
            )
            for s in data.get("data", [])
        ]

    def create_secret(
        self,
        name: str,
        value: str,
        project_id: str,
        environment: str = "prod",
        note: Optional[str] = None
    ) -> Secret:
        """
        Create a new secret.

        Args:
            name: Secret name
            value: Secret value
            project_id: Project ID
            environment: Environment
            note: Optional note

        Returns:
            Created Secret object
        """
        data = self._request(
            "POST",
            "/api/secrets",
            data={
                "name": name,
                "value": value,
                "project_id": project_id,
                "environment": environment,
                "note": note,
            }
        )
        return Secret(
            id=data["id"],
            name=data["name"],
            value=value,
            project_id=data["project_id"],
            environment=data["environment"],
            note=data.get("note"),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )

    def update_secret(
        self,
        secret_id: str,
        value: Optional[str] = None,
        note: Optional[str] = None
    ) -> Secret:
        """
        Update an existing secret.

        Args:
            secret_id: Secret ID
            value: New value (optional)
            note: New note (optional)

        Returns:
            Updated Secret object
        """
        update_data = {}
        if value is not None:
            update_data["value"] = value
        if note is not None:
            update_data["note"] = note

        data = self._request("PUT", f"/api/secrets/{secret_id}", data=update_data)
        return Secret(
            id=data["id"],
            name=data["name"],
            value=value or data.get("value", ""),
            project_id=data["project_id"],
            environment=data["environment"],
            note=data.get("note"),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )

    def delete_secret(self, secret_id: str) -> bool:
        """
        Delete a secret.

        Args:
            secret_id: Secret ID

        Returns:
            True if deleted successfully
        """
        self._request("DELETE", f"/api/secrets/{secret_id}")
        return True

    # ==================== Projects ====================

    def get_projects(self) -> list[Project]:
        """
        List all projects.

        Returns:
            List of Project objects
        """
        data = self._request("GET", "/api/projects")
        return [
            Project(
                id=p["id"],
                name=p["name"],
                description=p.get("description"),
                user_id=p.get("user_id"),
                created_at=p.get("created_at"),
                updated_at=p.get("updated_at"),
            )
            for p in data.get("data", [])
        ]

    def get_project(self, project_id: str) -> Project:
        """
        Get a project by ID.

        Args:
            project_id: Project ID

        Returns:
            Project object
        """
        data = self._request("GET", f"/api/projects/{project_id}")
        return Project(
            id=data["id"],
            name=data["name"],
            description=data.get("description"),
            user_id=data.get("user_id"),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )

    # ==================== Machine Accounts ====================

    def get_machine_accounts(self) -> list[MachineAccount]:
        """
        List all machine accounts.

        Returns:
            List of MachineAccount objects
        """
        data = self._request("GET", "/api/machine-accounts")
        return [
            MachineAccount(
                id=m["id"],
                name=m["name"],
                user_id=m.get("user_id"),
                status=m.get("status"),
                created_at=m.get("created_at"),
                updated_at=m.get("updated_at"),
            )
            for m in data.get("data", [])
        ]

    # ==================== Health Check ====================

    def health_check(self, detailed: bool = False) -> dict:
        """
        Check server health.

        Args:
            detailed: Include detailed service checks

        Returns:
            Health status dict
        """
        params = {"detailed": "true"} if detailed else None
        return self._request("GET", "/health", params=params)


# Convenience function
def get_secret(
    server: str,
    token: str,
    name: str,
    project_id: str,
    environment: str = "prod"
) -> str:
    """
    Quick function to get a secret value.

    Args:
        server: Tirisfal server URL
        token: Access token
        name: Secret name
        project_id: Project ID
        environment: Environment

    Returns:
        Secret value as string
    """
    client = TirisfalClient(server, token)
    secret = client.get_secret(name, project_id, environment)
    return secret.value
