(function (window) {
    'use strict';
    let requestLimit = 3500000;
    const imageCache = new Map();
    async function compactImage(source, budget) {
        if (source.length <= budget) return source;
        const cacheKey = `${budget}:${source}`;
        if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);
        const image = await new Promise((resolve, reject) => {
            const element = new Image(); element.onload = () => resolve(element);
            element.onerror = () => reject(new Error('参考图读取失败，请换成 PNG、JPEG 或 WebP'));
            element.src = source;
        });
        const canvas = document.createElement('canvas');
        let longest = Math.min(2048, Math.max(image.naturalWidth, image.naturalHeight));
        for (let attempt = 0; attempt < 6; attempt++) {
            const scale = Math.min(1, longest / Math.max(image.naturalWidth, image.naturalHeight));
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            const context = canvas.getContext('2d');
            context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const compact = canvas.toDataURL('image/jpeg', Math.max(0.55, 0.88 - attempt * 0.06));
            if (compact.length <= budget) {
                if (imageCache.size >= 10) imageCache.delete(imageCache.keys().next().value);
                imageCache.set(cacheKey, compact); return compact;
            }
            longest = Math.round(longest * 0.8);
        }
        throw new Error('图片过大，请缩小参考图后重试');
    }
    async function request(path, data) {
        if (data && Array.isArray(data.images)) {
            const budget = Math.floor(Math.min(requestLimit * 0.8, 2800000) / data.images.length);
            data = { ...data, images: await Promise.all(data.images.map(image => compactImage(image, budget))) };
            if (new TextEncoder().encode(JSON.stringify(data)).length > requestLimit) throw new Error('内容超过上传限制，请减少参考图或描述长度');
        }
        const response = await fetch(path, {
            method: data ? 'POST' : 'GET',
            headers: data ? { 'Content-Type': 'application/json' } : {},
            body: data ? JSON.stringify(data) : undefined,
            signal: AbortSignal.timeout(600000)
        });
        const result = await response.json().catch(() => { throw new Error(response.status === 413 ? '图片超出上传限制，请减少参考图或压缩后再试' : '服务返回异常，请检查 API 部署与运行日志'); });
        if (response.status === 401 && path !== '/api/session') window.dispatchEvent(new CustomEvent('social-auth-required'));
        if (!response.ok) throw new Error(result.error || `请求失败 (${response.status})`);
        if (path === '/api/config') requestLimit = result.maxRequestBytes || requestLimit;
        return result;
    }
    window.SocialApi = Object.freeze({
        login: (code) => request('/api/session', { code }),
        getConfig: () => request('/api/config'),
        ensureReady: async () => {
            const config = await request('/api/config');
            if (!config.demo && (!config.text.ready || !config.image.ready)) throw new Error('请先在 Vercel 环境变量或本地 .env 配置文本和图片 API 地址、模型与密钥');
            return config;
        },
        generateText: (payload) => request('/api/text', payload),
        generateImage: (payload) => request('/api/images', payload)
    });
})(window);
