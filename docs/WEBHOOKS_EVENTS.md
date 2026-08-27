# BOLETERA Webhooks & Event System

> **MEGA Heavy Webhooks & Events Documentation**
> 
> **Version:** 2.0  
> **Status:** Complete  
> **Total Event Types:** 25+  
> **Webhook Protocol:** JSON over HTTPS  
> **Retry Strategy:** Exponential backoff with 72-hour window

---

## WEBHOOK FUNDAMENTALS

### Webhook Structure

Every webhook includes:

```typescript
{
  id: string;              // Unique webhook ID
  eventType: string;       // e.g., "order.completed"
  timestamp: ISO8601;      // When event occurred
  eventId: string;         // Reference ID (orderId, eventId, etc)
  organizationId: string;  // For multi-tenancy
  
  // Event-specific data
  data: {
    [key: string]: any;
  };
  
  // Security
  signature: string;       // HMAC SHA-256 signature
  signatureVersion: string; // "v1"
}
```

### Webhook Signature Verification

```typescript
// Compute signature
const payload = JSON.stringify(webhook);
const timestamp = webhook.timestamp;
const secret = process.env.WEBHOOK_SECRET;

const signedContent = `${timestamp}.${payload}`;
const signature = crypto
  .createHmac('sha256', secret)
  .update(signedContent)
  .digest('hex');

// Verify
if (signature !== webhook.signature) {
  throw new Error('Invalid webhook signature');
}
```

### Webhook Delivery

```
1. Event occurs
2. Webhook queued to Bull (async)
3. Initial delivery attempt
4. On failure:
   - Retry after 5 seconds
   - Retry after 30 seconds
   - Retry after 5 minutes
   - Retry after 30 minutes
   - Retry after 2 hours
   - ... continues for 72 hours
5. Webhook logged to audit trail
```

---

## EVENT TYPES

### ORDER LIFECYCLE EVENTS

#### 1. `order.created`
**Triggered:** When customer places order (before payment)

```json
{
  "eventType": "order.created",
  "eventId": "ORD-20260517-0042",
  "data": {
    "orderId": "ORD-20260517-0042",
    "customerId": "user_john_123",
    "eventId": "evt_taylor_2026",
    "eventTitle": "Taylor Swift Concert",
    "channel": "WEB",
    "quantity": 2,
    "totalAmount": 504.00,
    "status": "PROCESSING",
    "createdAt": "2026-05-17T14:32:45Z",
    "expiresAt": "2026-05-17T14:47:45Z"  // 15 min hold
  }
}
```

#### 2. `order.completed`
**Triggered:** When payment successfully processed

```json
{
  "eventType": "order.completed",
  "eventId": "ORD-20260517-0042",
  "data": {
    "orderId": "ORD-20260517-0042",
    "paymentId": "pay_xyz123",
    "totalAmount": 504.00,
    "status": "COMPLETED",
    "tickets": [
      {
        "id": "tkt_1",
        "barcode": "TKT-20260517-0001",
        "seatNumber": "A-25-50",
        "url": "https://boletera.com/tickets/tkt_1"
      },
      {
        "id": "tkt_2",
        "barcode": "TKT-20260517-0002",
        "seatNumber": "A-26-50",
        "url": "https://boletera.com/tickets/tkt_2"
      }
    ],
    "completedAt": "2026-05-17T14:32:52Z"
  }
}
```

#### 3. `order.cancelled`
**Triggered:** When customer or system cancels order

```json
{
  "eventType": "order.cancelled",
  "eventId": "ORD-20260517-0042",
  "data": {
    "orderId": "ORD-20260517-0042",
    "reason": "CUSTOMER_REQUEST",  // CUSTOMER_REQUEST, HOLD_EXPIRED, SYSTEM_ERROR
    "refundAmount": 504.00,
    "refundStatus": "PROCESSING",  // PROCESSING, COMPLETED, FAILED
    "cancelledAt": "2026-05-17T14:45:00Z"
  }
}
```

#### 4. `order.refunded`
**Triggered:** When refund completed

