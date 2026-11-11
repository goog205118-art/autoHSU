import { setTimeout as delay } from 'node:timers/promises';
import { isReady } from './config.mjs';

export class ApiError extends Error {
  constructor(message, status = 502, options) { super(message, options); this.status = status; }
}

export const RATIOS = new Set(['1:1', '4:5', '9:16', '16:9', '2:3', '3:2']);
export function validateInput(input, image = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError('请求必须是 JSON 对象', 400);
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 60000) throw new ApiError('prompt 不能为空且不能超过 60000 字符', 400);
  if (!Array.isArray(input.images) || input.images.length < 1 || input.images.length > 5) throw new ApiError('请提供 1–5 张商品参考图', 400);
  for (const imageData of input.images) {
    if (typeof imageData !== 'string' || imageData.length > 12 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageData)) {
      throw new ApiError('参考图须为 PNG、JPEG 或 WebP，每张编码后不超过 12 MB', 400);
    }
  }
  if (image && (!RATIOS.has(input.ratio) || !/^\d{3,4}x\d{3,4}$/.test(input.size || ''))) throw new ApiError('图片比例或尺寸无效', 400);
  return input;
}

function endpoint(base, path) {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
function geminiParts(input) {
  return [{ text: input.prompt }, ...input.images.map((url) => {
    const [, mimeType, data] = url.match(/^data:([^;]+);base64,(.+)$/);
    return { inlineData: { mimeType, data } };
  })];
}
function redact(message, key) {
  return key ? String(message).replaceAll(key, '[REDACTED]') : String(message);
}
async function fetchJson(url, options, config, key) {
  let response, body;
  try {
    response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(config.timeout) });
    body = await response.text();
  }
  catch (error) {
    throw new ApiError(error.name === 'TimeoutError' ? '上游 API 请求超时' : '无法连接上游 API，请检查地址与网络', 502, { cause: error });
  }
  let data;
  try { data = JSON.parse(body); }
  catch { throw new ApiError(`上游 API 返回非 JSON 数据 (HTTP ${response.status})`); }
  if (!response.ok) {
    const detail = String(data.error?.message || data.message || '请检查模型、密钥和接口权限').slice(0, 300);
    throw new ApiError(`上游 API 错误 (${response.status}): ${redact(detail, key)}`);
  }
  return data;
}
function jsonPost(data, headers = {}) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) };
}
function requireService(service, label) {
  if (!isReady(service)) throw new ApiError(`${label} API 未配置，请修改 .env 后重启服务`, 503);
}

export function parseCopy(raw) {
  let data = raw;
  if (typeof data === 'string') {
    try { data = JSON.parse(data.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
    catch { throw new ApiError('文本模型未返回有效 JSON，请重试或更换支持 JSON 输出的多模态模型'); }
  }
  if (!data || typeof data.content !== 'string' || !data.content.trim() || typeof data.theme !== 'string' || !data.theme.trim() || !Array.isArray(data.hashtags) || data.hashtags.some((tag) => typeof tag !== 'string')) {
    throw new ApiError('文案结果缺少有效 content、hashtags 或 theme 字段');
  }
  return { content: data.content, hashtags: data.hashtags, theme: data.theme };
}

export async function generateText(input, config) {
  requireService(config.text, '文本');
  const service = config.text;
  let result;
  if (service.provider === 'gemini') {
    const raw = await fetchJson(endpoint(service.baseUrl, `models/${encodeURIComponent(service.model)}:generateContent`), jsonPost({
      contents: [{ role: 'user', parts: geminiParts(input) }],
      generationConfig: { responseMimeType: 'application/json' }
    }, { 'x-goog-api-key': service.key }), config, service.key);
    result = raw.candidates?.[0]?.content?.parts?.filter((part) => part.text && !part.thought).map((part) => part.text).join('');
  } else if (service.provider === 'compatible') {
    const raw = await fetchJson(endpoint(service.baseUrl, 'chat/completions'), jsonPost({
      model: service.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: input.prompt }, ...input.images.map((url) => ({ type: 'image_url', image_url: { url } }))] }],
      response_format: { type: 'json_object' }
    }, { Authorization: `Bearer ${service.key}` }), config, service.key);
    result = raw.choices?.[0]?.message?.content;
  } else throw new ApiError('不支持的文本 API 类型', 503);
  return parseCopy(result);
}

