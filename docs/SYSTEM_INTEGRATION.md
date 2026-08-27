# BOLETERA - System Integration & Webhooks Architecture

> **MEGA Heavy Integration Document** 
> **Document Version:** 3.0
> **Status:** Complete & Integrated

---

## TABLE OF CONTENTS

1. [System Integration Flow](#system-integration-flow)
2. [Webhook Events](#webhook-events)
3. [Event-Driven Architecture](#event-driven-architecture)
4. [API Gateway & Routing](#api-gateway--routing)
5. [Data Synchronization](#data-synchronization)
6. [Error Handling & Retry Logic](#error-handling--retry-logic)
7. [Integration Patterns](#integration-patterns)

---

## SYSTEM INTEGRATION FLOW

### **7 Pillar Integrated System**

```
TIER 1: ADMIN & CONFIGURATION
├── EventManagement       → Create single/series/residency/festival
├── ChannelManagement     → Configure allocation (web/taquilla/api/phone)
├── LayoutManagement      → Design venue, sightlines, accessibility
├── CampaignExecution     → Presale, early bird, VIP, loyalty
└── Reporting             → Real-time dashboards, predictive analytics

TIER 2: DISCOVERY & PERSONALIZATION
├── SearchService         → AI-ranked search (content 30%, personalization 40%, demand 20%, business 10%)
├── TrendingEvents        → Real-time trending based on occupancy
├── SmartRecommendations  → Personalized by user history & preferences
└── Autocomplete          → Fast search suggestions

TIER 3: SALES & FULFILLMENT
├── Inventory (holds)     → Redis-backed atomic operations
├── Pricing (dynamic)     → Surge, time-based, segment pricing
├── Orders                → Multi-channel, atomic transactions
├── TaquillaPOS           → < 45 second checkout, offline mode
├── Payment               → Stripe, Banorte, cash handling
└── Notifications         → Bull queue async jobs

TIER 4: POST-SALE
├── Resale                → P2P marketplace
├── Analytics             → Event/promoter/customer analytics
├── Fraud                 → ML scoring, KYC/AML
└── Settlement            → Payout calculations
```

### **Integrated Data Flow: Customer Journey**

```
1. DISCOVERY PHASE
   ↓
   SearchService.searchEvents(query, userId)
   ├─ AI Ranking: content (30%) + personalization (40%) + demand (20%) + business (10%)
   ├─ Returns top events sorted by relevance
   ├─ Logs: search impressions for analytics
   └─ Stores: user_search_history

2. EVENT DETAIL PAGE
   ↓
   SeatMapping3D.getInteractiveSeatView(eventId)
   ├─ Returns: live statusBySeat (+ compatible venue envelope)
   ├─ Geometry: published SeatMapData → client @boletera/venue-3d
   ├─ Real-time occupancy: GET /3d/events/{eventId}/heatmap
   └─ Recommendations: POST /3d/events/{eventId}/recommendations

3. SEAT SELECTION
   ↓
   LayoutManagement.holdSeats(eventId, [seat_ids], 15min)
   ├─ Locks seats for 15 minutes
   ├─ Stores hold_expiration timestamp
   └─ Returns: hold confirmation

4. CAMPAIGN VALIDATION
   ↓
   CampaignExecution.validatePresaleCode(code, eventId, userId)
   ├─ Validates: time window, allocation, per-user limit, target segment
   ├─ Returns: discount amount & campaign details
   └─ Logs: code redemption attempt

5. PRICING CALCULATION
   ↓
   PricingService.calculatePrice(eventId, seatId, qty, campaign)
   ├─ Base price × DynamicMultiplier (surge)
   ├─ × TimeMultiplier (early bird / last minute)
   ├─ × SegmentMultiplier (customer type)
   ├─ - CampaignDiscount (presale / VIP)
   ├─ + Fees (10%) + Taxes (16%)
   └─ Returns: final price breakdown

6. CHECKOUT (< 45 seconds)
   ↓
   TaquillaPOS.quickCheckout(terminalId, eventId, offer, qty, code)
   ├─ Verify presale code (1s)
   ├─ Calculate price (1s)
   ├─ Atomically hold seats (2s)
   ├─ Create order + order items (5s)
   └─ Return total ready for payment

7. PAYMENT PROCESSING
   ↓
   PaymentService.processPayment(orderId, method, amount)
   ├─ Route to Stripe / Banorte / Cash
   ├─ Stripe: async webhook handling
   ├─ Banorte: IPN callback
   ├─ Cash: POS terminal confirmation
   └─ Store payment record

8. ORDER CONFIRMATION
   ↓
   OrderService.completeOrder(orderId, paymentId)
   ├─ Update order status → COMPLETED
   ├─ Update tickets → SOLD
   ├─ Release hold expiration timer
   ├─ Create ticket PDF/barcode
   └─ Trigger notifications

9. POST-SALE EVENTS
   ├─ Notifications: Email receipt, SMS ticket, push notification
   ├─ Analytics: Log order event (channel, revenue, customer)
   ├─ Loyalty: Award points (CampaignExecution.awardLoyaltyPoints)
   ├─ Reporting: Update dashboard metrics (real-time)
   ├─ Fraud: Score transaction (ML scoring)
   └─ Resale: Make ticket eligible for resale (if enabled)

10. RECURRING SYNC (every 5 min)
    ├─ ChannelManagement: Dynamic reallocation (web 40% → taquilla 30% if needed)
    ├─ SearchService: Update trending events (based on occupancy)
    ├─ Reporting: Refresh real-time dashboard metrics
    ├─ TaquillaPOS: Sync inventory to all terminals
    └─ EventManagement: Check for status transitions (soon → live → ended)
```

---

## WEBHOOK EVENTS

### **Webhooks Emitted by System**

All webhooks include:
```typescript
{
  id: "evt_xyz",
  eventType: "order.completed",
  timestamp: "2026-05-17T14:32:45Z",
  data: { ... },
  signature: "sha256_hmac_token",
  retryCount: 0
}
```

### **Order Events**

```
✅ order.created
   When: Order placed but not yet paid
   Data: {orderId, customerId, eventId, totalAmount, channel}
   
✅ order.completed
   When: Payment successful, tickets issued
   Data: {orderId, paymentId, tickets: [{id, barcode}]}
   
✅ order.cancelled
   When: Customer cancels or time expires
   Data: {orderId, reason, refundAmount}
   
✅ order.failed
   When: Payment failed
   Data: {orderId, paymentId, errorCode, errorMessage}
```

### **Event Events**

```
✅ event.published
   When: Event goes live
   Data: {eventId, title, startDate, capacity}
   
✅ event.sold_out
   When: Occupancy reaches 100%
   Data: {eventId, soldOut: true, occupancy: 100}
   
✅ event.trending
   When: Occupancy crosses 70%
   Data: {eventId, occupancy: 70.5, trendingScore: 0.85}
   
✅ event.approaching
   When: Event starts in <24 hours
   Data: {eventId, hoursRemaining: 23.5}
```

### **Campaign Events**

```
✅ campaign.published
   When: Campaign becomes active
   Data: {campaignId, type, allocation}
   
✅ campaign.code_redeemed
   When: Presale code used
   Data: {campaignId, code, userId, timestamp}
   
✅ campaign.sold_out
   When: Campaign allocation exhausted
   Data: {campaignId, totalRedeemed, revenue}
```

### **Channel Events**

```
✅ channel.reallocated
   When: Inventory moved between channels
   Data: {eventId, from: 'WEB', to: 'TAQUILLA', quantity: 50}
   
✅ channel.health_changed
   When: Channel health status changes
   Data: {channel, status: 'healthy'|'degraded'|'down', details}
```

### **Terminal Events**

```
✅ terminal.offline
   When: Taquilla terminal goes offline
   Data: {terminalId, mode: 'OFFLINE', queuedTransactions: 12}
   
✅ terminal.online
   When: Terminal reconnects
   Data: {terminalId, mode: 'ONLINE', syncedTransactions: 12}
```

---

## EVENT-DRIVEN ARCHITECTURE

### **Bull Queue Job Types** (Async Processing)

```typescript
// 1. NOTIFICATION JOBS
'notification:email' → Send order confirmation
'notification:sms' → Send ticket barcode
'notification:push' → Send event reminder
'notification:daily_digest' → Promoter daily summary

// 2. ANALYTICS JOBS
'analytics:log_search' → Log search impressions
'analytics:log_order' → Log order event
'analytics:log_channel' → Log channel metrics
'analytics:refresh_dashboard' → Refresh real-time dashboard

// 3. RECONCILIATION JOBS
'reconcile:inventory' → Match actual vs recorded
'reconcile:channel_health' → Check channel status
'reconcile:settlement' → Generate payout reports

// 4. MAINTENANCE JOBS
'maintenance:expire_holds' → Release expired seat holds
'maintenance:archive_events' → Archive completed events
'maintenance:cleanup_tokens' → Revoke expired tokens

// 5. PREDICTION JOBS
'predict:occupancy' → Predict event occupancy
'predict:revenue' → Forecast revenue
'predict:fraud_score' → ML fraud scoring
```

### **Bull Queue Configuration**

```typescript
// Redis-backed with retry logic
{
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000 // 2s, 4s, 8s
  },
  removeOnComplete: true,
  removeOnFail: false // Keep for debugging
}
```

---

## API GATEWAY & ROUTING

### **URL Structure**

```
Base: /api/v1

EVENT MANAGEMENT
POST   /api/v1/events/manage/create
POST   /api/v1/events/manage/{eventId}/pricing/rules
POST   /api/v1/events/manage/{eventId}/channels/allocate
POST   /api/v1/events/manage/{eventId}/campaigns/create
GET    /api/v1/events/manage/{eventId}/calendar

CHANNEL MANAGEMENT
POST   /api/v1/channels/config
POST   /api/v1/channels/{eventId}/allocate
GET    /api/v1/channels/{eventId}/health
POST   /api/v1/channels/{eventId}/reallocate
GET    /api/v1/channels/{eventId}/analytics

LAYOUT MANAGEMENT
POST   /api/v1/layouts/venue/{venueId}
POST   /api/v1/layouts/{layoutId}/sightlines
POST   /api/v1/layouts/{layoutId}/seats/hold
POST   /api/v1/layouts/{layoutId}/seats/release

3D / LIVE INVENTORY (canonical)
GET    /api/v1/3d/events/{eventId}/interactive
GET    /api/v1/3d/events/{eventId}/heatmap
POST   /api/v1/3d/events/{eventId}/recommendations

SEARCH & DISCOVERY
GET    /api/v1/search/events?query=taylor&dateRange=...
GET    /api/v1/search/facets
GET    /api/v1/search/autocomplete?q=taylor
GET    /api/v1/search/trending
GET    /api/v1/search/recommendations/{userId}

CAMPAIGNS
POST   /api/v1/campaigns/create/{organizationId}/{eventId}
POST   /api/v1/campaigns/{campaignId}/publish
POST   /api/v1/campaigns/validate-code
GET    /api/v1/campaigns/{campaignId}/analytics
POST   /api/v1/campaigns/{userId}/loyalty/award
GET    /api/v1/campaigns/{userId}/loyalty/balance

TAQUILLA / POS
POST   /api/v1/taquilla/terminal/init
POST   /api/v1/taquilla/session/start
POST   /api/v1/taquilla/checkout
POST   /api/v1/taquilla/payment
GET    /api/v1/taquilla/receipt/{orderId}
POST   /api/v1/taquilla/scan
POST   /api/v1/taquilla/sync-inventory
GET    /api/v1/taquilla/analytics/{terminalId}/{period}

REPORTING
GET    /api/v1/reports/dashboard/realtime/{organizationId}
GET    /api/v1/reports/settlement/{organizationId}/{period}
GET    /api/v1/reports/heatmap/{eventId}
GET    /api/v1/reports/predict/{eventId}
GET    /api/v1/reports/channels/{organizationId}
GET    /api/v1/reports/customers/{organizationId}
GET    /api/v1/reports/forecast/{organizationId}/{days}
```

---

## DATA SYNCHRONIZATION

### **Real-Time Sync Pattern (every 30 seconds)**

```typescript
// 1. EventManagement → ChannelManagement
PublishEvent → ChannelManagement.notifyNewEvent()
├─ Update inventory allocations
├─ Calculate available inventory per channel
└─ Push to all connected terminals

// 2. Inventory → SearchService
InventoryService.updateInventory() → SearchService.updateDemandSignals()
├─ Recalculate trending scores
├─ Update occupancy-based ranking
└─ Refresh trending events list

// 3. Orders → Reporting
OrderService.completeOrder() → ReportingService.updateRealtimeDashboard()
├─ Increment order count
├─ Update revenue total
├─ Calculate occupancy %
├─ Update channel breakdown
└─ Trigger occupancy prediction

// 4. Campaigns → Pricing
CampaignService.redeemCode() → PricingService.applyDiscount()
├─ Decrement allocation
├─ Apply discount to order
└─ Track campaign ROI

// 5. TaquillaPOS → Inventory
TerminalService.completeCheckout() → InventoryService.updateAvailable()
├─ Mark seats as SOLD
├─ Update channel inventory
├─ Trigger reallocation if needed
└─ Sync back to other terminals
```

### **Consistency Guarantees**

```
✅ Strong Consistency: Order creation (atomic transaction)
✅ Eventual Consistency: Analytics updates (eventual)
✅ Read-After-Write: Payment confirmation (read within 1s)
✅ Causal Consistency: Campaign → Discount → Order
```

---

## ERROR HANDLING & RETRY LOGIC

### **HTTP Status Codes**

```
200 OK           - Success
201 CREATED      - Resource created
202 ACCEPTED     - Async job queued
400 BAD REQUEST  - Invalid input
401 UNAUTHORIZED - Missing auth
403 FORBIDDEN    - No permission
404 NOT FOUND    - Resource not found
409 CONFLICT     - Business logic conflict (seat taken, code expired)
422 UNPROCESSABLE - Validation error
429 TOO MANY     - Rate limited
500 ERROR        - Server error
503 UNAVAILABLE  - Service temporarily down (Redis/DB offline)
```

### **Retry Logic**

```
// Idempotent operations (safe to retry)
✅ GET requests
✅ Payment confirmation (idempotency key)
✅ Order completion (transaction check)

// Non-idempotent (require caution)
❌ Order creation (check for duplicates)
❌ Campaign code redemption (one-time use)
❌ Point awards (track in metadata)
```

---

## INTEGRATION PATTERNS

### **Pattern 1: Event Notification Chain**

```
User clicks "Checkout"
  → TaquillaPOS.quickCheckout()
  → Emits: order.created webhook
  → Bull: notification:email job queued
  → Bull: analytics:log_order job queued
  → Bull: predict:fraud_score job queued
  → Return: {orderId, status: 'processing'}
  
[Asynchronously]
  → PaymentService.processPayment()
  → Emits: order.completed webhook
  → Bull: notification:order_confirmed job
  → OrderService.generateTickets()
  → Tickets stored with barcode
  → ReportingService.updateDashboard()
```

### **Pattern 2: Dynamic Allocation**

```
Every 30 seconds: ChannelManagement.reallocateInventory()
  → Get current occupancy by channel
  → Apply reallocation rules:
     IF occupancy(web) < 30% AND queue(taquilla) > 20:
       → Move 50 tickets from web → taquilla
       → Emit: channel.reallocated webhook
       → Update all terminals
  → Calculate new health metrics
  → Emit: channel.health_changed webhook if status changes
```

### **Pattern 3: Predictive Scoring**

```
Every hour: ReportingService.predictOccupancy(eventId)
  → Fetch current occupancy %
  → Fetch historical data (similar events)
  → Calculate days-until-event
  → ML model prediction:
     IF daysUntil > 60: low confidence, slow growth
     IF daysUntil 14-60: medium confidence, acceleration
     IF daysUntil < 14: high confidence, rapid sales
  → Generate recommendation
  → Store in cache for admin dashboard
  → If prediction > 90%: Emit event.sold_out webhook
  → If prediction jumped 20%+: Emit event.trending webhook
```

### **Pattern 4: Campaign Lifecycle**

```
DRAFT → [admin publishes] → ACTIVE → [auto-ends at endsAt] → ENDED

During ACTIVE:
  ✅ Presale codes can be redeemed
  ✅ Every redemption:
     → Validate code (time, allocation, user limits, segments)
     → Decrement allocation
     → Apply discount to order
     → Emit campaign.code_redeemed webhook
     → Award loyalty points if applicable
     → Log to analytics
```

---

## COMPLETE REQUEST-RESPONSE EXAMPLES

### **Example 1: Event Creation → Full Pipeline**

```
REQUEST:
POST /api/v1/events/manage/create
Authorization: Bearer {jwt_token}
{
  "title": "Taylor Swift Concert",
  "type": "single",
  "startDate": "2026-05-20",
  "venueId": "venue_123",
  "capacity": 20000,
  "basePrice": 150,
  "channels": {
    "WEB": 0.40,
    "TAQUILLA": 0.30,
    "API": 0.20,
    "PHONE": 0.10
  }
}

RESPONSE (202 ACCEPTED):
{
  "eventId": "evt_taylor_2026",
  "status": "PUBLISHED",
  "inventory": {
    "WEB": 8000,
    "TAQUILLA": 6000,
    "API": 4000,
    "PHONE": 2000
  },
  "basePrice": 150,
  "jobId": "job_evt_creation_xyz"
}

BACKGROUND JOBS:
1. EventManagement.createEvent() → COMPLETE
2. ChannelManagement.allocateInventory() → COMPLETE
3. InventoryService.createTickets() → QUEUED
4. SearchService.indexEvent() → QUEUED
5. Notifications.sendToPromotionPartners() → QUEUED

WEBHOOKS EMITTED:
event.published → {eventId, title, capacity}
```

### **Example 2: Customer Checkout (< 45 seconds)**

```
REQUEST:
POST /api/v1/taquilla/checkout
{
  "terminalId": "term_main_1",
  "sessionId": "sess_alice_001",
  "eventId": "evt_taylor_2026",
  "offerId": "offer_premium_vip",
  "quantity": 2,
  "discountCode": "VIP20",
  "paymentMethod": "CARD"
}

[EXECUTION TIMELINE]
T+0s:   START
T+1s:   Event lookup (cache hit) → Premium: $250, VIP discount: 20%
T+2s:   Presale code validation → VALID, -$50 per ticket
T+3s:   Atomically hold 2 seats → HELD until T+18 (15 min)
T+4s:   Create order → ORD-20260517-0042
T+5s:   Create 2 order items → Items linked
T+6s:   Calculate: $250 × 2 = $500
        Discount: $50 × 2 = -$100
        Subtotal: $400
        Fees (10%): $40
        Taxes (16%): $64
        Total: $504

RESPONSE (200 OK) @ T+7s:
{
  "orderId": "ORD-20260517-0042",
  "total": 504.00,
  "breakdown": {
    "subtotal": 400,
    "discount": 100,
    "fees": 40,
    "taxes": 64
  },
  "processingTime": "7.2 seconds",
  "status": "READY_FOR_PAYMENT",
  "heldUntil": "2026-05-17T14:47:45Z"
}

PAYMENT PROCESSING:
POST /api/v1/payment/process
{
  "orderId": "ORD-20260517-0042",
  "method": "CARD",
  "amount": 504
}

RESPONSE (200 OK):
{
  "paymentId": "pay_xyz123",
  "status": "APPROVED",
  "timestamp": "2026-05-17T14:32:52Z"
}

BACKGROUND JOBS (async):
✅ Bull: notification:email → Order receipt
✅ Bull: notification:sms → Ticket barcode
✅ Bull: analytics:log_order → Channel/revenue/customer data
✅ Bull: predict:fraud_score → ML fraud detection
✅ CampaignExecution.awardLoyaltyPoints(userId, 50 points)

WEBHOOKS EMITTED:
✅ order.created
✅ order.completed
✅ campaign.code_redeemed
```

---

**Last Updated:** May 17, 2026  
**Integration Level:** COMPLETE ✅  
**All 7 Pillars:** Connected & Operational  
**Status:** Production Ready