```json
{
  "eventType": "order.refunded",
  "eventId": "ORD-20260517-0042",
  "data": {
    "orderId": "ORD-20260517-0042",
    "refundId": "ref_xyz123",
    "amount": 504.00,
    "method": "ORIGINAL_PAYMENT",
    "status": "COMPLETED",
    "refundedAt": "2026-05-17T14:45:30Z"
  }
}
```

#### 5. `order.failed`
**Triggered:** When payment fails

```json
{
  "eventType": "order.failed",
  "eventId": "ORD-20260517-0042",
  "data": {
    "orderId": "ORD-20260517-0042",
    "paymentId": "pay_xyz123",
    "reason": "CARD_DECLINED",  // CARD_DECLINED, INSUFFICIENT_FUNDS, EXPIRED_CARD, etc
    "errorCode": "card_declined",
    "errorMessage": "Your card was declined",
    "retryable": true,
    "failedAt": "2026-05-17T14:32:50Z"
  }
}
```

#### 6. `order.hold_expiring`
**Triggered:** 1 minute before hold expires

```json
{
  "eventType": "order.hold_expiring",
  "eventId": "ORD-20260517-0042",
  "data": {
    "orderId": "ORD-20260517-0042",
    "seatsOnHold": 2,
    "expiresIn": 60,  // seconds
    "expiresAt": "2026-05-17T14:47:45Z"
  }
}
```

---

### EVENT LIFECYCLE EVENTS

#### 7. `event.published`
**Triggered:** When event goes live

```json
{
  "eventType": "event.published",
  "eventId": "evt_taylor_2026",
  "data": {
    "eventId": "evt_taylor_2026",
    "title": "Taylor Swift Concert",
    "venueId": "venue_madison_square",
    "capacity": 20000,
    "startDate": "2026-05-20T20:00:00Z",
    "basePrice": 150.00,
    "publishedAt": "2026-05-17T14:32:45Z"
  }
}
```

#### 8. `event.sold_out`
**Triggered:** When occupancy reaches 100%

```json
{
  "eventType": "event.sold_out",
  "eventId": "evt_taylor_2026",
  "data": {
    "eventId": "evt_taylor_2026",
    "title": "Taylor Swift Concert",
    "occupancy": 100.0,
    "totalTickets": 20000,
    "soldTickets": 20000,
    "soldOutAt": "2026-05-19T08:23:15Z",
    "timeToSoldOut": {
      "days": 2,
      "hours": 12,
      "minutes": 51
    }
  }
}
```

#### 9. `event.trending`
**Triggered:** When occupancy crosses 70%

```json
{
  "eventType": "event.trending",
  "eventId": "evt_taylor_2026",
  "data": {
    "eventId": "evt_taylor_2026",
    "title": "Taylor Swift Concert",
    "occupancy": 70.5,
    "trendingScore": 0.85,
    "trendingSince": "2026-05-17T14:32:45Z",
    "searchVolume": {
      "previous24h": 15000,
      "current24h": 25000,
      "growth": 66.7
    }
  }
}
```

#### 10. `event.approaching`
**Triggered:** When event starts in < 24 hours

```json
{
  "eventType": "event.approaching",
  "eventId": "evt_taylor_2026",
  "data": {
    "eventId": "evt_taylor_2026",
    "title": "Taylor Swift Concert",
    "hoursRemaining": 23.5,
    "occupancy": 92.5,
    "ticketsRemaining": 1500,
    "startsAt": "2026-05-20T20:00:00Z"
  }
}
```

#### 11. `event.completed`
**Triggered:** When event ends

```json
{
  "eventType": "event.completed",
  "eventId": "evt_taylor_2026",
  "data": {
    "eventId": "evt_taylor_2026",
    "title": "Taylor Swift Concert",
    "completedAt": "2026-05-20T23:00:00Z",
    "finalOccupancy": 95.5,
    "finalRevenue": 2850000.00,
    "totalOrders": 19100,
    "avgOrderValue": 149.21
  }
}
```

---

### CAMPAIGN EVENTS

#### 12. `campaign.published`
**Triggered:** When campaign goes live

