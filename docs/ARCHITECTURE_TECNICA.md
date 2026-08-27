# BOLETERA Platform - Technical Architecture

---

## 📐 System Design Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER (Next.js)                         │
│  Web (localhost:3000) | Admin (localhost:3002) | Mobile (React Native)  │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                    REST / WebSocket
                             │
┌────────────────────────────┴────────────────────────────────────────────┐
│                      API GATEWAY / NestJS (3001)                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Middleware: Auth, CORS, Logger, Error Handling                 │  │
│  │  Documentation: Swagger/OpenAPI at /api/docs                    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────┬──────────┬────────────┬──────────┬───────────┬──────────────────┘
      │          │            │          │           │
   Discovery  Inventory   Pricing    Orders     Payment
   (Search)  (Holds)    (Dynamic)   (Process)  (Stripe)
      │          │            │          │           │
      └──────────┴────────────┴──────────┴───────────┴──────────────────┐
                                                                         │
                                    ┌────────────────────────────────────┤
                                    │ BUSINESS LOGIC MODULES             │
                                    │ ┌─────────────────────────────────┐│
                                    │ │ • Fraud Detection (ML scoring)  ││
                                    │ │ • 3D Seat Mapping (AI)          ││
                                    │ │ • Analytics (Dashboards)        ││
                                    │ │ • Resale (P2P Marketplace)      ││
                                    │ │ • Admin (Operations)            ││
                                    │ │ • Notifications (Queue)         ││
                                    │ └─────────────────────────────────┘│
                                    │ ┌─────────────────────────────────┐│
                                    │ │ INFRASTRUCTURE                  ││
                                    │ │ • Auth & RBAC                   ││
                                    │ │ • Multi-Tenant Isolation        ││
                                    │ │ • Audit Logging                 ││
                                    │ └─────────────────────────────────┘│
                                    └────────────────────────────────────┘
                                           │
                            ┌──────────────┼──────────────┬──────────────┐
                            │              │              │              │
                      PostgreSQL        Redis          Bull Queue   External APIs
                      Database        (Holds,         (Async Jobs)  (Stripe,
                      (50+ models)   Sessions)                      Fraud APIs)
