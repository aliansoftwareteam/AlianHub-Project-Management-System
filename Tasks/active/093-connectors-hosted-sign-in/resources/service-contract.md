# Shared sign-in service — contract between a hosted instance and the service

Task 093 (instance side, AlianHub). The service itself is built in the alianhub-cloud repo (`docs/tasks/connector-sign-in/`, created with its PR) against this contract. Written 2026-11-12.

## Why it exists

Apps such as GitHub, Slack, HubSpot, Canva, Google and Microsoft need an OAuth app registered with the exact callback address. Hosted instances live on many domains, custom and white-label ones included, so Alian registers each app **once**, with one callback on the service. Every hosted instance signs its members in through it. The app secrets live only in the service; members' tokens live only on their own instance.

## Instance settings (set by the platform when it provisions a hosted instance)

| Variable | Meaning |
|---|---|
| `HOSTING_MODE=managed` | The instance is hosted by Alian |
| `INSTANCE_ID` | The instance's id in the platform (`ins_…`) |
| `PLATFORM_API_KEY` | The key the instance shares with the platform (32+ characters) |
| `CONNECTOR_SIGNIN_URL` | The service's https base, e.g. `https://connect.alianhub.com` |
| `CONNECTOR_SIGNIN_PROVIDERS` | The providers the service has an app for, e.g. `github,slack,hubspot,canva` |

With any of them missing, the instance never uses the service; a company's own app (and on self-hosted installs, the instance's app) works as before.

## Requests from an instance

Every request carries:
- `X-Instance-Id: <INSTANCE_ID>`
- `X-Timestamp: <milliseconds since epoch>`
- `X-Signature: base64url(HMAC-SHA256(PLATFORM_API_KEY, "<timestamp>.<path>.<body>"))`, where `<path>` is the request path (`/v1/token`) and `<body>` is the exact JSON body, or empty for GET.

The service refuses a request with an unknown or suspended instance, a bad signature, or a timestamp more than five minutes off. It must accept the instance's previous key during a key rotation.

| Route | Body | Answer |
|---|---|---|
| `GET /v1/apps` | — | `{ apps: { <provider>: { clientId, redirectUri } } }`. `redirectUri` is the service's own callback for that provider, under `CONNECTOR_SIGNIN_URL`. The instance caches it ten minutes |
| `POST /v1/token` | `{ provider, grantType: 'authorization_code', code, redirectUri, codeVerifier? }` | The provider's own token answer, unchanged (JSON). The service adds `client_id` and `client_secret` and calls the provider's token endpoint |
| `POST /v1/token` | `{ provider, grantType: 'refresh_token', refreshToken }` | As above |
| `POST /v1/revoke` | `{ provider, token }` | `{}` once the provider was asked to revoke |

Errors are `{ error: '<code>' }` with a 4xx status: `bad_signature`, `unknown_instance`, `instance_suspended`, `unknown_provider`, or the provider's own error code (`invalid_grant`). A 5xx or no answer is "unreachable" to the instance: the person is told to try again, and a connection is never marked broken for it.

The service stores no tokens and logs no token, code or secret.

## The browser's way through the service

1. The instance builds the consent address with the service's `clientId` and `redirectUri`, and a `state` that is an envelope: `base64url(JSON { i: <INSTANCE_ID>, s: <the instance's own signed state> })` + `.` + `base64url(HMAC-SHA256(PLATFORM_API_KEY, <that payload>))`.
2. The provider sends the person to `redirectUri` on the service with `code` and the envelope.
3. The service checks the envelope's signature with that instance's key and looks the instance's address up in **its own** instance list. It never takes an address from the request. It then redirects to `<instance address>/api/v1/connector-oauth/<provider>/callback?code=<code>&state=<the instance's own state>`, passing on `error` instead when the provider sent one.
4. The instance's callback hands the code to the signed-in page in the URL fragment, as for any provider. The page completes, and the instance exchanges the code through `POST /v1/token` with the same `redirectUri`.

A forged envelope, an unknown or suspended instance, or a state the instance did not sign is refused at step 3 or step 4.
