#!/bin/bash
# Tirisfal Secrets Manager API 测试脚本

BASE_URL="http://localhost:8787"
TOKEN=""

echo "=== 1. 测试用户注册 ==="
curl -s -X POST "$BASE_URL/api/accounts/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","name":"Test","password":"Test123456789.","masterPasswordKey":"test","masterPasswordHash":"test"}' | head -200

echo ""
echo "=== 2. 测试用户登录 ==="
LOGIN_RESULT=$(curl -s -X POST "$BASE_URL/identity/connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&username=test@test.com&password=Test123456789.&scope=api offline_access&deviceType=1&deviceIdentifier=test&deviceName=test")
echo "$LOGIN_RESULT" | head -200
TOKEN=$(echo "$LOGIN_RESULT" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

echo ""
echo "=== 3. 测试 Machine Account 创建 ==="
curl -s -X POST "$BASE_URL/api/machine-accounts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-agent","description":"Test Agent"}' | head -200

echo ""
echo "=== 4. 测试 Project 创建 ==="
curl -s -X POST "$BASE_URL/api/projects" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test-Project","description":"Test Project"}' | head -200

echo ""
echo "=== 测试完成 ==="