```json
{
  "eventType": "campaign.published",
  "eventId": "camp_early_bird_001",
  "data": {
    "campaignId": "camp_early_bird_001",
    "eventId": "evt_taylor_2026",
    "name": "Early Bird - 20% Off",
    "type": "early_bird",
    "allocation": 1000,
    "discountValue": 20,
    "publishedAt": "2026-05-17T14:32:45Z"
  }
}
```

#### 13. `campaign.code_redeemed`
**Triggered:** When presale code used

```json
{
  "eventType": "campaign.code_redeemed",
  "eventId": "camp_presale_vip_001",
  "data": {
    "campaignId": "camp_presale_vip_001",
    "code": "VIP20",
    "userId": "user_john_123",
    "orderId": "ORD-20260517-0042",
    "discount": 20,
    "discountType": "percentage",
    "redeemedAt": "2026-05-17T14:32:45Z"
  }
}
```

#### 14. `campaign.sold_out`
**Triggered:** When campaign allocation exhausted

```json
{
  "eventType": "campaign.sold_out",
  "eventId": "camp_early_bird_001",
  "data": {
    "campaignId": "camp_early_bird_001",
    "name": "Early Bird - 20% Off",
    "allocation": 1000,
    "redeemed": 1000,
    "revenue": 150000.00,
    "avgOrderValue": 150.00,
    "soldOutAt": "2026-05-15T08:23:15Z",
    "timeToSoldOut": {
      "days": 5,
      "hours": 2,
      "minutes": 23
    }
  }
}
```

#### 15. `campaign.ended`
**Triggered:** When campaign reaches end date

```json
{
  "eventType": "campaign.ended",
  "eventId": "camp_early_bird_001",
  "data": {
    "campaignId": "camp_early_bird_001",
    "name": "Early Bird - 20% Off",
    "endedAt": "2026-05-15T23:59:59Z",
    "stats": {
      "allocation": 1000,
      "redeemed": 750,
      "remaining": 250,
      "revenue": 112500.00
    }
  }
}
```

---

### CHANNEL EVENTS

#### 16. `channel.reallocated`
**Triggered:** When inventory reallocated between channels

```json
{
  "eventType": "channel.reallocated",
  "eventId": "evt_taylor_2026",
  "data": {
    "eventId": "evt_taylor_2026",
    "from": "WEB",
    "to": "TAQUILLA",
    "quantity": 50,
    "reason": "DEMAND_BASED",  // DEMAND_BASED, MANUAL, FAILOVER
    "newAllocation": {
      "WEB": 1950,
      "TAQUILLA": 1550,
      "API": 1000,
      "PHONE": 500
    },
    "reallocatedAt": "2026-05-17T14:32:45Z"
  }
}
```

#### 17. `channel.health_changed`
**Triggered:** When channel health status changes

```json
{
  "eventType": "channel.health_changed",
  "eventId": "evt_taylor_2026",
  "data": {
    "eventId": "evt_taylor_2026",
    "channel": "TAQUILLA",
    "previousStatus": "healthy",
    "currentStatus": "degraded",
    "reason": "QUEUE_BACKLOG",
    "metrics": {
      "responseTime": 2000,  // ms
      "errorRate": 5.2,      // %
      "syncLag": 10          // seconds
    },
    "changedAt": "2026-05-17T14:32:45Z"
  }
}
```

#### 18. `channel.offline`
**Triggered:** When channel goes offline

```json
{
  "eventType": "channel.offline",
  "eventId": "evt_taylor_2026",
  "data": {
    "eventId": "evt_taylor_2026",
    "channel": "API",
    "reason": "CONNECTION_ERROR",
    "affectedTickets": 500,
    "wentOfflineAt": "2026-05-17T14:32:45Z"
  }
}
```

---

### TERMINAL / TAQUILLA EVENTS

#### 19. `terminal.offline`
**Triggered:** When POS terminal goes offline

```json
{
  "eventType": "terminal.offline",
  "eventId": "term_main_1",
  "data": {
    "terminalId": "term_main_1",
    "location": "Main Box Office",
    "mode": "OFFLINE",
    "queuedTransactions": 12,
    "wentOfflineAt": "2026-05-17T14:32:45Z"
  }
}
```

