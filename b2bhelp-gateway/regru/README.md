# REG.RU shared-hosting gateway

This is the PHP 8.2+ adapter for the existing REG.RU Host-A shared hosting. It is designed to live in a separate `api/` directory beside the current site files, leaving `index.html` and the rest of the public site untouched.

## Files and secrets

- Upload `api/index.php` and `api/.htaccess` into a new `/www/<domain>/api/` directory.
- Keep configuration outside `www`, at `/var/www/<hosting-user>/data/b2bhelp-config.php`.
- Use `config.sample.php` only as a template. Fill the private config on the server; never upload it under `www` or commit the real token.
- The API trusts only the exact CRM origin in `CRM_ALLOWED_ORIGINS`, verifies Firebase ID tokens and active owner/logistics membership, then calls only `https://dev.b2b-help.ru`.

This keeps staff browsers from connecting directly to Avito: browser traffic goes to the CRM host and this gateway, and this gateway calls B2BHelp. It does not guarantee that Avito is unaware of the connected seller account or messages; B2BHelp's upstream relationship and Avito's own service-side records are outside this gateway's control.

Endpoints are `/api/health`, `/api/accounts`, `/api/chats`, `/api/pull`, `/api/messages`, `/api/read`, `/api/send`, and `/api/website-leads`. There is no polling or webhook subscription.

The public `POST /api/website-leads` route accepts consented inquiries from the static `chinilkin/` site, validates fields, applies a per-IP rate limit, and writes to private JSON files outside `www` using file locking and mode `0600`. It keeps only an HMAC of the client IP for rate limiting; the raw IP is not stored. Authenticated `GET` and `POST /api/website-leads` are limited to active owner and dispatcher-logistic members for listing and updating lead stage/order link. The website form sends only the page path, not the full URL/query string. Verify that PHP can write to the hosting account's private `data/` directory before publishing this route.

Test the receiver without creating a lead by sending an empty JSON object with the allowed CRM `Origin`; it should return `400 fields`. A request from a disallowed `Origin` should return `403 origin`. Do not use real customer details for smoke tests. The adapter must be tested on the target PHP runtime before serving CRM traffic.

No B2BHelp token is included in this repository. The live REG.RU installation keeps its token and Firebase verification settings in the private file outside `www`; deployments must preserve that file and its restrictive permissions. The authenticated `/health` route reports only whether the token is configured, never the token value.
