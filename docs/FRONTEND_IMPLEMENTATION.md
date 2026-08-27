# FRONTEND IMPLEMENTATION GUIDE

> **BOLETERA Frontend Architecture & Component System**
>
> Versión: 1.0  
> Última actualización: May 17, 2026

---

## 📱 FRONTEND STACK

### **Admin Dashboard** (apps/admin)
- **Framework:** Next.js 14 (App Router)
- **UI Library:** React 18
- **Styling:** Tailwind CSS 3.4
- **Charts:** Recharts (real-time analytics)
- **Data Fetching:** TanStack React Query 5.39
- **State:** Zustand (optional, for complex state)
- **Icons:** Lucide React

### **Web App** (apps/web)
- **Framework:** Next.js 14 (App Router)
- **UI Library:** React 18
- **Styling:** Tailwind CSS 3.4
- **3D Visualization:** Three.js (future)
- **Charts:** Recharts
- **Data Fetching:** TanStack React Query 5.39
- **Payment:** Stripe Elements (integration)

### **Shared Libraries** (packages/ui)
- **API Client:** `api-client.ts` - Centralized HTTP client with auth
- **React Hooks:** `hooks.ts` - 30+ custom hooks for API integration
- **Components:** Reusable UI components (future)
- **Utils:** Type definitions, helpers, validators

---

## 🏗️ PROJECT STRUCTURE

```
boletera-app/
├── apps/
│   ├── admin/                          # Next.js Admin Dashboard
│   │   ├── app/
│   │   │   ├── (platform)/
│   │   │   │   ├── layout.tsx          # Main navigation shell
│   │   │   │   ├── dashboard/          # Real-time metrics
│   │   │   │   ├── events/             # Event management CRUD
│   │   │   │   ├── campaigns/          # Campaign lifecycle
│   │   │   │   └── reporting/          # Analytics dashboards
│   │   │   ├── login/                  # Auth page
│   │   │   └── layout.tsx              # Root layout
│   │   ├── components/
│   │   │   ├── EventList.tsx           # 700 LOC - List/Create events
│   │   │   ├── RealtimeDashboard.tsx   # 450 LOC - KPI charts
│   │   │   ├── CampaignManagement.tsx  # 500 LOC - Campaign CRUD
│   │   │   └── TerminalConfig.tsx      # Terminal setup (future)
│   │   ├── lib/
│   │   │   ├── hooks.ts
│   │   │   └── utils.ts
│   │   └── package.json
│   │
│   ├── web/                            # Next.js Customer Web App
│   │   ├── app/
│   │   │   ├── page.tsx                # Home - event discovery
│   │   │   ├── event/
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx        # Event detail + layout
│   │   │   │       └── checkout/       # Checkout flow
│   │   │   ├── profile/                # User profile + orders
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── EventDiscovery.tsx      # 600 LOC - Search + trending
│   │   │   ├── SeatSelection.tsx       # 750 LOC - 2D/3D seats
│   │   │   ├── CheckoutFlow.tsx        # 600 LOC - Payment form
│   │   │   └── OccupancyHeatmap.tsx    # 400 LOC - Real-time status
│   │   ├── lib/
│   │   │   ├── hooks.ts
│   │   │   └── utils.ts
│   │   └── package.json
│   │
│   ├── taquilla/                       # POS Terminal App (React)
│   └── worker/                         # Background jobs
│
├── packages/
│   ├── ui/
│   │   ├── api-client.ts               # 350 LOC - HTTP client
│   │   ├── hooks.ts                    # 500 LOC - React hooks
│   │   ├── types.ts                    # Type definitions
│   │   └── components/
│   │       ├── Button.tsx              # Base components (future)
│   │       ├── Card.tsx
│   │       └── [...]
│   └── database/
│       └── prisma/
│           └── schema.prisma
```

---

## 🔌 API CLIENT INTEGRATION

### **Configuration**

```typescript
// .env.local
NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
NEXT_PUBLIC_AUTH_TOKEN_KEY=boletera_token
```

### **Usage Example: Admin Event Creation**

