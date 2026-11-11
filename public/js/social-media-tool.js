(function (window, document) {
    'use strict';

    const HIDDEN_JSON_SCHEMA_PROMPT = `
\n\n=== 强制输出规则 (CRITICAL) ===
You MUST return ONLY a valid JSON object. Do NOT include any markdown wrappers (like \`\`\`json).
The JSON object must strictly match this schema:
{
  "content": "The main social media post text.",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "theme": "A short English visual theme distilled from the post."
}
Do NOT generate image prompts. The frontend will combine 'theme' with user-selected image templates.`;

    const MAX_IMAGES = 5;
    const MAX_GENERATED_IMAGES = 5;
    const SETTINGS_KEY = 'veoSocialStandaloneSettings.v1';
    const DEFAULT_WORKSPACE_COUNT = 1;
    const DEFAULT_IMAGE_RATIO = '1:1';
    const DEFAULT_IMAGE_COUNT = 3;

    const SOCIAL_IMAGE_RATIOS = Object.freeze([
        { value: '1:1', label: '1:1 正方形 / Instagram Feed', size: '1024x1024' },
        { value: '4:5', label: '4:5 竖版 Feed / Instagram', size: '1024x1280' },
        { value: '9:16', label: '9:16 Story / Reels / TikTok', size: '720x1280' },
        { value: '16:9', label: '16:9 横版 / YouTube / Facebook', size: '1280x720' },
        { value: '2:3', label: '2:3 Pinterest Pin', size: '1024x1536' },
        { value: '3:2', label: '3:2 横版商品图', size: '1536x1024' }
    ]);

    const FRONTEND_DYNAMIC_PROMPT_TEMPLATE = `商品描述: {{productDesc || "无"}}
节日/场景: {{contextDesc || "常规发贴"}}
贴文引导链接: {{guidanceLink || "无"}}

请根据提供的图片和上述信息，只生成社媒文案、标签和视觉主题，不生成完整生图提示词。`;

    const DEFAULT_PROMPT_TEMPLATES = Object.freeze([
        {
            id: 'poster-premium',
            type: 'poster',
            name: '高级主视觉海报',
            body: 'Create a premium social media poster-style product visual for "{{theme}}". Use the uploaded product as the hero subject, clean editorial composition, polished commercial lighting, subtle brand campaign feeling, clear focal hierarchy, no readable text unless naturally part of the product, suitable for {{ratio}} social media output. Context: {{context}}. Post copy direction: {{copy}}'
        },
        {
            id: 'poster-promo',
            type: 'poster',
            name: '促销氛围海报',
            body: 'Create a high-converting promotional poster visual for "{{theme}}". Feature the uploaded product prominently with energetic seasonal styling, premium ecommerce campaign composition, vivid but tasteful color contrast, no fake logos, no distorted text, suitable for {{ratio}}. Landing link context: {{link}}. Product notes: {{product}}'
        },
        {
            id: 'scene-lifestyle',
            type: 'scene',
            name: '生活方式场景',
            body: 'Create a photorealistic lifestyle scene inspired by "{{theme}}". Show the uploaded product naturally in use, authentic human-scale environment, warm believable lighting, social-media-ready composition, premium but not overly staged, suitable for {{ratio}}. Scene context: {{context}}. Product notes: {{product}}'
        },
        {
            id: 'scene-detail',
            type: 'scene',
            name: '质感细节场景',
            body: 'Create a close-up product detail scene for "{{theme}}". Emphasize material, texture, craftsmanship, clean background depth, tactile lighting, realistic shadows and reflections, product remains accurate to the uploaded references, suitable for {{ratio}}. Post direction: {{copy}}'
        }
    ]);

    const defaultSettings = {
        microCropEnabled: false,
        systemPrompt: '你是一位资深的欧美社媒营销专家。请根据用户提供的商品图片、描述以及使用场景/节日，撰写极具吸引力的社媒贴文（如 Instagram, Facebook 风格）。贴文需包含引人入胜的标题、正文、行动呼吁（CTA），语言为符合欧美本土习惯的英语。同时生成3-5个高流量的 Hashtag，并提炼一个简短英文视觉主题 theme。不要生成完整生图提示词，生图提示词由前端模板系统负责。',
        promptTemplates: DEFAULT_PROMPT_TEMPLATES.map((item) => ({ ...item }))
    };

    let settings = { ...defaultSettings };
    let workspaces = [];
    let activeWorkspaceId = '';
    let initialized = false;
    let toastTimer = null;

    const $ = (selector) => document.querySelector(selector);
    const byId = (id) => document.getElementById(id);

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function safeJsonParse(text, fallback = null) {
        try {
            return JSON.parse(text);
        } catch (err) {
            return fallback;
        }
    }

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function createWorkspace() {
        const id = `social_ws_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        return {
            id,
            name: `W${workspaces.length + 1}`,
            uploadedImages: [],
            productDesc: '',
            contextDesc: '',
            guidanceLink: '',
            imageRatio: DEFAULT_IMAGE_RATIO,
            imageCount: DEFAULT_IMAGE_COUNT,
            imageRatios: [DEFAULT_IMAGE_RATIO, DEFAULT_IMAGE_RATIO, DEFAULT_IMAGE_RATIO],
            templateSelections: ['poster-premium', 'scene-lifestyle', 'scene-detail'],
            textResult: null,
            imagePrompts: [],
            imageResults: [],
            logs: ['运行日志'],
            progress: { percent: 0, label: '待开始' },
            isLoading: false,
            generationToken: 0
        };
    }

    function ensureWorkspaces() {
        while (workspaces.length < DEFAULT_WORKSPACE_COUNT) {
            workspaces.push(createWorkspace());
        }
        if (!activeWorkspaceId || !getWorkspace(activeWorkspaceId)) {
            activeWorkspaceId = workspaces[0].id;
        }
    }

    function getWorkspace(id) {
        return workspaces.find((workspace) => workspace.id === id) || null;
    }

    function getActiveWorkspace() {
        ensureWorkspaces();
        return getWorkspace(activeWorkspaceId) || workspaces[0];
    }

    function saveActiveForm() {
        const workspace = getActiveWorkspace();
        if (!workspace) return;
        const productDesc = byId('social-tool-product-desc');
        const contextDesc = byId('social-tool-context-desc');
        const guidanceLink = byId('social-tool-guidance-link');
        const imageCount = byId('social-tool-image-count');
        if (productDesc) workspace.productDesc = productDesc.value;
        if (contextDesc) workspace.contextDesc = contextDesc.value;
        if (guidanceLink) workspace.guidanceLink = guidanceLink.value;
        if (imageCount) workspace.imageCount = clampImageCount(imageCount.value);
        const slotSelects = Array.from(document.querySelectorAll('[data-social-template-slot]'));
        if (slotSelects.length) {
            workspace.templateSelections = slotSelects.map((select, index) => select.value || getDefaultTemplateId(index));
        }
        const ratioSelects = Array.from(document.querySelectorAll('[data-social-ratio-slot]'));
        if (ratioSelects.length) {
            workspace.imageRatios = ratioSelects.map((select, index) => normalizeImageRatio(select.value || getWorkspaceRatio(workspace, index)));
            workspace.imageRatio = workspace.imageRatios[0] || workspace.imageRatio || DEFAULT_IMAGE_RATIO;
        }
    }

    function restoreActiveForm() {
        const workspace = getActiveWorkspace();
        const productDesc = byId('social-tool-product-desc');
        const contextDesc = byId('social-tool-context-desc');
        const guidanceLink = byId('social-tool-guidance-link');
        const imageCount = byId('social-tool-image-count');
        if (productDesc) productDesc.value = workspace.productDesc || '';
        if (contextDesc) contextDesc.value = workspace.contextDesc || '';
        if (guidanceLink) guidanceLink.value = workspace.guidanceLink || '';
        if (imageCount) imageCount.value = String(clampImageCount(workspace.imageCount));
        renderTemplateSlots(workspace);
    }

    function getWorkspaceStatus(workspace) {
        if (workspace.isLoading) return 'running';
        if (workspace.imageResults.some((item) => item && item.status === 'failed')) return 'failed';
        if (workspace.textResult || workspace.imageResults.some((item) => item && item.status === 'success')) return 'done';
        return 'idle';
    }

    function getTemplateTypeLabel(type) {
        return type === 'poster' ? '海报' : '场景';
    }

    function normalizePromptTemplates(templates) {
        const source = Array.isArray(templates) && templates.length ? templates : DEFAULT_PROMPT_TEMPLATES;
        const seen = new Set();
        const normalized = [];
        source.forEach((item) => {
            if (!item || typeof item !== 'object') return;
            const type = item.type === 'poster' ? 'poster' : 'scene';
            const body = String(item.body || '').trim();
            if (!body) return;
            const id = String(item.id || `${type}_${Date.now()}_${normalized.length}`).trim();
            if (!id || seen.has(id)) return;
            seen.add(id);
            normalized.push({
                id,
                type,
                name: String(item.name || getTemplateTypeLabel(type)).trim() || getTemplateTypeLabel(type),
                body
            });
        });
        return normalized.length ? normalized : DEFAULT_PROMPT_TEMPLATES.map((item) => ({ ...item }));
    }

    function getPromptTemplates() {
        settings.promptTemplates = normalizePromptTemplates(settings.promptTemplates);
        return settings.promptTemplates;
    }

    function getTemplateById(templateId) {
        return getPromptTemplates().find((item) => item.id === templateId) || getPromptTemplates()[0];
    }

    function getDefaultTemplateId(index) {
        const defaults = ['poster-premium', 'scene-lifestyle', 'scene-detail', 'poster-promo', 'scene-lifestyle'];
        const template = getTemplateById(defaults[index]);
        return template ? template.id : getPromptTemplates()[0].id;
    }

    function clampImageCount(value) {
        const parsed = parseInt(value, 10);
        if (!Number.isFinite(parsed)) return DEFAULT_IMAGE_COUNT;
        return Math.min(MAX_GENERATED_IMAGES, Math.max(1, parsed));
    }

    function normalizeImageRatio(value) {
        const ratio = String(value || '').trim();
        return SOCIAL_IMAGE_RATIOS.some((item) => item.value === ratio) ? ratio : DEFAULT_IMAGE_RATIO;
    }

    function ensureWorkspaceImageRatios(workspace) {
        if (!workspace) return [];
        const imageCount = clampImageCount(workspace.imageCount);
        const existing = Array.isArray(workspace.imageRatios) ? workspace.imageRatios : [];
        workspace.imageRatios = Array.from({ length: imageCount }, (_, index) => (
            normalizeImageRatio(existing[index] || workspace.imageRatio || DEFAULT_IMAGE_RATIO)
        ));
        workspace.imageRatio = workspace.imageRatios[0] || workspace.imageRatio || DEFAULT_IMAGE_RATIO;
        return workspace.imageRatios;
    }

    function getWorkspaceRatio(workspace, index) {
        const ratios = ensureWorkspaceImageRatios(workspace);
        return normalizeImageRatio(ratios[index] || workspace.imageRatio || DEFAULT_IMAGE_RATIO);
    }

    function createTemplateId(type, name) {
        const slug = String(name || type || 'template')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 28) || 'template';
        return `${type || 'scene'}-${slug}-${Date.now().toString(36)}`;
    }

    function fillTemplate(template, context) {
        const values = {
            theme: context.theme,
            copy: context.copy,
            hashtags: context.hashtags,
            product: context.product,
            context: context.context,
            link: context.link,
            ratio: context.ratio,
            size: context.size,
            slot: context.slot,
            templateName: template.name,
            templateType: getTemplateTypeLabel(template.type)
        };
        return String(template.body || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
            return values[key] !== undefined && values[key] !== null ? String(values[key]) : '';
        }).trim();
    }

    function extractTheme(textResult, workspace) {
        if (textResult && textResult.theme) return String(textResult.theme).trim();
        const content = textResult && textResult.content ? String(textResult.content).trim() : '';
        const sentence = content.split(/[.!?\n。！？]/).map((item) => item.trim()).find(Boolean);
        return sentence || workspace.contextDesc || workspace.productDesc || 'premium social media product campaign';
    }

    function buildImagePlans(textResult, workspace) {
        const imageCount = clampImageCount(workspace.imageCount);
        ensureWorkspaceImageRatios(workspace);
        const theme = extractTheme(textResult, workspace);
        const copy = textResult && textResult.content ? String(textResult.content) : '';
        const hashtags = textResult && Array.isArray(textResult.hashtags) ? textResult.hashtags.join(' ') : '';
        return Array.from({ length: imageCount }, (_, index) => {
            const template = getTemplateById(workspace.templateSelections[index] || getDefaultTemplateId(index));
            const selectedRatio = getWorkspaceRatio(workspace, index);
            const selectedSize = resolveSocialImageSize(selectedRatio);
            const prompt = fillTemplate(template, {
                theme,
                copy,
                hashtags,
                product: workspace.productDesc || '无',
                context: workspace.contextDesc || '常规发贴',
                link: workspace.guidanceLink || '无',
                ratio: selectedRatio,
                size: selectedSize,
                slot: index + 1
            });
            return {
                index,
                prompt,
                templateId: template.id,
                templateName: template.name,
                templateType: template.type,
                ratio: selectedRatio,
                size: selectedSize
            };
        });
    }

    function getSocialRatioConfig(ratio) {
        return SOCIAL_IMAGE_RATIOS.find((item) => item.value === ratio) || SOCIAL_IMAGE_RATIOS[0];
    }

    function resolveSocialImageSize(ratio) {
        const config = getSocialRatioConfig(ratio);
        return config.size;
    }

    function getAspectRatioStyle(ratio) {
        const config = getSocialRatioConfig(ratio);
        const parts = String(config.value || DEFAULT_IMAGE_RATIO).split(':').map((part) => parseInt(part, 10));
        if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part) || part <= 0)) return '1 / 1';
        return `${parts[0]} / ${parts[1]}`;
    }

    function normalizeHashtags(tags) {
        return Array.isArray(tags)
            ? tags.map((tag) => String(tag || '').trim()).filter(Boolean).map((tag) => tag.startsWith('#') ? tag : `#${tag}`)
            : [];
    }

    function formatDateFolderName(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function sanitizeFilename(value, fallback = 'file') {
        const cleaned = String(value || '')
            .replace(/[\\/:*?"<>|]+/g, '-')
            .replace(/\s+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 72);
        return cleaned || fallback;
    }

    function getImageFileExtension(url, blob) {
        const type = blob && blob.type ? blob.type.toLowerCase() : '';
        if (type.includes('svg')) return 'svg';
        if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
        if (type.includes('webp')) return 'webp';
        if (type.includes('gif')) return 'gif';
        if (type.includes('png')) return 'png';
        const match = String(url || '').split('?')[0].match(/\.([a-z0-9]{3,5})$/i);
        return match ? match[1].toLowerCase() : 'png';
    }

    async function writeFileToDirectory(directoryHandle, filename, data) {
        const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(data);
        await writable.close();
    }

    function buildExportCopyText(workspace) {
        const result = workspace && workspace.textResult ? workspace.textResult : null;
        const copy = result && result.content ? String(result.content).trim() : '';
        const hashtags = normalizeHashtags(result && result.hashtags).join(' ');
        const lines = [];
        if (copy) lines.push(copy);
        if (hashtags) lines.push('', hashtags);
        if (workspace && workspace.guidanceLink) lines.push('', `Link: ${workspace.guidanceLink}`);
        if (workspace && workspace.productDesc) lines.push('', `Product: ${workspace.productDesc}`);
        if (workspace && workspace.contextDesc) lines.push(`Context: ${workspace.contextDesc}`);
        return lines.join('\n').trim();
    }

    function getPreviewHostname(url) {
        const value = String(url || '').trim();
        if (!value) return '';
        try {
            return new URL(value).hostname.replace(/^www\./i, '');
        } catch (err) {
            return value.replace(/^https?:\/\//i, '').split('/')[0];
        }
    }

    function getPreviewImage(workspace) {
        const successful = workspace && Array.isArray(workspace.imageResults)
            ? workspace.imageResults.find((item) => item && item.status === 'success' && item.url)
            : null;
        return successful && successful.url ? successful.url : '';
    }

    function buildDynamicPrompt(productDesc, contextDesc, guidanceLink) {
        return `商品描述: ${productDesc || '无'}
节日/场景: ${contextDesc || '常规发贴'}
贴文引导链接: ${guidanceLink || '无'}

请根据提供的图片和上述信息，执行任务。`;
    }

    function shouldApplyMicroCrop() {
        return settings.microCropEnabled !== false;
    }

    async function createDrawableImageSource(url) {
        const value = String(url || '').trim();
        if (!/^https?:\/\//i.test(value)) {
            return { url: value, revoke: null, crossOrigin: false };
        }
        try {
            const response = await fetch(value, { mode: 'cors', credentials: 'omit' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            return {
                url: objectUrl,
                revoke: () => URL.revokeObjectURL(objectUrl),
                crossOrigin: false
            };
        } catch (error) {
            return { url: value, revoke: null, crossOrigin: true };
        }
    }

    function loadCanvasImage(source) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            if (source.crossOrigin) img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('图片读取失败或远程地址不允许前端处理'));
            img.src = source.url;
        });
    }

    async function microCropImageUrl(url, index = 0) {
        if (!url || !window.HTMLCanvasElement) return url;
        const source = await createDrawableImageSource(url);
        try {
            const img = await loadCanvasImage(source);
            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;
            if (!width || !height || width < 64 || height < 64) return url;

            const variance = Math.random() * 0.003;
            const horizontalRatio = 0.0025 + variance + ((index % 3) * 0.00035);
            const verticalRatio = 0.0025 + (Math.random() * 0.0025) + ((index % 2) * 0.0003);
            const cropX = Math.max(1, Math.min(Math.floor(width * horizontalRatio), Math.floor((width - 2) / 2)));
            const cropY = Math.max(1, Math.min(Math.floor(height * verticalRatio), Math.floor((height - 2) / 2)));
            if (cropX <= 0 || cropY <= 0 || width - cropX * 2 <= 0 || height - cropY * 2 <= 0) return url;

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return url;
            ctx.drawImage(img, cropX, cropY, width - cropX * 2, height - cropY * 2, 0, 0, width, height);
            return canvas.toDataURL('image/png');
        } finally {
            if (source.revoke) source.revoke();
        }
    }

    async function postProcessGeneratedImage(rawUrl, index, workspaceId) {
        if (!shouldApplyMicroCrop()) {
            return { url: rawUrl, originalUrl: '', postProcessed: false };
        }
        try {
            const processedUrl = await microCropImageUrl(rawUrl, index);
            const postProcessed = Boolean(processedUrl && processedUrl !== rawUrl);
            if (postProcessed) {
                logDebug(`第 ${index + 1} 张图片已完成静默微裁切。`, workspaceId);
            }
            return {
                url: processedUrl || rawUrl,
                originalUrl: postProcessed ? rawUrl : '',
                postProcessed
            };
        } catch (error) {
            const message = error && error.message ? error.message : String(error || '未知错误');
            logDebug(`第 ${index + 1} 张图片微裁切跳过: ${escapeHtml(message)}`, workspaceId);
            return { url: rawUrl, originalUrl: '', postProcessed: false };
        }
    }

    function bindGeneratedImageDrag(img, result, index) {
        if (!img || !result || !result.url) return;
        img.addEventListener('dragstart', (event) => {
            if (!event.dataTransfer) return;
            const filename = `social-image-${String(index + 1).padStart(2, '0')}.png`;
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData('text/plain', result.url);
            event.dataTransfer.setData('text/uri-list', result.url);
            event.dataTransfer.setData('DownloadURL', `image/png:${filename}:${result.url}`);
            event.dataTransfer.setData('application/json', JSON.stringify({
                type: 'social_image',
                index,
                url: result.url,
                originalUrl: result.originalUrl || '',
                postProcessed: Boolean(result.postProcessed)
            }));
        });
    }

    function ensureShell() {
        if (byId('social-tool-workspace')) return;
        const modal = document.createElement('main');
        modal.id = 'social-tool-workspace';
        modal.className = 'social-tool-workspace';
        modal.setAttribute('aria-label', '社媒内容工作台');
        modal.innerHTML = `
            <div class="social-tool-shell">
                <div class="social-tool-head">
                    <div class="social-tool-title">
                        <h1><span class="studio-mark" aria-hidden="true">S</span> 社媒工作室<span class="studio-subtitle">内容工作台</span></h1>
                        <p>让产品有故事，让灵感成作品。</p>
                    </div>
                    <div class="social-tool-head-actions"><span class="connection-status" id="studio-connection-status" role="status">未连接 API</span>
                        <button class="top-btn" id="social-tool-export-btn" type="button" title="导出当前社媒内容" aria-label="导出当前社媒内容">
                            <span class="material-symbols-outlined">drive_folder_upload</span><span>导出</span>
                        </button>
                        <button class="top-btn" id="social-tool-settings-btn" type="button" title="API 与模板设置" aria-label="API 与模板设置" aria-expanded="false" aria-controls="social-tool-settings">
                            <span class="material-symbols-outlined">tune</span><span>设置</span>
                        </button>
                    </div>
                </div>
                <nav class="social-tool-workspaces" aria-label="工作区"><span class="workspace-label">工作区</span>
                        <div class="social-tool-workspace-list" id="social-tool-workspace-list"></div>
                        <button class="social-tool-workspace-add" id="social-tool-workspace-add" type="button" title="新增工作区">
                            <span class="material-symbols-outlined" style="font-size:19px;">add</span>
                        </button>
                    <span class="workspace-note">刷新会清空作品，请及时导出</span></nav>
                <div class="social-tool-body">
                    <section class="social-tool-grid studio-compose" aria-label="创作设置">
                        <div class="column-heading"><div><h2>开始创作</h2><p>准备素材，定义这一次的表达。</p></div><span class="material-symbols-outlined">edit_note</span></div>
                        <div class="social-tool-panel">
                            <h3><span class="material-symbols-outlined">image</span> 产品图片</h3>
                            <div class="social-tool-gallery" id="social-tool-gallery">
                                <label class="social-tool-upload" id="social-tool-upload" tabindex="0" title="点击上传、拖入图片，或鼠标悬停后 Ctrl+V 粘贴剪切板图片">
                                    <span class="material-symbols-outlined">add_photo_alternate</span>
                                    <span>上传产品图片</span>
                                    <small>点击、拖入或粘贴图片</small>
                                    <input id="social-tool-image-input" type="file" accept="image/png,image/jpeg,image/webp" multiple>
                                </label>
                            </div>
                            <p class="social-tool-muted" style="margin-top:10px;">最多 5 张 · PNG、JPG、WebP。用于识别产品和生成配图。</p>
                        </div>
                        <div class="social-tool-panel">
                            <h3><span class="material-symbols-outlined">edit_note</span> 内容需求</h3>
                            <div class="social-tool-field">
                                <label for="social-tool-product-desc">商品描述</label>
                                <textarea class="social-tool-textarea" id="social-tool-product-desc" placeholder="例如：环保材质便携咖啡杯，保温12小时，适合户外和通勤..."></textarea>
                            </div>
                            <div class="social-tool-field">
                                <label for="social-tool-context-desc">活动/场景说明</label>
                                <input class="social-tool-input" id="social-tool-context-desc" type="text" placeholder="例如：圣诞节促销，强调温馨和送礼属性">
                            </div>
                            <div class="social-tool-field">
                                <label for="social-tool-guidance-link">贴文引导链接</label>
                                <input class="social-tool-input" id="social-tool-guidance-link" type="url" placeholder="https://... 可选，用作贴文 CTA 或活动落点">
                            </div>
                            <div class="social-tool-field">
                                <label for="social-tool-image-count">生图张数</label>
                                <select class="social-tool-select" id="social-tool-image-count">
                                    ${Array.from({ length: MAX_GENERATED_IMAGES }, (_, index) => `<option value="${index + 1}" ${index + 1 === DEFAULT_IMAGE_COUNT ? 'selected' : ''}>${index + 1} 张</option>`).join('')}
                                </select>
                            </div>
                            <div class="social-tool-field">
                                <label>每张图的提示词模板 / 配图比例</label>
                                <div class="social-tool-template-slots" id="social-tool-template-slots"></div>
                            </div>
                            <button class="top-btn top-btn-primary social-tool-main-btn" id="social-tool-generate-btn" type="button">
                                <span class="material-symbols-outlined">auto_awesome</span>
                                <span id="social-tool-generate-text">生成文案 & 模板配图</span>
                            </button>
                        </div>
                        <details class="studio-activity"><summary>生成进度与记录</summary><div class="social-tool-log" id="social-tool-log" role="log" aria-label="生成记录"></div></details>
                    </section>
                    <section class="social-tool-grid studio-results" aria-label="创作结果">
                        <div class="column-heading"><div><h2>内容预览</h2><p>文案与配图，在这里成为完整的贴文。</p></div><span class="preview-label">贴文预览</span></div>
                        <div class="social-tool-preview-stage">
                            <div class="social-tool-preview-actions"><h3>社媒贴文</h3>
                                <button class="top-btn" id="social-tool-copy-btn" type="button">
                                    <span class="material-symbols-outlined">content_copy</span>
                                    复制文案
                                </button>
                            </div>
                            <div class="social-tool-output" id="social-tool-text-output">等待生成中...</div>
                        </div>
                        <div class="social-tool-panel">
                            <h3><span class="material-symbols-outlined">palette</span> 配图作品</h3>
                            <div class="social-tool-image-grid" id="social-tool-images">
                                <div class="social-tool-placeholder"><span class="material-symbols-outlined">photo_library</span><strong>一组作品，从一个想法开始</strong><span>选择每张图的模板与比例，生成后可独立重试、预览和导出。</span></div>
                            </div>
                        </div>
                    </section>
                </div>
                <div class="social-tool-settings" id="social-tool-settings">
                    <div class="social-tool-settings-page">
                        <div class="social-tool-settings-head">
                            <div>
                                <h3><span class="material-symbols-outlined">tune</span> 社媒引擎设置</h3>
                                <p class="social-tool-muted" style="margin:6px 0 0;">连接自己的 API，管理内容风格和配图模板。</p>
                            </div>
                            <button class="top-btn" id="social-tool-settings-back" type="button">
                                <span class="material-symbols-outlined">arrow_back</span>
                                返回工作台
                            </button>
                        </div>
                        <section class="social-tool-settings-section">
                            <div class="social-tool-settings-section-title">
                                <h4><span class="material-symbols-outlined">hub</span> 接口配置</h4>
                            </div>
                            <div class="social-tool-settings-grid">
                                <div class="social-tool-field" style="grid-column:1/-1">
                                    <label for="social-tool-api-base">API 地址</label>
                                    <input class="social-tool-input" id="social-tool-api-base" type="url" placeholder="https://api.openlux.ai/v1" autocomplete="off">
                                    <p class="social-tool-muted">与 GPT Image 工作室相同，填写服务商的 /v1 地址，图片由浏览器直接发送。</p>
                                </div>
                                <div class="social-tool-field" style="grid-column:1/-1">
                                    <label for="social-tool-api-key">API Key</label>
                                    <div class="social-connection-row">
                                        <input class="social-tool-input" id="social-tool-api-key" type="password" autocomplete="off" placeholder="填写自己的 API Key" spellcheck="false">
                                        <button class="top-btn" id="social-tool-show-key" type="button">显示</button>
                                    </div>
                                    <label class="social-tool-check-row" for="social-tool-remember-key"><input id="social-tool-remember-key" type="checkbox"><span>在当前浏览器记住 Key</span></label>
                                    <p class="social-tool-muted">未勾选时 Key 仅用于当前页面，刷新后重新填写。勾选后保存在此浏览器的本地存储中。</p>
                                </div>
                                <div class="social-tool-field">
                                    <label for="social-tool-image-model">图片模型</label>
                                    <input class="social-tool-input" id="social-tool-image-model" list="social-tool-image-models" placeholder="gpt-image-2" autocomplete="off">
                                    <datalist id="social-tool-image-models"><option value="gpt-image-2"><option value="gpt-image-2-c"><option value="gpt-image-2.5-flare"><option value="gpt-image-2.5-sunburst"><option value="gpt-image-1.5"><option value="gpt-image-1-mini"></datalist>
                                    <p class="social-tool-muted">可直接填写包含路线后缀的模型 ID，以当前 Key 可用模型为准。</p>
                                </div>
                                <div class="social-tool-field">
                                    <label for="social-tool-text-model">文案模型（须支持看图）</label>
                                    <input class="social-tool-input" id="social-tool-text-model" list="social-tool-text-models" placeholder="gpt-6.1-sol" autocomplete="off">
                                    <datalist id="social-tool-text-models"></datalist>
                                </div>
                                <div class="social-tool-field">
                                    <label for="social-tool-image-quality">图片质量</label>
                                    <select class="social-tool-select" id="social-tool-image-quality"><option value="low">快速预览</option><option value="medium">标准</option><option value="high">高质量</option><option value="xhigh">超高清（2.5）</option><option value="max">最高质量（2.5）</option><option value="auto">自动</option></select>
                                </div>
                                <div class="social-tool-field">
                                    <label for="social-tool-image-format">图片格式</label>
                                    <select class="social-tool-select" id="social-tool-image-format"><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select>
                                </div>
                                <div class="social-tool-field">
                                    <label for="social-tool-text-protocol">文案协议</label>
                                    <select class="social-tool-select" id="social-tool-text-protocol"><option value="responses">Responses（与参考项目一致）</option><option value="chat">Chat Completions（兼容接口）</option></select>
                                </div>
                                <div class="social-tool-field">
                                    <label for="social-tool-api-timeout">请求超时（秒）</label>
                                    <input class="social-tool-input" id="social-tool-api-timeout" type="number" min="30" max="1800" step="1">
                                </div>
                                <div class="social-tool-field" style="grid-column:1/-1">
                                    <label class="social-tool-check-row" for="social-tool-text-shared"><input id="social-tool-text-shared" type="checkbox"><span>文案复用图片 API 地址与 Key</span></label>
                                    <div id="social-tool-text-connection" hidden>
                                        <label for="social-tool-text-base">独立文案 API 地址</label>
                                        <input class="social-tool-input" id="social-tool-text-base" type="url" autocomplete="off">
                                        <label for="social-tool-text-key">独立文案 API Key</label>
                                        <input class="social-tool-input" id="social-tool-text-key" type="password" autocomplete="off" spellcheck="false">
                                    </div>
                                </div>
                                <div class="social-tool-field" style="grid-column:1/-1">
                                    <details><summary>高级兼容设置</summary>
                                        <label for="social-tool-format-field">图片格式参数</label>
                                        <select class="social-tool-select" id="social-tool-format-field"><option value="auto">自动（沿用参考项目规则）</option><option value="format">format</option><option value="output_format">output_format</option></select>
                                        <p class="social-tool-muted">仅在供应商明确提示不支持格式字段时修改。请求失败不会自动重新提交。</p>
                                    </details>
                                </div>
                                <div class="social-tool-field" style="grid-column:1/-1">
                                    <button class="top-btn" id="social-tool-fetch-models" type="button">读取可用模型</button>
                                    <p class="social-tool-muted" id="social-tool-api-status" role="status">填写自己的 API 连接即可生成；不连接也可以浏览页面。</p>
                                    <p class="social-tool-muted">读取列表仅查询模型，不会生图；若服务商不允许跨域读取列表，可手动填写模型。</p>
                                </div>
                                <div class="social-tool-field">
                                    <label for="social-tool-micro-crop">图片后处理</label>
                                    <label class="social-tool-check-row" for="social-tool-micro-crop">
                                        <input id="social-tool-micro-crop" type="checkbox">
                                        <span>生成后静默微裁切边缘，导出与拖出使用处理后图片</span>
                                    </label>
                                    <p class="social-tool-muted">用于社媒平台边缘适配和去除极轻微边缘瑕疵，幅度很小。</p>
                                </div>
                            </div>
                        </section>
                        <section class="social-tool-settings-section">
                            <div class="social-tool-settings-section-title">
                                <h4><span class="material-symbols-outlined">psychology</span> 前置提示词</h4>
                            </div>
                            <div class="social-tool-field">
                                <label for="social-tool-system-prompt">可直接更改：内容风格提示词</label>
                                <textarea class="social-tool-textarea" id="social-tool-system-prompt"></textarea>
                            </div>
                            <div class="social-tool-risk-grid">
                                <div class="social-tool-field social-tool-risk-field">
                                    <label for="social-tool-schema-prompt">高危只读：前台 JSON 输出协议</label>
                                    <textarea class="social-tool-textarea social-tool-risk-textarea" id="social-tool-schema-prompt" readonly></textarea>
                                    <p class="social-tool-muted">该段直接关联前台文案、标签、主题解析，误改会导致页面无法读取模型输出。</p>
                                </div>
                                <div class="social-tool-field social-tool-risk-field">
                                    <label for="social-tool-dynamic-prompt">高危只读：前台动态输入模板</label>
                                    <textarea class="social-tool-textarea social-tool-risk-textarea" id="social-tool-dynamic-prompt" readonly></textarea>
                                    <p class="social-tool-muted">该段展示商品描述、场景说明、引导链接如何拼接进大模型请求。</p>
                                </div>
                            </div>
                        </section>
                        <section class="social-tool-settings-section">
                            <div class="social-tool-settings-section-title">
                                <h4><span class="material-symbols-outlined">view_list</span> 模板管理</h4>
                                <span class="social-tool-muted">支持变量：{{theme}} {{copy}} {{hashtags}} {{product}} {{context}} {{link}} {{ratio}} {{size}}</span>
                            </div>
                            <div class="social-tool-template-manager">
                                <div>
                                    <div class="social-tool-template-list" id="social-tool-template-list"></div>
                                </div>
                                <div class="social-tool-template-builder">
                                    <div class="social-tool-inline-grid">
                                        <div class="social-tool-field" style="margin-bottom:0;">
                                            <label for="social-tool-new-template-type">模板分区</label>
                                            <select class="social-tool-select" id="social-tool-new-template-type">
                                                <option value="scene">场景模板</option>
                                                <option value="poster">海报模板</option>
                                            </select>
                                        </div>
                                        <div class="social-tool-field" style="margin-bottom:0;">
                                            <label for="social-tool-new-template-name">模板名称</label>
                                            <input class="social-tool-input" id="social-tool-new-template-name" type="text" placeholder="例如：户外露营场景">
                                        </div>
                                    </div>
                                    <div class="social-tool-field" style="margin:10px 0 0;">
                                        <label for="social-tool-new-template-body">提示词模板</label>
                                        <textarea class="social-tool-textarea" id="social-tool-new-template-body" placeholder="支持 {{theme}} {{copy}} {{product}} {{context}} {{link}} {{ratio}} 等变量"></textarea>
                                    </div>
                                    <div class="social-tool-template-builder-actions">
                                        <button class="top-btn top-btn-primary" id="social-tool-add-template-btn" type="button">
                                            <span class="material-symbols-outlined">add</span>
                                            添加模板
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </section>
                        <div class="social-tool-settings-actions">
                            <button class="top-btn" id="social-tool-settings-cancel" type="button">取消</button>
                            <button class="top-btn top-btn-primary" id="social-tool-settings-save" type="button">保存设置</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const toast = document.createElement('div');
        toast.id = 'social-tool-toast';
        toast.className = 'social-tool-toast';
        toast.setAttribute('role', 'status');
        document.body.appendChild(toast);

        const viewer = document.createElement('section');
        viewer.id = 'social-tool-image-viewer';
        viewer.className = 'social-tool-image-viewer';
        viewer.setAttribute('aria-label', '配图详情');
        viewer.innerHTML = `
            <div class="social-tool-image-viewer-inner"><div class="image-detail-head"><h2>配图详情</h2>
                <button class="social-tool-image-viewer-close" id="social-tool-image-viewer-close" type="button" title="返回工作台">
                    <span class="material-symbols-outlined">arrow_back</span> 返回工作台
                </button></div>
                <img id="social-tool-image-viewer-img" alt="生成配图预览">
                <a class="social-tool-image-viewer-open" id="social-tool-image-viewer-open" target="_blank" rel="noopener noreferrer">新窗口打开</a>
            </div>
        `;
        modal.querySelector('.social-tool-shell').appendChild(viewer);
    }

    function bindEvents() {
        byId('social-tool-export-btn').addEventListener('click', exportCurrentWorkspace);
        byId('social-tool-settings-btn').addEventListener('click', toggleSettings);
        byId('social-tool-settings-back').addEventListener('click', closeSettings);
        byId('social-tool-settings-cancel').addEventListener('click', () => {
            loadSettings();
            closeSettings();
        });
        byId('social-tool-settings-save').addEventListener('click', saveSettings);
        byId('social-tool-show-key').addEventListener('click', () => {
            const field = byId('social-tool-api-key');
            field.type = field.type === 'password' ? 'text' : 'password';
            byId('social-tool-show-key').textContent = field.type === 'password' ? '显示' : '隐藏';
        });
        byId('social-tool-text-shared').addEventListener('change', () => {
            byId('social-tool-text-connection').hidden = byId('social-tool-text-shared').checked;
        });
        byId('social-tool-fetch-models').addEventListener('click', fetchConnectionModels);
        byId('social-tool-generate-btn').addEventListener('click', handleGenerate);
        byId('social-tool-copy-btn').addEventListener('click', copyText);
        byId('social-tool-image-viewer-close').addEventListener('click', closeImagePreview);
        byId('social-tool-image-count').addEventListener('change', () => {
            saveActiveForm();
            renderTemplateSlots(getActiveWorkspace());
        });
        byId('social-tool-template-slots').addEventListener('change', (event) => {
            if (event.target && event.target.matches('[data-social-template-slot], [data-social-ratio-slot]')) saveActiveForm();
        });
        byId('social-tool-add-template-btn').addEventListener('click', addPromptTemplate);
        byId('social-tool-template-list').addEventListener('click', (event) => {
            const button = event.target.closest('[data-social-template-delete]');
            if (button) deletePromptTemplate(button.dataset.socialTemplateDelete);
        });
        byId('social-tool-workspace-add').addEventListener('click', addWorkspace);
        byId('social-tool-workspace-list').addEventListener('click', (event) => {
            const button = event.target.closest('.social-tool-workspace-btn');
            if (button && button.dataset.workspaceId) switchWorkspace(button.dataset.workspaceId);
        });
        byId('social-tool-images').addEventListener('click', (event) => {
            const button = event.target.closest('[data-social-rerun-index]');
            if (button) rerunImage(
                Number(button.dataset.socialRerunIndex),
                button.dataset.workspaceId || activeWorkspaceId,
                button.dataset.socialRerunMode || 'retry'
            );
        });
        byId('social-tool-image-input').addEventListener('change', handleImageSelect);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeImagePreview();
        });

        const upload = byId('social-tool-upload');
        const isUploadPasteTarget = () => {
            const active = document.activeElement;
            const uploadVisible = upload && upload.offsetParent !== null;
            return Boolean(uploadVisible && (
                upload.classList.contains('is-paste-target') ||
                active === upload ||
                upload.contains(active)
            ));
        };
        upload.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                byId('social-tool-image-input').click();
            }
        });
        upload.addEventListener('mouseenter', () => upload.classList.add('is-paste-target'));
        upload.addEventListener('mouseleave', () => upload.classList.remove('is-paste-target'));
        upload.addEventListener('focus', () => upload.classList.add('is-paste-target'));
        upload.addEventListener('blur', () => upload.classList.remove('is-paste-target'));
        upload.addEventListener('paste', handleUploadPaste);
        upload.addEventListener('dragover', (event) => {
            event.preventDefault();
            upload.classList.add('is-drag');
        });
        upload.addEventListener('dragleave', () => upload.classList.remove('is-drag'));
        upload.addEventListener('drop', (event) => {
            event.preventDefault();
            upload.classList.remove('is-drag');
            if (event.dataTransfer && event.dataTransfer.files) processFiles(event.dataTransfer.files);
        });
        document.addEventListener('paste', (event) => {
            if (event.defaultPrevented || !isUploadPasteTarget()) return;
            handleUploadPaste(event);
        });
    }

    function init() {
        if (initialized) return;
        ensureShell();
        loadSettings();
        ensureWorkspaces();
        renderActiveWorkspace();
        bindEvents();
        initialized = true;
        renderConnectionStatus();
    }

    function open() {
        init();
        byId('social-tool-workspace').classList.add('show');
    }

    function close() {
        closeSettings();
        closeImagePreview();
    }

    let workspaceScroll = 0;
    let previewReturnFocus = null;
    let previewScroll = 0;

    function closeSettings() {
        const settingsPanel = byId('social-tool-settings');
        const shell = document.querySelector('.social-tool-shell');
        if (settingsPanel) settingsPanel.classList.remove('show');
        if (shell) shell.classList.remove('settings-open');
        byId('social-tool-settings-btn')?.setAttribute('aria-expanded', 'false');
        window.scrollTo(0, workspaceScroll);
        byId('social-tool-settings-btn')?.focus({ preventScroll: true });
    }

    function openImagePreview(url) {
        if (!url) return;
        const viewer = byId('social-tool-image-viewer');
        const img = byId('social-tool-image-viewer-img');
        const link = byId('social-tool-image-viewer-open');
        if (!viewer || !img || !link) return;
        previewReturnFocus = document.activeElement;
        previewScroll = window.scrollY;
        img.src = url;
        link.href = url;
        viewer.classList.add('show');
        document.querySelector('.social-tool-shell').classList.add('preview-open');
        window.scrollTo(0, 0);
        byId('social-tool-image-viewer-close').focus({ preventScroll: true });
    }

    function closeImagePreview() {
        const viewer = byId('social-tool-image-viewer');
        const img = byId('social-tool-image-viewer-img');
        if (!viewer || !viewer.classList.contains('show')) return;
        viewer.classList.remove('show');
        document.querySelector('.social-tool-shell').classList.remove('preview-open');
        window.scrollTo(0, previewScroll);
        previewReturnFocus?.focus({ preventScroll: true });
        if (img) img.removeAttribute('src');
    }

    function addWorkspace() {
        saveActiveForm();
        const workspace = createWorkspace();
        workspaces.push(workspace);
        activeWorkspaceId = workspace.id;
        renderActiveWorkspace();
        showToast('已新增工作区');
    }

    function switchWorkspace(workspaceId) {
        if (!getWorkspace(workspaceId) || workspaceId === activeWorkspaceId) return;
        saveActiveForm();
        activeWorkspaceId = workspaceId;
        renderActiveWorkspace();
    }

    function renderWorkspaceRail() {
        const list = byId('social-tool-workspace-list');
        if (!list) return;
        list.innerHTML = '';
        workspaces.forEach((workspace, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `social-tool-workspace-btn ${workspace.id === activeWorkspaceId ? 'active' : ''} ${getWorkspaceStatus(workspace)}`;
            button.dataset.workspaceId = workspace.id;
            button.title = `${workspace.name || `W${index + 1}`} - ${getWorkspaceStatus(workspace)}`;
            button.textContent = `创作 ${String(index + 1).padStart(2, '0')}`;
            button.setAttribute('aria-current', workspace.id === activeWorkspaceId ? 'true' : 'false');
            button.setAttribute('aria-label', `工作区 ${index + 1}，${getWorkspaceStatus(workspace)}`);
            list.appendChild(button);
        });
    }

    function renderActiveWorkspace() {
        ensureWorkspaces();
        restoreActiveForm();
        renderWorkspaceRail();
        renderGallery();
        renderTextOutput(getActiveWorkspace().textResult);
        renderImageResults(getActiveWorkspace());
        renderLog(getActiveWorkspace());
        setLoadingState(getActiveWorkspace().isLoading);
    }

    function toggleSettings() {
        if (byId('social-tool-settings').classList.contains('show')) closeSettings();
        else openSettings();
    }

    function openSettings() {
        workspaceScroll = window.scrollY;
        saveActiveForm();
        closeImagePreview();
        loadSettings();
        const settingsPanel = byId('social-tool-settings');
        const shell = document.querySelector('.social-tool-shell');
        if (settingsPanel) settingsPanel.classList.add('show');
        if (shell) shell.classList.add('settings-open');
        renderTemplateManager();
        byId('social-tool-settings-btn').setAttribute('aria-expanded', 'true');
        window.scrollTo(0, 0);
        byId('social-tool-settings-back').focus({ preventScroll: true });
    }

    function loadSettings() {
        const saved = safeJsonParse(window.localStorage && window.localStorage.getItem(SETTINGS_KEY), null);
        settings = saved && typeof saved === 'object' ? { ...defaultSettings, ...saved } : { ...defaultSettings };
        settings.promptTemplates = normalizePromptTemplates(settings.promptTemplates);
        if (/imagePrompts|构思1-3张|写出.*生图提示词|optimized for DALL/i.test(String(settings.systemPrompt || ''))) {
            settings.systemPrompt = defaultSettings.systemPrompt;
        }
        const fieldMap = {
            'social-tool-system-prompt': settings.systemPrompt,
            'social-tool-schema-prompt': HIDDEN_JSON_SCHEMA_PROMPT.trim(),
            'social-tool-dynamic-prompt': FRONTEND_DYNAMIC_PROMPT_TEMPLATE
        };
        Object.entries(fieldMap).forEach(([id, value]) => {
            const el = byId(id);
            if (el) el.value = value || '';
        });
        const microCrop = byId('social-tool-micro-crop');
        if (microCrop) microCrop.checked = settings.microCropEnabled !== false;
        loadConnectionFields();
        renderTemplateManager();
    }

    const connectionFields = {
        base: 'social-tool-api-base', key: 'social-tool-api-key',
        imageModel: 'social-tool-image-model', textModel: 'social-tool-text-model',
        quality: 'social-tool-image-quality', format: 'social-tool-image-format',
        textProtocol: 'social-tool-text-protocol', timeout: 'social-tool-api-timeout',
        textBase: 'social-tool-text-base', textKey: 'social-tool-text-key', formatField: 'social-tool-format-field'
    };
    function loadConnectionFields() {
        const connection = window.SocialApi.getConnection();
        for (const [key, id] of Object.entries(connectionFields)) byId(id).value = connection[key];
        byId('social-tool-remember-key').checked = connection.rememberKey;
        byId('social-tool-text-shared').checked = connection.useImageConnection;
        byId('social-tool-text-connection').hidden = connection.useImageConnection;
        byId('social-tool-api-key').type = 'password';
        byId('social-tool-show-key').textContent = '显示';
        renderConnectionStatus();
    }
    function renderConnectionStatus() {
        const c = window.SocialApi.getConnection();
        const ready = Boolean(c.key && (c.useImageConnection || c.textKey));
        const badge = byId('studio-connection-status');
        if (badge) {
            badge.textContent = ready ? 'API 已配置' : '未连接 API';
            badge.classList.toggle('ready', Boolean(ready));
        }
        byId('social-tool-api-status').textContent = ready ? `已填写连接 · 文案 ${c.textModel} · 图片 ${c.imageModel}（尚未验证供应商可用性）` : '填写自己的 API 连接即可生成；不连接也可以浏览页面。';
    }
    async function fetchConnectionModels() {
        const button = byId('social-tool-fetch-models');
        const base = byId('social-tool-api-base').value, key = byId('social-tool-api-key').value;
        button.disabled = true;
        byId('social-tool-api-status').textContent = '正在读取模型…';
        try {
            const models = await window.SocialApi.listModels({ base, key });
            if (base !== byId('social-tool-api-base').value || key !== byId('social-tool-api-key').value) return;
            const images = models.filter(id => /^(gpt-image-|chatgpt-image-latest)/.test(id));
            byId('social-tool-image-models').replaceChildren(...images.map(id => new Option(id, id)));
            byId('social-tool-text-models').replaceChildren(...models.filter(id => !images.includes(id)).map(id => new Option(id, id)));
            byId('social-tool-api-status').textContent = `已读取 ${models.length} 个模型，其中 ${images.length} 个 GPT Image 模型；请按用途选择，读取列表不代表支持看图。`;
        } catch (error) { byId('social-tool-api-status').textContent = error.message; }
        finally { button.disabled = false; }
    }

    function saveSettings() {
        try {
            const connection = Object.fromEntries(Object.entries(connectionFields).map(([key, id]) => [key, byId(id).value]));
            connection.rememberKey = byId('social-tool-remember-key').checked;
            connection.useImageConnection = byId('social-tool-text-shared').checked;
            window.SocialApi.saveConnection(connection);
        } catch (error) { showToast(error.message, true); return; }
        settings.microCropEnabled = byId('social-tool-micro-crop') ? byId('social-tool-micro-crop').checked : defaultSettings.microCropEnabled;
        settings.systemPrompt = byId('social-tool-system-prompt').value.trim() || defaultSettings.systemPrompt;
        settings.promptTemplates = normalizePromptTemplates(settings.promptTemplates);
        try {
            window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (err) {}
        renderConnectionStatus();
        closeSettings();
        showToast('设置已应用');
    }

    function handleImageSelect(event) {
        if (event.target.files) processFiles(event.target.files);
        event.target.value = '';
    }

    function extractClipboardImageFiles(clipboardData) {
        if (!clipboardData) return [];
        const files = [];
        if (clipboardData.items && clipboardData.items.length) {
            Array.from(clipboardData.items).forEach((item) => {
                if (!item || item.kind !== 'file' || !item.type || !item.type.startsWith('image/')) return;
                const file = item.getAsFile();
                if (file) files.push(file);
            });
        }
        if (files.length === 0 && clipboardData.files && clipboardData.files.length) {
            Array.from(clipboardData.files).forEach((file) => {
                if (file && file.type && file.type.startsWith('image/')) files.push(file);
            });
        }
        return files;
    }

    function handleUploadPaste(event) {
        if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
        const files = extractClipboardImageFiles(event.clipboardData);
        if (!files.length) {
            showToast('剪切板里没有可粘贴的图片', true);
            return false;
        }
        event.preventDefault();
        const added = processFiles(files);
        if (added > 0) {
            showToast(`已从剪切板粘贴 ${added} 张图片`);
        }
        return true;
    }

    function processFiles(files) {
        const workspace = getActiveWorkspace();
        const availableSlots = MAX_IMAGES - workspace.uploadedImages.length;
        if (availableSlots <= 0) {
            showToast('最多只能上传5张图片', true);
            return 0;
        }
        const acceptedFiles = Array.from(files)
            .filter((file) => file && ['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
            .slice(0, availableSlots);
        acceptedFiles.forEach((file) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                workspace.uploadedImages.push({
                    dataUrl: event.target.result,
                    mimeType: file.type
                });
                if (workspace.id === activeWorkspaceId) renderGallery();
            };
            reader.readAsDataURL(file);
        });
        return acceptedFiles.length;
    }

    function removeImage(index) {
        getActiveWorkspace().uploadedImages.splice(index, 1);
        renderGallery();
    }

    function renderGallery() {
        const gallery = byId('social-tool-gallery');
        gallery.querySelectorAll('.social-tool-preview').forEach((item) => item.remove());
        const upload = byId('social-tool-upload');
        const workspace = getActiveWorkspace();
        workspace.uploadedImages.forEach((img, index) => {
            const item = document.createElement('div');
            item.className = 'social-tool-preview';
            const image = document.createElement('img');
            image.src = img.dataUrl;
            image.alt = `产品参考图 ${index + 1}`;
            const remove = document.createElement('button');
            remove.className = 'social-tool-remove';
            remove.type = 'button';
            remove.setAttribute('aria-label', `移除参考图 ${index + 1}`);
            remove.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">close</span>';
            remove.addEventListener('click', () => removeImage(index));
            item.append(image, remove);
            gallery.insertBefore(item, upload);
        });
        upload.style.display = workspace.uploadedImages.length >= MAX_IMAGES ? 'none' : 'flex';
    }

    function renderTemplateOptions(selectedId) {
        const templates = getPromptTemplates();
        return ['poster', 'scene'].map((type) => {
            const groupItems = templates.filter((item) => item.type === type);
            if (!groupItems.length) return '';
            const options = groupItems.map((item) => {
                const selected = item.id === selectedId ? ' selected' : '';
                return `<option value="${escapeHtml(item.id)}"${selected}>${escapeHtml(item.name)}</option>`;
            }).join('');
            return `<optgroup label="${getTemplateTypeLabel(type)}模板">${options}</optgroup>`;
        }).join('');
    }

    function renderTemplateSlots(workspace = getActiveWorkspace()) {
        const container = byId('social-tool-template-slots');
        if (!container || !workspace) return;
        const imageCount = clampImageCount(workspace.imageCount);
        workspace.imageCount = imageCount;
        workspace.templateSelections = Array.isArray(workspace.templateSelections) ? workspace.templateSelections : [];
        ensureWorkspaceImageRatios(workspace);
        container.innerHTML = Array.from({ length: imageCount }, (_, index) => {
            const selectedId = getTemplateById(workspace.templateSelections[index] || getDefaultTemplateId(index)).id;
            const selectedRatio = getWorkspaceRatio(workspace, index);
            workspace.templateSelections[index] = selectedId;
            return `
                <div class="social-tool-template-slot">
                    <span>图 ${index + 1}</span>
                    <select class="social-tool-select" aria-label="图 ${index + 1} 提示词模板" data-social-template-slot="${index}">
                        ${renderTemplateOptions(selectedId)}
                    </select>
                    <select class="social-tool-select" aria-label="图 ${index + 1} 配图比例" data-social-ratio-slot="${index}">
                        ${SOCIAL_IMAGE_RATIOS.map((item) => `<option value="${escapeHtml(item.value)}" ${item.value === selectedRatio ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
                    </select>
                </div>
            `;
        }).join('');
    }

    function renderTemplateManager() {
        const list = byId('social-tool-template-list');
        if (!list) return;
        const templates = getPromptTemplates();
        const canDelete = templates.length > 1;
        list.innerHTML = templates.map((template) => `
            <article class="social-tool-template-card">
                <div class="social-tool-template-card-head">
                    <div class="social-tool-template-card-title">
                        <span class="social-tool-template-pill">${getTemplateTypeLabel(template.type)}</span>
                        <span>${escapeHtml(template.name)}</span>
                    </div>
                    <button class="social-tool-template-delete" type="button" data-social-template-delete="${escapeHtml(template.id)}" ${canDelete ? '' : 'disabled'} title="${canDelete ? '删除模板' : '至少保留一个模板'}">
                        <span class="material-symbols-outlined" style="font-size:18px;">delete</span>
                    </button>
                </div>
                <div class="social-tool-template-card-body">${escapeHtml(template.body)}</div>
            </article>
        `).join('');
    }

    function persistSettings() {
        try {
            window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (err) {}
    }

    function deletePromptTemplate(templateId) {
        const templates = getPromptTemplates();
        if (!templateId) return;
        if (templates.length <= 1) {
            showToast('至少需要保留一个模板', true);
            return;
        }
        if (!templates.some((template) => template.id === templateId)) return;

        settings.promptTemplates = normalizePromptTemplates(templates.filter((template) => template.id !== templateId));
        workspaces.forEach((workspace) => {
            if (!Array.isArray(workspace.templateSelections)) return;
            workspace.templateSelections = workspace.templateSelections.map((selectedId, index) => (
                selectedId === templateId ? getDefaultTemplateId(index) : selectedId
            ));
        });
        persistSettings();
        saveActiveForm();
        renderTemplateManager();
        renderTemplateSlots(getActiveWorkspace());
        showToast('模板已删除');
    }

    function addPromptTemplate() {
        const typeEl = byId('social-tool-new-template-type');
        const nameEl = byId('social-tool-new-template-name');
        const bodyEl = byId('social-tool-new-template-body');
        const type = typeEl && typeEl.value === 'poster' ? 'poster' : 'scene';
        const name = nameEl ? nameEl.value.trim() : '';
        const body = bodyEl ? bodyEl.value.trim() : '';
        if (!name || !body) {
            showToast('请填写模板名称和提示词内容', true);
            return;
        }
        const template = {
            id: createTemplateId(type, name),
            type,
            name,
            body
        };
        settings.promptTemplates = normalizePromptTemplates([...getPromptTemplates(), template]);
        persistSettings();
        if (nameEl) nameEl.value = '';
        if (bodyEl) bodyEl.value = '';
        saveActiveForm();
        renderTemplateManager();
        renderTemplateSlots(getActiveWorkspace());
        showToast('模板已添加');
    }

    async function handleGenerate() {
        saveActiveForm();
        const workspace = getActiveWorkspace();
        if (workspace.isLoading) {
            showToast('当前工作区正在生成中');
            return;
        }
        if (workspace.uploadedImages.length === 0) {
            showToast('请至少上传一张产品图片', true);
            return;
        }
        workspace.isLoading = true;
        setLoadingState(true);
        renderWorkspaceRail();
        try { await window.SocialApi.ensureReady(); }
        catch (error) {
            workspace.isLoading = false;
            renderWorkspaceRail();
            if (activeWorkspaceId === workspace.id) setLoadingState(false);
            showToast(error.message, true);
            openSettings();
            return;
        }

        const workspaceId = workspace.id;
        const generationToken = workspace.generationToken + 1;
        workspace.generationToken = generationToken;
        workspace.productDesc = (workspace.productDesc || '').trim();
        workspace.contextDesc = (workspace.contextDesc || '').trim();
        workspace.guidanceLink = (workspace.guidanceLink || '').trim();
        workspace.imageCount = clampImageCount(workspace.imageCount);
        ensureWorkspaceImageRatios(workspace);
        workspace.textResult = null;
        workspace.imagePrompts = [];
        workspace.imageResults = [];
        workspace.logs = ['运行日志'];
        workspace.progress = { percent: 5, label: '准备任务' };
        workspace.isLoading = true;
        renderActiveWorkspace();

        try {
            setWorkspaceProgress(workspaceId, 12, '分析图片与文案');
            logDebug('正在调用文本多模态大模型分析图片...', workspaceId);
            const textResult = await callTextMultimodalModel(workspace.productDesc, workspace.contextDesc, workspace.guidanceLink, workspaceId);
            if (!textResult) throw new Error('文本模型未返回有效数据');
            logDebug('文本生成成功，正在渲染到界面...', workspaceId);
            workspace.textResult = textResult;
            setWorkspaceProgress(workspaceId, 38, '文案生成完成');
            if (activeWorkspaceId === workspaceId) renderTextOutput(textResult);

            const imagePlans = buildImagePlans(textResult, workspace).filter((plan) => plan.prompt);
            workspace.imagePrompts = imagePlans.map((plan) => plan.prompt);
            if (imagePlans.length === 0) {
                logDebug('未找到可用模板，跳过生图步骤。', workspaceId);
                setWorkspaceProgress(workspaceId, 100, '文案完成，无配图任务');
            } else {
                logDebug(`准备通过模板和 API 生成 ${imagePlans.length} 张图片...`, workspaceId);
                workspace.imageResults = imagePlans.map((plan, index) => ({ ...plan, index, status: 'pending', url: '', error: '', ratio: plan.ratio, size: plan.size }));
                setWorkspaceProgress(workspaceId, 45, '准备生图');
                if (activeWorkspaceId === workspaceId) renderImageResults(workspace);
                let completedImages = 0;
                const results = await Promise.allSettled(imagePlans.map((plan, index) => (
                    generateImage(plan.prompt, index, workspaceId)
                        .then(async (url) => {
                            const processed = await postProcessGeneratedImage(url, index, workspaceId);
                            workspace.imageResults[index] = { ...plan, index, status: 'success', url: processed.url, originalUrl: processed.originalUrl, postProcessed: processed.postProcessed, error: '', ratio: plan.ratio, size: plan.size };
                            return processed;
                        })
                        .catch((error) => {
                            const message = error && error.message ? error.message : String(error || 'Unknown image error');
                            workspace.imageResults[index] = { ...plan, index, status: 'failed', url: '', error: message, ratio: plan.ratio, size: plan.size };
                            logDebug(`第 ${index + 1} 张图片生成失败: ${escapeHtml(message)}`, workspaceId);
                            throw error;
                        })
                        .finally(() => {
                            completedImages += 1;
                            const percent = Math.min(96, 45 + Math.round((completedImages / imagePlans.length) * 45));
                            setWorkspaceProgress(workspaceId, percent, completedImages === imagePlans.length ? '图片生成收尾中' : `已完成 ${completedImages}/${imagePlans.length} 张图片`);
                            if (activeWorkspaceId === workspaceId) renderImageResults(workspace);
                        })
                )));
                results.forEach((result, index) => {
                    if (result.status === 'fulfilled' && result.value) {
                        const processed = typeof result.value === 'string'
                            ? { url: result.value, originalUrl: '', postProcessed: false }
                            : result.value;
                        workspace.imageResults[index] = { ...imagePlans[index], index, status: 'success', url: processed.url, originalUrl: processed.originalUrl || '', postProcessed: Boolean(processed.postProcessed), error: '', ratio: imagePlans[index].ratio, size: imagePlans[index].size };
                    }
                });
                const failureCount = workspace.imageResults.filter((item) => item.status === 'failed').length;
                setWorkspaceProgress(workspaceId, 100, failureCount ? `配图成功 ${imagePlans.length - failureCount}/${imagePlans.length} 张，失败图片可单独重试` : '生成完成');
                if (activeWorkspaceId === workspaceId) renderImageResults(workspace);
                if (activeWorkspaceId === workspaceId && !byId('social-tool-images').querySelector('.social-tool-image-item')) {
                    byId('social-tool-images').innerHTML = '<div class="social-tool-placeholder">图片生成失败，请查看日志</div>';
                }
            }


            const failureCount = workspace.imageResults.filter((item) => item.status === 'failed').length;
            showToast(failureCount ? `文案已生成，${failureCount} 张配图失败，可单独重试` : '生成完成', failureCount > 0);
        } catch (error) {
            console.error(error);
            logDebug(`<span style="color:var(--danger);">错误: ${escapeHtml(error.message || error)}</span>`, workspaceId);
            setWorkspaceProgress(workspaceId, 100, '生成失败');
            showToast('生成过程发生错误，请查看日志', true);
        } finally {
            if (workspace.generationToken === generationToken) workspace.isLoading = false;
            renderWorkspaceRail();
            if (activeWorkspaceId === workspaceId) setLoadingState(false);
        }
    }

    async function callTextMultimodalModel(productDesc, contextDesc, guidanceLink, workspaceId) {
        const workspace = getWorkspace(workspaceId) || getActiveWorkspace();
        return window.SocialApi.generateText({
            prompt: settings.systemPrompt + HIDDEN_JSON_SCHEMA_PROMPT + "\n\n" + buildDynamicPrompt(productDesc, contextDesc, guidanceLink),
            images: workspace.uploadedImages.map((image) => image.dataUrl)
        });
    }

    async function generateImage(promptText, index, workspaceId) {
        logDebug(`正在通过 API 生成第 ${index + 1} 张图片…`, workspaceId);
        const workspace = getWorkspace(workspaceId) || getActiveWorkspace();
        const current = workspace.imageResults[index];
        const ratio = normalizeImageRatio((current && current.ratio) || getWorkspaceRatio(workspace, index));
        const result = await window.SocialApi.generateImage({
            prompt: promptText,
            images: workspace.uploadedImages.map((image) => image.dataUrl).slice(0, MAX_IMAGES),
            ratio,
            size: resolveSocialImageSize(ratio)
        });
        return result.url;
    }

    function renderTextOutput(data) {
        const output = byId('social-tool-text-output');
        const workspace = getActiveWorkspace();
        if (!data) {
            output.innerHTML = `
                <div class="social-tool-social-preview">
                    <article class="social-tool-post-card">
                        <div class="social-tool-post-head">
                            <div class="social-tool-post-avatar">S</div>
                            <div>
                                <div class="social-tool-post-title">你的产品故事</div>
                                <div class="social-tool-post-meta">文案、标签与产品配图</div>
                            </div>
                            <span class="material-symbols-outlined" style="font-size:18px; color:#6b7280;">more_horiz</span>
                        </div>
                        <div class="social-tool-post-copy">添加产品图片与内容需求，开始这一次创作。</div>
                        <div class="social-tool-post-media">
                            <div class="social-tool-post-media-placeholder ${workspace.isLoading ? 'loading' : ''}">
                                <span class="material-symbols-outlined">${workspace.isLoading ? 'hourglass_top' : 'image'}</span>
                                <span>${workspace.isLoading ? '图片生成中...' : '为你的产品，留一个好位置'}</span>
                            </div>
                        </div>
                        <div class="social-tool-post-engage">
                            <span><span class="material-symbols-outlined">thumb_up</span>Like</span>
                            <span><span class="material-symbols-outlined">mode_comment</span>Comment</span>
                            <span><span class="material-symbols-outlined">ios_share</span>Share</span>
                        </div>
                    </article>
                </div>
            `;
            const tags = byId('social-tool-tags');
            if (tags) tags.innerHTML = '';
            return;
        }
        const tagsList = normalizeHashtags(data.hashtags);
        const previewImage = getPreviewImage(workspace);
        const host = getPreviewHostname(workspace.guidanceLink);
        const tagText = tagsList.length ? `<span class="social-tool-inline-tags">${escapeHtml(tagsList.join(' '))}</span>` : '';
        const mediaHtml = previewImage
            ? `<img src="${escapeHtml(previewImage)}" alt="社媒配图预览">`
            : `
                <div class="social-tool-post-media-placeholder ${workspace.isLoading ? 'loading' : ''}">
                    <span class="material-symbols-outlined">${workspace.isLoading ? 'hourglass_top' : 'image'}</span>
                    <span>${workspace.isLoading ? '配图生成中...' : '图片生成后会显示在这里'}</span>
                </div>
            `;
        const linkHtml = workspace.guidanceLink ? `
            <div class="social-tool-post-link">
                <div>
                    <div class="social-tool-post-link-domain">${escapeHtml(host || 'Campaign Link')}</div>
                    <div class="social-tool-post-link-title">${escapeHtml(workspace.contextDesc || workspace.productDesc || 'Learn more about this campaign')}</div>
                </div>
                <button class="social-tool-post-cta" type="button">Shop Now</button>
            </div>
        ` : '';
        output.innerHTML = `
            <div class="social-tool-social-preview">
                <article class="social-tool-post-card">
                    <div class="social-tool-post-head">
                        <div class="social-tool-post-avatar">S</div>
                        <div>
                            <div class="social-tool-post-title">${escapeHtml(workspace.productDesc || 'Social Campaign')}</div>
                            <div class="social-tool-post-meta">Sponsored · Just now</div>
                        </div>
                        <span class="material-symbols-outlined" style="font-size:18px; color:#6b7280;">more_horiz</span>
                    </div>
                    <div class="social-tool-post-copy">${escapeHtml(data.content || '未能生成有效文案')}${tagText}</div>
                    <div class="social-tool-post-media">${mediaHtml}</div>
                    ${linkHtml}
                    <div class="social-tool-post-engage">
                        <span><span class="material-symbols-outlined">thumb_up</span>Like</span>
                        <span><span class="material-symbols-outlined">mode_comment</span>Comment</span>
                        <span><span class="material-symbols-outlined">ios_share</span>Share</span>
                    </div>
                </article>
            </div>
        `;
        const tags = byId('social-tool-tags');
        if (tags) tags.innerHTML = '';
        if (tags && tagsList.length) {
            tagsList.forEach((tag) => {
                const span = document.createElement('span');
                span.className = 'social-tool-tag';
                span.textContent = tag;
                tags.appendChild(span);
            });
        }
    }

    function renderGeneratedImage(url, index) {
        const grid = byId('social-tool-images');
        grid.querySelectorAll('.social-tool-placeholder').forEach((item) => item.remove());
        const item = document.createElement('div');
        item.className = 'social-tool-image-item';
        item.classList.add('success');
        item.style.aspectRatio = DEFAULT_IMAGE_RATIO.replace(':', ' / ');
        item.addEventListener('click', (event) => {
            if (!event.target.closest('a, button')) openImagePreview(url);
        });
        const img = document.createElement('img');
        img.src = url;
        img.alt = `生成配图 ${index + 1}`;
        img.draggable = true;
        bindGeneratedImageDrag(img, { url }, index);
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = '打开';
        item.append(img, link);
        grid.appendChild(item);
    }

    function renderImageResults(workspace) {
        const grid = byId('social-tool-images');
        if (!grid) return;
        const results = workspace && Array.isArray(workspace.imageResults) ? workspace.imageResults : [];
        if (results.length === 0) {
            grid.innerHTML = '<div class="social-tool-placeholder"><span class="material-symbols-outlined">photo_library</span><strong>一组作品，从一个想法开始</strong><span>选择每张图的模板与比例，生成后可独立重试、预览和导出。</span></div>';
            return;
        }
        grid.innerHTML = '';
        results.forEach((result, index) => {
            const status = result && result.status ? result.status : 'pending';
            const item = document.createElement('div');
            item.className = `social-tool-image-item ${status}`;
            item.style.aspectRatio = getAspectRatioStyle(result && result.ratio);
            if (status === 'success' && result.url) {
                const img = document.createElement('img');
                img.src = result.url;
                img.alt = `生成配图 ${index + 1}`;
                img.draggable = true;
                bindGeneratedImageDrag(img, result, index);
                const badge = document.createElement('span');
                badge.className = 'social-tool-image-badge';
                badge.textContent = `${getTemplateTypeLabel(result.templateType)} · ${result.templateName || `图 ${index + 1}`}`;
                const link = document.createElement('a');
                link.href = result.url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = '打开';
                const regenerate = document.createElement('button');
                regenerate.className = 'social-tool-image-regenerate';
                regenerate.type = 'button';
                regenerate.dataset.workspaceId = workspace.id;
                regenerate.dataset.socialRerunIndex = String(index);
                regenerate.dataset.socialRerunMode = 'regenerate';
                regenerate.title = '保留当前模板与比例，重新生成这一张';
                regenerate.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px;">refresh</span>重新生成';
                const actions = document.createElement('div');
                actions.className = 'social-tool-image-actions';
                actions.append(regenerate, link);
                item.append(img, badge, actions);
                item.title = '点击查看配图详情';
                item.setAttribute('aria-label', `预览配图 ${index + 1}，${result.templateName || ''}`);
                item.tabIndex = 0;
                item.addEventListener('click', (event) => {
                    if (event.target && typeof event.target.closest === 'function' && event.target.closest('a, button')) return;
                    item.focus({ preventScroll: true });
                    openImagePreview(result.url);
                });
                item.addEventListener('keydown', (event) => {
                    if (event.target !== item) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openImagePreview(result.url);
                    }
                });
            } else if (status === 'failed') {
                item.innerHTML = `
                    <span class="material-symbols-outlined">error</span>
                    <div>第 ${index + 1} 张生成失败</div>
                    <div class="social-tool-muted">${escapeHtml(result.templateName || '')}</div>
                    <button class="social-tool-image-retry" type="button" data-workspace-id="${escapeHtml(workspace.id)}" data-social-rerun-index="${index}" data-social-rerun-mode="retry">重试这张</button>
                `;
            } else {
                item.innerHTML = `
                    <div class="social-tool-image-loader">
                        <div class="social-tool-loader-shimmer"></div>
                        <div class="social-tool-loader-copy">
                            <strong><span class="material-symbols-outlined social-tool-image-pending-icon">autorenew</span> 第 ${index + 1} 张生成中</strong>
                            <div>${escapeHtml(result.templateName || '') || '正在匹配模板与比例'}</div>
                        </div>
                    </div>
                `;
            }
            grid.appendChild(item);
        });
        if (workspace && workspace.id === activeWorkspaceId && workspace.textResult) {
            renderTextOutput(workspace.textResult);
        }
    }

    async function rerunImage(index, workspaceId, mode = 'retry') {
        const workspace = getWorkspace(workspaceId);
        if (!workspace || workspace.isLoading) {
            if (workspace && workspace.isLoading) showToast('该工作区正在生成中，请稍候');
            return;
        }
        if (workspace.id === activeWorkspaceId) saveActiveForm();
        ensureWorkspaceImageRatios(workspace);
        const latestPlan = workspace.textResult ? buildImagePlans(workspace.textResult, workspace)[index] : null;
        const prompt = (latestPlan && latestPlan.prompt) || workspace.imagePrompts[index] || (workspace.imageResults[index] && workspace.imageResults[index].prompt);
        if (!prompt) {
            showToast('找不到这张图的提示词，无法重新生成', true);
            return;
        }
        const isRegenerate = mode === 'regenerate';
        const previousResult = workspace.imageResults[index] || {};
        const selectedRatio = getWorkspaceRatio(workspace, index);
        const selectedSize = resolveSocialImageSize(selectedRatio);
        workspace.imageRatios[index] = selectedRatio;
        workspace.imageRatio = workspace.imageRatios[0] || selectedRatio;
        workspace.imagePrompts[index] = prompt;
        workspace.imageResults[index] = { ...previousResult, ...latestPlan, index, prompt, status: 'pending', url: '', error: '', ratio: selectedRatio, size: selectedSize };
        workspace.progress = { percent: 45, label: `重新生成第 ${index + 1} 张图片` };
        workspace.isLoading = true;
        renderWorkspaceRail();
        if (activeWorkspaceId === workspace.id) {
            renderImageResults(workspace);
            renderLog(workspace);
            setLoadingState(true);
        }
        try {
            const rawUrl = await generateImage(prompt, index, workspace.id);
            const processed = await postProcessGeneratedImage(rawUrl, index, workspace.id);
            workspace.imageResults[index] = { ...previousResult, ...latestPlan, index, prompt, status: 'success', url: processed.url, originalUrl: processed.originalUrl, postProcessed: processed.postProcessed, error: '', ratio: selectedRatio, size: selectedSize };
            setWorkspaceProgress(workspace.id, 100, '单图生成完成');

            showToast(isRegenerate ? '单图重新生成完成' : '单图重试完成');
        } catch (error) {
            const message = error && error.message ? error.message : String(error || 'Unknown image error');
            workspace.imageResults[index] = { ...previousResult, ...latestPlan, index, prompt, status: 'failed', url: '', error: message, ratio: selectedRatio, size: selectedSize };
            logDebug(`第 ${index + 1} 张图片重试失败: ${escapeHtml(message)}`, workspace.id);
            setWorkspaceProgress(workspace.id, 100, '单图生成失败');
            showToast(isRegenerate ? '单图重新生成失败，可再次点击重试' : '单图重试失败，可再次点击重试', true);
        } finally {
            workspace.isLoading = false;
            renderWorkspaceRail();
            if (activeWorkspaceId === workspace.id) {
                renderImageResults(workspace);
                setLoadingState(false);
            }
        }
    }

    function clearOutputs() {
        renderTextOutput(null);
        const tags = byId('social-tool-tags');
        if (tags) tags.innerHTML = '';
        byId('social-tool-images').innerHTML = '<div class="social-tool-placeholder">等待图片生成中...</div>';
    }

    function setLoadingState(isLoading) {
        const btn = byId('social-tool-generate-btn');
        const text = byId('social-tool-generate-text');
        btn.disabled = isLoading;
        text.textContent = isLoading ? '正在制作...' : '生成文案 & 模板配图';
    }

    function resetLog() {
        renderLog(getActiveWorkspace());
    }

    function clampProgress(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 0;
        return Math.min(100, Math.max(0, Math.round(parsed)));
    }

    function getWorkspaceProgress(workspace) {
        if (!workspace || !workspace.progress) return { percent: 0, label: '待开始' };
        return {
            percent: clampProgress(workspace.progress.percent),
            label: workspace.progress.label || '待开始'
        };
    }

    function setWorkspaceProgress(workspaceId, percent, label) {
        const workspace = getWorkspace(workspaceId) || getActiveWorkspace();
        const target = clampProgress(percent);
        const current = workspace.progress && Number.isFinite(workspace.progress.percent)
            ? clampProgress(workspace.progress.percent)
            : 0;
        workspace.progress = {
            percent: current,
            target,
            label: label || (workspace.progress && workspace.progress.label) || '运行中'
        };
        if (workspace.progressTimer) clearTimeout(workspace.progressTimer);
        const stepTick = () => {
            const state = workspace.progress || { percent: current, target, label: label || '运行中' };
            const nextTarget = clampProgress(state.target);
            const nextCurrent = clampProgress(state.percent);
            if (nextCurrent === nextTarget) {
                workspace.progressTimer = null;
                if (workspace.id === activeWorkspaceId) renderLog(workspace);
                return;
            }
            const delta = Math.max(1, Math.min(4, Math.ceil(Math.abs(nextTarget - nextCurrent) / 6)));
            state.percent = nextCurrent < nextTarget
                ? Math.min(nextTarget, nextCurrent + delta)
                : Math.max(nextTarget, nextCurrent - delta);
            workspace.progress = state;
            if (workspace.id === activeWorkspaceId) renderLog(workspace);
            workspace.progressTimer = window.setTimeout(stepTick, 55);
        };
        workspace.progressTimer = window.setTimeout(stepTick, 35);
        if (workspace.id === activeWorkspaceId) renderLog(workspace);
    }

    function renderLog(workspace) {
        const log = byId('social-tool-log');
        if (!log) return;
        const entries = workspace && Array.isArray(workspace.logs) && workspace.logs.length ? workspace.logs : ['运行日志'];
        const progress = getWorkspaceProgress(workspace);
        log.innerHTML = `
            <div class="social-tool-progress">
                <div class="social-tool-progress-meta">
                    <span>${escapeHtml(progress.label)}</span>
                    <span>${progress.percent}%</span>
                </div>
                <div class="social-tool-progress-track">
                    <div class="social-tool-progress-fill" style="width:${progress.percent}%;"></div>
                </div>
            </div>
            ${entries.map((entry) => `<div>${entry}</div>`).join('')}
        `;
        log.scrollTop = log.scrollHeight;
    }

    function logDebug(message, workspaceId = activeWorkspaceId) {
        const workspace = getWorkspace(workspaceId) || getActiveWorkspace();
        const item = document.createElement('div');
        const time = new Date().toLocaleTimeString();
        item.innerHTML = `<span style="opacity:.7;">[${escapeHtml(time)}]</span> ${message}`;
        workspace.logs.push(item.innerHTML);
        renderWorkspaceRail();
        if (workspace.id === activeWorkspaceId) renderLog(workspace);
    }

    async function fetchExportImageBlob(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
    }

    function downloadExportBlob(filename, blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1200);
    }

    async function fallbackDownloadWorkspaceExport(workspace, copyText, successImages) {
        const dateName = formatDateFolderName();
        const failed = [];
        downloadExportBlob(`${dateName}-copy.txt`, new Blob([`\ufeff${copyText || '暂无文案'}`], { type: 'text/plain;charset=utf-8' }));
        for (let index = 0; index < successImages.length; index += 1) {
            const result = successImages[index];
            try {
                const blob = await fetchExportImageBlob(result.url);
                const extension = getImageFileExtension(result.url, blob);
                const name = sanitizeFilename(result.templateName || `image-${index + 1}`, `image-${index + 1}`);
                downloadExportBlob(`${dateName}-image-${String(index + 1).padStart(2, '0')}-${name}.${extension}`, blob);
            } catch (error) {
                failed.push(`image-${index + 1}: ${result.url}`);
            }
        }
        if (failed.length) {
            downloadExportBlob(`${dateName}-image-download-links.txt`, new Blob([`\ufeff${failed.join('\n')}`], { type: 'text/plain;charset=utf-8' }));
            showToast('部分远程图片受跨域限制，已导出链接清单', true);
        } else {
            showToast('当前浏览器不支持文件夹选择，已改为普通下载');
        }
    }

    async function exportCurrentWorkspace() {
        saveActiveForm();
        const workspace = getActiveWorkspace();
        if (workspace.isLoading) {
            showToast('请等待当前生成完成后再导出', true);
            return;
        }
        const copyText = buildExportCopyText(workspace);
        const successImages = Array.isArray(workspace.imageResults)
            ? workspace.imageResults.filter((item) => item && item.status === 'success' && item.url)
            : [];
        if (!copyText && successImages.length === 0) {
            showToast('暂无可导出的文案或图片', true);
            return;
        }
        if (!window.showDirectoryPicker) {
            await fallbackDownloadWorkspaceExport(workspace, copyText, successImages);
            return;
        }

        try {
            const rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            const exportHandle = await rootHandle.getDirectoryHandle(formatDateFolderName(), { create: true });
            await writeFileToDirectory(
                exportHandle,
                'copy.txt',
                new Blob([`\ufeff${copyText || '暂无文案'}`], { type: 'text/plain;charset=utf-8' })
            );

            const failed = [];
            for (let index = 0; index < successImages.length; index += 1) {
                const result = successImages[index];
                try {
                    const blob = await fetchExportImageBlob(result.url);
                    const extension = getImageFileExtension(result.url, blob);
                    const name = sanitizeFilename(result.templateName || `image-${index + 1}`, `image-${index + 1}`);
                    await writeFileToDirectory(exportHandle, `image-${String(index + 1).padStart(2, '0')}-${name}.${extension}`, blob);
                } catch (error) {
                    failed.push(`image-${index + 1}: ${result.url}`);
                }
            }

            if (failed.length) {
                await writeFileToDirectory(
                    exportHandle,
                    'image-download-links.txt',
                    new Blob([`\ufeff${failed.join('\n')}`], { type: 'text/plain;charset=utf-8' })
                );
                showToast('已导出文案；部分远程图片受跨域限制，已保存链接清单', true);
            } else {
                showToast(`已导出到 ${formatDateFolderName()} 文件夹`);
            }
        } catch (error) {
            if (error && error.name === 'AbortError') return;
            console.error(error);
            showToast('导出失败，请检查文件夹权限或图片链接', true);
        }
    }

    async function copyText() {
        const workspace = getActiveWorkspace();
        if (!workspace.textResult || !workspace.textResult.content) {
            showToast('暂无可复制的文案', true);
            return;
        }
        const text = workspace.textResult.content;
        const tagList = workspace.textResult && Array.isArray(workspace.textResult.hashtags)
            ? workspace.textResult.hashtags.map((tag) => String(tag || '').startsWith('#') ? String(tag || '') : `#${tag}`)
            : Array.from((byId('social-tool-tags') && byId('social-tool-tags').children) || []).map((item) => item.textContent);
        const hashtags = tagList.filter(Boolean).join(' ');
        const fullText = [text, hashtags].filter(Boolean).join('\n\n').trim();
        if (!fullText || fullText === '等待生成中...') return;
        try {
            if (window.navigator.clipboard && window.isSecureContext) {
                await window.navigator.clipboard.writeText(fullText);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = fullText;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            }
            showToast('文案和标签已复制');
        } catch (err) {
            showToast('复制失败，当前环境不支持该操作', true);
        }
    }

    function showToast(message, isError = false) {
        const toast = byId('social-tool-toast');
        if (!toast) return;
        toast.textContent = message;
        toast.className = `social-tool-toast show${isError ? ' error' : ''}`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.className = 'social-tool-toast';
        }, 2600);
    }

    window.openSocialMediaTool = open;
    window.closeSocialMediaTool = close;
    window.VeoSocialMediaTool = {
        open,
        close,
        init,
        getSettings: () => ({ ...settings })
    };
})(window, document);
