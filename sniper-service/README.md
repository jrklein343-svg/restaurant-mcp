# Restaurant Sniper Service

A 24/7 reservation sniper that runs on Render (or any cloud platform). Automatically books Resy reservations and sends you OpenTable booking links the instant slots become available.

## Features

- **Resy Auto-Book**: Automatically completes reservations when slots open
- **OpenTable Alerts**: Sends you a booking link instantly when slots appear
- **Push Notifications**: Supports Discord, Slack, Pushover, and Ntfy
- **Persistent Storage**: Snipes survive server restarts
- **Simple HTTP API**: Easy to integrate with any client

## Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

### Manual Setup

1. Create a new **Web Service** on Render
2. Connect your GitHub repo
3. Set **Root Directory**: `sniper-service`
4. Set **Build Command**: `npm install && npm run build`
5. Set **Start Command**: `npm start`
6. Add environment variables (see below)

## Environment Variables

### Required
| Variable | Description |
|----------|-------------|
| `RESY_EMAIL` | Your Resy account email |
| `RESY_PASSWORD` | Your Resy account password |

### Optional - Security
| Variable | Description |
|----------|-------------|
| `API_KEY` | Require this key in `X-API-Key` header for all requests |

### Optional - Notifications
| Variable | Description |
|----------|-------------|
| `NOTIFICATION_WEBHOOK` | Discord/Slack webhook URL |
| `PUSHOVER_USER` | Pushover user key |
| `PUSHOVER_TOKEN` | Pushover API token |
| `NTFY_TOPIC` | Ntfy topic name (e.g., `my-restaurant-alerts`) |
| `NTFY_SERVER` | Ntfy server URL (default: `https://ntfy.sh`) |

## API Usage

### Create a Snipe

```bash
curl -X POST https://your-service.onrender.com/api/snipes \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "restaurantId": 12345,
    "restaurantName": "Carbone",
    "platform": "resy",
    "date": "2025-02-15",
    "partySize": 2,
    "preferredTimes": ["7:00 PM", "7:30 PM", "8:00 PM"],
    "releaseTime": "2025-02-01T09:00:00-05:00"
  }'
```

### List Snipes

```bash
curl https://your-service.onrender.com/api/snipes \
  -H "X-API-Key: your-api-key"
```

### Cancel a Snipe

```bash
curl -X DELETE https://your-service.onrender.com/api/snipes/snipe-123 \
  -H "X-API-Key: your-api-key"
```

## How It Works

1. You create a snipe with the restaurant ID, target date, preferred times, and release time
2. The service schedules the snipe to start 30 seconds before release
3. At release time, it polls the API every 500ms looking for matching slots
4. **Resy**: Automatically books the first matching slot using your saved payment method
5. **OpenTable**: Sends you a push notification with the booking link

## Finding Restaurant IDs

### Resy
1. Go to the restaurant's Resy page
2. Open browser DevTools → Network tab
3. Look for requests to `api.resy.com`
4. The `venue_id` parameter is the restaurant ID

### OpenTable
1. Go to the restaurant's OpenTable page
2. The URL contains the restaurant ID: `opentable.com/r/restaurant-name-city-12345`
3. The number at the end (12345) is the restaurant ID

## Notification Setup

### Discord
1. In your Discord server, go to Channel Settings → Integrations → Webhooks
2. Create a webhook and copy the URL
3. Set `NOTIFICATION_WEBHOOK` to this URL

### Ntfy (Free, Easy)
1. Pick a unique topic name (e.g., `my-resy-alerts-xyz123`)
2. Set `NTFY_TOPIC` to your topic name
3. Install the Ntfy app on your phone and subscribe to your topic
4. That's it! No account needed.

### Pushover ($5 one-time)
1. Create account at pushover.net
2. Get your User Key from the dashboard
3. Create an Application and get the API Token
4. Set `PUSHOVER_USER` and `PUSHOVER_TOKEN`

## Local Development

```bash
cd sniper-service
npm install
npm run build

# Set environment variables
export RESY_EMAIL="your@email.com"
export RESY_PASSWORD="yourpassword"

npm start
```