#### 20. `terminal.online`
**Triggered:** When terminal reconnects

```json
{
  "eventType": "terminal.online",
  "eventId": "term_main_1",
  "data": {
    "terminalId": "term_main_1",
    "location": "Main Box Office",
    "mode": "ONLINE",
    "offlineFor": 300,  // seconds
    "syncedTransactions": 12,
    "wentOnlineAt": "2026-05-17T14:35:45Z"
  }
}
```

#### 21. `terminal.sync_error`
**Triggered:** When sync between terminal and server fails

```json
{
  "eventType": "terminal.sync_error",
  "eventId": "term_main_1",
  "data": {
    "terminalId": "term_main_1",
    "errorCode": "INVENTORY_MISMATCH",
    "details": {
      "expectedInventory": 500,
      "actualInventory": 480,
      "difference": -20
    },
    "occurredAt": "2026-05-17T14:32:45Z"
  }
}
```

---

### PAYMENT EVENTS

#### 22. `payment.initiated`
**Triggered:** When payment processing starts

```json
{
  "eventType": "payment.initiated",
  "eventId": "pay_xyz123",
  "data": {
    "paymentId": "pay_xyz123",
    "orderId": "ORD-20260517-0042",
    "gateway": "STRIPE",
    "amount": 504.00,
    "currency": "USD",
    "initiatedAt": "2026-05-17T14:32:45Z"
  }
}
```

#### 23. `payment.succeeded`
**Triggered:** When payment succeeds

```json
{
  "eventType": "payment.succeeded",
  "eventId": "pay_xyz123",
  "data": {
    "paymentId": "pay_xyz123",
    "orderId": "ORD-20260517-0042",
    "gateway": "STRIPE",
    "amount": 504.00,
    "method": "CARD",
    "cardBrand": "VISA",
    "cardLast4": "4242",
    "succeededAt": "2026-05-17T14:32:52Z"
  }
}
```

#### 24. `payment.failed`
**Triggered:** When payment fails

```json
{
  "eventType": "payment.failed",
  "eventId": "pay_xyz123",
  "data": {
    "paymentId": "pay_xyz123",
    "orderId": "ORD-20260517-0042",
    "gateway": "STRIPE",
    "amount": 504.00,
    "reason": "CARD_DECLINED",
    "code": "card_declined",
    "failedAt": "2026-05-17T14:32:50Z",
    "retryable": true,
    "retryAfter": 300  // seconds
  }
}
```

---

### LOYALTY & FRAUD EVENTS

#### 25. `loyalty.points_awarded`
**Triggered:** When loyalty points credited

```json
{
  "eventType": "loyalty.points_awarded",
  "eventId": "user_john_123",
  "data": {
    "userId": "user_john_123",
    "orderId": "ORD-20260517-0042",
    "pointsAwarded": 100,
    "totalPoints": 450,
    "tier": "SILVER",
    "awardedAt": "2026-05-17T14:32:52Z"
  }
}
```

#### 26. `fraud.score_calculated`
**Triggered:** When fraud ML model scores transaction

```json
{
  "eventType": "fraud.score_calculated",
  "eventId": "ORD-20260517-0042",
  "data": {
    "orderId": "ORD-20260517-0042",
    "fraudScore": 8,  // 0-100, higher = more suspicious
    "riskLevel": "LOW",  // LOW, MEDIUM, HIGH
    "factors": {
      "velocity_check": 2,
      "card_country_mismatch": 0,
      "device_fingerprint": 3,
      "user_history": 1,
      "amount_unusual": 2
    },
    "calculatedAt": "2026-05-17T14:32:52Z"
  }
}
```

#### 27. `fraud.alert`
**Triggered:** When fraud score exceeds threshold

```json
{
  "eventType": "fraud.alert",
  "eventId": "ORD-20260517-0042",
  "data": {
    "orderId": "ORD-20260517-0042",
    "fraudScore": 85,
    "riskLevel": "HIGH",
    "action": "MANUAL_REVIEW",  // MANUAL_REVIEW, AUTO_BLOCK
    "alertedAt": "2026-05-17T14:32:52Z"
  }
}
```