```typescript
'use client';

import { useCreateEvent } from '@/packages/ui/hooks';

export function EventForm() {
  const createEvent = useCreateEvent();
  
  const handleSubmit = async (data: EventData) => {
    try {
      const { data: event } = await createEvent.mutateAsync({
        title: data.title,
        type: 'single',
        startDate: data.date,
        venueId: data.venue,
        capacity: 5000,
        basePrice: 100
      });
      
      console.log('Event created:', event.id);
      // Redirect or show success
    } catch (error) {
      // Handle error
    }
  };

  return <form onSubmit={handleSubmit}>...</form>;
}
```

### **API Hooks Available (30+)**

**Events**
- `useCreateEvent()` - POST /events/manage/create
- `useGetEvent(eventId)` - GET /events/manage/{id}
- `useListEvents(filters)` - GET /events/manage/list
- `useUpdateEvent(eventId)` - PUT /events/manage/{id}
- `usePublishEvent(eventId)` - POST /events/manage/{id}/publish
- `useSetPricingRules(eventId)` - POST /events/manage/{id}/pricing

**Campaigns**
- `useCreateCampaign()` - POST /campaigns/create
- `useListCampaigns(eventId)` - GET /campaigns/list
- `usePublishCampaign(id)` - POST /campaigns/{id}/publish
- `useGeneratePresaleCodes(campaignId, count)` - POST /campaigns/{id}/presale-codes
- `useGetCampaignAnalytics(campaignId)` - GET /campaigns/{id}/analytics

**Reporting**
- `useGetRealtimeDashboard(orgId)` - GET /reporting/dashboard (auto-refetch every 10s)
- `useGetSettlementReport(orgId, period)` - GET /reporting/settlement
- `useGetChannelPerformance(orgId)` - GET /reporting/channels
- `useGetCustomerAnalytics(orgId)` - GET /reporting/customers
- `usePredictOccupancy(eventId)` - GET /reporting/predict/{id}
- `useGetRevenueForecast(orgId, days)` - GET /reporting/forecast

**Search & Discovery**
- `useSearchEvents(query, filters)` - GET /search/events (AI ranking)
- `useGetTrendingEvents()` - GET /search/trending
- `useGetSmartRecommendations()` - GET /search/recommendations

**Seat Selection (canonical `/3d/events/...`)**
- `useGetOccupancyHeatmap(_layoutId, eventId)` - GET /3d/events/{eventId}/heatmap
- `useGetInteractive3D(eventId)` - GET /3d/events/{eventId}/interactive
- `useGet3DVisualization(_layoutId, eventId)` - alias → interactive
- `useGetAISeatRecommendations(eventId, prefs)` - POST /3d/events/{eventId}/recommendations
- `useHoldSeats(layoutId, eventId)` - POST /layouts/{id}/seats/hold (15-min hold)

**Auth**
- `useLogin()` - POST /auth/login
- `useLogout()` - POST /auth/logout
- `useGetCurrentUser()` - GET /auth/me

---

## 🎨 COMPONENT LIBRARY

### **Admin Components**

#### EventList Component (700 LOC)
**Location:** `apps/admin/components/EventList.tsx`

**Features:**
- List all events with filters
- Inline event creation form
- Quick publish/unpublish
- Links to event details, pricing, campaigns

**Props:**
```typescript
interface EventListProps {
  organizationId?: string;
}
```

**Example Usage:**
```jsx
<EventList />
```

---

#### RealtimeDashboard Component (450 LOC)
**Location:** `apps/admin/components/RealtimeDashboard.tsx`

**Features:**
- 4 KPI cards: revenue, orders, avg value, occupancy
- Channel performance bar chart
- 30-day revenue forecast line chart
- Occupancy prediction with confidence
- Channel mix pie chart
- Auto-refresh every 10 seconds

**Props:**
```typescript
interface DashboardProps {
  organizationId: string;
  eventId?: string;
}
```

**Example Usage:**
```jsx
<RealtimeDashboard organizationId="org_acme" eventId="evt_taylor" />
```

---

#### CampaignManagement Component (500 LOC)
**Location:** `apps/admin/components/CampaignManagement.tsx`

