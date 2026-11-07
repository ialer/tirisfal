/**
 * 文件下载响应构造（附件 / Send 文件共用）。
 *
 * 安全约束：上传时保存的 MIME 由客户端控制，绝不能原样回写。
 * 统一强制 octet-stream + attachment + sandbox CSP：
 * 即使有人上传 text/html，浏览器也只会下载，不会在本站源内执行。
 */
export interface DownloadObject {
  body: BodyInit | null;
  size: number;
}

export function buildFileDownloadResponse(object: DownloadObject): Response {
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment',
      'Content-Length': String(object.size),
      'Cache-Control': 'private, no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
