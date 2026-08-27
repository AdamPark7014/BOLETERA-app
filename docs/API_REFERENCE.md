# BOLETERA API Reference - Complete Endpoint Documentation

> **MEGA HEAVY API DOCUMENTATION**
> 
> **Version:** 3.0  
> **Last Updated:** May 17, 2026  
> **Status:** Production Ready  
> **Total Endpoints:** 75+  
> **Authentication:** JWT Bearer Token (required for all endpoints)

---

## TABLE OF CONTENTS

1. [Authentication & Authorization](#authentication--authorization)
2. [Event Management Endpoints](#event-management-endpoints)
3. [Channel Management Endpoints](#channel-management-endpoints)
4. [Layout Management Endpoints](#layout-management-endpoints)
5. [Search & Discovery Endpoints](#search--discovery-endpoints)
6. [Campaign Management Endpoints](#campaign-management-endpoints)
7. [Taquilla / POS Endpoints](#taquilla--pos-endpoints)
8. [Reporting & Analytics Endpoints](#reporting--analytics-endpoints)
9. [Common Patterns](#common-patterns)
10. [Error Handling](#error-handling)

---

## AUTHENTICATION & AUTHORIZATION

### JWT Token Structure
```json
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "sub": "user_id",
    "email": "user@example.com",
    "roles": ["CUSTOMER", "PROMOTER"],
    "organizationId": "org_xyz",
    "iat": 1684351965,
    "exp": 1684438365
  }
}
```

### Authorization Levels
```
✅ CUSTOMER    → Can purchase, view owned orders, resell
✅ PROMOTER    → Can create events, manage campaigns, view analytics
✅ VENUE_MANAGER → Can manage venue layout, terminal config
✅ ARTIST      → Can view artist events
✅ ADMIN       → Can manage all orders, events, users
✅ SUPER_ADMIN → Full system access
```

---

## EVENT MANAGEMENT ENDPOINTS

### 1. Create Single Event
```
POST /api/v1/events/manage/create
Content-Type: application/json
Authorization: Bearer {token}

REQUEST BODY:
{
  "title": "Taylor Swift Concert",
  "description": "Amazing live concert",
  "type": "single",
  "startDate": "2026-05-20T20:00:00Z",
  "endDate": "2026-05-20T23:00:00Z",
  "venueId": "venue_madison_square",
  "capacity": 20000,
  "basePrice": 150.00,
  "imageUrl": "https://images.example.com/taylor.jpg",
  "timezone": "America/New_York"
}

RESPONSE (201 CREATED):
{
  "eventId": "evt_taylor_2026_05_20",
  "title": "Taylor Swift Concert",
  "slug": "taylor-swift-concert-1715851200",
  "status": "DRAFT",
  "type": "single",
  "capacity": 20000,
  "basePrice": 150.00,
  "organization": {
    "id": "org_promoter_1",
    "name": "Live Nation"
  },
  "venue": {
    "id": "venue_madison_square",
    "name": "Madison Square Garden",
    "address": "...address..."
  },
  "createdAt": "2026-05-17T14:32:45Z",
  "updatedAt": "2026-05-17T14:32:45Z"
}

STATUS CODES:
✅ 201 CREATED      - Event created successfully
❌ 400 BAD REQUEST  - Invalid input (missing field, invalid date)
❌ 401 UNAUTHORIZED - Missing/invalid token
❌ 403 FORBIDDEN    - Not permission to create events
❌ 404 NOT FOUND    - Venue not found
```

### 2. Create Event Series
```
POST /api/v1/events/manage/series/create
Authorization: Bearer {token}

REQUEST BODY:
{
  "seriesName": "Hamilton Broadway Tour",
  "description": "Multi-city Hamilton production",
  "occurrences": [
    {
      "date": "2026-05-20",
      "title": "New York",
      "venueId": "venue_broadway",
      "capacity": 2000
    },
    {
      "date": "2026-05-21",
      "title": "New York",
      "venueId": "venue_broadway",
      "capacity": 2000
    },
    {
      "date": "2026-06-01",
      "title": "Los Angeles",
      "venueId": "venue_hollywood",
      "capacity": 2500
    }
  ],
  "basePrice": 200.00
}

RESPONSE (201 CREATED):
{
  "seriesId": "ser_hamilton_2026",
  "seriesName": "Hamilton Broadway Tour",
  "occurrences": 3,
  "totalCapacity": 6500,
  "events": [
    {eventId: "evt_hamilton_ny_1", ...},
    {eventId: "evt_hamilton_ny_2", ...},
    {eventId: "evt_hamilton_la_1", ...}
  ]
}
```

### 3. Create Residency
```
POST /api/v1/events/manage/residency/create
Authorization: Bearer {token}

REQUEST BODY:
{
  "name": "Celine Dion - Las Vegas Residency",
  "venueId": "venue_caesars_palace",
  "frequency": "nightly",  // daily, weekly, biweekly, monthly
  "startDate": "2026-06-01",
  "occurrenceCount": 120,
  "exceptions": ["2026-07-04"],  // Dark dates
  "basePrice": 250.00
}

RESPONSE (201 CREATED):
{
  "residencyId": "res_celine_vegas_2026",
  "name": "Celine Dion - Las Vegas Residency",
  "frequency": "nightly",
  "totalOccurrences": 120,
  "totalCapacity": 240000,
  "startDate": "2026-06-01",
  "estimatedEndDate": "2026-10-28"
}
```

### 4. Set Pricing Rules
```
POST /api/v1/events/manage/{eventId}/pricing/rules
Authorization: Bearer {token}

REQUEST BODY:
{
  "basePrice": 150,
  "surgePricing": {
    "enabled": true,
    "tiers": [
      {"occupancy": 70, "multiplier": 1.15},
      {"occupancy": 80, "multiplier": 1.30},
      {"occupancy": 90, "multiplier": 1.50}
    ]
  },
  "timeBased": {
    "enabled": true,
    "rules": [
      {"daysUntilEvent": 90, "multiplier": 0.85},
      {"daysUntilEvent": 30, "multiplier": 1.00},
      {"daysUntilEvent": 7, "multiplier": 1.20},
      {"daysUntilEvent": 1, "multiplier": 1.40}
    ]
  },
  "segmentPricing": {
    "EARLY_BUYER": 0.85,
    "REGULAR": 1.00,
    "VVIP": 1.25
  },
  "customZones": {
    "section_101": 200,
    "section_102": 150,
    "section_103": 100
  }
}

RESPONSE (200 OK):
{
  "eventId": "evt_taylor_2026",
  "pricingRules": {
    "basePrice": 150,
    "surgePricingEnabled": true,
    "timeBasedEnabled": true,
    "segmentPricingEnabled": true,
    "customZonesEnabled": true
  },
  "updatedAt": "2026-05-17T14:32:45Z"
}
```

### 5. Allocate Channels
```
POST /api/v1/events/manage/{eventId}/channels/allocate
Authorization: Bearer {token}

REQUEST BODY:
{
  "channels": {
    "WEB": {
      "percentage": 40,
      "discount": -5,
      "activeHours": "00:00-23:59"
    },
    "TAQUILLA": {
      "percentage": 30,
      "discount": 0,
      "activeHours": "08:00-22:00"
    },
    "API": {
      "percentage": 20,
      "discount": -10
    },
    "PHONE": {
      "percentage": 10,
      "discount": 0
    }
  }
}

RESPONSE (200 OK):
{
  "eventId": "evt_taylor_2026",
  "totalCapacity": 20000,
  "allocation": {
    "WEB": {"tickets": 8000, "discount": -5},
    "TAQUILLA": {"tickets": 6000, "discount": 0},
    "API": {"tickets": 4000, "discount": -10},
    "PHONE": {"tickets": 2000, "discount": 0}
  },
  "validation": {
    "totalPercentage": 100,
    "status": "VALID"
  }
}

ERRORS:
❌ 422 UNPROCESSABLE:
   {
     "error": "Channel allocation does not total 100%",
     "allocation": 95,
     "required": 100
   }
```

### 6. Create Campaign
```
POST /api/v1/events/manage/{eventId}/campaigns/create
Authorization: Bearer {token}

REQUEST BODY:
{
  "name": "VIP Presale",
  "type": "presale",  // presale, early_bird, vip, group, loyalty
  "description": "Early access for VIP members",
  "startsAt": "2026-05-10T10:00:00Z",
  "endsAt": "2026-05-15T23:59:59Z",
  "allocation": 500,
  "quantityPerUser": 4,
  "discountType": "percentage",  // percentage, fixed
  "discountValue": 20,
  "budget": 50000,
  "targetSegments": ["prior_attendees"],
  "metadata": {
    "minLoyaltyLevel": "silver"
  }
}

RESPONSE (201 CREATED):
{
  "campaignId": "camp_vip_presale_001",
  "eventId": "evt_taylor_2026",
  "name": "VIP Presale",
  "type": "presale",
  "status": "DRAFT",
  "allocation": 500,
  "presaleCodes": 500,
  "discountType": "percentage",
  "discountValue": 20,
  "createdAt": "2026-05-17T14:32:45Z"
}
```

### 7. Get Event Calendar
```
GET /api/v1/events/manage/{organizationId}/calendar?month=2026-05
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "month": "2026-05",
  "calendar": {
    "1": [],
    "2": [],
    ...
    "20": [
      {
        "eventId": "evt_taylor_2026",
        "title": "Taylor Swift Concert",
        "startTime": "20:00",
        "occupancy": 45.5,
        "status": "PUBLISHED"
      }
    ],
    ...
    "31": []
  }
}
```

---

## CHANNEL MANAGEMENT ENDPOINTS

### 8. Configure Channels
```
POST /api/v1/channels/config/{eventId}
Authorization: Bearer {token}

REQUEST BODY:
{
  "channels": [
    {
      "name": "WEB",
      "enabled": true,
      "allocation": 40,
      "activeHours": "00:00-23:59",
      "locations": ["boletera.com"]
    },
    {
      "name": "TAQUILLA",
      "enabled": true,
      "allocation": 30,
      "activeHours": "08:00-22:00",
      "locations": [
        {
          "id": "loc_main_box",
          "name": "Main Box Office",
          "address": "123 Main St",
          "terminals": 2,
          "staff": 2
        }
      ]
    }
  ]
}

RESPONSE (200 OK):
{
  "eventId": "evt_taylor_2026",
  "channelsConfigured": 4,
  "status": "CONFIGURED"
}
```

### 9. Get Channel Health
```
GET /api/v1/channels/{eventId}/health
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "eventId": "evt_taylor_2026",
  "generatedAt": "2026-05-17T14:32:45Z",
  "health": {
    "WEB": {
      "status": "healthy",
      "responseTime": 125,
      "errorRate": 0.1,
      "occupancy": 55,
      "trend": "↑ 8%"
    },
    "TAQUILLA": {
      "status": "healthy",
      "syncLag": 2,
      "activeTerminals": 2,
      "queueLength": 8,
      "avgTransactionTime": 45,
      "errorRate": 0.2
    },
    "API": {
      "status": "healthy",
      "activePartners": 3,
      "rateLimitUsage": 45,
      "errorRate": 0.05
    },
    "PHONE": {
      "status": "healthy",
      "activeOperators": 2,
      "callQueueLength": 3
    }
  }
}
```

### 10. Dynamic Reallocation
```
POST /api/v1/channels/{eventId}/reallocate
Authorization: Bearer {token}

REQUEST BODY (optional - auto if empty):
{
  "rules": [
    {
      "condition": "web_occupancy < 30 AND taquilla_queue > 20",
      "action": "move 50 from WEB to TAQUILLA"
    }
  ]
}

RESPONSE (200 OK):
{
  "eventId": "evt_taylor_2026",
  "reallocations": [
    {
      "from": "WEB",
      "to": "TAQUILLA",
      "quantity": 50,
      "reason": "Demand-based reallocation",
      "timestamp": "2026-05-17T14:32:45Z"
    }
  ],
  "newAllocation": {
    "WEB": 1950,
    "TAQUILLA": 1550,
    "API": 1000,
    "PHONE": 500
  }
}
```

### 11. Get Channel Analytics
```
GET /api/v1/channels/{eventId}/analytics?period=last_7_days
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "eventId": "evt_taylor_2026",
  "period": "last_7_days",
  "channels": [
    {
      "channel": "WEB",
      "orders": 450,
      "revenue": 67500,
      "avgOrderValue": 150.00,
      "completion": 98.2,
      "conversionRate": 12.5
    },
    {
      "channel": "TAQUILLA",
      "orders": 320,
      "revenue": 48000,
      "avgOrderValue": 150.00,
      "completion": 99.8,
      "conversionRate": 21.3
    },
    {
      "channel": "API",
      "orders": 150,
      "revenue": 22500,
      "avgOrderValue": 150.00,
      "partners": 3,
      "completion": 97.1
    },
    {
      "channel": "PHONE",
      "orders": 80,
      "revenue": 12000,
      "avgOrderValue": 150.00,
      "completion": 95.0
    }
  ],
  "totalRevenue": 150000
}
```

### 12. Add API Partner
```
POST /api/v1/channels/{eventId}/partners/add
Authorization: Bearer {token}

REQUEST BODY:
{
  "name": "Ticket Reseller Inc",
  "allocation": 10,  // % of API channel
  "commissionRate": 5,  // %
  "rateLimit": 1000,  // per minute
  "webhookUrl": "https://partner.com/webhook"
}

RESPONSE (201 CREATED):
{
  "partnerId": "partner_xyz",
  "name": "Ticket Reseller Inc",
  "apiKey": "sk_live_xyz123...",
  "apiSecret": "***",
  "allocation": 10,
  "commissionRate": 5,
  "status": "ACTIVE"
}
```

---

## LAYOUT MANAGEMENT ENDPOINTS

### 13. Create Venue Layout
```
POST /api/v1/layouts/venue/{venueId}
Authorization: Bearer {token}

REQUEST BODY:
{
  "name": "Main Floor 2026",
  "description": "Full capacity configuration",
  "totalCapacity": 20000,
  "sections": [
    {
      "sectionId": "A",
      "name": "Front Center",
      "capacity": 5000,
      "type": "premium",
      "pricingMultiplier": 1.5,
      "rows": 50,
      "seatsPerRow": 100
    },
    {
      "sectionId": "B",
      "name": "Side Premium",
      "capacity": 4000,
      "type": "premium",
      "pricingMultiplier": 1.25,
      "rows": 40,
      "seatsPerRow": 100
    },
    {
      "sectionId": "C",
      "name": "General Admission",
      "capacity": 8000,
      "type": "general",
      "pricingMultiplier": 1.0,
      "rows": 80,
      "seatsPerRow": 100
    },
    {
      "sectionId": "D",
      "name": "Accessible",
      "capacity": 3000,
      "type": "accessible",
      "pricingMultiplier": 0.9,
      "rows": 30,
      "seatsPerRow": 100
    }
  ]
}

RESPONSE (201 CREATED):
{
  "layoutId": "layout_msg_2026_main",
  "venueId": "venue_madison_square",
  "name": "Main Floor 2026",
  "capacity": 20000,
  "sectionsCreated": 4,
  "seatsCreated": 20000,
  "status": "ACTIVE"
}
```

### 14. Calculate Sightline Scores
```
POST /api/v1/layouts/{layoutId}/sightlines
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "layoutId": "layout_msg_2026_main",
  "seatsProcessed": 20000,
  "scoreDistribution": {
    "90-100": 2000,  // Excellent view
    "70-89": 6000,   // Good view
    "50-69": 8000,   // Standard view
    "0-49": 4000     // Limited view
  }
}
```

### 15. Get Seat Recommendations (canonical)
```
POST /api/v1/3d/events/{eventId}/recommendations
Authorization: Bearer {token}

REQUEST BODY:
{
  "count": 2,
  "viewQuality": "best",
  "tier": "premium"
}

RESPONSE (200 OK):
{
  "eventId": "evt_taylor_2026",
  "recommendations": [
    {
      "seatId": "seat_A_25_50",
      "score": 95.5,
      "tier": "premium"
    }
  ]
}
```

> Removed: `GET /layouts/{layoutId}/recommendations/:eventId` (use this endpoint).

### 16. Get Occupancy Heatmap (canonical)
```
GET /api/v1/3d/events/{eventId}/heatmap

RESPONSE (200 OK):
{
  "eventId": "evt_taylor_2026",
  "heatmap": {
    "A": { "occupied": 4750, "available": 250, "percentage": 95.0 },
    "B": { "occupied": 2800, "available": 1200, "percentage": 70.0 }
  }
}
```

> Removed: `GET /layouts/{layoutId}/heatmap/{eventId}`.

### 17. Live Interactive Seat Status (canonical)
```
GET /api/v1/3d/events/{eventId}/interactive

RESPONSE (200 OK):
{
  "eventId": "evt_taylor_2026",
  "statusBySeat": {
    "seat_A_1_1": "available",
    "seat_A_1_2": "sold"
  }
}
```

Geometry is projected client-side from published `SeatMapData` via `@boletera/venue-3d`.

> Removed: `GET /layouts/{layoutId}/3d/{eventId}`.

### 18. Hold Seats
```
POST /api/v1/layouts/{layoutId}/seats/hold
Authorization: Bearer {token}

REQUEST BODY:
{
  "eventId": "evt_taylor_2026",
  "seatIds": ["seat_A_25_50", "seat_A_26_50"],
  "durationMinutes": 15
}

RESPONSE (200 OK):
{
  "seatsHeld": 2,
  "expiresAt": "2026-05-17T14:47:45Z",
  "holdIds": ["hold_xyz1", "hold_xyz2"]
}
```

---

## SEARCH & DISCOVERY ENDPOINTS

### 19. Search Events (AI-Powered)
```
GET /api/v1/search/events
Authorization: Bearer {token}

QUERY PARAMETERS:
?query=taylor+swift
&dateRange=2026-05-01,2026-05-31
&priceRange=100,300
&categories=music,concerts
&cities=new_york,los_angeles
&userId={user_id}

RESPONSE (200 OK):
{
  "query": "taylor swift",
  "totalResults": 15,
  "results": [
    {
      "eventId": "evt_taylor_2026_05_20",
      "title": "Taylor Swift Concert - New York",
      "score": 98.5,
      "rankingFactors": {
        "contentMatching": 100.0,      // 30% weight
        "personalization": 95.2,        // 40% weight
        "demandSignals": 92.0,          // 20% weight
        "businessValue": 85.0           // 10% weight
      },
      "occupancy": 45.5,
      "venue": "Madison Square Garden",
      "startDate": "2026-05-20T20:00:00Z",
      "basePrice": 150.00
    },
    {...more results...}
  ]
}
```

### 20. Get Search Facets
```
GET /api/v1/search/facets
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "categories": [
    {"name": "Music", "count": 234},
    {"name": "Theater", "count": 156},
    {"name": "Sports", "count": 89}
  ],
  "cities": [
    {"name": "New York", "count": 145},
    {"name": "Los Angeles", "count": 98},
    {"name": "Chicago", "count": 67}
  ],
  "priceRange": {
    "min": 25,
    "max": 500
  }
}
```

### 21. Autocomplete Search
```
GET /api/v1/search/autocomplete?q=taylor
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "suggestions": [
    {
      "label": "Taylor Swift Concert - NY",
      "type": "event",
      "preview": "Music • May 20, 2026"
    },
    {
      "label": "Taylor Momsen - Concert",
      "type": "event",
      "preview": "Music • June 15, 2026"
    },
    {
      "label": "Music",
      "type": "category",
      "preview": "Browse category"
    }
  ]
}
```

### 22. Get Trending Events
```
GET /api/v1/search/trending?limit=10
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "trending": [
    {
      "eventId": "evt_taylor_2026_05_20",
      "title": "Taylor Swift Concert",
      "score": 92.5,
      "occupancy": 88.5,
      "trendingRank": 1,
      "trendingSince": "2026-05-15T14:32:45Z"
    },
    {...more trending...}
  ]
}
```

### 23. Get Personalized Recommendations
```
GET /api/v1/search/recommendations/{userId}
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "userId": "user_john_123",
  "recommendations": [
    {
      "eventId": "evt_concert_001",
      "title": "Similar Artist Concert",
      "category": "Music",
      "score": 85.0,
      "reason": "Based on your purchase history"
    },
    {...more recommendations...}
  ]
}
```

---

## CAMPAIGN MANAGEMENT ENDPOINTS

### 24. Create Campaign
```
POST /api/v1/campaigns/create/{organizationId}/{eventId}
Authorization: Bearer {token}

REQUEST BODY:
{
  "name": "Early Bird - 20% Off",
  "type": "early_bird",
  "startsAt": "2026-05-01",
  "endsAt": "2026-05-15",
  "allocation": 1000,
  "quantityPerUser": 10,
  "discountType": "percentage",
  "discountValue": 20,
  "budget": 30000
}

RESPONSE (201 CREATED):
{
  "campaignId": "camp_early_bird_001",
  "name": "Early Bird - 20% Off",
  "type": "early_bird",
  "status": "DRAFT",
  "presaleCodes": 1000
}
```

### 25. Publish Campaign
```
POST /api/v1/campaigns/{campaignId}/publish
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "campaignId": "camp_early_bird_001",
  "status": "ACTIVE",
  "publishedAt": "2026-05-17T14:32:45Z"
}
```

### 26. Validate Presale Code
```
POST /api/v1/campaigns/validate-code
Authorization: Bearer {token}

REQUEST BODY:
{
  "code": "EBIRD20",
  "eventId": "evt_taylor_2026",
  "userId": "user_123"
}

RESPONSE (200 OK):
{
  "valid": true,
  "discount": 20,
  "discountType": "percentage",
  "campaignId": "camp_early_bird_001",
  "campaignName": "Early Bird - 20% Off"
}

OR (invalid):
{
  "valid": false,
  "reason": "Code already used"
}
```

### 27. Get Campaign Analytics
```
GET /api/v1/campaigns/{campaignId}/analytics
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "campaignId": "camp_early_bird_001",
  "name": "Early Bird - 20% Off",
  "type": "early_bird",
  "status": "ACTIVE",
  "stats": {
    "allocation": 1000,
    "redeemed": 750,
    "remaining": 250,
    "redemptionRate": 75.0,
    "associatedOrders": 750,
    "estimatedRevenue": 100000.00
  },
  "period": {
    "startDate": "2026-05-01",
    "endDate": "2026-05-15"
  }
}
```

### 28. Award Loyalty Points
```
POST /api/v1/campaigns/{userId}/loyalty/award
Authorization: Bearer {token}

REQUEST BODY:
{
  "eventId": "evt_taylor_2026",
  "points": 100
}

RESPONSE (200 OK):
{
  "userId": "user_123",
  "points": 450,
  "tier": "SILVER",
  "awardedPoints": 100,
  "timestamp": "2026-05-17T14:32:45Z"
}
```

### 29. Get Loyalty Balance
```
GET /api/v1/campaigns/{userId}/loyalty/balance
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "userId": "user_123",
  "points": 450,
  "tier": "SILVER",
  "nextTierRequires": 50
}
```

---

## TAQUILLA / POS ENDPOINTS

### 30. Initialize Terminal
```
POST /api/v1/taquilla/terminal/init
Authorization: Bearer {token}

REQUEST BODY:
{
  "locationName": "Main Box Office",
  "terminalName": "POS-MAIN-1",
  "hardwareConfig": {
    "printerModel": "Star TSP800",
    "scannerVendor": "Honeywell",
    "cardReaderModel": "Ingenico iWL",
    "displayModel": "7\" LCD"
  }
}

RESPONSE (201 CREATED):
{
  "terminalId": "term_main_1",
  "status": "READY",
  "mode": "ONLINE",
  "location": "Main Box Office",
  "hardwareVerified": true
}
```

### 31. Start Cashier Session
```
POST /api/v1/taquilla/session/start
Authorization: Bearer {token}

REQUEST BODY:
{
  "terminalId": "term_main_1",
  "cashierId": "cashier_alice_001"
}

RESPONSE (200 OK):
{
  "sessionId": "sess_alice_001",
  "terminalId": "term_main_1",
  "cashierId": "cashier_alice_001",
  "status": "ACTIVE",
  "startedAt": "2026-05-17T08:00:00Z"
}
```

### 32. Quick Checkout (< 45 seconds)
```
POST /api/v1/taquilla/checkout
Authorization: Bearer {token}

REQUEST BODY:
{
  "terminalId": "term_main_1",
  "sessionId": "sess_alice_001",
  "eventId": "evt_taylor_2026",
  "offerId": "offer_premium_vip",
  "quantity": 2,
  "paymentMethod": "CARD",
  "discountCode": "VIP20"
}

RESPONSE (200 OK):
{
  "orderId": "ORD-20260517-0042",
  "total": 504.00,
  "breakdown": {
    "subtotal": 400.00,
    "discount": 100.00,
    "fees": 40.00,
    "taxes": 64.00
  },
  "processingTime": "7.2 seconds",
  "status": "READY_FOR_PAYMENT",
  "heldUntil": "2026-05-17T14:47:45Z"
}
```

### 33. Process Payment
```
POST /api/v1/taquilla/payment
Authorization: Bearer {token}

REQUEST BODY:
{
  "orderId": "ORD-20260517-0042",
  "method": "CARD",
  "cardDetails": {
    "lastFour": "4242",
    "brand": "VISA"
  },
  "amount": 504.00
}

RESPONSE (200 OK):
{
  "paymentId": "pay_xyz123",
  "status": "APPROVED",
  "orderId": "ORD-20260517-0042",
  "amount": 504.00,
  "timestamp": "2026-05-17T14:32:52Z"
}
```

### 34. Generate Receipt
```
GET /api/v1/taquilla/receipt/{orderId}
Authorization: Bearer {token}

REQUEST BODY:
{
  "terminalId": "term_main_1"
}

RESPONSE (200 OK):
{
  "receiptNumber": "RCP-20260517-0023",
  "timestamp": "2026-05-17T14:32:52Z",
  "event": "Taylor Swift Concert",
  "quantity": 2,
  "subtotal": 400.00,
  "discount": 100.00,
  "fees": 40.00,
  "taxes": 64.00,
  "total": 504.00,
  "paymentMethod": "CARD",
  "tickets": [
    {
      "barcode": "TKT-20260517-0001",
      "seatInfo": "A-25-50"
    },
    {
      "barcode": "TKT-20260517-0002",
      "seatInfo": "A-26-50"
    }
  ]
}
```

### 35. End Cashier Session
```
POST /api/v1/taquilla/session/end
Authorization: Bearer {token}

REQUEST BODY:
{
  "sessionId": "sess_alice_001",
  "cashierId": "cashier_alice_001"
}

RESPONSE (200 OK):
{
  "sessionId": "sess_alice_001",
  "startTime": "2026-05-17T08:00:00Z",
  "endTime": "2026-05-17T17:00:00Z",
  "totalTransactions": 65,
  "totalRevenue": 9750.00,
  "paymentBreakdown": {
    "CASH": {count: 30, amount: 4500.00},
    "CARD": {count: 35, amount: 5250.00}
  },
  "status": "CLOSED"
}
```

### 36. Terminal Analytics
```
GET /api/v1/taquilla/analytics/{terminalId}/{period}
Authorization: Bearer {token}

QUERY PARAMETERS:
?period=TODAY|WEEK|MONTH

RESPONSE (200 OK):
{
  "terminalId": "term_main_1",
  "period": "TODAY",
  "metrics": {
    "sessions": 3,
    "transactions": 65,
    "revenue": 9750.00,
    "avgTransactionValue": 150.00,
    "avgTransactionTime": 42,
    "errorRate": 0.2
  },
  "uptime": 99.8
}
```

---

## REPORTING & ANALYTICS ENDPOINTS

### 37. Real-Time Dashboard
```
GET /api/v1/reports/dashboard/realtime/{organizationId}
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "generatedAt": "2026-05-17T14:32:45Z",
  "metrics": {
    "todayRevenue": 45000.00,
    "todayOrders": 300,
    "weekRevenue": 280000.00,
    "weekOrders": 1850,
    "avgOrderValue": 150.00,
    "occupancy": 55.5,
    "soldTickets": 11100,
    "totalTickets": 20000
  },
  "channels": [
    {
      "channel": "WEB",
      "orders": 180,
      "revenue": 27000.00
    },
    {
      "channel": "TAQUILLA",
      "orders": 85,
      "revenue": 12750.00
    },
    {
      "channel": "API",
      "orders": 25,
      "revenue": 3750.00
    },
    {
      "channel": "PHONE",
      "orders": 10,
      "revenue": 1500.00
    }
  ]
}
```

### 38. Settlement Report
```
GET /api/v1/reports/settlement/{organizationId}/{period}
Authorization: Bearer {token}

QUERY PARAMETERS:
?period=DAILY|WEEKLY|MONTHLY

RESPONSE (200 OK):
{
  "organizationId": "org_live_nation",
  "period": "DAILY",
  "dateRange": {
    "start": "2026-05-17T00:00:00Z",
    "end": "2026-05-18T00:00:00Z"
  },
  "summary": {
    "grossRevenue": 45000.00,
    "commission": 6750.00,  // 15%
    "netRevenue": 38250.00,
    "totalOrders": 300,
    "avgOrderValue": 150.00
  },
  "paymentMethods": {
    "CARD": {count: 210, amount: 31500.00},
    "CASH": {count: 80, amount: 12000.00},
    "BANK_TRANSFER": {count: 10, amount: 1500.00}
  },
  "generatedAt": "2026-05-17T14:32:45Z"
}
```

### 39. Occupancy Heatmap
```
GET /api/v1/reports/heatmap/{eventId}
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "eventId": "evt_taylor_2026",
  "heatmap": {
    "A": {
      "sold": 4750,
      "total": 5000,
      "percentage": 95.0
    },
    "B": {
      "sold": 2800,
      "total": 4000,
      "percentage": 70.0
    },
    "C": {
      "sold": 4000,
      "total": 8000,
      "percentage": 50.0
    },
    "D": {
      "sold": 1200,
      "total": 3000,
      "percentage": 40.0
    }
  }
}
```

### 40. Occupancy Prediction
```
GET /api/v1/reports/predict/{eventId}
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "eventId": "evt_taylor_2026",
  "currentOccancy": 55.5,
  "predictedOccupancy": 92.0,
  "confidence": 0.85,
  "daysUntilEvent": 3,
  "recommendation": "Event trending towards SOLD OUT. Consider price increase or demand-based pricing."
}
```

### 41. Channel Performance
```
GET /api/v1/reports/channels/{organizationId}
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "channels": [
    {
      "channel": "WEB",
      "orders": 180,
      "revenue": 27000.00,
      "avgOrderValue": 150.00,
      "percentage": 60.0
    },
    {
      "channel": "TAQUILLA",
      "orders": 85,
      "revenue": 12750.00,
      "avgOrderValue": 150.00,
      "percentage": 28.3
    },
    {
      "channel": "API",
      "orders": 25,
      "revenue": 3750.00,
      "avgOrderValue": 150.00,
      "percentage": 8.3
    },
    {
      "channel": "PHONE",
      "orders": 10,
      "revenue": 1500.00,
      "avgOrderValue": 150.00,
      "percentage": 3.3
    }
  ],
  "totalRevenue": 45000.00
}
```

### 42. Customer Analytics
```
GET /api/v1/reports/customers/{organizationId}
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "uniqueCustomers": 1200,
  "repeatCustomers": 350,
  "newCustomers": 850,
  "repeatRate": 29.2,
  "totalSpent": 180000.00,
  "avgCustomerValue": 150.00,
  "ltv": 180.00
}
```

### 43. Revenue Forecast
```
GET /api/v1/reports/forecast/{organizationId}/30
Authorization: Bearer {token}

RESPONSE (200 OK):
{
  "organizationId": "org_live_nation",
  "forecastDays": 30,
  "forecast": [
    {
      "date": "2026-05-17",
      "actual": 45000.00,
      "predicted": 47250.00
    },
    {
      "date": "2026-05-18",
      "actual": 43000.00,
      "predicted": 45150.00
    },
    {...30 days total...}
  ]
}
```

---

## COMMON PATTERNS

### Error Response Format
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Channel allocation does not total 100%",
    "timestamp": "2026-05-17T14:32:45Z",
    "path": "/api/v1/events/manage/evt_123/channels/allocate",
    "details": {
      "allocation": 95,
      "required": 100,
      "channels": {
        "WEB": 40,
        "TAQUILLA": 30,
        "API": 20,
        "PHONE": 5
      }
    }
  }
}
```

### Pagination
```
GET /api/v1/events?page=1&limit=20&sort=startDate&order=desc

RESPONSE:
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1250,
    "pages": 63
  }
}
```

### Rate Limiting
```
Headers:
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 850
X-RateLimit-Reset: 2026-05-17T15:00:00Z
```

---

**Document Status:** ✅ Complete  
**Total Endpoints Documented:** 43+ (core endpoints)  
**Additional Endpoints:** 30+ (derived from CRUD operations)  
**Total API Coverage:** 75+ endpoints

