# Restaurant Reservation MCP Server

A local MCP server for searching and booking restaurant reservations through Resy and OpenTable.

## Features

- **Unified Search**: Search both Resy and OpenTable with a single query
- **Real-time Availability**: Check available time slots for any date
- **Direct Booking**: Book Resy reservations directly; get booking links for OpenTable
- **Reservation Sniper**: Auto-book the instant slots become available
- **Secure Credentials**: All credentials stored in Windows Credential Manager (encrypted with DPAPI)

## Installation

```bash
cd C:\Users\jrkle\Desktop\restaurant-mcp
npm install
npm run build
```

## Configure Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "restaurant-reservations": {
      "command": "node",
      "args": ["C:\\Users\\jrkle\\Desktop\\restaurant-mcp\\dist\\index.js"]
    }
  }
}
```

## Getting Started

### 1. Set Up Resy Credentials

First, you need your Resy API key and auth token. You can find these in your browser's developer tools while logged into resy.com:

```
# In Claude, use these tools:
set_credentials(platform: "resy", api_key: "YOUR_API_KEY", auth_token: "YOUR_TOKEN")

# Or for automatic token refresh, use:
set_login(platform: "resy", email: "your@email.com", password: "your-password")
```

### 2. Search for Restaurants

```
search_restaurants(query: "Carbone", location: "New York", party_size: 2)
```

**You don't need to know which platform a restaurant uses!** The search automatically checks both Resy and OpenTable in parallel. Each result includes a `platform` field (`resy` or `opentable`) and an ID like `resy-12345` or `opentable-67890` - just use these directly with `check_availability` and `make_reservation`.

### 3. Check Availability

```
check_availability(restaurant_id: "resy-12345", platform: "resy", date: "2025-02-15", party_size: 2)
```

### 4. Book a Reservation

```
make_reservation(
  restaurant_id: "resy-12345",
  platform: "resy",
  slot_id: "123456",
  party_size: 2,
  date: "2025-02-15"
)
```

## Reservation Sniper

For popular restaurants that release reservations at specific times:

```
snipe_reservation(
  restaurant_id: "resy-12345",
  platform: "resy",
  date: "2025-02-15",
  party_size: 2,
  preferred_times: ["7:00 PM", "7:30 PM", "8:00 PM"],
  release_time: "2025-02-01T09:00:00"
)
```

The sniper will:
1. Start polling 30 seconds before release time
2. Poll every 500ms once release time hits
3. Instantly book the first matching slot
4. Return confirmation or error

## Available Tools

| Tool | Description |
|------|-------------|
| `search_restaurants` | Search restaurants by name/location on Resy and/or OpenTable |
| `check_availability` | Get available time slots for a restaurant |
| `make_reservation` | Book a reservation |
| `list_reservations` | View your upcoming reservations |
| `cancel_reservation` | Cancel a booking |
| `set_credentials` | Store API key/token securely |
| `set_login` | Store email/password for auto-refresh |
| `check_auth_status` | Verify credentials are valid |
| `refresh_token` | Manually refresh auth token |
| `snipe_reservation` | Schedule auto-booking when slots open |
| `list_snipes` | View scheduled snipes |
| `cancel_snipe` | Cancel a scheduled snipe |

## Security

- **No credit card data**: This MCP never handles payment info. Bookings use payment methods saved in your Resy/OpenTable accounts.
- **Windows Credential Manager**: All credentials encrypted with DPAPI (same security as Chrome/Edge passwords)
- **No files**: Credentials never written to disk files
- **HTTPS only**: All API calls use TLS 1.3
- **Rate limited**: Max 10 requests/minute per platform

## Platform Notes

### Resy
- Full booking support via unofficial API
- Automatic token refresh when expired
- Can view and cancel reservations

### OpenTable
- Search and availability work without auth
- **Cannot complete booking via API** - returns a URL to finish on OpenTable's website
- Reservation listing not available

## Troubleshooting

### "Resy API key not configured"
Run `set_credentials` with your API key first.

### "Resy authentication failed"
Your token expired. Run `set_login` to enable auto-refresh, or manually get a new token.

### OpenTable booking returns URL
This is expected. OpenTable doesn't allow third-party booking - click the URL to complete on their site.

## Limitations

- Uses unofficial APIs that could change
- OpenTable requires manual booking completion
- For personal use only
