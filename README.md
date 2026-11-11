# 社媒内容工作台 · 网页直连版

从 veo-pal 的社媒功能提取，保留商品参考图、文案标签、多工作区、海报/场景模板、逐图比例、生成重试、预览和导出。

当前为纯静态网页。打开即可浏览，不需要访问口令、环境变量、云函数或 n8n。API 接入参照 goog205118-art/gptimagemt：在网页设置中填写自己的地址和 Key，由浏览器直接调用供应商。

## Vercel 部署

导入 goog205118-art/autoHSU，Framework 选 Other，根目录 ./，Node 22.x。仓库已配置构建命令 node scripts/check.mjs 和输出目录 public。不需要填写环境变量。已存在的旧版环境变量不再使用，可以删除。

部署后直接打开工作台。只看页面时无需填写任何连接。

## 接入 API

打开右上角「设置」：

1. 填 API 地址（默认 https://api.openlux.ai/v1）与自己的 Key。
2. 填当前 Key 实际可用的图片模型及支持看图的文案模型。可点击「读取可用模型」，也可手动填 ID。
3. 文案默认复用图片地址与 Key；也可取消勾选，填写独立文案连接。
4. 保存设置，返回工作台，上传商品图并生成。

图片请求为 /images/edits，multipart 重复 image 字段传送原始参考图，Bearer Key 鉴权。文案默认使用 /responses，可切换 /chat/completions。具体参数和限制见 [API.md](docs/API.md)。

默认仅在当前页面内存保存 Key，刷新后重新填写；勾选「在当前浏览器记住 Key」后存入本地存储。取消勾选并保存会清除已保存的两个 Key。设置和模板保存在当前浏览器；工作区、参考图和生成结果刷新后清空，请及时导出。

与纯网页直连方式相应，供应商须允许浏览器跨域（CORS）连接。本站不转发请求、不在服务端存储 Key。模型、额度和真实生成效果以你的供应商为准；没有收到真实 Key，本次只进行了模拟上游验证。

## 本地预览和检查

需要 Node.js 22+，没有 npm 依赖。

~~~sh
node scripts/serve.mjs
node scripts/check.mjs
~~~

或在 Windows 双击 start.cmd。打开 http://127.0.0.1:8787。此预览程序只发布静态文件，不处理模型请求。

## 文件

- public/：完整可部署网页。
- public/js/direct-api.js：浏览器连接、请求组装、结果解析。
- public/js/social-media-tool.js：原社媒界面与业务流程。
- scripts/：本地静态预览和构建检查。
- tests/：模拟接口测试及 Chromium 页面验收。
- docs/：部署、协议、项目全览和验证记录。

来源及提取范围见 [PROJECT_REVIEW.md](docs/PROJECT_REVIEW.md)。
