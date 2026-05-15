# Straight Flush Web Game Deployment

Single-port Node app: `server/index.js` serves the static web client from `public/` and accepts WebSocket upgrades on the same host and port. Runtime game state is in memory, so a process restart clears rooms and hands.

## Requirements

- Node.js 18 or newer
- npm
- A deployment copy that includes `package.json`, `server/`, `public/`, and `tests/`

## Install

```bash
cd /path/to/straight_flush_game_web_staging
npm install
```

## Start

Default bind is `0.0.0.0:8787`.

```bash
npm start
```

Override the bind address with environment variables:

```bash
HOST=127.0.0.1 PORT=8787 npm start
```

Use `HOST=127.0.0.1` when the app is behind nginx on the same server. Use `HOST=0.0.0.0` only when the Node process should listen on all interfaces.

## Health Check

```bash
curl -fsS http://127.0.0.1:8787/health
```

Expected response:

```json
{"ok":true}
```

## nginx Reverse Proxy

Proxy HTTP and WebSocket traffic to the same Node port. The browser can then connect to the same origin with `ws://` or `wss://`.

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

For TLS, terminate HTTPS in nginx and keep the same proxy headers in the `listen 443 ssl;` server block.

## pm2

```bash
npm install -g pm2
HOST=127.0.0.1 PORT=8787 pm2 start server/index.js --name straight-flush-web
pm2 save
pm2 startup
```

Common operations:

```bash
pm2 logs straight-flush-web
pm2 restart straight-flush-web
pm2 stop straight-flush-web
```

## Verification

```bash
npm test
npm run check
curl -fsS http://127.0.0.1:8787/health
```

If `npm run check` reports missing `public/app.js`, confirm the deployment bundle includes the `public/` web files before starting the service.
