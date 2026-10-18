# Admin Auth and Protection

<p align="right">
  <b>English</b> | <a href="./admin-auth-protection.zhCN.md">中文</a>
</p>

This document covers admin console authentication, application-layer protections already enabled, and edge protections recommended for production.

## Auth modes

The current version supports two admin auth modes:

- Basic: validate `ADMIN_TOKEN` only
- Enhanced: after Telegram `Bot Token` / `Chat ID` are configured and verified in System Settings, enable Telegram verification-code login

Current auth and security highlights:

- The admin console uses a session cookie instead of sending the admin token on every request
- Session TTL depends on security level: 7 days without Telegram verification, 30 days with it
- Login, code verification, and Telegram notifications are rate-limited at the app layer
- API docs can be disabled in System Settings; when off, `/api/docs`, `/api/redocs`, and `/api/openapi.json` return `404`

Do not rely on application logic alone in production — also configure Cloudflare WAF / Rate Limiting.

## Application layer

Protections already enabled:

- `/api/admin/auth/login` is rate-limited per IP; excess returns `429`
- Repeated admin-token failures enter a freeze window after a threshold
- `/api/admin/auth/verify` is rate-limited per IP; excess returns `429`
- Repeated verification-code failures enter a freeze window after a threshold
- Verification challenges bind to the first request IP; a source change requires a new code
- Telegram verification-code notifications are throttled per IP and globally
- Telegram login-result notifications are throttled per IP and globally; excess is silently skipped

## Related settings

Auth and protection settings live mainly under **System Settings**:

- Telegram admin verification toggle
- Telegram `Bot Token` / `Chat ID`
- API docs toggle

Suggested flow:

1. Configure `ADMIN_TOKEN` first
2. Fill in Telegram settings
3. Send a test message and complete verification
4. Enable Telegram 2FA
5. Decide whether to disable API docs based on exposure

## Edge layer

App-layer rate limits do not replace Cloudflare edge enforcement. In production, add WAF / Rate Limiting:

- Protect paths:
  - `POST /api/admin/auth/login`
  - `POST /api/admin/auth/verify`
- Recommended match expression:

```txt
http.request.method eq "POST" and (
  http.request.uri.path eq "/api/admin/auth/login" or
  http.request.uri.path eq "/api/admin/auth/verify"
)
```

- Recommended counting dimensions:
  - `ip.src`
  - `cf.colo.id`
- Recommended actions:
  - Prefer `Managed Challenge`
  - Use `Block` under high-volume attack
- Suggested starting thresholds:
  - `login`: 5 per minute
  - `verify`: 8 per minute
  - Mitigation duration: 15 minutes

## Rollout order

1. Create login rate-limit rules in the Cloudflare dashboard or API
2. Watch whether app-layer `429`s still spike
3. Finish Telegram verification setup and confirm session login works
4. Decide whether to disable API docs based on real exposure
5. If Telegram spam or admin-port scanning continues, tighten edge thresholds further
