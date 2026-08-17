# @boletera/payments — migration notes

## Additive (safe)

- `PaymentContext.amountMinor`, `idempotencyKey`
- `PaymentError` / `PaymentErrorCode`, `withSafeRetry`
- `IdempotencyGuard`, `banorteIntentIdempotency`, `redactForLog`
- Extended statuses: `declined` | `cancelled` | `expired` on intents/webhooks
- `SalesChannelType` remains an alias of shared `SalesChannelValue`

## Recommended

1. Always pass `idempotencyKey` when calling `createIntent` (required for `withSafeRetry`).
2. Prefer `amountMinor` (centavos) over floating `amount`.
3. Never log Payworks redirect URLs; use `redactForLog`.
4. Set `BANORTE_WEBHOOK_SECRET` in production (soft-allow only outside prod).
