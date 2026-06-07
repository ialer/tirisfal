// Secrets Manager Service 单元测试

import { SecretsManagerService } from './src/services/sm-service';

// Mock D1Database
const mockDb = {
  prepare: (sql: string) => ({
    bind: (...args: any[]) => ({
      run: async () => ({ meta: { changes: 1 } }),
      first: async () => null,
      all: async () => ({ results: [] }),
    }),
  }),
} as any;

async function testCreateMachineAccount() {
  console.log('测试: 创建 Machine Account');
  const service = new SecretsManagerService(mockDb);
  
  try {
    const result = await service.createMachineAccount('user-1', {
      name: 'test-agent',
      description: 'Test Agent',
    });
    console.log('✅ 创建成功:', result);
  } catch (error) {
    console.log('❌ 创建失败:', error);
  }
}

async function testCreateProject() {
  console.log('测试: 创建 Project');
  const service = new SecretsManagerService(mockDb);
  
  try {
    const result = await service.createProject('user-1', {
      name: 'Test-Project',
      description: 'Test Project',
    });
    console.log('✅ 创建成功:', result);
  } catch (error) {
    console.log('❌ 创建失败:', error);
  }
}

async function testCreateSecret() {
  console.log('测试: 创建 Secret');
  const service = new SecretsManagerService(mockDb);
  
  try {
    const result = await service.createSecret('user-1', {
      name: 'XIAOMI_API_KEY',
      value: 'sk-test-123',
      project_id: 'project-1',
      environment: 'prod',
    });
    console.log('✅ 创建成功:', result);
  } catch (error) {
    console.log('❌ 创建失败:', error);
  }
}

async function runTests() {
  console.log('=== Secrets Manager 单元测试 ===\n');
  
  await testCreateMachineAccount();
  await testCreateProject();
  await testCreateSecret();
  
  console.log('\n=== 测试完成 ===');
}

runTests().catch(console.error);
