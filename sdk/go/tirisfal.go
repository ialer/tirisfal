// Package tirisfal provides a client for the Tirisfal Secrets Manager API.
//
// Usage:
//
//	client := tirisfal.NewClient("https://your-worker.workers.dev", "your-token")
//	secret, err := client.GetSecret("API_KEY", "project-id", "prod")
//	if err != nil {
//	    log.Fatal(err)
//	}
//	fmt.Println(secret.Value)
package tirisfal

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Secret represents a secret value.
type Secret struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Value       string  `json:"value"`
	ProjectID   string  `json:"project_id"`
	Environment string  `json:"environment"`
	Note        *string `json:"note,omitempty"`
	CreatedAt   *string `json:"created_at,omitempty"`
	UpdatedAt   *string `json:"updated_at,omitempty"`
}

// Project represents a project.
type Project struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	UserID      *string `json:"user_id,omitempty"`
	CreatedAt   *string `json:"created_at,omitempty"`
	UpdatedAt   *string `json:"updated_at,omitempty"`
}

// MachineAccount represents a machine account.
type MachineAccount struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	UserID    *string `json:"user_id,omitempty"`
	Status    *string `json:"status,omitempty"`
	CreatedAt *string `json:"created_at,omitempty"`
	UpdatedAt *string `json:"updated_at,omitempty"`
}

// HealthStatus represents the health status of the server.
type HealthStatus struct {
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
	Version   string `json:"version"`
	Services  struct {
		Database string `json:"database"`
		Storage  string `json:"storage"`
	} `json:"services"`
}

// ErrorResponse represents an error response from the API.
type ErrorResponse struct {
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

// Client is the Tirisfal API client.
type Client struct {
	Server string
	Token  string
	HTTP   *http.Client
}

// NewClient creates a new Tirisfal client.
func NewClient(server, token string) *Client {
	return &Client{
		Server: strings.TrimRight(server, "/"),
		Token:  token,
		HTTP: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// request makes an HTTP request to the API.
func (c *Client) request(method, path string, body interface{}, params map[string]string) ([]byte, error) {
	u := c.Server + path

	if len(params) > 0 {
		q := url.Values{}
		for k, v := range params {
			if v != "" {
				q.Set(k, v)
			}
		}
		if encoded := q.Encode(); encoded != "" {
			u += "?" + encoded
		}
	}

	var bodyReader io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal body: %w", err)
		}
		bodyReader = strings.NewReader(string(jsonBody))
	}

	req, err := http.NewRequest(method, u, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.Token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		var errResp ErrorResponse
		if json.Unmarshal(respBody, &errResp) == nil && errResp.Error != "" {
			return nil, &APIError{
				StatusCode: resp.StatusCode,
				Message:    errResp.Error,
			}
		}
		return nil, &APIError{
			StatusCode: resp.StatusCode,
			Message:    string(respBody),
		}
	}

	return respBody, nil
}

// APIError represents an API error.
type APIError struct {
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("API error %d: %s", e.StatusCode, e.Message)
}

// GetSecret retrieves a secret by name.
func (c *Client) GetSecret(name, projectID, environment string) (*Secret, error) {
	if environment == "" {
		environment = "prod"
	}

	data, err := c.request("GET", "/api/secrets/by-name/"+url.PathEscape(name), nil, map[string]string{
		"project_id":  projectID,
		"environment": environment,
	})
	if err != nil {
		return nil, err
	}

	var secret Secret
	if err := json.Unmarshal(data, &secret); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &secret, nil
}

// ListSecrets lists secrets in a project.
func (c *Client) ListSecrets(projectID, environment string) ([]Secret, error) {
	params := map[string]string{
		"project_id": projectID,
	}
	if environment != "" {
		params["environment"] = environment
	}

	data, err := c.request("GET", "/api/secrets", nil, params)
	if err != nil {
		return nil, err
	}

	var result struct {
		Data []Secret `json:"data"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return result.Data, nil
}

// CreateSecret creates a new secret.
func (c *Client) CreateSecret(name, value, projectID, environment, note string) (*Secret, error) {
	if environment == "" {
		environment = "prod"
	}

	body := map[string]interface{}{
		"name":       name,
		"value":      value,
		"project_id": projectID,
		"environment": environment,
	}
	if note != "" {
		body["note"] = note
	}

	data, err := c.request("POST", "/api/secrets", body, nil)
	if err != nil {
		return nil, err
	}

	var secret Secret
	if err := json.Unmarshal(data, &secret); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &secret, nil
}

// UpdateSecret updates an existing secret.
func (c *Client) UpdateSecret(secretID string, value, note *string) (*Secret, error) {
	body := map[string]interface{}{}
	if value != nil {
		body["value"] = *value
	}
	if note != nil {
		body["note"] = *note
	}

	data, err := c.request("PUT", "/api/secrets/"+secretID, body, nil)
	if err != nil {
		return nil, err
	}

	var secret Secret
	if err := json.Unmarshal(data, &secret); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &secret, nil
}

// DeleteSecret deletes a secret.
func (c *Client) DeleteSecret(secretID string) error {
	_, err := c.request("DELETE", "/api/secrets/"+secretID, nil, nil)
	return err
}

// ListProjects lists all projects.
func (c *Client) ListProjects() ([]Project, error) {
	data, err := c.request("GET", "/api/projects", nil, nil)
	if err != nil {
		return nil, err
	}

	var result struct {
		Data []Project `json:"data"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return result.Data, nil
}

// GetProject gets a project by ID.
func (c *Client) GetProject(projectID string) (*Project, error) {
	data, err := c.request("GET", "/api/projects/"+projectID, nil, nil)
	if err != nil {
		return nil, err
	}

	var project Project
	if err := json.Unmarshal(data, &project); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &project, nil
}

// HealthCheck checks server health.
func (c *Client) HealthCheck(detailed bool) (*HealthStatus, error) {
	params := map[string]string{}
	if detailed {
		params["detailed"] = "true"
	}

	data, err := c.request("GET", "/health", nil, params)
	if err != nil {
		return nil, err
	}

	var status HealthStatus
	if err := json.Unmarshal(data, &status); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &status, nil
}
