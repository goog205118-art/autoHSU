import { createHash, createHmac, timingSafeEqual, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { ApiError } from './providers.mjs';

function equal(a, b) {
  const left = createHash('sha256').update(String(a)).digest();
  const right = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(left, right);
}
export function createSecurity(config) {
  const secret = config.accessCode || config.image.key || randomBytes(32).toString('hex');
  const key = createHash('sha256').update(`social-studio:${secret}`).digest();
  const requiresAuth = Boolean(config.accessCode) || (config.cloud && !config.demo);
  const configured = !requiresAuth || config.accessCode.length >= 12;
  const sign = (value) => createHmac('sha256', key).update(value).digest('base64url');
  function isAuthenticated(request) {
    if (!requiresAuth) return true;
    if (!configured) return false;
    const cookie = String(request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('social_session='));
    const [expires, signature] = (cookie?.slice('social_session='.length) || '').split('.');
    return Boolean(signature && Number(expires) > Date.now() && Number(expires) <= Date.now() + 13 * 3600000 && equal(sign(expires), signature));
  }
  function login(code) {
    if (!configured) throw new ApiError('请在 Vercel 环境变量设置至少 12 位的 APP_ACCESS_CODE 后重新部署', 503);
    if (!config.accessCode || !equal(code, config.accessCode)) throw new ApiError('访问口令不正确', 401);
    const expires = String(Date.now() + 12 * 3600000);
    return `social_session=${expires}.${sign(expires)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=43200${config.cloud ? '; Secure' : ''}`;
  }
  function requireAuth(request) {
    if (!configured) throw new ApiError('请配置至少 12 位的 APP_ACCESS_CODE 后重新部署', 503);
    if (!isAuthenticated(request)) throw new ApiError('请先输入工作台访问口令', 401);
  }
  function sealAsset(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ url: value, expires: Date.now() + 4 * 3600000 }), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  }
  function openAsset(token) {
    try {
      if (token.length > 16000) throw Error('token');
      const data = Buffer.from(token, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      const asset = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'));
      if (asset.expires < Date.now() || !/^https?:\/\//.test(asset.url)) throw Error('expired');
      return asset.url;
    } catch { throw new ApiError('图片链接无效或已过期，请使用已导出的文件', 404); }
  }
  return { requiresAuth, configured, isAuthenticated, login, requireAuth, sealAsset, openAsset };
}
