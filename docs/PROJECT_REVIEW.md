# 原项目全览与社媒模块提取说明

## 来源

- 仓库：`https://github.com/goog205118-art/veo-pal`
- 本次分析固定到提交：`ebff2a0c5fdfa47cf5f2e912e54dde9e92bd5e13`。
- 截图箭头对应入口：`index.html` 顶部 `onclick="openSocialMediaTool()"` 的“社媒”按钮。
- 原始实现：`js/social-media-tool.js`，2,201 行。
- 原始文件 SHA-256：`c249869be2f842ba36ab93fec60dcd267409985b3510ad76c6d06699b8bcdf5f`。
- 主要核对资料：主入口、开发文档、工作日志、54 个 `js/` 模块的结构和导出关系、CSS、表格工具与桌面助手源码。
- 全部前端模块索引见 `UPSTREAM_MODULES.json`。这些模块合计 17,923 行，索引用于定位边界，不代表每个模块都需要进入独立版。

仓库 README 偏重原先的画布与图片/视频功能；最新入口和 `WORKLOG.md` 还包含社媒、表格及 Office 表格功能。此次提取以固定提交中的实际代码为准。

## 原项目结构

| 区域 | 关键文件 | 职责 | 与社媒的关系 |
| --- | --- | --- | --- |
| 页面与启动 | `index.html`、`studio.html`、`js/index.html`、`app-bootstrap.js`、`app.js` | 按顺序加载全局脚本、恢复本地数据、绑定应用事件 | 原先提供社媒打开按钮及公共页面环境 |
| 展示页 | `launch-c*.html`、对应 CSS 和 `launch-c.js` | 独立展示入口 | 无运行依赖 |
| API 与模型 | `api-client.js`、`model-registry.js`、`image-core.js` | Wally/n8n 端点、模型元数据、图片路由 | 原社媒生图使用该链路 |
| 社媒 | `social-media-tool.js` | 商品图分析、文案、模板配图、多工作区、预览、导出 | 本次保留的主体 |
| 通用生图 | `image-*.js` | 参考图、蒙版、卡片、生图参数、提交、预览、异步任务 | 社媒原先可选复用部分工具函数 |
| 视频 | `video-*.js` | Veo 视频输入模式、模型、提交和轮询 | 无运行依赖 |
| 画布 | `canvas-*.js`、`viewport-culling.js`、`minimap.js`、`selection-toolbar.js` | 平移缩放、选择、布局、卡片渲染、小地图 | 无运行依赖 |
| 数据与工程 | `db.js`、`store.js`、`task-*.js`、`workspace-*.js` | IndexedDB、事件、任务、工程导入导出与输入 | 社媒原本维护自己的页面内存状态 |
| 素材与账单 | `material-library.js`、`billing.js`、`media-utils.js` | 公共素材、计费、图片编码工具 | 社媒原先可选通知账单刷新 |
| 网页表格 | `excel-tool.js` | 表格内容生成和导出 | 无运行依赖 |
| Office 表格 | `office-excel-tool.js`、`tools/officecli-bridge.mjs` | 生成 OfficeCLI 计划并连接本机助手 | 无运行依赖 |
| 桌面助手 | `desktop-assistant/` | Electron、托盘、本机 OfficeCLI 服务、更新和打包 | 服务 Office 表格功能，与社媒无运行依赖 |

原项目采用静态 HTML、CSS、经典全局 JavaScript，主网页没有 npm 构建链路；桌面助手是另一个有 `package.json` 的 Electron 子项目。模块通过 `window.Veo...` 和配置 hook 连接。

## 社媒原始流程

1. 选择工作区，上传最多 5 张商品图。
2. 填商品描述、节日/场景和引导链接。
3. 直接调用 Gemini 多模态文字模型，生成 `content`、`hashtags`、`theme`。
4. 前端将视觉主题与海报/场景模板组合，得到每张图的提示词。
5. 每张图选择自己的比例，通过 `VeoImageRequest` 和 `VeoApi.postEndpoint('image.unified')` 提交给原 n8n 图片服务。
6. 同步读取图片，或者收到任务 ID 后轮询。
7. 逐图更新预览和日志，支持失败重试、成功图重绘、复制与导出。

文字模型只负责文案和主题，配图提示词由前端模板产生。这项原始设计已保留。

## 提取时处理的依赖

| 原依赖 | 独立版处理 |
| --- | --- |
| 工作台顶栏按钮 | 独立 `public/index.html`，启动后直接进入社媒工作台 |
| 主 CSS 变量、弹窗、按钮和字体图标 | 本地基础样式、原社媒专用样式、本地 Unicode 图标，无 CDN |
| n8n 登录遮罩、会话密钥 | 移除；页面直接填写自己的 API 连接 |
| `VeoApi` 的 `image.unified` 与 webhook 轮询 | 浏览器直接调用 GPT Image `/images/edits` |
| `VeoImageCore`、`VeoModelRegistry` 的渠道元数据 | 独立图片模型配置，移除原专有渠道参数 |
| `VeoImageRequest` 的旧统一 payload | 各协议分别构建原生请求 |
| `VeoMedia`、全局图片响应解析器 | 浏览器 FormData 原图上传与结果归一化 |
| `VeoBilling.refreshBalanceAfterUsage()` | 提取后无账单模块依赖 |
| 原浏览器保存的 API Key | 在设置中填写，可选仅在当前浏览器记住 |

独立版的运行代码没有 n8n、Wally webhook 或 `stable_channel_*` 默认路由，也不加载任何画布/视频/表格脚本。

## 当前调用关系

独立社媒界面 → public/js/direct-api.js → 用户填写的 API 服务商。

图片使用 /images/edits；文案使用 /responses 或 /chat/completions。连接方式参照 gptimagemt 的 859b6ca 版本，详细差异见 API.md。

保留商品参考图、英文文案默认风格、四个模板、多工作区、1–5 张配图、逐图比例、手动重试重绘、日志、模拟贴文预览和导出。微裁切默认关闭。

按当前需求改为纯静态网页：移除网站访问口令、环境变量、云函数和演示 API。不连接模型也可浏览完整页面；用户在网页内设置自己的 API，图片原始字节由浏览器直接发送。
