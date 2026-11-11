# 社媒内容工作台 · API 独立版

从 `goog205118-art/veo-pal` 的“社媒”功能中提取，保留原有内容制作流程，替换请求层。独立运行，无需原工作台和 n8n。

支持直接部署到 Vercel。导入仓库后，先设置 `DEMO_MODE=true` 体验；使用真实模型时填写 `APP_ACCESS_CODE` 和两组 API 环境变量。完整步骤见 [Vercel 部署说明](docs/VERCEL.md)。

## 先体验

需要 Node.js 22 或更高版本，不需要安装 npm 依赖。

Windows 双击 `start-demo.cmd`，或者在本目录执行：

```powershell
node server.mjs --demo
```

浏览器打开 `http://127.0.0.1:8787`。演示模式会显示黄色提示，文案和配图均为模拟结果，用于检查流程，不会调用收费模型。上传一张 PNG、JPEG 或 WebP 图片即可体验。

## 接入真实 API

1. 将 `.env.example` 复制为 `.env`。
2. 填写文字与图片服务各自的供应商类型、地址、模型和密钥。
3. 双击 `start-api.cmd`，或执行 `node server.mjs`。
4. 浏览器打开服务地址，在设置中检查配置状态，再上传商品图开始制作。

修改 `.env` 后需要重启。真实模式缺少配置会明确报错，不会使用模拟数据。模型名故意留空，请填写你的供应商当前实际可用的模型。

支持两种文字协议和三种图片协议：

| 用途 | 配置值 | 请求方式 |
| --- | --- | --- |
| 文字 | `gemini` | Gemini 原生多模态 `generateContent` |
| 文字 | `compatible` | `/chat/completions`，带图片与 JSON 输出 |
| 图片 | `gemini` | Gemini 原生图片生成，传商品参考图和比例 |
| 图片 | `compatible` | `/images/edits`，通过 multipart 传商品参考图 |
| 图片 | `custom` | 直接调用自定义 JSON API，可配置异步轮询 |

接入参数和请求示例见 [API 接入说明](docs/API.md)。未指定供应商的特有字段需要按其接口文档补充到 `server/providers.mjs`。

## 保留的功能

- 最多 5 张商品参考图：选择文件、拖入、悬停上传区域后 Ctrl+V 粘贴。
- 商品描述、活动/场景、贴文引导链接。
- 多模态生成贴文正文、Hashtags 和视觉主题；默认沿用原版英文营销风格，可在设置改成中文。
- 每次 1–5 张配图；每张单独选择海报/场景模板和比例。
- 四个原版预设模板、模板新增删除、模板变量替换。
- 多工作区、逐张结果反馈、日志、进度、失败重试、单图重新生成。
- 模拟社媒贴文预览、双击大图、文案连同标签复制。
- 导出 `copy.txt` 与图片；支持文件夹选择，其他浏览器使用普通下载。
- 可选微裁切后处理；默认关闭，保留原图边缘。

模板和风格设置保存在浏览器本地。参考图、工作区和生成结果保留在当前页面内存中，刷新页面会清空，请及时导出。它是内容制作工具，不会替你发布到社交平台。

## 文件结构

```text
public/                 独立前端，无 CDN 依赖
  js/social-media-tool.js  从原项目提取的业务与界面
  js/api-client.js       调用本机 API 的唯一入口
  js/boot.js             启动与本地图标
server.mjs              本机服务、路由和生成图片读取
server/config.mjs       .env 与公开配置摘要
server/providers.mjs    文字/图片供应商适配器
tests/api.test.mjs       不消耗真实额度的接口测试
docs/                   项目全览、接入说明、验证记录与截图
```

调用关系为：`浏览器 → 本机 Node API → 模型供应商`。API 密钥只从服务端 `.env` 读取，不发送给浏览器，也不写入浏览器存储。

本地服务监听 `127.0.0.1`。Vercel 通过独立 Serverless 入口提供在线 API，带访问口令、无状态会话和图片读取。

## 检查

```powershell
node --test tests/api.test.mjs
```

已完成的自动化与浏览器验收见 [验证记录](docs/VALIDATION.md)。真实模型联调尚未进行，需要你提供的供应商配置。

原项目架构、提取范围和来源见 [项目全览与提取说明](docs/PROJECT_REVIEW.md)。
