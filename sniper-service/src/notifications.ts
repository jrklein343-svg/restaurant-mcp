// Notification service for sending alerts when slots are found
// Supports multiple notification methods

export interface NotificationPayload {
  title: string;
  message: string;
  url?: string;
}

// Send notification via webhook (Discord, Slack, etc.)
async function sendWebhook(payload: NotificationPayload): Promise<boolean> {
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK;
  if (!webhookUrl) return false;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Discord format
        content: `**${payload.title}**\n${payload.message}${payload.url ? `\n\n🔗 ${payload.url}` : ''}`,
        // Slack format (if using Slack webhook)
        text: `*${payload.title}*\n${payload.message}${payload.url ? `\n<${payload.url}|Book Now>` : ''}`,
      }),
    });
    return response.ok;
  } catch (error) {
    console.error('[Notify] Webhook failed:', error);
    return false;
  }
}

// Send notification via Pushover (mobile push notifications)
async function sendPushover(payload: NotificationPayload): Promise<boolean> {
  const userKey = process.env.PUSHOVER_USER;
  const apiToken = process.env.PUSHOVER_TOKEN;
  if (!userKey || !apiToken) return false;

  try {
    const response = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: apiToken,
        user: userKey,
        title: payload.title,
        message: payload.message,
        url: payload.url,
        url_title: 'Book Now',
        priority: 1, // High priority
        sound: 'cashregister',
      }),
    });
    return response.ok;
  } catch (error) {
    console.error('[Notify] Pushover failed:', error);
    return false;
  }
}

// Send notification via Ntfy (free, open-source push notifications)
async function sendNtfy(payload: NotificationPayload): Promise<boolean> {
  const topic = process.env.NTFY_TOPIC;
  const server = process.env.NTFY_SERVER || 'https://ntfy.sh';
  if (!topic) return false;

  try {
    const response = await fetch(`${server}/${topic}`, {
      method: 'POST',
      headers: {
        'Title': payload.title,
        'Priority': 'high',
        'Tags': 'fork_and_knife,bell',
        ...(payload.url ? { 'Click': payload.url, 'Actions': `view, Book Now, ${payload.url}` } : {}),
      },
      body: payload.message,
    });
    return response.ok;
  } catch (error) {
    console.error('[Notify] Ntfy failed:', error);
    return false;
  }
}

export async function sendNotification(payload: NotificationPayload): Promise<void> {
  console.log(`[Notify] ${payload.title}: ${payload.message}`);

  const results = await Promise.allSettled([
    sendWebhook(payload),
    sendPushover(payload),
    sendNtfy(payload),
  ]);

  const successes = results.filter(r => r.status === 'fulfilled' && r.value).length;
  if (successes === 0) {
    console.log('[Notify] No notification channels configured or all failed');
  } else {
    console.log(`[Notify] Sent via ${successes} channel(s)`);
  }
}

export async function notifySlotFound(
  restaurantName: string,
  date: string,
  time: string,
  platform: 'resy' | 'opentable',
  bookingUrl?: string
): Promise<void> {
  await sendNotification({
    title: `🍽️ ${restaurantName} - Slot Found!`,
    message: `${platform.toUpperCase()}: ${date} at ${time} is available!`,
    url: bookingUrl,
  });
}

export async function notifyBookingSuccess(
  restaurantName: string,
  date: string,
  time: string,
  confirmationId: string
): Promise<void> {
  await sendNotification({
    title: `✅ Reservation Confirmed!`,
    message: `${restaurantName} on ${date} at ${time}\nConfirmation: ${confirmationId}`,
  });
}

export async function notifySnipeFailed(
  restaurantName: string,
  date: string,
  reason: string
): Promise<void> {
  await sendNotification({
    title: `❌ Snipe Failed`,
    message: `${restaurantName} on ${date}: ${reason}`,
  });
}
