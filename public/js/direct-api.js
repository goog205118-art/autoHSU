(function (window) {
    'use strict';
    const STORAGE_KEY = 'socialStudio.connection.v1';
    const DEFAULT_BASE = 'https://api.openlux.ai/v1';
    const defaults = Object.freeze({
        base: DEFAULT_BASE, key: '', rememberKey: false,
        imageModel: 'gpt-image-2', quality: 'high', format: 'png', formatField: 'auto',
        textModel: 'gpt-6.1-sol', textProtocol: 'responses', useImageConnection: true,
        textBase: DEFAULT_BASE, textKey: '', timeout: 300
    });
    function parseBase(value) {
        let url;
        try { url = new URL(String(value).trim()); } catch { throw new Error('请输入有效的 API 地址'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址须为 HTTP 或 HTTPS，且不含账号、查询参数或片段');
        return url.href.replace(/\/+$/, '').replace(/\/(?:images\/(?:generations|edits)|responses|chat\/completions|models)$/, '');
    }
    function keyValue(value) {
        const key = String(value || '').trim().replace(/^Bearer\s+/i, '');
        if (key.length > 16000 || /\s/.test(key)) throw new Error('API Key 不能包含空格或换行');
        return key;
    }
    function normalize(value) {
        const c = { ...defaults, ...value };
        c.base = parseBase(c.base); c.textBase = parseBase(c.textBase || DEFAULT_BASE);
        c.key = keyValue(c.key); c.textKey = keyValue(c.textKey);
        c.rememberKey = c.rememberKey === true; c.useImageConnection = c.useImageConnection !== false;
        for (const name of ['imageModel', 'textModel']) {
            c[name] = String(c[name] || '').trim();
            if (!c[name] || c[name].length > 150 || /\s/.test(c[name])) throw new Error('请填写有效的文案与图片模型 ID');
        }
        if (!['responses', 'chat'].includes(c.textProtocol)) throw new Error('请选择文案请求协议');
        if (!['low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(c.quality)) throw new Error('图片质量无效');
        if (!['png', 'jpeg', 'webp'].includes(c.format)) throw new Error('图片格式无效');
        if (!['auto', 'format', 'output_format'].includes(c.formatField)) throw new Error('格式字段无效');
        c.timeout = Number(c.timeout);
        if (!Number.isInteger(c.timeout) || c.timeout < 30 || c.timeout > 1800) throw new Error('请求超时须为 30–1800 秒');
        return Object.fromEntries(Object.keys(defaults).map(name => [name, c[name]]));
    }
    let connection = { ...defaults };
    try {
        const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
        if (saved && typeof saved === 'object') connection = normalize(saved);
    } catch { /* The workspace can open even when browser storage is unavailable. */ }
    function saveConnection(value) {
        const next = normalize(value);
        const saved = { ...next, key: next.rememberKey ? next.key : '', textKey: next.rememberKey ? next.textKey : '' };
        try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); }
        catch { throw new Error('浏览器未能保存连接，请检查站点存储权限后重试'); }
        connection = next; return { ...connection };
    }
    const textConnection = c => c.useImageConnection ? { base: c.base, key: c.key } : { base: c.textBase, key: c.textKey };
    function getConfig() {
        return Promise.resolve({ text: { model: connection.textModel, ready: Boolean(textConnection(connection).key) }, image: { model: connection.imageModel, ready: Boolean(connection.key) } });
    }
    async function ensureReady() {
        if (!connection.key) throw new Error('请在设置中填写图片 API Key');
        if (!textConnection(connection).key) throw new Error('请填写文案 API Key，或复用图片连接');
        return getConfig();
    }
    async function request(url, options, key, timeout) {
        let response, result;
        try {
            response = await fetch(url, { ...options, credentials: 'omit', redirect: 'error', headers: { ...options.headers, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(timeout * 1000) });
            const raw = await response.text();
            try { result = JSON.parse(raw); } catch { throw new Error(`接口返回的内容不是 JSON（HTTP ${response.status}），请检查 API 地址和协议`); }
        } catch (error) {
            if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('请求等待中断，可能已产生用量；请先检查供应商记录，再决定是否重试');
            if (error instanceof TypeError) throw new Error('无法连接 API，请检查地址、网络及服务商的浏览器跨域（CORS）支持；不会自动重发');
            throw error;
        }
        if (!response.ok || result?.error) {
            const detail = String(result?.error?.message || result?.message || '请检查模型、Key 权限和参数').replaceAll(key, '[已隐藏]').slice(0, 300);
            throw new Error(`API 请求失败（HTTP ${response.status}）：${detail}`);
        }
        return result;
    }
    function validateInput(input) {
        if (!input || typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('提示词不能为空');
        if (!Array.isArray(input.images) || input.images.length < 1 || input.images.length > 5) throw new Error('请提供 1–5 张商品参考图');
        for (const image of input.images) if (typeof image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new Error('参考图须为 PNG、JPEG 或 WebP');
    }
    function parseCopy(raw) {
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
            catch { throw new Error('文案模型没有返回有效 JSON，请检查模型或文案协议'); }
        }
        if (!raw || typeof raw.content !== 'string' || !raw.content.trim() || typeof raw.theme !== 'string' || !raw.theme.trim() || !Array.isArray(raw.hashtags) || raw.hashtags.some(tag => typeof tag !== 'string')) throw new Error('文案结果缺少 content、hashtags 或 theme 字段');
        return { content: raw.content, hashtags: raw.hashtags, theme: raw.theme };
    }
    async function generateText(input) {
        validateInput(input);
        const c = { ...connection }, service = textConnection(c);
        if (!service.key) throw new Error('请先配置文案 API Key');
        const responses = c.textProtocol === 'responses';
        const body = responses ? {
            model: c.textModel, store: false, stream: false,
            input: [{ role: 'user', content: [{ type: 'input_text', text: input.prompt }, ...input.images.map(image_url => ({ type: 'input_image', image_url }))] }],
            text: { format: { type: 'json_object' } }
        } : {
            model: c.textModel, stream: false,
            messages: [{ role: 'user', content: [{ type: 'text', text: input.prompt }, ...input.images.map(url => ({ type: 'image_url', image_url: { url } }))] }],
            response_format: { type: 'json_object' }
        };
        const data = await request(service.base + (responses ? '/responses' : '/chat/completions'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, service.key, c.timeout);
        if (responses) {
            if (data.status === 'incomplete' || data.status === 'failed') throw new Error('文案生成未完成，请检查模型输出或供应商记录');
            const output = data.output_text || (data.output || []).filter(item => item.type === 'message').flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('');
            return parseCopy(output);
        }
        const content = data.choices?.[0]?.message?.content;
        return parseCopy(Array.isArray(content) ? content.map(part => part.text || '').join('') : content);
    }
    function imageProfile(id) {
        const core = id.replace(/-(fast|intx|stable)$/, '');
        const v25 = /^gpt-image-2\.5-(flare|sunburst)/.test(core);
        const v2 = !v25 && /^gpt-image-2(?:-|$|\.0)/.test(core);
        return { v25, v2, flexible: v25 || v2 || core === 'chatgpt-image-latest', fidelity: /^gpt-image-1\.5/.test(core) || core === 'gpt-image-1' ? 'high' : /^gpt-image-1-mini/.test(core) ? 'low' : null };
    }
    function imageSize(input, profile) {
        if (!['1:1', '4:5', '9:16', '16:9', '2:3', '3:2'].includes(input.ratio)) throw new Error('图片比例无效');
        const [width, height] = input.ratio.split(':').map(Number);
        if (!profile.flexible) return width === height ? '1024x1024' : width > height ? '1536x1024' : '1024x1536';
        // Every preset meets the reference project's GPT Image size constraints.
        return { '1:1': '1024x1024', '4:5': '1024x1280', '9:16': '720x1280', '16:9': '1280x720', '2:3': '1024x1536', '3:2': '1536x1024' }[input.ratio];
    }
    async function generateImage(input) {
        validateInput(input);
        const c = { ...connection }, profile = imageProfile(c.imageModel);
        if (!c.key) throw new Error('请先配置图片 API Key');
        if (!/^(gpt-image-|chatgpt-image-latest)/.test(c.imageModel)) throw new Error('当前接入支持 GPT Image 模型，请填写供应商实际可用的模型 ID');
        if (input.prompt.length > (profile.v25 ? 1000 : 32000)) throw new Error(profile.v25 ? '此模型提示词上限为 1000 字符，请缩短模板或使用其他模型' : '图片提示词不能超过 32000 字符');
        if (!profile.v25 && ['xhigh', 'max'].includes(c.quality)) throw new Error('当前质量仅适用于 GPT Image 2.5，请选择标准质量档');
        const openlux = ['api.openlux.ai', 'api.openlux.uk'].includes(new URL(c.base).hostname);
        const field = c.formatField === 'auto' ? (openlux && profile.v2 ? 'format' : 'output_format') : c.formatField;
        const params = { model: c.imageModel, prompt: input.prompt, n: '1', size: imageSize(input, profile), quality: c.quality, [field]: c.format };
        if (profile.v2 || profile.v25) params.response_format = 'b64_json';
        if (profile.fidelity) params.input_fidelity = profile.fidelity;
        const form = new FormData();
        for (const [name, value] of Object.entries(params)) form.append(name, value);
        input.images.forEach((source, index) => {
            const [, mime, base64] = source.match(/^data:([^;]+);base64,(.+)$/);
            form.append('image', new Blob([Uint8Array.from(atob(base64), character => character.charCodeAt(0))], { type: mime }), `reference-${index + 1}.${mime.split('/')[1]}`);
        });
        const data = await request(c.base + '/images/edits', { method: 'POST', body: form }, c.key, c.timeout);
        const item = data.data?.[0], mime = ['png', 'jpeg', 'webp'].includes(data.output_format) ? data.output_format : c.format;
        const url = item?.b64_json ? `data:image/${mime};base64,${item.b64_json}` : item?.url;
        if (typeof url !== 'string' || !/^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(url)) throw new Error('图片接口未返回有效的 b64_json 或 URL，请检查模型与参数');
        return { url };
    }
    async function listModels(value = connection) {
        const base = parseBase(value.base), key = keyValue(value.key);
        if (!key) throw new Error('请先填写 API Key');
        const data = await request(base + '/models', { method: 'GET' }, key, 30);
        if (!Array.isArray(data.data)) throw new Error('模型接口没有返回有效列表，可手动填写模型 ID');
        return [...new Set(data.data.map(item => item.id).filter(id => typeof id === 'string' && id.length <= 150))];
    }
    window.SocialApi = Object.freeze({ getConnection: () => ({ ...connection }), saveConnection, getConfig, ensureReady, listModels, generateText, generateImage });
})(window);