```

---

## 🏛️ Module Architecture

### Module Organization (14 Core + 3 Infrastructure)

```
apps/api/src/
├── modules/
│   ├── discovery/              # Event search & recommendations
│   │   ├── discovery.service.ts
│   │   ├── discovery.controller.ts
│   │   └── discovery.module.ts
│   │
│   ├── inventory/              # Real-time stock (Redis holds)
│   │   ├── inventory.service.ts
│   │   ├── inventory.controller.ts
│   │   └── inventory.module.ts
│   │
│   ├── pricing/                # Dynamic pricing engine
│   │   ├── pricing.service.ts     (500+ lines)
│   │   ├── pricing.controller.ts
│   │   └── pricing.module.ts
│   │
│   ├── orders/                 # Multi-channel order processing
│   │   ├── orders.service.ts
│   │   ├── orders.controller.ts
│   │   └── orders.module.ts
│   │
│   ├── payment/                # Stripe & payment gateways
│   │   ├── payment.service.ts     (300+ lines)
│   │   ├── payment.controller.ts
│   │   └── payment.module.ts
│   │
│   ├── fraud/                  # ML-ready fraud detection
│   │   ├── fraud.service.ts       (400+ lines)
│   │   ├── fraud.controller.ts
│   │   └── fraud.module.ts
│   │
│   ├── resale/                 # P2P marketplace
│   │   ├── resale.service.ts      (400+ lines)
│   │   ├── resale.controller.ts
│   │   └── resale.module.ts
│   │
│   ├── analytics/              # Dashboards & reporting
│   │   ├── analytics.service.ts   (400+ lines)
│   │   ├── analytics.controller.ts
│   │   └── analytics.module.ts
│   │
│   ├── admin/                  # Operations & control
│   │   ├── admin.service.ts       (250+ lines)
│   │   ├── admin.controller.ts
│   │   └── admin.module.ts
│   │
│   ├── notification/           # Bull queue + async
│   │   ├── notification.service.ts (300+ lines)
│   │   ├── notification.processor.ts
│   │   └── notification.module.ts
│   │
│   ├── seat-mapping-3d/        # Compat /3d routes (status + sightline recommend)
│   │   ├── seat-mapping-3d.service.ts  # inventory status; geometry via venue-engine
│   │   ├── seat-mapping-3d.controller.ts
│   │   └── seat-mapping-3d.module.ts
│   │
│   ├── tenant/                 # Multi-org support
│   │   ├── tenant.service.ts
│   │   └── tenant.module.ts
│   │
│   ├── auth/                   # JWT, RBAC, guards
│   │   ├── auth.service.ts
│   │   ├── jwt.strategy.ts
│   │   ├── jwt-auth.guard.ts
│   │   ├── roles.guard.ts
│   │   └── auth.module.ts
│   │
│   ├── access/                 # Organization access control
│   │   ├── access.service.ts
│   │   └── access.module.ts
│   │
│   └── prisma/                 # Database abstraction
│       ├── prisma.service.ts
│       └── prisma.module.ts
│
├── common/                     # Shared middleware & utilities
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── interceptors/
│   │   └── logging.interceptor.ts
│   └── common.module.ts
│
├── app.module.ts               # Main application module
├── app.controller.ts
├── app.service.ts
└── main.ts                     # Bootstrap
```

---

## 🗄️ Database Schema (Prisma)

### Core Models

```
Organization (tenant)
├── id (cuid)
├── name
├── type (PROMOTER | VENUE | BOLETERA | ARTIST)
├── commissionRate
├── bankingInfo
└── kycStatus

Event
├── id (cuid)
├── organizationId (FK)
├── venueId (FK)
├── title, description
├── startsAt, endsAt
├── status (DRAFT | SCHEDULED | ON_SALE | SOLD_OUT | CANCELLED)
├── capacity
└── createdAt, updatedAt

Ticket (individual seat)
├── id (cuid)
├── eventId (FK)
├── seatId
├── status (AVAILABLE | HELD | SOLD | REFUNDED | TRANSFERRED)
├── price (Decimal)
├── fees (Decimal)
└── holdExpiresAt

Order
├── id (cuid)
├── publicId (human-readable)
├── organizationId (FK)
├── eventId (FK)
├── userId (FK)
├── status (PENDING | PROCESSING | COMPLETED | CANCELLED | FAILED)
├── totalAmount (Decimal)
├── channel (WEB | TAQUILLA | API)
└── createdAt

OrderItem
├── id (cuid)
├── orderId (FK)
├── ticketId (FK)
├── quantity
├── unitPrice (Decimal)
└── unitFees (Decimal)

Payment
├── id (cuid)
├── orderId (FK)
├── gateway (STRIPE | PAYPAL | ADYEN)
├── status (PENDING | SUCCEEDED | FAILED | REFUNDED)
├── stripePaymentIntentId
├── amount (Decimal)
└── metadata (JSON)

Refund
├── id (cuid)
├── orderId (FK)
├── amount (Decimal)
├── reason
├── status (PENDING | COMPLETED | FAILED)
├── processedAt
└── externalRefundId

FraudFlag
├── id (cuid)
├── orderId (FK)
├── userId (FK)
├── score (0-100)
├── severity (LOW | MEDIUM | HIGH | CRITICAL)
├── reasoning (JSON)
├── status (FLAGGED | REVIEWED | RESOLVED)
└── createdAt

ResaleListing
├── id (cuid)
├── ticketId (FK)
├── sellerId (FK)
├── price (Decimal)
├── status (ACTIVE | SOLD | CANCELLED)
├── priceHistory (JSON)
└── soldAt

