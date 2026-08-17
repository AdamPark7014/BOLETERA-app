# Domain contracts owned by `@boletera/shared`

Other packages must **import** these symbols. Do not redefine parallel enums or
money helpers in `@boletera/validators`, `@boletera/payments`, apps, etc.

## Money

- `MoneyAmount`, `CurrencyCode`, `DEFAULT_CURRENCY`
- `toMinorUnits` / `fromMinorUnits` / `money` / `moneyFromMinor`
- `addMoney`, `subtractMoney`, `multiplyMoney`, `sumMoney`, `allocateMinor`
- `addVat`, `splitVatInclusive`, `MEXICO_VAT_RATE`
- `formatMoney`, `formatMoneyMajor`, `toGatewayAmountString`
- `CURRENCY_NUMERIC_CODES` (Payworks `484` / `840`)

All arithmetic is in **integer centavos**. Convert at the edge only.

## Locale / timezone

- `PLATFORM_LOCALE` = `es-MX`
- `PLATFORM_TIMEZONE` = `America/Mexico_City`
- `PLATFORM_COUNTRY` = `MX`
- `MEXICO_MARKET`, `resolveOrganizationTimezone`
- Scheduling helpers: `zonedTimeToUtc`, `getZonedParts`, `expandRecurrence`,
  `resolveSaleStatus`, `detectScheduleConflicts`

## Enums

- `SalesChannel`, `UserRole`, `TicketStatus`, `OrderStatus`, `PaymentStatus`,
  `PaymentMethod` and matching `*_VALUES` / `*Value` string unions

## Seat maps

- `SeatMapData` and nested geometry types in `types.ts`

## Owned elsewhere

- `analytics-contracts.ts` — another agent
- Prisma models — `@boletera/database`
- UI components — `@boletera/ui`
