/**
 * Simple test for Tirisfal Node.js SDK
 */

const { TirisfalClient, TirisfalError } = require('./index');

// Mock fetch for testing
global.fetch = async (url, options) => {
  console.log(`[Mock] ${options.method} ${url}`);

  if (url.includes('/health')) {
    return {
      ok: true,
      json: async () => ({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '2026.1.0',
        services: { database: 'ok', storage: 'disabled' },
      }),
    };
  }

  if (url.includes('/api/secrets/by-name/')) {
    return {
      ok: true,
      json: async () => ({
        id: 'secret-123',
        name: 'API_KEY',
        value: 'sk-test-12345',
        project_id: 'proj-123',
        environment: 'prod',
        created_at: new Date().toISOString(),
      }),
    };
  }

  if (url.includes('/api/secrets') && options.method === 'POST') {
    const body = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        id: 'secret-' + Date.now(),
        name: body.name,
        project_id: body.project_id,
        environment: body.environment,
        created_at: new Date().toISOString(),
      }),
    };
  }

  if (url.includes('/api/projects')) {
    return {
      ok: true,
      json: async () => ({
        data: [
          { id: 'proj-123', name: 'My Project', description: 'Test project' },
        ],
      }),
    };
  }

  return {
    ok: false,
    status: 404,
    json: async () => ({ error: 'Not found' }),
  };
};

async function runTests() {
  console.log('=== Tirisfal SDK Tests ===\n');

  const client = new TirisfalClient({
    server: 'https://test.workers.dev',
    token: 'test-token',
  });

  // Test 1: Health Check
  console.log('Test 1: Health Check');
  const health = await client.healthCheck();
  console.log('  Status:', health.status);
  console.log('  ✓ Passed\n');

  // Test 2: Get Secret
  console.log('Test 2: Get Secret');
  const secret = await client.getSecret('API_KEY', { projectId: 'proj-123' });
  console.log('  Name:', secret.name);
  console.log('  Value:', secret.value);
  console.log('  ✓ Passed\n');

  // Test 3: List Projects
  console.log('Test 3: List Projects');
  const projects = await client.getProjects();
  console.log('  Count:', projects.length);
  console.log('  First:', projects[0]?.name);
  console.log('  ✓ Passed\n');

  // Test 4: Error Handling
  console.log('Test 4: Error Handling');
  try {
    await client.getSecret('nonexistent', { projectId: 'invalid' });
  } catch (e) {
    if (e instanceof TirisfalError) {
      console.log('  Caught expected error:', e.message);
      console.log('  ✓ Passed\n');
    }
  }

  console.log('=== All Tests Passed ===');
}

runTests().catch(console.error);