Venue
├── id (cuid)
├── organizationId (FK)
├── name
├── capacity
├── type (ARENA | THEATER | OUTDOOR | OTHER)
└── address, city, country

Layout (3D seat map)
├── id (cuid)
├── venueId (FK)
├── sections (JSON) # Procedurally generated or imported
├── seats (JSON) # x, y, z coordinates + metadata
├── isActive
└── generatedAt

User
├── id (cuid)
├── email (unique)
├── name
├── passwordHash
├── role (CUSTOMER | PROMOTER | VENUE_MANAGER | ARTIST | ADMIN)
├── status (ACTIVE | BLOCKED | UNVERIFIED)
├── emailVerified
├── twoFactorEnabled
├── phoneNumber
└── kycStatus (PENDING | APPROVED | REJECTED)

PromoterPayout
├── id (cuid)
├── organizationId (FK)
├── period (DAILY | WEEKLY | MONTHLY)
├── status (PENDING | PROCESSING | COMPLETED | FAILED)
├── grossRevenue (Decimal)
├── commissionAmount (Decimal)
├── chargebacks (Decimal)
├── netPayout (Decimal)
└── processedAt

AuditLog
├── id (cuid)
├── userId (FK)
├── action (string)
├── details (JSON)
└── createdAt
```

---

## 🔄 Data Flow Examples

### Example 1: Event Discovery → Purchase Flow

```
1. USER: Search for events
   └─→ GET /discovery/search?artist=&venue=&date=
       │
2. DISCOVERY SERVICE
   └─→ Prisma: Event.findMany({filter: {...}})
   └─→ Redis: Cache results (5min TTL)
   └─→ Return: Event[] with availability
       │
3. USER: View event detail
   └─→ GET /events/{eventId}
       │
4. SEAT MAPPING 3D
   └─→ Generate 3D venue
   └─→ Fetch ticket statuses from Prisma
   └─→ Overlay real-time holds from Redis
   └─→ Return: Interactive 3D model
       │
5. USER: Select seats & recommend
   └─→ POST /3d/events/{eventId}/recommendations
   └─→ AI scoring: distance + centerness
   └─→ Return: Top 5 recommended seats
       │
6. USER: Add to cart
   └─→ Create SeatHold in Redis (900s TTL)
   └─→ Update Inventory count
       │
7. USER: Checkout
   └─→ POST /payments/intents (Stripe)
   └─→ Stripe returns client secret
   └─→ Frontend: Collect card with Stripe Elements
       │
8. USER: Confirm payment
   └─→ POST /payments/confirm
       │
9. PAYMENT SERVICE
   └─→ Stripe: Confirm payment intent
   └─→ Stripe: SUCCESS → webhook received
       │
10. ORDER SERVICE (in $transaction)
    ├─→ Create Order record
    ├─→ Create OrderItems
    ├─→ Update Tickets (SOLD)
    ├─→ Release Redis hold
    ├─→ Create tickets metadata
    └─→ Return: Order confirmation
        │
11. NOTIFICATION SERVICE (async via Bull)
    ├─→ Enqueue: order.confirmation
    ├─→ Enqueue: ticket.pdf
    ├─→ Return: 202 Accepted
        │
12. NOTIFICATION PROCESSOR (Bull worker)
    ├─→ Generate PDF
    ├─→ Send email with Sendgrid
    ├─→ Log delivery status
    └─→ Complete job
```

---

## 🔐 Authentication & Authorization Flow

```
1. USER: Login with credentials
   └─→ POST /auth/login {email, password}
       │
2. AUTH SERVICE
   ├─→ Find User by email
   ├─→ Verify password (bcrypt)
   ├─→ Generate JWT tokens
   │   ├─ accessToken (24h exp)
   │   └─ refreshToken (7d exp)
   └─→ Return: {accessToken, refreshToken, user}
       │
3. CLIENT: Store tokens (localStorage + httpOnly cookie)
   └─→ Include in Authorization header: Bearer {accessToken}
       │