**Features:**
- List campaigns with status badges
- Create campaign with discount rules
- Generate presale codes (batch)
- Real-time analytics sidebar
- Redemption rate tracking
- ROI calculation

**Props:**
```typescript
interface CampaignManagementProps {
  eventId: string;
  organizationId: string;
}
```

**Example Usage:**
```jsx
<CampaignManagement eventId="evt_1" organizationId="org_acme" />
```

---

### **Web Components**

#### EventDiscovery Component (600 LOC)
**Location:** `apps/web/components/EventDiscovery.tsx`

**Features:**
- Full-text search with AI ranking
- 4-factor ranking breakdown (content, personalization, demand, business)
- Trending events view
- Smart recommendations for you
- Filter by date, price, genre
- Event cards with AI score badge
- Mobile responsive grid layout

**Props:**
```typescript
// No props required - uses hooks internally
```

**Example Usage:**
```jsx
<EventDiscovery />
```

---

#### SeatSelection Component (750 LOC)
**Location:** `apps/web/components/SeatSelection.tsx`

**Features:**
- 2D seating chart with sections
- 3D visualization placeholder (Three.js ready)
- Dynamic seat selection (max by quantity)
- Sightline score tooltips per seat
- Real-time occupancy color coding
- 15-minute seat hold countdown
- Order summary sidebar
- Responsive layout

**Props:**
```typescript
interface SeatSelectionProps {
  layoutId: string;
  eventId: string;
  basePrice: number;
}
```

**Example Usage:**
```jsx
<SeatSelection 
  layoutId="layout_msg" 
  eventId="evt_taylor" 
  basePrice={150} 
/>
```

---

#### CheckoutFlow Component (600 LOC)
**Location:** `apps/web/components/CheckoutFlow.tsx`

**Features:**
- Presale code validation with discount
- Multi-method payment (card, Banorte, cash)
- Secure card form with validation
- Contact information capture
- Order summary with breakdown
- Confirmation screen with ticket download
- Money-back guarantee messaging

**Props:**
```typescript
interface CheckoutProps {
  orderTotal: number;
  selectedSeats: string[];
  eventName: string;
  eventDate: string;
}
```

**Example Usage:**
```jsx
<CheckoutFlow
  orderTotal={450.50}
  selectedSeats={['A1', 'A2', 'A3']}
  eventName="Taylor Swift - Eras Tour"
  eventDate="June 15, 2026"
/>
```

---

## 🔄 DATA FLOW EXAMPLE: Event Creation to Reporting

```
┌─────────────────────────────────────────────────────────────┐
│ 1. ADMIN CREATES EVENT                                      │
├─────────────────────────────────────────────────────────────┤
│ User fills form → EventList component                       │
│ calls useCreateEvent() hook                                 │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. API CALL                                                 │
├─────────────────────────────────────────────────────────────┤
│ POST /events/manage/create                                  │
│ {                                                            │
│   "title": "Taylor Swift",                                  │
│   "type": "single",                                         │
│   "startDate": "2026-06-01T19:00:00Z",                      │
│   "venue": "madison_square",                                │
│   "capacity": 20000,                                        │
│   "basePrice": 150                                          │
│ }                                                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. BACKEND PROCESSING                                       │
├─────────────────────────────────────────────────────────────┤
│ EventManagementService.createEvent()                        │
│ - Validates input                                           │
│ - Creates event in DB                                       │
│ - Generates layout                                          │
│ - Emits webhook: event.created                              │
│ - Returns 201 {event}                                       │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. FRONTEND UPDATES                                         │
├─────────────────────────────────────────────────────────────┤
│ React Query invalidates cache                               │
│ EventList component re-fetches useListEvents()              │
│ New event appears in list                                   │
│ User clicks "View Details" → navigates to event page        │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. REAL-TIME DASHBOARD UPDATES                              │
├─────────────────────────────────────────────────────────────┤
│ RealtimeDashboard auto-refetch every 10s                    │
│ useGetRealtimeDashboard() calls                             │
│ GET /reporting/dashboard?eventId=evt_taylor                 │
│ Displays updated KPIs, forecast, occupancy prediction      │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. WEB APP: CUSTOMER DISCOVERS EVENT                        │
├─────────────────────────────────────────────────────────────┤
│ useGetTrendingEvents() or useSearchEvents()                 │
│ EventDiscovery shows new event with AI ranking              │
│ Customer clicks → SeatSelection component                   │
│ useGetOccupancyHeatmap() shows live availability            │
│ Customer selects seats → useHoldSeats() (15 min lock)       │
│ Proceeds to CheckoutFlow component                          │
│ Completes payment → Order created                           │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. ADMIN SEES REAL-TIME ANALYTICS                           │
├─────────────────────────────────────────────────────────────┤
│ Dashboard updates automatically:                            │
│ - Today Revenue: +$450.50                                   │
│ - Today Orders: +1                                          │
│ - Occupancy: 2.25% (1 of 20,000)                            │
│ - Prediction: 87% confidence of SOLD OUT                    │
│ - Forecast: Revenue trending up                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 DEVELOPMENT WORKFLOW

### **1. Setup Local Environment**

```bash
cd boletera-app

