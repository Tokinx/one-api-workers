# 管理员认证与防护

<p align="right">
  <a href="./admin-auth-protection.md">English</a> | <b>中文</b>
</p>

本文档聚焦管理后台的认证方式、当前已启用的应用层保护，以及生产环境建议补齐的边缘层防护。

## 认证模式

当前版本支持两种后台认证模式：

- 基础模式：仅校验 `ADMIN_TOKEN`
- 增强模式：在系统设置中配置并验证 Telegram `Bot Token` / `Chat ID` 后，启用 Telegram 验证码登录

当前实现的认证与安全要点：

- 管理后台使用 session cookie，而不是每次请求直接传管理员令牌
- session 有效期按登录安全级别区分：未启用 Telegram 验证时为 7 天，启用后为 30 天
- 登录、验证码验证和 Telegram 通知都带应用层限速
- API 文档可在系统设置中关闭；关闭后 `/api/docs`、`/api/redocs`、`/api/openapi.json` 会直接返回 `404`

生产环境不要只依赖应用层逻辑，仍应额外配置 Cloudflare WAF / Rate Limiting。

## 应用层

当前版本已在应用层启用以下保护：

- `/api/admin/auth/login` 按 IP 统计请求频率，超限后返回 `429`
- 管理员令牌连续失败达到阈值后进入冻结窗口
- `/api/admin/auth/verify` 按 IP 统计请求频率，超限后返回 `429`
- 验证码连续失败达到阈值后进入冻结窗口
- 验证码 challenge 绑定首次请求 IP，来源变化后要求重新获取验证码
- Telegram 验证码通知按 IP 和全局双层节流
- Telegram 登录结果通知按 IP 和全局双层节流，超限后静默跳过

## 相关配置

认证与防护相关设置主要位于管理后台的 `System Settings` 页面：

- Telegram 管理员验证开关
- Telegram `Bot Token` / `Chat ID`
- API 文档开关

建议流程：

1. 先配置 `ADMIN_TOKEN`
2. 在系统设置中填写 Telegram 配置
3. 发送测试消息并完成验证
4. 再启用 Telegram 二次验证
5. 根据暴露面决定是否关闭 API 文档

## 边缘层

应用层限速不能替代 Cloudflare 边缘层拦截。生产环境至少再加一层 WAF / Rate Limiting：

- 保护路径：
  - `POST /api/admin/auth/login`
  - `POST /api/admin/auth/verify`
- 推荐匹配表达式：

```txt
http.request.method eq "POST" and (
  http.request.uri.path eq "/api/admin/auth/login" or
  http.request.uri.path eq "/api/admin/auth/verify"
)
```

- 推荐计数维度：
  - `ip.src`
  - `cf.colo.id`
- 推荐动作：
  - 首选 `Managed Challenge`
  - 高频攻击场景可改为 `Block`
- 推荐起始阈值：
  - `login`: 1 分钟内 5 次
  - `verify`: 1 分钟内 8 次
  - 缓解时长：15 分钟

## 落地顺序

1. 先在 Cloudflare 控制台或 API 建立登录限速规则
2. 再观察应用层 `429` 是否仍大量出现
3. 完成 Telegram 验证配置并确认 session 登录链路正常
4. 根据实际暴露情况决定是否关闭 API 文档
5. 若仍有 Telegram 刷屏或管理口扫号，再继续收紧边缘层阈值
