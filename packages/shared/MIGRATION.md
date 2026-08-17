# @boletera/shared — migration notes

## Additive (no consumer changes required)

New exports available from `@boletera/shared`:

| Export | Purpose |
| --- | --- |
| `money`, `MoneyAmount`, `toMinorUnits`, `fromMinorUnits`, `formatMoney`, `allocateMinor`, `addVat`, … | Canonical money arithmetic in centavos |
| `PLATFORM_LOCALE`, `PLATFORM_TIMEZONE`, `PLATFORM_COUNTRY`, `MEXICO_MARKET` | Mexico market defaults |
| `resolveOrganizationTimezone` | Safe IANA timezone fallback to `America/Mexico_City` |
| `OrderStatus`, `PaymentStatus`, `PaymentMethod` (+ `*_VALUES`) | Domain enums previously duplicated in apps |
| `TicketStatus.CANCELLED` / `REFUNDED` / `TRANSFERRED` | Extended ticket lifecycle |
| `EventRef`, `OrderRef` | Cross-app identity DTOs |
| `zoneObservesDstOnDate` | Operator warning helper around DST transitions |
| `SalesChannelValue`, `UserRoleValue`, … | String-literal unions of the enums |

`zonedTimeToUtc` behaviour is unchanged for non-ambiguous times. Ambiguous
fall-back times now prefer the **earlier** (daylight) occurrence; spring-forward
gaps still resolve to the first valid minute after the jump.

## Recommended consumer migrations

1. **Money** — replace ad-hoc `toLocaleString('es-MX', { style: 'currency' })`
   helpers with `formatMoney` / `formatMoneyMajor`. Convert gateway amounts with
   `toGatewayAmountString`.
2. **Enums** — import `PaymentMethod`, `OrderStatus`, `PaymentStatus` from
   `@boletera/shared` instead of redeclaring string unions in validators/payments.
3. **Timezone** — use `PLATFORM_TIMEZONE` / `resolveOrganizationTimezone` instead
   of hardcoding `"America/Mexico_City"`.

## Do not edit

`analytics-contracts.ts` is owned by another agent.