---

## WEBHOOK ENDPOINTS CONFIGURATION

### Register Webhook Endpoint

```
POST /api/v1/webhooks/register
Authorization: Bearer {token}

REQUEST:
{
  "url": "https://myapp.com/webhooks/boletera",
  "eventTypes": [
    "order.completed",
    "order.failed",
    "event.sold_out",
    "campaign.code_redeemed"
  ],
  "active": true,
  "description": "Main webhook for order updates"
}

RESPONSE (201):
{
  "webhookId": "wh_xyz123",
  "url": "https://myapp.com/webhooks/boletera",
  "secret": "whsec_xyz123...",
  "eventTypes": 4,
  "createdAt": "2026-05-17T14:32:45Z"
}
```

### List Webhooks

```
GET /api/v1/webhooks
Authorization: Bearer {token}

RESPONSE (200):
{
  "webhooks": [
    {
      "webhookId": "wh_xyz123",
      "url": "https://myapp.com/webhooks/boletera",
      "eventTypes": 4,
      "active": true,
      "lastDelivery": "2026-05-17T14:32:45Z",
      "successRate": 99.8
    }
  ]
}
```

### Get Webhook Events

```
GET /api/v1/webhooks/{webhookId}/events?limit=50
Authorization: Bearer {token}

RESPONSE (200):
{
  "webhookId": "wh_xyz123",
  "events": [
    {
      "eventId": "evt_20260517_001",
      "eventType": "order.completed",
      "status": "DELIVERED",
      "deliveredAt": "2026-05-17T14:32:52Z",
      "attempts": 1
    },
    {
      "eventId": "evt_20260517_002",
      "eventType": "order.failed",
      "status": "RETRYING",
      "lastAttempt": "2026-05-17T14:33:00Z",
      "attempts": 2,
      "nextRetry": "2026-05-17T14:34:00Z"
    }
  ]
}
```

### Retry Failed Webhook

```
POST /api/v1/webhooks/{webhookId}/retry/{eventId}
Authorization: Bearer {token}

RESPONSE (202):
{
  "eventId": "evt_20260517_002",
  "status": "RETRYING",
  "nextRetry": "2026-05-17T14:34:00Z"
}
```

---

## WEBHOOK IMPLEMENTATION EXAMPLES

### Express.js Webhook Handler

```typescript
import crypto from 'crypto';
import express from 'express';

const app = express();
const WEBHOOK_SECRET = process.env.BOLETERA_WEBHOOK_SECRET;

app.post('/webhooks/boletera', express.json(), async (req, res) => {
  const webhook = req.body;

  // Verify signature
  const payload = JSON.stringify(webhook);
  const timestamp = webhook.timestamp;
  const signature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  if (signature !== webhook.signature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Handle different event types
  try {
    switch (webhook.eventType) {
      case 'order.completed':
        await handleOrderCompleted(webhook.data);
        break;
      case 'order.failed':
        await handleOrderFailed(webhook.data);
        break;
      case 'event.sold_out':
        await handleEventSoldOut(webhook.data);
        break;
      default:
        console.log(`Unknown event type: ${webhook.eventType}`);
    }

    // Must return 200 to acknowledge receipt
    res.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    // Return 500 to trigger retry
    res.status(500).json({ error: 'Processing failed' });
  }
});

async function handleOrderCompleted(data) {
  console.log(`Order completed: ${data.orderId}`);
  // Update your database, send confirmation email, etc
}

async function handleOrderFailed(data) {
  console.log(`Order failed: ${data.orderId} - ${data.reason}`);
  // Notify customer, log for review, etc
}

async function handleEventSoldOut(data) {
  console.log(`Event sold out: ${data.eventId}`);
  // Update UI, notify waitlist, etc
}
```

---

**Document Status:** ✅ Complete  
**Total Event Types:** 27  
**Retry Window:** 72 hours  
**Signature Algorithm:** HMAC SHA-256  
**Protocol:** HTTPS JSON  
**Last Updated:** May 17, 2026
