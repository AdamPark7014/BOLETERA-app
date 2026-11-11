# Boletera Platform - Enterprise Architecture

## Overview

**Boletera Platform** es un sistema de ticketing empresarial **mega pesado, impecable y completamente modular** diseñado para servir TODOS los modelos de negocio de boleteras globales y superarlos.

## Core Capabilities

### 1. Primary Market Ticketing

- Venta directa de entradas (artista → público)
- Control de inventario en tiempo real
- Reservas con expiración (15-60 min)
- Policies customizables por evento

### 2. Secondary Market / Resale

- Marketplace peer-to-peer
- Validación de precios anti-scalping
- Restricciones de transferencia (no-transfer policies)
- Comisiones automáticas

### 3. Dynamic Pricing

- AI-driven demand pricing
- Surge pricing automático (80%+ vendido)
- Early bird discounts
- Time-based pricing (close to event = higher prices)

### 4. Multi-Organization B2B

- Cada promoter/venue es una organización
- Comisiones y payouts automáticos
- KYC/AML verificación
- Reportes de liquidación

### 5. Fraud & Compliance

- ML-based fraud scoring (0-100)
- Detección de duplicados
- Device fingerprinting
- KYC verification
- AML watchlist checking

### 6. Global Payments

- Múltiples gateways: Stripe, PayPal, Adyen, local methods
- Procesamiento multi-moneda (15+ currencies)
- Tax cálculo automático por jurisdicción
- Chargeback protection

### 7. Advanced Analytics

- Reportes en tiempo real (sales, revenue, trends)
- Settling reports (cuánto paga cada promoter)
- Customer LTV, churn analysis
- Tax reporting per jurisdiction

## Database Schema (Prisma)

**50+ modelos empresariales** organizados en capas:

```
Core Layer:
- Organization (promoter, venue, boletera, artist)
- Venue (arena, teatro, lugar)
- Event (concierto, deporte, teatro)
- Offer (zona/sección con precio)
- Ticket (entrada individual)

Transactional Layer:
- Order (compra de entradas)
- OrderItem (línea de compra)
- Payment (procesamiento de pago)
- Refund (devoluciones)

User Layer:
- User (cliente, admin, promoter)
- Session (autenticación)

Resale Layer:
- ResaleListing (venta segunda mano)
- ResaleOffer (oferta de comprador)

Pricing Layer:
- DynamicPrice (precios ajustados)
- Promotion (códigos descuento)

Analytics Layer:
- FraudFlag (anomalías)
- EventAnalytics (métricas evento)
- PromoterPayout (liquidación)

Customer Layer:
- Cart (carrito)
- Wishlist (favoritos)
- Review (reseñas)
```

## API Architecture (NestJS)

### Modularización

Cada módulo es **independiente y escalable**:

```
PrismaModule (DB access)
├── AuthModule (JWT, OAuth2)
├── DiscoveryModule (búsqueda eventos)
├── InventoryModule (disponibilidad)
├── PricingModule (cálculo de precios)
├── OrdersModule (checkout + órdenes)
├── PaymentModule (procesar pagos)
├── ResaleModule (marketplace)
├── FraudModule (detección fraude)
├── AnalyticsModule (reportes)
├── AdminModule (operaciones)
└── NotificationModule (email, SMS, push)
```

### API Endpoints (Swagger @ /api/docs)

```
GET    /api/v1/discovery/events         - Buscar eventos
GET    /api/v1/inventory/availability   - Ver disponibilidad
POST   /api/v1/orders                    - Crear orden
POST   /api/v1/payments                  - Procesar pago
GET    /api/v1/resale/listings          - Listar venta 2da mano
POST   /api/v1/analytics/reports        - Generar reporte
```

## Frontend Architecture (Next.js)

### Customer Marketplace (`apps/web`)

Pages:

- `/` - Homepage con hero + featured events
- `/events` - Búsqueda avanzada
- `/events/[id]` - Detalle evento + compra
- `/checkout` - Carrito + pago
- `/orders/[id]` - Confirmación + PDF
- `/resale` - Marketplace segunda mano

Components:

- EventCard (grid/list)
- SearchFilters (advanced search)
- CheckoutForm (Stripe integration)
- CartWidget (preview)

