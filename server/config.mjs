import fs from 'node:fs';

export function loadEnv(file, env = process.env) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[match[1]] = value;
  }
}

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function readConfig(env = process.env, demoFlag = false) {
  const provider = (prefix) => ({
    provider: env[`${prefix}_PROVIDER`] || 'gemini',
    baseUrl: env[`${prefix}_API_BASE_URL`] || 'https://generativelanguage.googleapis.com/v1beta',
    key: env[`${prefix}_API_KEY`] || '',
    model: env[`${prefix}_MODEL`] || ''
  });
  return {
    cloud: env.VERCEL === '1',
    accessCode: env.APP_ACCESS_CODE || '',
    port: integer(env.PORT, 8787, 1, 65535),
    demo: demoFlag || env.DEMO_MODE === 'true',
    text: provider('TEXT'),
    image: { ...provider('IMAGE'), sizeMode: env.IMAGE_SIZE_MODE || 'standard', submitUrl: env.IMAGE_SUBMIT_URL || '', pollUrl: env.IMAGE_POLL_URL || '' },
    timeout: integer(env.API_TIMEOUT_MS, 180000, 1, env.VERCEL === '1' ? 240000 : 600000),
    pollInterval: integer(env.POLL_INTERVAL_MS, 3000, 1, 60000),
    pollTimeout: integer(env.POLL_TIMEOUT_MS, env.VERCEL === '1' ? 240000 : 300000, 1, env.VERCEL === '1' ? 240000 : 600000)
  };
}

export function isReady(service) {
  if (!service.key || !service.model) return false;
  if (service.provider === 'custom') return Boolean(service.submitUrl);
  return ['gemini', 'compatible'].includes(service.provider) && Boolean(service.baseUrl);
}

export function publicConfig(config) {
  const summarize = (service) => ({ provider: service.provider, model: service.model, ready: isReady(service) });
  return { demo: config.demo, cloud: config.cloud, maxRequestBytes: config.cloud ? 3500000 : 40 * 1024 * 1024, text: summarize(config.text), image: summarize(config.image) };
}
