# HTTPS and reverse proxy

AlianHub listens on plain HTTP (port 4000). In production, put a reverse proxy with a TLS certificate in front of it. HTTPS is not optional: session cookies are marked `Secure` in production, calls need a secure context, and connecting an AI app by address needs an `https` URL.

## Steps

1. Point a DNS name at the host, for example `pm.example.com`.
2. Run a reverse proxy (Caddy, nginx, Traefik, a cloud load balancer) that terminates TLS and forwards to `localhost:4000`. Any of them can get a free Let's Encrypt certificate.
3. Make sure the proxy forwards WebSocket upgrades on `/socket.io/`.
4. Set the public address, in **Settings › Instance › Settings › General** or in `.env`:

   ```bash
   WEBURL=https://pm.example.com
   APIURL=https://pm.example.com/
   ```

   `APIURL` is the same address with a trailing slash.
5. Set `TRUST_PROXY=1` (**Security** group, or `.env`) so rate limiting and the audit log see client addresses, not the proxy's. This one needs a restart.
6. Restart the app and open `https://pm.example.com`. The readiness card on **Settings › Instance › Health** turns green for **Public URL uses HTTPS** once `WEBURL` starts with `https://`.

## Caddy

Caddy gets and renews the certificate on its own and forwards WebSockets without extra lines.

```txt
pm.example.com {
    encode gzip
    reverse_proxy localhost:4000
}
```

When Caddy runs in Docker on the same Compose network, use `reverse_proxy app:4000`.

## nginx

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name pm.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name pm.example.com;

    ssl_certificate     /etc/letsencrypt/live/pm.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pm.example.com/privkey.pem;

    # Attachments are uploaded through the API.
    client_max_body_size 100m;

    # The app does not compress its responses itself.
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;
        proxy_read_timeout 300s;
    }
}
```

Get the certificate with `certbot --nginx -d pm.example.com`. On nginx older than 1.25.1, write `listen 443 ssl http2;` instead of the separate `http2 on;` line.

What each part is for:

- `Upgrade` and `Connection` let Socket.io switch to a WebSocket. Without them real-time updates fall back to long polling, which works but is slower and heavier.
- `X-Forwarded-For` and `X-Forwarded-Proto` tell the app the client address and that the request came over HTTPS. The app believes them only from proxies `TRUST_PROXY` allows.
- `proxy_read_timeout 300s` keeps long requests (AI answers, exports) and idle sockets open. The app's own keep-alive timeout (`SERVER_KEEP_ALIVE_TIMEOUT_MS`, 65 s) should stay above any idle timeout of the proxy in front.
- `client_max_body_size` must be at least your largest upload; the nginx default of 1 MB refuses most attachments.
- `gzip` shrinks the first page load from about 2.3 MB to about 0.74 MB. Caddy needs `encode gzip` inside the site block for the same effect.

## TRUST_PROXY

| Value | Use when |
|---|---|
| `loopback` (default) | the proxy runs on the same host and connects from 127.0.0.1 or ::1 |
| `1` | exactly one proxy sits in front, on another address (Docker, a load balancer) |
| `2`, `3`, ... | that many proxies in a chain (a CDN in front of a load balancer) |
| `true` | trust every hop; only behind a hosted proxy that always overwrites `X-Forwarded-For` |

Too low, and every user appears to come from the proxy's address: the per-IP rate limit (`GLOBAL_RATE_LIMIT_PER_MIN`, 1000 per minute) then applies to the whole office. Too high, and a client can fake its address.

## CORS and other origins

The API accepts browser requests from `WEBURL` and `APIURL`. If the web app is served from a different address than the API, or another site of yours calls the API from a browser, list the extra origins:

```bash
CORS_ORIGINS=https://app.example.com,https://intranet.example.com
```

The list is read on every request, so it applies without a restart. The desktop time tracker and API clients without an `Origin` header are not affected.

## Cookies and plain HTTP

With `NODE_ENV=production` (the Docker image default) the session cookies are marked `Secure`. Browsers drop them over plain `http://`, so logging in over HTTP fails by design: the login succeeds, then the next page sends you back to the login screen. Use HTTPS, or for a quick local test set `NODE_ENV=development`.

The security headers (`HELMET_ENABLED`, on by default) include `Strict-Transport-Security`, so once a browser has visited over HTTPS it will refuse plain HTTP for that host.

## Related

- [Security](./security)
- [Troubleshooting](./troubleshooting)
- [Environment variables](./env-reference)
