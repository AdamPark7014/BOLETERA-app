-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('PROMOTER', 'VENUE', 'BOLETERA', 'ARTIST', 'DISTRIBUTOR');

-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('MUSIC', 'SPORTS', 'THEATER', 'COMEDY', 'CONFERENCE', 'WORKSHOP', 'FESTIVAL', 'FAMILY', 'STANDUP', 'CINEMA', 'OTHER');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "EventSeriesKind" AS ENUM ('SERIES', 'RESIDENCY', 'TOUR', 'SEASON', 'FESTIVAL');

-- CreateEnum
CREATE TYPE "EventSeriesStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SalePhaseKind" AS ENUM ('PRESALE', 'MEMBERS', 'PUBLIC', 'LAST_MINUTE', 'DOOR');

-- CreateEnum
CREATE TYPE "SalePhaseStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('AVAILABLE', 'HELD', 'SOLD', 'USED', 'REFUNDED', 'TRANSFERRED', 'RESOLD', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('STRIPE', 'PAYPAL', 'ADYEN', 'SQUARE', 'RAZORPAY', 'WORLDPAY', 'BANORTE', 'CLIP', 'OXXO', 'SPEI', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'BANK_TRANSFER', 'PAYPAL', 'APPLE_PAY', 'GOOGLE_PAY', 'CRYPTO', 'LOCAL_PAYMENT', 'CASH', 'OXXO', 'SPEI', 'CLIP');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('WEB', 'TAQUILLA', 'API', 'ADMIN');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'EXPIRED', 'RELEASED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED', 'DISPUTE');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'EUR', 'GBP', 'MXN', 'CAD', 'AUD', 'JPY', 'CNY', 'BRL', 'INR', 'AED', 'CHF', 'SGD', 'HKD', 'NZD');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'PROMOTER', 'VENUE_MANAGER', 'ARTIST', 'ADMIN', 'SUPER_ADMIN', 'TAQUILLA', 'SCANNER');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('CUSTOMER_REQUEST', 'PAYMENT_ERROR', 'DUPLICATE', 'FRAUD', 'EVENT_CANCELLED', 'TICKET_NOT_RECEIVED', 'CUSTOMER_CHANGED_MIND');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "FraudType" AS ENUM ('SUSPICIOUS_ACTIVITY', 'DUPLICATE_PURCHASE', 'HIGH_VELOCITY', 'UNLIKELY_LOCATION', 'MULTIPLE_DECLINED', 'CHARGEBACK', 'ACCOUNT_BREACH', 'BOT_ACTIVITY', 'SCALPING_VIOLATION', 'KYC_MISMATCH');

