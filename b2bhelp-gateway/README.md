# MASTER AI — B2BHelp Message Center

All marketplace messaging goes through B2BHelp:

```text
MASTER AI -> B2BHelp -> Avito
```

MASTER AI must never send requests to Avito or store Avito API credentials. B2BHelp's official API docs are at `https://user.dev.b2b-help.ru/docs/readme`; its documented API host is `https://dev.b2b-help.ru`.

## Implemented API contract

The gateway uses the official `msg-center` methods:

| Operation | B2BHelp route | Scope |
| --- | --- | --- |
| List connected message-center accounts | `GET /msg-center/accounts` | `msg-center.get_accounts` |
| List chats | `GET /msg-center/chats` | `msg-center.get_chats` |
| Get a chat's messages | `GET /msg-center/chat/messages` | `msg-center.get_chat_messages` |
| Mark a chat read | `POST /msg-center/chat/read` | `msg-center.read_chat` |
| Send a text message | `POST /msg-center/chat/messsage/send` | `msg-center.send_message` |

The upstream token is sent as `Authorization: <API_TOKEN>` with no `Bearer` prefix. The text send method has a 1000-character maximum. The documented message list endpoints use page/limit pagination. The gateway makes no background polling; reads happen on an explicit app request.

The API docs do not specify the incoming webhook event schema or signature. The gateway therefore does not subscribe to webhooks yet. The message response schema also leaves individual message properties unspecified, so the UI must be checked against a real account response before enabling production conversation rendering.

## Runtime

The preferred production adapter for this CRM is the PHP gateway under `regru/`, deployed on the existing REG.RU shared hosting. The standalone Node.js 22+ HTTP service and Dockerfile remain available for a compatible host, but the CRM does not depend on Vercel. The inspected REG.RU account has an active shared Host-A plan with PHP/SSH; Node.js or Docker support is not established for that plan, so use the tested PHP adapter there.

The standalone service exposes `/api/health`, `/api/accounts`, `/api/chats`, `/api/pull`, `/api/messages`, `/api/read`, and `/api/send`. Set `CRM_ALLOWED_ORIGINS` to a comma-separated list of exact CRM origins once the production domain is known.

## Server environment

Required only on the server. Set these variables in the hosting control panel, service manager, or container runtime. The standalone server does not load `.env` files; `.env.example` is a list of variable names and must not contain real credentials:

- `B2BHELP_API_TOKEN` — create a token with only the five scopes listed above.
- `FIREBASE_WEB_API_KEY` — used to verify the CRM ID token.
- `FIREBASE_PROJECT_ID=master-ai-beta-9440599`
- `FIREBASE_WORKSPACE_ID=master-ai-beta`

Never put `B2BHELP_API_TOKEN` in `cloud-config.js`, HTML, service worker, or browser JavaScript. The gateway authorizes Firebase roles `owner` and `dispatcher_logistic` before every B2BHelp API call. See `.env.example` for variable names only; never commit real values.

The REG.RU account was inspected. No service, domain, or server was changed or purchased. The linked `.ru` domain is due for renewal on 2026-10-11; its automatic renewal is enabled, but the account showed a zero balance. The displayed “renew for free” offer requires renewing Host-A for 12 months, so it is not a no-cost renewal unless that hosting purchase is made. The active Host-A plan runs through 2026-10-28.

## Runtime status

- No direct Avito requests or Avito credentials are used by this gateway.
- B2BHelp's IP/device privacy statement applies to its API-key-based Avito account connection. It does not mean Avito cannot see the seller account, message activity, or B2BHelp's server-side requests.
- No destructive account enable/disable scopes are used.
- No repeated full-history sync is performed.
