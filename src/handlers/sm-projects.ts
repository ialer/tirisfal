// Projects API Handlers

import { Env } from '../types';
import { SecretsManagerService } from '../services/sm-service';
import { jsonResponse, errorResponse } from '../utils/response';

export async function handleProjects(
  request: Request,
  env: Env,
  path: string,
  method: string,
  userId: string
): Promise<Response> {
  const smService = new SecretsManagerService(env.DB);

  // POST /api/projects - 创建项目
  if (method === 'POST' && path === '/api/projects') {
    const body = await request.json() as { name: string; description?: string };
    
    if (!body.name) {
      return errorResponse('Name is required', 400);
    }

    const project = await smService.createProject(userId, {
      name: body.name,
      description: body.description,
    });

    return jsonResponse(project, 201);
  }

  // GET /api/projects - 列出所有项目
  if (method === 'GET' && path === '/api/projects') {
    const projects = await smService.getProjectsByUserId(userId);
    return jsonResponse({ data: projects });
  }

  // 匹配 /api/projects/:id
  const projectMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)$/);
  if (projectMatch) {
    const projectId = projectMatch[1];

    // GET /api/projects/:id
    if (method === 'GET') {
      const project = await smService.getProject(projectId);
      if (!project || project.user_id !== userId) {
        return errorResponse('Not found', 404);
      }
      return jsonResponse(project);
    }

    // DELETE /api/projects/:id
    if (method === 'DELETE') {
      const project = await smService.getProject(projectId);
      if (!project || project.user_id !== userId) {
        return errorResponse('Not found', 404);
      }

      await smService.deleteProject(projectId);
      return jsonResponse({ success: true });
    }
  }

  return errorResponse('Not found', 404);
}