Styling:

- **Neutral Professional Palette** (Ink, Sky, Mint, Coral, Sun)
- **Fonts**: Bebas Neue (headers) + Space Grotesk (body)
- SCSS modules + Tailwind CSS

### Admin Dashboard (`apps/admin`)

Pages:

- `/dashboard` - KPIs en tiempo real
- `/events` - CRUD eventos
- `/orders` - Gestión órdenes
- `/fraud` - Alertas fraude
- `/analytics` - Reportes avanzados
- `/payouts` - Liquidaciones

## Performance & Scalability

### Targets

| Metric           | Target              | Implementation                     |
| ---------------- | ------------------- | ---------------------------------- |
| API Response     | < 100ms (p95)       | Redis caching, DB indexing         |
| Homepage Load    | < 2s (LCP)          | Next.js CDN, Image optimization    |
| Checkout         | < 3 requests, 200ms | Atomic DB transactions             |
| Concurrent Users | 100k+               | Horizontal scaling, load balancing |
| Transactions/min | 10k+                | Queue-based processing (Bull)      |

### Caching Strategy

```
Level 1: Redis (session, cart, inventory)
Level 2: Next.js ISR (events, promotions)
Level 3: CDN CloudFlare (static assets)
Level 4: DB query optimization (Prisma)
```

### Queue Processing

Events processed asynchronously:

```
- Notifications (email, SMS, push)
- Reporting (analytics, settlement)
- Fraud scoring (ML model)
- Invoice generation
```

## Security & Compliance

- **Auth**: JWT + Passport.js + OAuth2
- **Payment**: PCI DSS (Stripe tokenization)
- **Data**: End-to-end encryption
- **AML/KYC**: Integration ready
- **GDPR**: Data handling + right to be forgotten
- **Rate Limiting**: 100 requests/15min per IP

## Deployment Architecture

```
    CloudFlare CDN
         ↓
    API Load Balancer (ALB)
    /            \
  API Pods     Web Pods (Next.js)
  (NestJS)     Admin Pods
    ↓              ↓
  Kubernetes Cluster
    ↓
  PostgreSQL (RDS)
  Redis (ElastiCache)
  S3 (file storage)
```

## Desarrollo

### Local Setup

```bash
# Install
pnpm install

# Database
docker-compose up -d
pnpm db:migrate:dev
pnpm db:seed

# Run all
pnpm dev

# Or individually
pnpm dev:api      # :4000
pnpm dev:web      # :3000
pnpm dev:admin    # :3001
```

### Environment Variables

Ver `.env.example` - requiere:

- DATABASE_URL
- REDIS_URL
- JWT_SECRET
- STRIPE keys
- PAYPAL credentials
- SMTP (email)

## Business Model

Boletera genera revenue:

```
Per-Ticket Commission: 15% default
- Promoter paga 15% de comisión
- O fija precio = comisión incluida

Resale Commission: 8% default
- 8% de venta segunda mano

Settlement: Automático semanal
- Deduce comisión
- Deduce chargebacks
- Transfiere neto a organizacion

B2B License: Modelo SaaS
- Boleteras pueden usar Boletera Platform
- Modelo white-label disponible
```

## Competencia vs. Boletera

| Feature          | Ticketmaster | StubHub | Boletera |
| ---------------- | ------------ | ------- | -------- |
| Primary Market   | ✅           | ❌      | ✅       |
| Resale           | ❌           | ✅      | ✅       |
| Dynamic Pricing  | ✅           | ❌      | ✅       |
| White-Label      | ❌           | ❌      | ✅       |
| Fraud Detection  | ✅           | ✅      | ✅       |
| Multi-Currency   | ✅           | Limited | ✅       |
| Self-Service API | Limited      | ❌      | ✅       |
| Open Marketplace | ❌           | ✅      | ✅       |

## Next Steps

1. **Implementar módulos API** (Auth → Discovery → Orders → Payment)
2. **Build web frontend** (pages, components, integration)
3. **Admin dashboard** (dashboards, CRUD)
4. **Testing & QA** (unit + E2E)
5. **Beta launch** (early customers)
6. **Scale & optimize** (performance, compliance)

---

**Boletera Platform: Built for Global Enterprise Ticketing.**
