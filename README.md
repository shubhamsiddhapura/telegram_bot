# 🤖 Telegram Affiliate Bot

**Production-grade Node.js automation system** that monitors Telegram channels/groups in real-time, converts eligible shopping links via EarnKaro, and broadcasts converted affiliate deals to WhatsApp — fully automated, continuously running.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         telegram-affiliate-bot                      │
│                                                                     │
│  ┌──────────────┐    EVENTS.TELEGRAM_MESSAGE    ┌───────────────┐  │
│  │ TelegramSvc  │ ──────────────────────────── ▶│ MessageEvent  │  │
│  │  (GramJS)    │                               │     Bus       │  │
│  └──────────────┘                               └──────┬────────┘  │
│                                                        │           │
│                                                 p-queue│ (conc=3)  │
│                                                        ▼           │
│                                               ┌────────────────┐   │
│                                               │ MessageProcessor│   │
│                                               │    Service     │   │
│                                               └───────┬────────┘   │
│                                                       │            │
│                        ┌──────────────────────────────┤            │
│                        │                              │            │
│                 ┌──────▼──────┐               ┌───────▼──────┐    │
│                 │ EarnKaro    │               │  WhatsApp    │    │
│                 │  Service    │               │   Service    │    │
│                 │ (Axios+retry│               │ (Axios+queue)│    │
│                 └─────────────┘               └──────────────┘    │
│                                                                    │
│  ┌─────────────────────────────────────────────┐                  │
│  │              Express HTTP Server             │                  │
│  │  GET  /api/health    GET  /api/status        │                  │
│  │  POST /api/webhook/process                   │                  │
│  └─────────────────────────────────────────────┘                  │
│                                                                    │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐  │
│  │    Redis     │   │   BullMQ     │   │    Winston Logger    │  │
│  │  (dedup +    │   │   Queue      │   │  (console + files)   │  │
│  │   cache)     │   │  (durable)   │   └──────────────────────┘  │
│  └──────────────┘   └──────────────┘                              │
└────────────────────────────────────────────────────────────────────┘
```

---

## Low Level Design (LLD)

### Module Responsibilities

| Module | File | Responsibility |
|--------|------|----------------|
| **TelegramService** | `src/telegram/TelegramService.js` | GramJS client lifecycle, listen/reconnect, emit events |
| **MessageEventBus** | `src/events/messageEventBus.js` | Wire Telegram events → processor with p-queue concurrency |
| **MessageProcessorService** | `src/services/MessageProcessorService.js` | Pipeline orchestration: extract → filter → convert → send |
| **EarnKaroService** | `src/earnkaro/EarnKaroService.js` | Affiliate link conversion via EarnKaro API + retry |
| **WhatsAppService** | `src/whatsapp/WhatsAppService.js` | Message delivery via hosted WhatsApp API + retry + queue |
| **Dedup Helper** | `src/helpers/dedup.js` | Redis-backed message & URL deduplication |
| **URL Extractor** | `src/utils/urlExtractor.js` | Pure-function URL extract, validate, filter, replace |
| **Redis Helper** | `src/helpers/redis.js` | Singleton ioredis client shared by queues and dedup |
| **Message Queue** | `src/queues/messageQueue.js` | BullMQ durable queue for crash-safe processing |
| **Config** | `src/config/env.js` | Validates all env vars at startup; typed config object |
| **Logger** | `src/utils/logger.js` | Winston with daily-rotate files + module child loggers |

### Data Flow

```
1. Telegram message arrives (any subscribed channel/group)
   └─ TelegramService._onNewMessage()

2. Event emitted: EVENTS.TELEGRAM_MESSAGE
   └─ messageEventBus picks up and enqueues via p-queue

3. MessageProcessorService.process() called
   ├─ isMessageDuplicate() → skip if seen before (Redis/memory)
   ├─ extractUrls(text)    → raw URL list
   ├─ filterUrls(urls)     → remove Amazon, deduplicate
   ├─ deduplicateUrls()    → remove recently-processed URLs
   ├─ EarnKaroService.convertDeal(text) → affiliate links
   ├─ _buildFinalMessage() → format for WhatsApp
   └─ WhatsAppService.sendMessage() → deliver via RailOne API

4. All stages log to Winston (console + daily log files)
```

### Retry Strategy

| Component | Retries | Backoff | Retryable Conditions |
|-----------|---------|---------|---------------------|
| EarnKaro API | 3 | 1s → 2s → 5s | Network errors, 5xx, 429 |
| WhatsApp API | 3 | 1s → 2s → 5s | Network errors, 5xx, 429 |
| Telegram connect | ∞ | 5s → 10s → ... → 60s (exp) | Any connection failure |
| BullMQ jobs | 3 | Exponential (2s base) | Any job error |

### Reconnection Strategy

- **Telegram**: Health-check polling every 30s. On disconnect → exponential backoff reconnect (5s → 10s → 20s → ... → 60s cap). Backoff resets on successful connect.
- **Redis**: ioredis built-in `retryStrategy` with 500ms×attempts, capped at 5s.
- **HTTP**: Non-applicable (stateless).

### Deduplication

Two-layer deduplication prevents double-processing:

1. **Message-level**: `messageId = chatId:messageId` stored in Redis with 1-hour TTL. Same message arriving twice (e.g., forwarded) is ignored.
2. **URL-level**: SHA-256(url) stored in Redis with 1-hour TTL. Same link from different messages within the window is only converted once.

Falls back to an in-memory `Set` if Redis is unavailable.

---

## Folder Structure

```
telegram-affiliate-bot/
├── src/
│   ├── config/
│   │   └── env.js                 ← Validated config from .env
│   ├── constants/
│   │   └── index.js               ← Amazon domains, event names, etc.
│   ├── controllers/
│   │   ├── healthController.js    ← GET /health, GET /status
│   │   └── webhookController.js   ← POST /webhook/process
│   ├── earnkaro/
│   │   └── EarnKaroService.js     ← Affiliate link conversion
│   ├── events/
│   │   └── messageEventBus.js     ← Telegram event → processor wiring
│   ├── helpers/
│   │   ├── dedup.js               ← Redis deduplication
│   │   └── redis.js               ← ioredis singleton
│   ├── middlewares/
│   │   ├── errorHandler.js        ← Centralized Express error handler
│   │   ├── rateLimiter.js         ← express-rate-limit config
│   │   └── requestLogger.js       ← HTTP request logging
│   ├── queues/
│   │   └── messageQueue.js        ← BullMQ durable queue + worker
│   ├── routes/
│   │   └── index.js               ← Express router aggregation
│   ├── services/
│   │   └── MessageProcessorService.js  ← Core pipeline orchestrator
│   ├── telegram/
│   │   └── TelegramService.js     ← GramJS client + reconnect
│   ├── utils/
│   │   ├── asyncWrapper.js        ← asyncHandler, withRetry, sleep
│   │   ├── logger.js              ← Winston logger factory
│   │   └── urlExtractor.js        ← URL extract/filter/replace utils
│   ├── whatsapp/
│   │   └── WhatsAppService.js     ← WhatsApp delivery + queue
│   ├── app.js                     ← Express app factory
│   └── server.js                  ← Entry point + graceful shutdown
├── logs/                          ← Daily rotating log files (auto-created)
├── .env.example                   ← Template for environment variables
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── ecosystem.config.js            ← PM2 configuration
├── package.json
└── README.md
```

---

## Setup & Installation

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- Redis (local or hosted)
- Pre-generated Telegram StringSession (from `gramjs` + Google Colab)
- EarnKaro developer API token
- Your RailOne WhatsApp Sender API running

### 1. Clone & install

```bash
git clone <repo-url>
cd telegram-affiliate-bot
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in **all** required values:

```env
PORT=3000
NODE_ENV=production

TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=abcdef1234567890abcdef1234567890
TELEGRAM_STRING_SESSION=1BQANOTEuA...   # Your pre-generated session

EARNKARO_API_TOKEN=your_earnkaro_token
EARNKARO_API_URL=https://ekaro-api.affiliaters.in/api/converter/public

WHATSAPP_SENDER_URL=https://your-railone-app.up.railway.app/send

REDIS_HOST=127.0.0.1
REDIS_PORT=6379

LOG_LEVEL=info
```

### 3. Run

#### Development (with auto-reload)
```bash
npm run dev
```

#### Production (Node directly)
```bash
npm start
```

#### Production with PM2
```bash
npm install -g pm2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # enable auto-start on reboot
```

#### Docker Compose
```bash
docker-compose up -d
docker-compose logs -f bot
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Liveness probe — returns `200 ok` |
| `GET` | `/api/status` | Detailed system status (Telegram, queues, memory) |
| `POST` | `/api/webhook/process` | Manually push a message through the pipeline |

### POST /api/webhook/process

```json
{
  "message": "🔥 Big sale on Flipkart! Check this: https://flipkart.com/product/abc",
  "chatTitle": "Deals Group",
  "chatId": "external"
}
```

Response:
```json
{
  "success": true,
  "message": "Message accepted for processing",
  "messageId": "webhook:550e8400-e29b-41d4-a716-446655440000"
}
```

---

## Logging

Log files are written to `./logs/` with daily rotation:

- `combined-YYYY-MM-DD.log` — all logs at INFO and above
- `error-YYYY-MM-DD.log` — errors only
- `pm2-out.log` / `pm2-error.log` — PM2 stdout/stderr

Sample log output:
```
10:23:01 info [TelegramService] Connected to Telegram { username: 'mybot', id: '123456' }
10:23:15 info [TelegramService] New Telegram message received { messageId: '-1001234:891', chatTitle: 'Best Deals India', preview: '🔥 Huge sale on Myntra...' }
10:23:15 info [MessageProcessor] Processing new message { messageId: '-1001234:891', chatTitle: 'Best Deals India' }
10:23:15 info [MessageProcessor] URLs extracted { count: 2, urls: ['https://myntra.com/...', 'https://ajio.com/...'] }
10:23:15 info [MessageProcessor] Fresh URLs to convert { count: 2 }
10:23:16 info [EarnKaroService] Conversion successful { originalLength: 240, convertedLength: 285 }
10:23:17 info [WhatsAppService] WhatsApp message sent successfully { messageId: '-1001234:891' }
10:23:17 info [MessageProcessor] ✅ Pipeline complete { messageId: '-1001234:891' }
```

---

## Blocked Amazon Domains

The following domains are automatically filtered out. No conversion is attempted:

```
amazon.in   amazon.com   amazon.co.uk   amazon.de   amazon.fr
amazon.ca   amazon.com.au  amazon.com.br  amazon.co.jp
amzn.to     amzn.in      amzn.eu        a.co
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Runtime environment |
| `TELEGRAM_API_ID` | **Yes** | — | Numeric API ID from my.telegram.org |
| `TELEGRAM_API_HASH` | **Yes** | — | API hash from my.telegram.org |
| `TELEGRAM_STRING_SESSION` | **Yes** | — | Pre-generated GramJS StringSession |
| `EARNKARO_API_TOKEN` | **Yes** | — | EarnKaro bearer token |
| `EARNKARO_API_URL` | No | EK default | Override the API endpoint |
| `EARNKARO_TIMEOUT_MS` | No | `10000` | EarnKaro call timeout |
| `EARNKARO_MAX_RETRIES` | No | `3` | Retry attempts |
| `WHATSAPP_SENDER_URL` | **Yes** | — | Your RailOne WhatsApp API base URL |
| `WHATSAPP_TIMEOUT_MS` | No | `10000` | WhatsApp call timeout |
| `WHATSAPP_MAX_RETRIES` | No | `3` | Retry attempts |
| `REDIS_HOST` | No | `127.0.0.1` | Redis host |
| `REDIS_PORT` | No | `6379` | Redis port |
| `REDIS_PASSWORD` | No | — | Redis auth password |
| `REDIS_DB` | No | `0` | Redis database index |
| `DEDUP_CACHE_TTL_SECONDS` | No | `3600` | Dedup cache TTL (seconds) |
| `MAX_URLS_PER_MESSAGE` | No | `10` | URL cap per message |
| `LOG_LEVEL` | No | `info` | Winston log level |
| `LOG_DIR` | No | `./logs` | Log file directory |

---

## Customising the WhatsApp Payload

Your RailOne API may require specific fields (phone number, group ID, etc.). Open `src/whatsapp/WhatsAppService.js` and update `_doSend()`:

```js
const payload = {
  message,
  phone: config.whatsapp.targetPhone,  // add to .env + config/env.js
};
```

---

## Customising the Final Message Format

Edit `MessageProcessorService._buildFinalMessage()`:

```js
_buildFinalMessage(convertedText) {
  return [
    '🔥 *Deal Alert!*',
    '',
    convertedText.trim(),
    '',
    `_Source: AutoDeals Bot | ${new Date().toLocaleString('en-IN')}_`,
  ].join('\n');
}
```

---

## Production Checklist

- [ ] `.env` filled with real values
- [ ] Redis running and accessible
- [ ] WhatsApp API responding at `WHATSAPP_SENDER_URL`
- [ ] Telegram StringSession tested (connects successfully)
- [ ] EarnKaro token valid and active
- [ ] PM2 or Docker Compose configured for auto-restart
- [ ] Log rotation enabled (handled automatically by winston-daily-rotate-file)
- [ ] Health check monitored (e.g., UptimeRobot on `/api/health`)