# Install dependencies
pnpm install

# Setup env vars
cp .env.example .env.local
# Update NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1

# Start backend
cd apps/api && pnpm dev

# In new terminal: Start admin dashboard
cd apps/admin && pnpm dev
# Visit: http://localhost:3001

# In new terminal: Start web app
cd apps/web && pnpm dev
# Visit: http://localhost:3002
```

### **2. Add New Component**

```typescript
// 1. Create component file
// apps/{admin|web}/components/MyComponent.tsx

'use client';
import { useMyHook } from '@/packages/ui/hooks';

export default function MyComponent({ prop1, prop2 }) {
  const { data, isLoading } = useMyHook();
  return <div>...</div>;
}

// 2. Use in page
// apps/{admin|web}/app/my-page/page.tsx

import MyComponent from '@/components/MyComponent';

export default function MyPage() {
  return <MyComponent prop1="value" />;
}
```

### **3. Add New API Hook**

```typescript
// 1. Update api-client.ts
async myNewMethod(params: any) {
  return this.instance.post('/my-endpoint', params);
}

// 2. Add hook in hooks.ts
export function useMyNewHook() {
  return useQuery({
    queryKey: ['my-hook'],
    queryFn: () => apiClient.myNewMethod({}),
  });
}

// 3. Use in component
import { useMyNewHook } from '@/packages/ui/hooks';

const { data } = useMyNewHook();
```

---

## 📊 PERFORMANCE TARGETS

| Feature | Target | Implementation |
|---------|--------|-----------------|
| Page load | < 2s | Next.js static + CDN |
| Search results | < 300ms | API cached with Redis |
| Checkout | < 45s | Optimized for POS terminals |
| Dashboard update | < 500ms | Real-time with WebSockets (future) |
| Seat selection | < 100ms | Client-side filtering |
| 3D render | < 60fps | Three.js with GPU acceleration |

---

## 🔐 SECURITY CHECKLIST

- [ ] All API calls authenticated with JWT
- [ ] Rate limiting on POST endpoints (100 req/min)
- [ ] Card data never stored on frontend (Stripe tokenization)
- [ ] CORS configured to backend domain only
- [ ] XSS protection with React built-in escaping
- [ ] CSRF tokens on state-changing operations
- [ ] No secrets in env.local (use env vars)
- [ ] SSL/TLS enforced on production
- [ ] Content Security Policy headers configured

---

## 📝 NEXT STEPS

1. **Three.js Integration** - Implement 3D venue visualization
2. **WebSocket Layer** - Real-time seat updates (eliminate polling)
3. **Mobile App** - React Native for iOS/Android
4. **Payment Integration** - Stripe Elements + Webhooks
5. **Testing** - E2E tests with Playwright
6. **Accessibility** - WCAG 2.1 compliance
7. **Internationalization** - i18n for Spanish/English
8. **Performance** - Implement image optimization + lazy loading

---

**Arranque y despliegue: ver el [README](../README.md) del repo.**