-- CreateEnum
CREATE TYPE "FraudSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FraudStatus" AS ENUM ('FLAGGED', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE');

-- CreateEnum
CREATE TYPE "ResaleStatus" AS ENUM ('ACTIVE', 'SOLD', 'CANCELLED', 'DELISTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ResaleOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'BOGO', 'FREE_SHIPPING', 'CASHBACK');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "KYCStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AMLStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'WATCHLIST');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('PENDING', 'NOTIFIED', 'CONVERTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CfdiStatus" AS ENUM ('DRAFT', 'STAMPED', 'CANCELLED', 'ERROR');

-- CreateEnum
CREATE TYPE "PosTerminalStatus" AS ENUM ('READY', 'OFFLINE', 'DISABLED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "PosSessionStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "SeasonPassPurchaseStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "type" "OrgType" NOT NULL DEFAULT 'PROMOTER',
    "website" TEXT,
    "logoUrl" TEXT,
    "bannerUrl" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "country" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "bankAccountName" TEXT,
    "bankCode" TEXT,
    "bankRoutingNumber" TEXT,
    "bankAccountNumber" TEXT,
    "paypalEmail" TEXT,
    "stripeAccountId" TEXT,
    "taxId" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "kycStatus" "KYCStatus" NOT NULL DEFAULT 'PENDING',
    "amlStatus" "AMLStatus" NOT NULL DEFAULT 'PENDING',
    "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "feesInclusive" BOOLEAN NOT NULL DEFAULT false,
    "allowResale" BOOLEAN NOT NULL DEFAULT true,
    "resaleCommission" DOUBLE PRECISION NOT NULL DEFAULT 0.08,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "timezone" TEXT NOT NULL,
    "totalCapacity" INTEGER NOT NULL,
    "accessibilitySeats" INTEGER NOT NULL DEFAULT 0,
    "premiumSeats" INTEGER NOT NULL DEFAULT 0,
    "generalSeats" INTEGER NOT NULL DEFAULT 0,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueLayout" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "mapData" JSONB NOT NULL,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#737373',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatRow" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seat" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "rowId" TEXT,
    "label" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "coord3d" JSONB,
    "tier" TEXT,
    "viewQuality" DOUBLE PRECISION,
    "accessible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSeatMap" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "snapshotData" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventSeatMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatHold" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "seatId" TEXT,
    "offerId" TEXT,
    "userId" TEXT,
    "sessionId" TEXT,
    "channel" "SalesChannel" NOT NULL DEFAULT 'WEB',
    "cashierId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantTheme" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "primaryColor" TEXT NOT NULL DEFAULT '#171717',
    "secondaryColor" TEXT NOT NULL DEFAULT '#737373',
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "customDomain" TEXT,
    "subdomain" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantTheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessZone" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "capacity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketScan" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "zoneId" TEXT,
    "scannedBy" TEXT NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "provider" "PaymentGateway" NOT NULL,
    "externalId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "channel" "SalesChannel" NOT NULL DEFAULT 'WEB',
    "metadata" JSONB,
    "idempotencyKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashierShift" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openingCash" DECIMAL(12,2) NOT NULL,
    "closingCash" DECIMAL(12,2),
    "totalSales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "metadata" JSONB,

    CONSTRAINT "CashierShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "slug" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "bannerImage" TEXT,
    "category" "EventCategory" NOT NULL DEFAULT 'MUSIC',
    "genre" TEXT,
    "rating" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL,
    "doorsAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "announceAt" TIMESTAMP(3),
    "publishAt" TIMESTAMP(3),
    "salesStartAt" TIMESTAMP(3),
    "salesEndAt" TIMESTAMP(3),
    "rescheduledFrom" TIMESTAMP(3),
    "scheduleNote" TEXT,
    "seriesId" TEXT,
    "seriesOrder" INTEGER,
    "minPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "maxPrice" DECIMAL(12,2) NOT NULL DEFAULT 1000,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "totalCapacity" INTEGER NOT NULL,
    "holdableCapacity" INTEGER,
    "allowResale" BOOLEAN NOT NULL DEFAULT true,
    "transferAllowed" BOOLEAN NOT NULL DEFAULT true,
    "refundable" BOOLEAN NOT NULL DEFAULT true,
    "nonTransferable" BOOLEAN NOT NULL DEFAULT false,
    "holdExpiration" INTEGER NOT NULL DEFAULT 900,
    "enableDynamic" BOOLEAN NOT NULL DEFAULT false,
    "surgeThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "surgePriceMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.25,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSeries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "venueId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "kind" "EventSeriesKind" NOT NULL DEFAULT 'SERIES',
    "status" "EventSeriesStatus" NOT NULL DEFAULT 'DRAFT',
    "category" "EventCategory" NOT NULL DEFAULT 'MUSIC',
    "timezone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "recurrence" JSONB,
    "template" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalePhase" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SalePhaseKind" NOT NULL DEFAULT 'PUBLIC',
    "code" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "SalePhaseStatus" NOT NULL DEFAULT 'SCHEDULED',
    "channels" "SalesChannel"[],
    "allocationPercent" INTEGER,
    "maxPerOrder" INTEGER,
    "discountPercent" DOUBLE PRECISION,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalePhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueBlackout" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueBlackout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "description" TEXT,
    "basePrice" DECIMAL(12,2) NOT NULL,
    "fees" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "totalQuantity" INTEGER NOT NULL,
    "remainingQuantity" INTEGER NOT NULL,
    "soldQuantity" INTEGER NOT NULL DEFAULT 0,
    "holdQuantity" INTEGER NOT NULL DEFAULT 0,
    "minPerOrder" INTEGER NOT NULL DEFAULT 1,
    "maxPerOrder" INTEGER NOT NULL DEFAULT 10,
    "minAge" INTEGER,
    "restrictedCards" TEXT[],
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'AVAILABLE',
    "orderItemId" TEXT,
    "buyerName" TEXT,
    "buyerEmail" TEXT,
    "seatId" TEXT,
    "seatNumber" TEXT,
    "row" TEXT,
    "section" TEXT,
    "isResale" BOOLEAN NOT NULL DEFAULT false,
    "originalPrice" DECIMAL(12,2),
    "resalePrice" DECIMAL(12,2),
    "checkedInAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "buyerEmail" VARCHAR(255) NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerPhone" TEXT,
    "billingAddress" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "fees" DECIMAL(10,2) NOT NULL,
    "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(10,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "promotionId" TEXT,
    "commissionAmount" DECIMAL(10,2) NOT NULL,
    "paymentId" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CARD',
    "channel" "SalesChannel" NOT NULL DEFAULT 'WEB',
    "cashierId" TEXT,
    "posOps" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "unitFees" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "gateway" "PaymentGateway" NOT NULL DEFAULT 'BANORTE',
    "externalId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "lastFourDigits" TEXT,
    "brand" TEXT,
    "metadata" JSONB,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" "RefundReason" NOT NULL DEFAULT 'CUSTOMER_REQUEST',
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "requestedBy" TEXT NOT NULL,
    "processedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "profileImage" TEXT,
    "phone" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "organizationId" TEXT,
    "password" TEXT,
    "passwordResetToken" TEXT,
    "passwordResetAt" TIMESTAMP(3),
    "provider" TEXT,
    "providerId" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosTerminal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "status" "PosTerminalStatus" NOT NULL DEFAULT 'READY',
    "hardwareConfig" JSONB,
    "offlineMode" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "cacheMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosTerminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosCashierSession" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "status" "PosSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "PosCashierSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResaleListing" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "sellerName" TEXT NOT NULL,
    "askingPrice" DECIMAL(10,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "fee" DECIMAL(10,2) NOT NULL,
    "status" "ResaleStatus" NOT NULL DEFAULT 'ACTIVE',
    "delisted" BOOLEAN NOT NULL DEFAULT false,
    "delistedReason" TEXT,
    "listedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soldAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResaleListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResaleOffer" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "offerPrice" DECIMAL(10,2) NOT NULL,
    "status" "ResaleOfferStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ResaleOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DynamicPrice" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "adjustedPrice" DECIMAL(10,2) NOT NULL,
    "priceMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "reason" TEXT NOT NULL,
    "activeFrom" TIMESTAMP(3) NOT NULL,
    "activeTo" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DynamicPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "PromotionType" NOT NULL DEFAULT 'PERCENTAGE',
    "value" DECIMAL(10,2) NOT NULL,
    "maxDiscount" DECIMAL(10,2),
    "minOrderAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "usageLimit" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "usagePerCustomer" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudFlag" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "orderId" TEXT,
    "ticketId" TEXT,
    "userId" TEXT,
    "type" "FraudType" NOT NULL DEFAULT 'SUSPICIOUS_ACTIVITY',
    "severity" "FraudSeverity" NOT NULL DEFAULT 'MEDIUM',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "status" "FraudStatus" NOT NULL DEFAULT 'FLAGGED',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedBy" TEXT,
    "resolution" TEXT,
    "ipAddress" TEXT,
    "deviceFingerprint" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "FraudFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAnalytics" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "totalTicketsSold" INTEGER NOT NULL,
    "totalRevenue" DECIMAL(15,2) NOT NULL,
    "totalFees" DECIMAL(12,2) NOT NULL,
    "averagePrice" DECIMAL(10,2) NOT NULL,
    "uniqueBuyers" INTEGER NOT NULL,
    "repeatBuyers" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoterPayout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossRevenue" DECIMAL(15,2) NOT NULL,
    "commission" DECIMAL(12,2) NOT NULL,
    "netAmount" DECIMAL(15,2) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "referenceId" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoterPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wishlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wishlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 5,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "offerId" TEXT,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "notifiedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketTransfer" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toEmail" TEXT NOT NULL,
    "toUserId" TEXT,
    "transferCode" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['read:events', 'read:inventory']::TEXT[],
    "rateLimit" INTEGER NOT NULL DEFAULT 1000,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rfc" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "regimenFiscal" TEXT NOT NULL DEFAULT '601',
    "codigoPostal" TEXT NOT NULL,
    "serie" TEXT NOT NULL DEFAULT 'A',
    "nextFolio" INTEGER NOT NULL DEFAULT 1,
    "pacMode" TEXT NOT NULL DEFAULT 'sandbox',
    "pacProvider" TEXT,
    "pacApiKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfdiInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT,
    "uuid" TEXT,
    "serie" TEXT NOT NULL,
    "folio" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'I',
    "status" "CfdiStatus" NOT NULL DEFAULT 'DRAFT',
    "receptorRfc" TEXT NOT NULL,
    "receptorNombre" TEXT NOT NULL,
    "receptorUsoCfdi" TEXT NOT NULL DEFAULT 'G03',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "iva" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "xmlUrl" TEXT,
    "pdfUrl" TEXT,
    "pacRaw" JSONB,
    "errorMessage" TEXT,
    "stampedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfdiInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonPass" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "venueId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "seasonLabel" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "maxQuantity" INTEGER NOT NULL DEFAULT 100,
    "soldQuantity" INTEGER NOT NULL DEFAULT 0,
    "benefits" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeasonPass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonPassEvent" (
    "id" TEXT NOT NULL,
    "seasonPassId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,

    CONSTRAINT "SeasonPassEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonPassPurchase" (
    "id" TEXT NOT NULL,
    "seasonPassId" TEXT NOT NULL,
    "userId" TEXT,
    "buyerEmail" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "status" "SeasonPassPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "seatSection" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeasonPassPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_slug_idx" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_type_idx" ON "Organization"("type");

-- CreateIndex
CREATE INDEX "Organization_verified_idx" ON "Organization"("verified");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_externalId_key" ON "Venue"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_slug_key" ON "Venue"("slug");

-- CreateIndex
CREATE INDEX "Venue_organizationId_idx" ON "Venue"("organizationId");

-- CreateIndex
CREATE INDEX "Venue_slug_idx" ON "Venue"("slug");

-- CreateIndex
CREATE INDEX "Venue_city_idx" ON "Venue"("city");

-- CreateIndex
CREATE INDEX "Venue_organizationId_city_idx" ON "Venue"("organizationId", "city");

-- CreateIndex
CREATE INDEX "VenueLayout_venueId_idx" ON "VenueLayout"("venueId");

-- CreateIndex
CREATE INDEX "Section_layoutId_idx" ON "Section"("layoutId");

-- CreateIndex
CREATE UNIQUE INDEX "Section_layoutId_slug_key" ON "Section"("layoutId", "slug");

-- CreateIndex
CREATE INDEX "SeatRow_sectionId_idx" ON "SeatRow"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "SeatRow_sectionId_label_key" ON "SeatRow"("sectionId", "label");

-- CreateIndex
CREATE INDEX "Seat_sectionId_idx" ON "Seat"("sectionId");

-- CreateIndex
CREATE INDEX "Seat_rowId_idx" ON "Seat"("rowId");

-- CreateIndex
CREATE UNIQUE INDEX "Seat_sectionId_label_key" ON "Seat"("sectionId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "EventSeatMap_eventId_key" ON "EventSeatMap"("eventId");

-- CreateIndex
CREATE INDEX "EventSeatMap_layoutId_idx" ON "EventSeatMap"("layoutId");

-- CreateIndex
CREATE INDEX "SeatHold_eventId_idx" ON "SeatHold"("eventId");

-- CreateIndex
CREATE INDEX "SeatHold_seatId_idx" ON "SeatHold"("seatId");

-- CreateIndex
CREATE INDEX "SeatHold_expiresAt_idx" ON "SeatHold"("expiresAt");

-- CreateIndex
CREATE INDEX "SeatHold_status_idx" ON "SeatHold"("status");

-- CreateIndex
CREATE INDEX "SeatHold_eventId_status_expiresAt_idx" ON "SeatHold"("eventId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "SeatHold_sessionId_status_idx" ON "SeatHold"("sessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TenantTheme_organizationId_key" ON "TenantTheme"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantTheme_customDomain_key" ON "TenantTheme"("customDomain");

-- CreateIndex
CREATE UNIQUE INDEX "TenantTheme_subdomain_key" ON "TenantTheme"("subdomain");

-- CreateIndex
CREATE INDEX "AccessZone_venueId_idx" ON "AccessZone"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessZone_venueId_slug_key" ON "AccessZone"("venueId", "slug");

-- CreateIndex
CREATE INDEX "TicketScan_ticketId_idx" ON "TicketScan"("ticketId");

-- CreateIndex
CREATE INDEX "TicketScan_scannedAt_idx" ON "TicketScan"("scannedAt");

-- CreateIndex
CREATE INDEX "TicketScan_zoneId_scannedAt_idx" ON "TicketScan"("zoneId", "scannedAt");

-- CreateIndex
CREATE INDEX "TicketScan_ticketId_success_scannedAt_idx" ON "TicketScan"("ticketId", "success", "scannedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_idempotencyKey_key" ON "PaymentIntent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentIntent_orderId_idx" ON "PaymentIntent"("orderId");

-- CreateIndex
CREATE INDEX "PaymentIntent_externalId_idx" ON "PaymentIntent"("externalId");

-- CreateIndex
CREATE INDEX "PaymentIntent_provider_status_createdAt_idx" ON "PaymentIntent"("provider", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentIntent_status_expiresAt_idx" ON "PaymentIntent"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_idx" ON "AuditEvent"("organizationId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CashierShift_userId_idx" ON "CashierShift"("userId");

-- CreateIndex
CREATE INDEX "CashierShift_organizationId_idx" ON "CashierShift"("organizationId");

-- CreateIndex
CREATE INDEX "CashierShift_userId_closedAt_idx" ON "CashierShift"("userId", "closedAt");

-- CreateIndex
CREATE INDEX "CashierShift_organizationId_openedAt_idx" ON "CashierShift"("organizationId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Event_externalId_key" ON "Event"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE INDEX "Event_organizationId_idx" ON "Event"("organizationId");

-- CreateIndex
CREATE INDEX "Event_venueId_idx" ON "Event"("venueId");

-- CreateIndex
CREATE INDEX "Event_slug_idx" ON "Event"("slug");

-- CreateIndex
CREATE INDEX "Event_startsAt_idx" ON "Event"("startsAt");

-- CreateIndex
CREATE INDEX "Event_status_idx" ON "Event"("status");

-- CreateIndex
CREATE INDEX "Event_category_idx" ON "Event"("category");

-- CreateIndex
CREATE INDEX "Event_seriesId_idx" ON "Event"("seriesId");

-- CreateIndex
CREATE INDEX "Event_venueId_startsAt_idx" ON "Event"("venueId", "startsAt");

-- CreateIndex
CREATE INDEX "Event_publishAt_idx" ON "Event"("publishAt");

-- CreateIndex
CREATE INDEX "Event_salesStartAt_idx" ON "Event"("salesStartAt");

-- CreateIndex
CREATE INDEX "Event_organizationId_status_startsAt_idx" ON "Event"("organizationId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Event_organizationId_status_publishAt_idx" ON "Event"("organizationId", "status", "publishAt");

-- CreateIndex
CREATE INDEX "Event_status_category_startsAt_idx" ON "Event"("status", "category", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventSeries_slug_key" ON "EventSeries"("slug");

-- CreateIndex
CREATE INDEX "EventSeries_organizationId_idx" ON "EventSeries"("organizationId");

-- CreateIndex
CREATE INDEX "EventSeries_venueId_idx" ON "EventSeries"("venueId");

-- CreateIndex
CREATE INDEX "EventSeries_status_idx" ON "EventSeries"("status");

-- CreateIndex
CREATE INDEX "SalePhase_eventId_startsAt_idx" ON "SalePhase"("eventId", "startsAt");

-- CreateIndex
CREATE INDEX "SalePhase_status_idx" ON "SalePhase"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SalePhase_eventId_name_key" ON "SalePhase"("eventId", "name");

-- CreateIndex
CREATE INDEX "VenueBlackout_venueId_startsAt_idx" ON "VenueBlackout"("venueId", "startsAt");

-- CreateIndex
CREATE INDEX "Offer_eventId_idx" ON "Offer"("eventId");

-- CreateIndex
CREATE INDEX "Offer_isAvailable_idx" ON "Offer"("isAvailable");

-- CreateIndex
CREATE INDEX "Offer_eventId_isAvailable_idx" ON "Offer"("eventId", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_eventId_zone_key" ON "Offer"("eventId", "zone");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_code_key" ON "Ticket"("code");

-- CreateIndex
CREATE INDEX "Ticket_eventId_idx" ON "Ticket"("eventId");

-- CreateIndex
CREATE INDEX "Ticket_offerId_idx" ON "Ticket"("offerId");

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex
CREATE INDEX "Ticket_code_idx" ON "Ticket"("code");

-- CreateIndex
CREATE INDEX "Ticket_seatId_idx" ON "Ticket"("seatId");

-- CreateIndex
CREATE INDEX "Ticket_eventId_status_idx" ON "Ticket"("eventId", "status");

-- CreateIndex
CREATE INDEX "Ticket_eventId_offerId_status_idx" ON "Ticket"("eventId", "offerId", "status");

-- CreateIndex
CREATE INDEX "Ticket_eventId_seatId_status_idx" ON "Ticket"("eventId", "seatId", "status");

-- CreateIndex
CREATE INDEX "Ticket_eventId_checkedInAt_idx" ON "Ticket"("eventId", "checkedInAt");

-- CreateIndex
CREATE INDEX "Ticket_orderItemId_idx" ON "Ticket"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_eventId_seatId_key" ON "Ticket"("eventId", "seatId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_publicId_key" ON "Order"("publicId");

-- CreateIndex
CREATE INDEX "Order_organizationId_idx" ON "Order"("organizationId");

-- CreateIndex
CREATE INDEX "Order_eventId_idx" ON "Order"("eventId");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_publicId_idx" ON "Order"("publicId");

-- CreateIndex
CREATE INDEX "Order_buyerEmail_idx" ON "Order"("buyerEmail");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_organizationId_status_createdAt_idx" ON "Order"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_organizationId_status_completedAt_idx" ON "Order"("organizationId", "status", "completedAt");

-- CreateIndex
CREATE INDEX "Order_eventId_status_idx" ON "Order"("eventId", "status");

-- CreateIndex
CREATE INDEX "Order_organizationId_channel_status_createdAt_idx" ON "Order"("organizationId", "channel", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_cashierId_channel_createdAt_idx" ON "Order"("cashierId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "Order_paymentId_idx" ON "Order"("paymentId");

-- CreateIndex
CREATE INDEX "Order_promotionId_idx" ON "Order"("promotionId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_offerId_idx" ON "OrderItem"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_externalId_key" ON "Payment"("externalId");

-- CreateIndex
CREATE INDEX "Payment_gateway_idx" ON "Payment"("gateway");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_externalId_idx" ON "Payment"("externalId");

-- CreateIndex
CREATE INDEX "Payment_gateway_status_createdAt_idx" ON "Payment"("gateway", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE INDEX "Refund_status_idx" ON "Refund"("status");

-- CreateIndex
CREATE INDEX "Refund_status_processedAt_idx" ON "Refund"("status", "processedAt");

-- CreateIndex
CREATE INDEX "Refund_status_requestedAt_idx" ON "Refund"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_token_idx" ON "Session"("token");

-- CreateIndex
CREATE INDEX "PosTerminal_organizationId_idx" ON "PosTerminal"("organizationId");

-- CreateIndex
CREATE INDEX "PosTerminal_organizationId_status_idx" ON "PosTerminal"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PosCashierSession_terminalId_idx" ON "PosCashierSession"("terminalId");

-- CreateIndex
CREATE INDEX "PosCashierSession_cashierId_idx" ON "PosCashierSession"("cashierId");

-- CreateIndex
CREATE INDEX "PosCashierSession_terminalId_cashierId_status_idx" ON "PosCashierSession"("terminalId", "cashierId", "status");

-- CreateIndex
CREATE INDEX "PosCashierSession_terminalId_status_startedAt_idx" ON "PosCashierSession"("terminalId", "status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResaleListing_ticketId_key" ON "ResaleListing"("ticketId");

-- CreateIndex
CREATE INDEX "ResaleListing_sellerId_idx" ON "ResaleListing"("sellerId");

-- CreateIndex
CREATE INDEX "ResaleListing_status_idx" ON "ResaleListing"("status");

-- CreateIndex
CREATE INDEX "ResaleListing_status_listedAt_idx" ON "ResaleListing"("status", "listedAt");

-- CreateIndex
CREATE INDEX "ResaleOffer_listingId_idx" ON "ResaleOffer"("listingId");

-- CreateIndex
CREATE INDEX "ResaleOffer_buyerId_idx" ON "ResaleOffer"("buyerId");

-- CreateIndex
CREATE INDEX "ResaleOffer_status_idx" ON "ResaleOffer"("status");

-- CreateIndex
CREATE INDEX "DynamicPrice_eventId_idx" ON "DynamicPrice"("eventId");

-- CreateIndex
CREATE INDEX "DynamicPrice_offerId_idx" ON "DynamicPrice"("offerId");

-- CreateIndex
CREATE INDEX "DynamicPrice_activeFrom_activeTo_idx" ON "DynamicPrice"("activeFrom", "activeTo");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_code_key" ON "Promotion"("code");

-- CreateIndex
CREATE INDEX "Promotion_code_idx" ON "Promotion"("code");

-- CreateIndex
CREATE INDEX "Promotion_organizationId_idx" ON "Promotion"("organizationId");

-- CreateIndex
CREATE INDEX "Promotion_startDate_endDate_idx" ON "Promotion"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "FraudFlag_eventId_idx" ON "FraudFlag"("eventId");

-- CreateIndex
CREATE INDEX "FraudFlag_orderId_idx" ON "FraudFlag"("orderId");

-- CreateIndex
CREATE INDEX "FraudFlag_userId_idx" ON "FraudFlag"("userId");

-- CreateIndex
CREATE INDEX "FraudFlag_severity_idx" ON "FraudFlag"("severity");

-- CreateIndex
CREATE INDEX "FraudFlag_status_idx" ON "FraudFlag"("status");

-- CreateIndex
CREATE INDEX "FraudFlag_eventId_status_idx" ON "FraudFlag"("eventId", "status");

-- CreateIndex
CREATE INDEX "FraudFlag_eventId_severity_idx" ON "FraudFlag"("eventId", "severity");

-- CreateIndex
CREATE INDEX "FraudFlag_ticketId_idx" ON "FraudFlag"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "EventAnalytics_eventId_key" ON "EventAnalytics"("eventId");

-- CreateIndex
CREATE INDEX "EventAnalytics_eventId_idx" ON "EventAnalytics"("eventId");

-- CreateIndex
CREATE INDEX "EventAnalytics_date_idx" ON "EventAnalytics"("date");

-- CreateIndex
CREATE INDEX "PromoterPayout_organizationId_idx" ON "PromoterPayout"("organizationId");

-- CreateIndex
CREATE INDEX "PromoterPayout_status_idx" ON "PromoterPayout"("status");

-- CreateIndex
CREATE INDEX "PromoterPayout_organizationId_status_periodEnd_idx" ON "PromoterPayout"("organizationId", "status", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_userId_key" ON "Cart"("userId");

-- CreateIndex
CREATE INDEX "Cart_userId_idx" ON "Cart"("userId");

-- CreateIndex
CREATE INDEX "Wishlist_userId_idx" ON "Wishlist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Wishlist_userId_eventId_key" ON "Wishlist"("userId", "eventId");

-- CreateIndex
CREATE INDEX "Review_eventId_idx" ON "Review"("eventId");

-- CreateIndex
CREATE INDEX "Review_userId_idx" ON "Review"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_eventId_userId_key" ON "Review"("eventId", "userId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_eventId_idx" ON "WaitlistEntry"("eventId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_status_idx" ON "WaitlistEntry"("status");

-- CreateIndex
CREATE INDEX "WaitlistEntry_createdAt_idx" ON "WaitlistEntry"("createdAt");

-- CreateIndex
CREATE INDEX "WaitlistEntry_eventId_status_priority_createdAt_idx" ON "WaitlistEntry"("eventId", "status", "priority", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_eventId_email_key" ON "WaitlistEntry"("eventId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "TicketTransfer_transferCode_key" ON "TicketTransfer"("transferCode");

-- CreateIndex
CREATE INDEX "TicketTransfer_ticketId_idx" ON "TicketTransfer"("ticketId");

-- CreateIndex
CREATE INDEX "TicketTransfer_toEmail_idx" ON "TicketTransfer"("toEmail");

-- CreateIndex
CREATE INDEX "TicketTransfer_transferCode_idx" ON "TicketTransfer"("transferCode");

-- CreateIndex
CREATE INDEX "TicketTransfer_status_idx" ON "TicketTransfer"("status");

-- CreateIndex
CREATE INDEX "TicketTransfer_status_expiresAt_idx" ON "TicketTransfer"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_idx" ON "ApiKey"("organizationId");

-- CreateIndex
CREATE INDEX "ApiKey_keyPrefix_idx" ON "ApiKey"("keyPrefix");

-- CreateIndex
CREATE INDEX "ApiKey_active_idx" ON "ApiKey"("active");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalProfile_organizationId_key" ON "FiscalProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CfdiInvoice_uuid_key" ON "CfdiInvoice"("uuid");

-- CreateIndex
CREATE INDEX "CfdiInvoice_organizationId_idx" ON "CfdiInvoice"("organizationId");

-- CreateIndex
CREATE INDEX "CfdiInvoice_orderId_idx" ON "CfdiInvoice"("orderId");

-- CreateIndex
CREATE INDEX "CfdiInvoice_status_idx" ON "CfdiInvoice"("status");

-- CreateIndex
CREATE INDEX "CfdiInvoice_receptorRfc_idx" ON "CfdiInvoice"("receptorRfc");

-- CreateIndex
CREATE INDEX "CfdiInvoice_organizationId_status_createdAt_idx" ON "CfdiInvoice"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CfdiInvoice_organizationId_serie_folio_key" ON "CfdiInvoice"("organizationId", "serie", "folio");

-- CreateIndex
CREATE INDEX "SeasonPass_organizationId_idx" ON "SeasonPass"("organizationId");

-- CreateIndex
CREATE INDEX "SeasonPass_active_idx" ON "SeasonPass"("active");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonPass_organizationId_slug_key" ON "SeasonPass"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "SeasonPassEvent_eventId_idx" ON "SeasonPassEvent"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonPassEvent_seasonPassId_eventId_key" ON "SeasonPassEvent"("seasonPassId", "eventId");

-- CreateIndex
CREATE INDEX "SeasonPassPurchase_seasonPassId_idx" ON "SeasonPassPurchase"("seasonPassId");

-- CreateIndex
CREATE INDEX "SeasonPassPurchase_buyerEmail_idx" ON "SeasonPassPurchase"("buyerEmail");

-- CreateIndex
CREATE INDEX "SeasonPassPurchase_seasonPassId_status_idx" ON "SeasonPassPurchase"("seasonPassId", "status");

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueLayout" ADD CONSTRAINT "VenueLayout_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "VenueLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatRow" ADD CONSTRAINT "SeatRow_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "SeatRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeatMap" ADD CONSTRAINT "EventSeatMap_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeatMap" ADD CONSTRAINT "EventSeatMap_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "VenueLayout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatHold" ADD CONSTRAINT "SeatHold_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatHold" ADD CONSTRAINT "SeatHold_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantTheme" ADD CONSTRAINT "TenantTheme_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessZone" ADD CONSTRAINT "AccessZone_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketScan" ADD CONSTRAINT "TicketScan_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketScan" ADD CONSTRAINT "TicketScan_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "AccessZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "EventSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalePhase" ADD CONSTRAINT "SalePhase_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueBlackout" ADD CONSTRAINT "VenueBlackout_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTerminal" ADD CONSTRAINT "PosTerminal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCashierSession" ADD CONSTRAINT "PosCashierSession_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "PosTerminal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResaleListing" ADD CONSTRAINT "ResaleListing_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResaleOffer" ADD CONSTRAINT "ResaleOffer_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ResaleListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DynamicPrice" ADD CONSTRAINT "DynamicPrice_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DynamicPrice" ADD CONSTRAINT "DynamicPrice_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudFlag" ADD CONSTRAINT "FraudFlag_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudFlag" ADD CONSTRAINT "FraudFlag_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudFlag" ADD CONSTRAINT "FraudFlag_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudFlag" ADD CONSTRAINT "FraudFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoterPayout" ADD CONSTRAINT "PromoterPayout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wishlist" ADD CONSTRAINT "Wishlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTransfer" ADD CONSTRAINT "TicketTransfer_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalProfile" ADD CONSTRAINT "FiscalProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CfdiInvoice" ADD CONSTRAINT "CfdiInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CfdiInvoice" ADD CONSTRAINT "CfdiInvoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonPass" ADD CONSTRAINT "SeasonPass_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonPass" ADD CONSTRAINT "SeasonPass_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonPassEvent" ADD CONSTRAINT "SeasonPassEvent_seasonPassId_fkey" FOREIGN KEY ("seasonPassId") REFERENCES "SeasonPass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonPassEvent" ADD CONSTRAINT "SeasonPassEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonPassPurchase" ADD CONSTRAINT "SeasonPassPurchase_seasonPassId_fkey" FOREIGN KEY ("seasonPassId") REFERENCES "SeasonPass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