4. REQUEST to protected endpoint
   └─→ GET /admin/events
       Authorization: Bearer eyJhbGciOiJIUzI1NiI...
       │
5. JWT AUTH GUARD
   ├─→ Extract token from header
   ├─→ Verify signature
   ├─→ Verify not expired
   ├─→ Attach user to request object
   └─→ Continue to next middleware
       │
6. ROLES GUARD
   ├─→ Check user.role against @Roles('ADMIN')
   ├─→ If authorized → allow request
   ├─→ If not → throw 403 Forbidden
       │
7. ORGANIZATION ACCESS GUARD
   ├─→ Check user has access to organizationId
   ├─→ Prevent cross-tenant data access
   └─→ Continue to handler
       │
8. CONTROLLER/SERVICE
   └─→ Execute business logic
```

---

## 💻 Service Layer Pattern

### Example: Pricing Service

```typescript
@Injectable()
export class PricingService {
  constructor(private prisma: PrismaService) {}

  // 1. Load base price
  async calculatePrice(eventId: string, offerId: string) {
    const offer = await this.prisma.offer.findUnique({...});
    let price = offer.price;

    // 2. Apply surge pricing
    const occupancy = await this.getOccupancy(eventId, offerId);
    price = this.applySurgePricing(price, occupancy);

    // 3. Apply time-based discount/premium
    const daysUntilEvent = this.daysBetween(new Date(), event.startsAt);
    price = this.applyTimeBasedPricing(price, daysUntilEvent);

    // 4. Apply customer segment pricing
    const segment = await this.getCustomerSegment(userId);
    price = this.applySegmentPricing(price, segment);

    // 5. Apply promotional discount
    const promotion = await this.validatePromotion(promoCode);
    price = this.applyPromotion(price, promotion);

    // 6. Add fees
    const fees = this.calculateFees(price);

    return { price, fees, total: price + fees };
  }
}
```

---

## 🚨 Error Handling

### Global Exception Filter

```typescript
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = 500;
    let message = 'Internal Server Error';
    let data = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.getResponse()['message'];
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      status = 400;
      message = 'Database operation failed';
    }

    response.status(status).json({
      statusCode: status,
      message,
      data,
      timestamp: new Date().toISOString(),
    });
  }
}
```

---

## 📋 Deployment Architecture

### Development (Docker Compose)
```yaml
version: '3.8'
services:
  api:
    build: ./apps/api
    ports: ["3001:3001"]
    environment:
      DATABASE_URL: postgresql://user:pass@postgres:5432/boletera
      REDIS_URL: redis://redis:6379
  
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  redis:
    image: redis:7-alpine
```

### Production (Kubernetes)
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: boletera-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: boletera-api
  template:
    metadata:
      labels:
        app: boletera-api
    spec:
      containers:
      - name: api
        image: boletera:v1.0
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: connection-string
```

---

## 📊 Monitoring & Observability

### Logging Strategy
- **INFO:** User actions, successful operations
- **WARN:** Unusual patterns, potential fraud
- **ERROR:** Failed operations, exceptions
- **DEBUG:** Detailed diagnostics (dev only)

### Key Metrics to Track
- API response times (p50, p95, p99)
- Error rates by endpoint
- Database query times
- Cache hit rates
- Queue job completion times
- Fraud detection accuracy

---

## 🔒 Security Layers

```
Layer 1: Input Validation
├─→ DTOs with class-validator
└─→ Sanitization

Layer 2: Authentication
├─→ JWT verification
└─→ Token expiration

Layer 3: Authorization
├─→ Role-based checks
├─→ Resource ownership
└─→ Organization isolation

Layer 4: Business Logic
├─→ Fraud detection scoring
├─→ Amount validation
└─→ Rate limiting

Layer 5: Data Protection
├─→ SQL injection prevention (Prisma)
├─→ Encrypted PII fields
└─→ HIPAA/PCI compliance ready
```

---

**Architecture designed for scale, built for excellence.**
