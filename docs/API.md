# 网页 API 接入

参照仓库 goog205118-art/gptimagemt，固定阅读版本 859b6cae59c4236089d02995429aa53978358833。核对了 src/services/connection.js、images.js、models.js、src/features/jobs.js、api/agent.js 和 shared/model-ids.js。

保留其网页填写连接、Bearer 鉴权、图片直传、multipart image 字段、模型尺寸/质量/格式参数规则。当前社媒版为纯静态网页，文案和模型查询也直接发往供应商，不包含参考项目的 Agent/额度查询云函数。

## 页面设置

| 字段 | 行为 |
| --- | --- |
| API 地址 | 默认 https://api.openlux.ai/v1；也可填支持同协议的地址 |
| API Key | 当前页面内存使用；可选择记住于当前浏览器 |
| 图片模型 | 默认 gpt-image-2；请按当前 Key 可用列表选择 |
| 文案模型 | 默认沿用参考项目的 gpt-6.1-sol；须支持图片输入与 JSON 输出 |
| 文案协议 | 默认 Responses，可切换 Chat Completions |
| 文案复用图片连接 | 默认开启；关闭后可填独立地址与 Key |
| 请求超时 | 30–1800 秒，默认 300 秒 |
| 高级格式字段 | 自动、format、output_format；不自动重发修正请求 |

示例模型来自参考仓库，不保证当前服务商为你的 Key 开放了这些模型。读取列表只表明模型可见，不等于验证图片输入与 JSON 输出能力。

## 文案

默认 POST {base}/responses，Authorization: Bearer {key}。发送 model、store:false、stream:false、input 中的 input_text 与每张 input_image，text.format.type=json_object。读取 output_text 或 output message 中的 output_text。

兼容模式 POST {base}/chat/completions，发送 text/image_url 多模态 messages、stream:false 和 response_format.type=json_object。

两种协议都要求模型输出 content（非空正文）、hashtags（字符串数组）、theme（非空视觉主题）。提示词组合及后续配图模板仍由原社媒流程完成。

## 图片

有商品参考图时 POST {base}/images/edits，Authorization: Bearer {key}。浏览器生成 FormData 并设置 multipart boundary，代码不手填 Content-Type。

每张参考图使用同名 image 字段，保留原图字节，不压缩后经过云函数。参数有 model、prompt、n=1、size、quality。每张图独立请求，1–5 张配图保留原逐张反馈与手动重试。

沿用参考仓库的格式字段规则：OpenLux 的 GPT Image 2 使用 format；2.5 与其他兼容服务默认 output_format。2/2.5 请求 response_format=b64_json，旧模型按其规则设置 input_fidelity。可在高级设置手动指定格式字段。

GPT Image 2/2.5 与 chatgpt-image-latest 按所选比例发送预设尺寸，均满足参考仓库的 16 倍数与像素约束。旧模型使用 1024x1024、1024x1536、1536x1024，具体比例由供应商支持情况决定。2.5 提示词限 1000 字符，其他为 32000 字符；超出时提示精简，不截断原内容。

结果读取 data[0].b64_json 或 URL。Base64 图片直接在浏览器预览和导出；远程 URL 的下载和图片后处理还取决于图片地址的跨域权限。

## 请求失败

不会因断网、超时、限流、5xx 或格式不兼容自动重发付费生成。错误显示供应商状态和可操作提示。超时或断网后应先核对供应商任务记录，再决定是否手动重试。

没有网站访问口令、登录 Cookie、环境变量或服务端 Key。页面连接保存在本浏览器，不随 GitHub/Vercel 同步；不要把真实 Key 写入源代码。
