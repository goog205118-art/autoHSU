# API 接入说明

## 调用分层

前端只调用本机 `/api/text` 和 `/api/images`。供应商 URL 和密钥由服务端 `.env` 决定，运行过程中不经过 n8n 或原项目的 Wally 服务。

`GET /api/config` 仅返回协议类型、模型名、是否已配置和是否演示模式。它不执行付费请求，也不验证密钥是否有效。

### Gemini 原生协议

```dotenv
TEXT_PROVIDER=gemini
TEXT_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta
TEXT_API_KEY=填你的文字密钥
TEXT_MODEL=填可用的多模态文本模型

IMAGE_PROVIDER=gemini
IMAGE_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta
IMAGE_API_KEY=填你的图片密钥
IMAGE_MODEL=填支持原生图片生成的模型
```

Base URL 填到版本前缀，不要带 `/models/模型名:generateContent`。服务端自动添加该路径，并用 `x-goog-api-key` 请求头认证。

文字请求包含商品参考图、可编辑风格提示词、固定 JSON 输出要求和动态商品信息；返回正文、标签、主题。图片请求包含模板生成的提示词、同组商品参考图和单图 `aspectRatio`。所选模型必须支持相应能力；供应商网关若不支持图片配置参数，需在适配器中按其文档调整。

### Compatible 兼容协议

```dotenv
TEXT_PROVIDER=compatible
TEXT_API_BASE_URL=https://你的供应商域名/v1
TEXT_API_KEY=填你的密钥
TEXT_MODEL=填支持图片输入和JSON输出的模型

IMAGE_PROVIDER=compatible
IMAGE_API_BASE_URL=https://你的供应商域名/v1
IMAGE_API_KEY=填你的密钥
IMAGE_MODEL=填支持图像编辑的模型
IMAGE_SIZE_MODE=standard
```

Base URL 填到 API 版本前缀，程序分别添加 `/chat/completions` 和 `/images/edits`。使用 `Authorization: Bearer ...`。

文字请求使用 `messages[].content` 中的 `text` 与 `image_url`，并请求 `response_format=json_object`。

图片请求使用 multipart，字段为 `model`、`prompt`、`n=1`、`size` 和多个 `image[]` 文件。供应商必须支持这些字段；只提供 `/images/generations` 的文生图接口不能直接代替它，否则商品参考图会丢失。字段命名不同的服务应新增适配器。

`IMAGE_SIZE_MODE=standard` 将正方形、横图、竖图分别映射为 `1024x1024`、`1536x1024`、`1024x1536`，适合只接受固定尺寸的服务。**此模式下实际文件比例可能与选择的 4:5、9:16 等不完全相同**，界面仍按所选比例预览。如果供应商支持任意尺寸，改为 `IMAGE_SIZE_MODE=provider`，原样发送每张图的目标尺寸。需要严格比例时，优先使用明确支持该比例的图片服务。

图片响应支持 `data[0].url` 或 `data[0].b64_json`。远程图片地址会转换为本机临时资源地址，以便预览和导出，避免浏览器跨域下载问题。远程图片读取链接采用加密的无状态令牌，有效期 4 小时；在访问口令保持不变时，可跨函数实例读取。请及时导出。

### 自定义图片 JSON API

适合后续自建服务或已有的供应商代理，不需要引入工作流引擎。

```dotenv
IMAGE_PROVIDER=custom
IMAGE_API_KEY=填你的密钥
IMAGE_MODEL=填模型标识
IMAGE_SUBMIT_URL=https://你的服务/api/images
IMAGE_POLL_URL=https://你的服务/api/tasks/{taskId}
```

向 `IMAGE_SUBMIT_URL` 发出 POST，附 Bearer 密钥，JSON 如下：

```json
{
  "model": "your-image-model",
  "prompt": "由原版模板和主题组合的提示词",
  "images": ["data:image/png;base64,..."],
  "ratio": "4:5",
  "size": "1024x1280",
  "n": 1
}
```

同步响应任选一种：

```json
{"url":"https://你的图片域名/result.png"}
```

```json
{"data":[{"b64_json":"图片的base64内容"}]}
```

异步响应：

```json
{"task_id":"task-123","status":"processing"}
```

随后程序会 GET `IMAGE_POLL_URL`，将 `{taskId}` 替换为经过 URL 编码的任务 ID，并使用同一 Bearer 密钥。处理中可返回 `{"status":"processing"}`；成功时返回上面的图片格式；失败时返回 `{"status":"failed"}`。顶层或 `data` 对象下的 `task_id`、`taskId`、`id` 均可识别。失败状态优先于响应中的旧图片地址。

供应商如采用 POST 轮询、其他鉴权头、不同响应字段，修改 `server/providers.mjs` 的 custom 分支即可，不影响界面和模板。

## 本机接口契约

`POST /api/text` 请求：

```json
{"prompt":"风格提示词+JSON协议+商品描述","images":["data:image/png;base64,..."]}
```

响应：

```json
{"content":"正文","hashtags":["#tag"],"theme":"English visual theme"}
```

`POST /api/images` 请求：

```json
{"prompt":"完整生图提示词","images":["data:image/png;base64,..."],"ratio":"4:5","size":"1024x1280"}
```

响应：`{"url":"data:image/png;base64,..."}` 或本机 `/api/assets/...` 地址。

所有错误返回 HTTP 错误状态和 `{"error":"可读错误信息"}`。上传限制：1–5 张 PNG/JPEG/WebP；每张 Base64 编码后不超过 12 MB；本机单次 JSON 请求不超过 40 MB，Vercel 线上版不超过 3.5 MB。前端会按总预算压缩参考图，必要时转为 JPEG 并将透明区域填白。

## 后续接入自己的业务系统

保留前端 `/api/text`、`/api/images` 的契约，就可以将 Node 适配层迁入现有后端。浏览器调用入口集中在 `public/js/api-client.js`；供应商差异集中在 `server/providers.mjs`。如需前后端分域部署，需自行配置认证及允许来源。
