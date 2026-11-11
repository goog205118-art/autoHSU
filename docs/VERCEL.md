# Vercel 部署

仓库内容已包含静态前端、Node Serverless API、路由、环境变量样例和构建检查。无需 n8n，无需额外数据库，无需安装前端构建框架。

## 导入仓库

在 Vercel 新建项目，选择 `goog205118-art/autoHSU`：

| 设置 | 值 |
| --- | --- |
| Framework Preset | Other |
| Root Directory | 仓库根目录 `./` |
| Build Command | 自动读取 `vercel.json` 中的 `node scripts/check.mjs` |
| Output Directory | `public` |
| Node.js | `package.json` 固定为 22.x，已用 22.23.4 验证 |

根目录就是当前项目目录，不需要填写 `outputs/veo-social-standalone`。

## 首次只看界面

设置 `DEMO_MODE=true` 后部署。演示模式的文案和图片均为模拟结果，页面有明确提示，不调用模型。可以额外设置至少 12 位的 `APP_ACCESS_CODE`，为演示页面加访问口令。

## 使用真实 API

在项目 Settings → Environment Variables 填写以下变量，然后重新部署：

| 变量 | 内容 |
| --- | --- |
| `DEMO_MODE` | `false`，或删除该变量 |
| `APP_ACCESS_CODE` | 你自己设置的工作台口令，至少 12 位 |
| `TEXT_PROVIDER` | `gemini` 或 `compatible` |
| `TEXT_API_BASE_URL` | 文本服务版本前缀地址 |
| `TEXT_API_KEY` | 文本服务密钥 |
| `TEXT_MODEL` | 支持图片输入和 JSON 输出的模型名 |
| `IMAGE_PROVIDER` | `gemini`、`compatible` 或 `custom` |
| `IMAGE_API_BASE_URL` | 图片服务版本前缀地址，custom 可省略 |
| `IMAGE_API_KEY` | 图片服务密钥 |
| `IMAGE_MODEL` | 支持商品参考图的模型名 |

custom 模式还需要 `IMAGE_SUBMIT_URL` 和可选 `IMAGE_POLL_URL`。各协议的完整例子见 [API.md](API.md)。

首次进入工作台时输入 `APP_ACCESS_CODE`，登录保持 12 小时。口令只用于进入工作台，和模型 API 密钥不同。真实线上模式没有配置合格口令时，生成接口不会开放。

Vercel 的 Production、Preview 环境变量分别设置；更新变量后需 Redeploy。不要把 `.env` 或真实密钥上传 GitHub。

## 针对 Serverless 的处理

- 静态资源直接由 `public/` 发布。
- 所有 API 通过 `api/gateway.mjs` 统一入口运行，`vercel.json` 负责 `/api/*` 路由。
- 每次函数最长配置 300 秒，内部默认上游请求超时 180 秒，自定义任务默认最多等待 240 秒。
- 参考图请求自动压缩，控制整个 JSON 请求在 3.5 MB 内；大图可能转为 JPEG，透明区域填白。
- Base64 生成结果和图片读取使用分块响应，不主动缩小模型生成的图片。
- 远程图片地址使用加密令牌读取，不依赖函数内存 Map，也不依赖本地文件。
- 访问会话同样采用无状态签名，函数冷启动后无需重新登录。
- 页面内的工作区与结果在刷新后清空，请及时导出。设置和模板保存在当前浏览器。

这些设计无需数据库。超过单次函数时长的供应商任务，需要进一步改为客户端轮询加持久任务记录；当前接口会明确报超时。

## 部署后检查

打开部署地址，确认：输入访问口令可以进入；设置页显示文本/图片已配置；上传一张商品图，先选择 1 张配图测试完整链路；成功后再使用多图并发。

构建阶段会运行语法检查与 12 项模拟接口测试。仓库中没有真实供应商密钥，部署成功不代表供应商鉴权和余额已经验证。

Vercel 参考文档：

- `https://vercel.com/docs/functions/runtimes/node-js`
- `https://vercel.com/docs/functions/limitations`
- `https://vercel.com/docs/functions/configuring-functions/duration`