export function extractImage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const parts = raw.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.thought) continue;
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) return `data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`;
  }
  if (raw.data && !Array.isArray(raw.data) && typeof raw.data === 'object') {
    const nested = extractImage(raw.data);
    if (nested) return nested;
  }
  const item = raw.data?.[0] || raw.images?.[0] || raw;
  if (typeof item === 'string') return item;
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  return item.url || item.imageUrl || item.image_url || null;
}
function assertImage(url) {
  if (typeof url !== 'string' || !/^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(url)) throw new ApiError('图片 API 未返回可用图片地址');
  return { url };
}
export function sizeForProvider(size, ratio, mode) {
  if (mode === 'provider') return size;
  const [width, height] = ratio.split(':').map(Number);
  return width === height ? '1024x1024' : width > height ? '1536x1024' : '1024x1536';
}

export async function generateImage(input, config) {
  requireService(config.image, '图片');
  const service = config.image;
  let raw;
  if (service.provider === 'gemini') {
    raw = await fetchJson(endpoint(service.baseUrl, `models/${encodeURIComponent(service.model)}:generateContent`), jsonPost({
      contents: [{ role: 'user', parts: geminiParts(input) }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: input.ratio } }
    }, { 'x-goog-api-key': service.key }), config, service.key);
  } else if (service.provider === 'compatible') {
    const form = new FormData();
    form.set('model', service.model);
    form.set('prompt', input.prompt);
    form.set('n', '1');
    form.set('size', sizeForProvider(input.size, input.ratio, service.sizeMode));
    input.images.forEach((url, index) => {
      const [, mime, b64] = url.match(/^data:([^;]+);base64,(.+)$/);
      form.append('image[]', new Blob([Buffer.from(b64, 'base64')], { type: mime }), `reference-${index + 1}.${mime.split('/')[1]}`);
    });
    raw = await fetchJson(endpoint(service.baseUrl, 'images/edits'), { method: 'POST', headers: { Authorization: `Bearer ${service.key}` }, body: form }, config, service.key);
  } else if (service.provider === 'custom') {
    const deadline = Date.now() + config.pollTimeout;
    raw = await fetchJson(service.submitUrl, jsonPost({ ...input, model: service.model, n: 1 }, { Authorization: `Bearer ${service.key}` }), config, service.key);
    let currentTaskId = '';
    // A failed status always takes precedence over any stale image in the response.
    for (;;) {
      const data = raw.data && !Array.isArray(raw.data) ? raw.data : raw;
      const status = String(data.status || data.state || '').toLowerCase();
      if (['failed', 'error', 'rejected', 'cancelled', 'canceled', 'timeout'].includes(status)) throw new ApiError('图片 API 任务失败，请查看供应商任务记录');
      const image = extractImage(raw);
      if (image) return assertImage(image);
      const taskId = data.taskId || data.task_id || data.id || currentTaskId;
      currentTaskId = taskId;
      if (!taskId || !service.pollUrl.includes('{taskId}')) throw new ApiError('图片 API 未返回图片，或异步任务未配置含 {taskId} 的 IMAGE_POLL_URL');
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new ApiError('图片 API 任务轮询超时');
      await delay(Math.min(config.pollInterval, remaining));
      const pollBudget = deadline - Date.now();
      if (pollBudget <= 0) throw new ApiError('图片 API 任务轮询超时');
      try {
        raw = await fetchJson(service.pollUrl.replaceAll('{taskId}', encodeURIComponent(String(taskId))), { headers: { Authorization: `Bearer ${service.key}` } }, { ...config, timeout: Math.min(config.timeout, pollBudget) }, service.key);
      } catch (error) {
        // A request capped by the task deadline has exhausted the polling budget.
        // Preserve a shorter, independent API timeout and other upstream errors.
        if (pollBudget <= config.timeout && error.cause?.name === 'TimeoutError') throw new ApiError('图片 API 任务轮询超时');
        throw error;
      }
    }
  } else throw new ApiError('不支持的图片 API 类型', 503);
  return assertImage(extractImage(raw));
}
