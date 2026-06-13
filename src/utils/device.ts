const DEFAULT_DEVICE_NAME = '未知设备';
const DEFAULT_DEVICE_TYPE = 14;

/**
 * 将 Base64 URL 编码的字符串解码为 UTF-8 文本
 */
function decodeBase64UrlUtf8(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4;
    const padded = padding === 0 ? normalized : normalized + '='.repeat(4 - padding);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 标准化设备标识符，去除空白并限制长度
 */
function normalizeDeviceIdentifier(value: string | undefined | null): string | null {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, 128);
}

/**
 * 标准化设备名称，空白则返回默认名称
 */
function normalizeDeviceName(value: string | undefined | null): string {
  const normalized = String(value || '').trim();
  if (!normalized) return DEFAULT_DEVICE_NAME;
  return normalized.slice(0, 128);
}

/**
 * 解析设备类型，无效值返回默认类型
 */
function parseDeviceType(value: string | number | undefined | null): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  const parsed = Number.parseInt(String(value || ''), 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return DEFAULT_DEVICE_TYPE;
}

/** 设备信息接口 */
export interface AuthRequestDeviceInfo {
  deviceIdentifier: string | null;
  deviceName: string;
  deviceType: number;
}

/**
 * 从请求体和请求头中读取设备信息
 * @param body - 请求体
 * @param request - HTTP 请求对象
 * @returns 标准化后的设备信息
 */
export function readAuthRequestDeviceInfo(
  body: Record<string, string | undefined>,
  request: Request
): AuthRequestDeviceInfo {
  const bodyIdentifier = body.deviceIdentifier || body.device_identifier;
  const headerIdentifier = request.headers.get('X-Device-Identifier') || undefined;
  const bodyName = body.deviceName || body.device_name;
  const headerName = request.headers.get('X-Device-Name') || undefined;
  const bodyType = body.deviceType || body.device_type;
  const headerType = request.headers.get('Device-Type') || undefined;

  return {
    deviceIdentifier: normalizeDeviceIdentifier(bodyIdentifier || headerIdentifier),
    deviceName: normalizeDeviceName(bodyName || headerName),
    deviceType: parseDeviceType(bodyType || headerType),
  };
}

/**
 * 读取已知设备探测信息（邮箱和设备标识符）
 */
export function readKnownDeviceProbe(request: Request): {
  email: string | null;
  deviceIdentifier: string | null;
} {
  const encodedEmail = request.headers.get('X-Request-Email') || '';
  const decodedEmail = decodeBase64UrlUtf8(encodedEmail);
  const fallbackRawEmail = request.headers.get('X-Request-Email');
  const email = (decodedEmail || fallbackRawEmail || '').trim().toLowerCase() || null;
  const deviceIdentifier = normalizeDeviceIdentifier(request.headers.get('X-Device-Identifier'));
  return { email, deviceIdentifier };
}

/**
 * 读取当前操作设备的标识符
 */
export function readActingDeviceIdentifier(request: Request): string | null {
  return normalizeDeviceIdentifier(request.headers.get('X-Tirisfal-Acting-Device-Id'));
}
