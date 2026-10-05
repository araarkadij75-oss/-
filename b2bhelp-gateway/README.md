# MASTER AI — B2BHelp Message Center Gateway

This gateway is the only planned messaging integration path for Avito-originated conversations.

```
Avito -> B2BHelp -> MASTER AI
```

MASTER AI must **not** authenticate to or call Avito directly.

## Current state

The B2BHelp account has a dedicated API token with the following least-privilege scopes:

- `msg-center.get_accounts`
- `msg-center.subscribe_webhook`
- `msg-center.get_chats`
- `msg-center.get_chat_messages`
- `msg-center.read_chat`
- `msg-center.send_message`
- `msg-center.send_message_file`
- `msg-center.unsubscribe_webhook`

The token value is intentionally not stored in this repository.

## Server-only environment

Required:

- `B2BHELP_API_TOKEN`
- `B2BHELP_API_BASE_URL` — set only from the official B2BHelp API documentation
- `FIREBASE_WEB_API_KEY`
- `FIREBASE_PROJECT_ID=master-ai-beta-9440599`
- `FIREBASE_WORKSPACE_ID=master-ai-beta`

Reserved for webhook verification once the official webhook contract is confirmed:

- `B2BHELP_WEBHOOK_SECRET`

Do not place these values in `cloud-config.js`, any HTML file, service worker, or browser JavaScript.

## Safety contract

1. No direct Avito client credentials or Avito API calls.
2. B2BHelp token is server-only.
3. Browser requests to this gateway require a Firebase ID token and a permitted MASTER AI role.
4. Incoming messages will be deduplicated by the stable B2BHelp message identifier before any CRM mutation.
5. A conversation can link to at most one canonical MASTER AI order unless an owner explicitly creates another.
6. Webhook processing must be idempotent and safe to retry.
7. No destructive B2BHelp scopes are required.

## Blocked on official API contract

The B2BHelp developer UI exposes “Документация API”, but the exact upstream base URL, authorization header format, request payloads, webhook payload/signature and subscription parameters have not yet been read. No guessed upstream request code is committed.

Once the documentation page is available, implement only the documented contract for accounts, chats, messages, send, read-chat and webhook subscribe/unsubscribe.
