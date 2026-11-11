# Vercel 静态部署

导入 goog205118-art/autoHSU：

| 设置 | 值 |
| --- | --- |
| Framework Preset | Other |
| Root Directory | ./ |
| Build Command | node scripts/check.mjs |
| Output Directory | public |
| Node.js | 22.x |
| Environment Variables | 无需填写 |

vercel.json 已包含以上构建与输出配置。没有 Functions、API 路由或登录入口。旧版本设置过的环境变量不会再被读取，可在 Vercel 设置中删除。

推送 main 后自动部署。打开页面即可浏览；调用模型时在页面右上角「设置」填写 API 地址、Key 与模型，保存后上传参考图生成。

图片与文案请求由浏览器直接发往服务商，不经过 Vercel Functions。服务商须支持浏览器跨域（CORS）；若不支持，纯静态部署无法代替其开放跨域权限。

「读取可用模型」只进行 GET /models 查询。模型名可手动填写。没有真实 Key 时不会自动请求供应商。

构建运行语法检查和 11 项模拟测试，不需要密钥，也不会消耗模型额度。页面验收记录见 VALIDATION.md。API 参数见 API.md。
