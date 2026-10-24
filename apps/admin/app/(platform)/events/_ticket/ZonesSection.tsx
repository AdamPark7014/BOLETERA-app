'use client';

import { useEffect, useMemo, useState } from 'react';
import { Field, Money, ParameterCard, TicketButton, formatTicketAmount } from '@boletera/ui';
import { adminApi } from '@/lib/api';
import { updateOffer } from '@/lib/platform-api';
import { Param, Switch } from './controls';
import styles from './frame.module.scss';
import {
  asRecord,
  formatCount,
  formatWhen,
  readNumber,
  readOffers,
  readString,
  yesNo,
  type OfferView,
} from './read';

type PriceQuote = { total: number; fees: number; taxes: number; base: number };

type Draft = { name: string; price: string; available: boolean };

function draftOf(offer: OfferView): Draft {
  return {
    name: offer.name,
    price: String(offer.basePrice),
    available: offer.isAvailable,
  };
}

function moneyLabel(raw: string): string {
  if (raw.trim() === '') return '—';
  const price = Number(raw);
  if (!Number.isFinite(price)) return '—';
  return formatTicketAmount(price);
}

export function ZonesSection({
  eventId,
  event,
  token,
  canWrite,
  onSaved,
}: {
  eventId: string;
  event: unknown;
  token: string;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const offers = useMemo(() => readOffers(event), [event]);
  const row = asRecord(event);
  const zone = readString(row.timezone) ?? 'America/Mexico_City';
  const surge = readNumber(row.surgeThreshold);
  const surgeLabel = surge == null ? '—' : `${Math.round(surge <= 1 ? surge * 100 : surge)}%`;
  const [openId, setOpenId] = useState<string | null>(offers[0]?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(offers.map((offer) => [offer.id, draftOf(offer)])),
  );
  const [quotes, setQuotes] = useState<Record<string, PriceQuote>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(Object.fromEntries(offers.map((offer) => [offer.id, draftOf(offer)])));
    setOpenId((current) => current ?? offers[0]?.id ?? null);
  }, [offers]);

  useEffect(() => {
    let alive = true;
    if (!token || offers.length === 0) return undefined;
    void Promise.all(
      offers.map(async (offer) => {
        try {
          const result = await adminApi<Record<string, unknown>>('/pricing/calculate', token, {
            method: 'POST',
            body: JSON.stringify({ eventId, offerId: offer.id, quantity: 1 }),
            silent: true,
          });
          const total = readNumber(result.total);
          const fees = readNumber(result.fees);
          const taxes = readNumber(result.taxes);
          const base = readNumber(result.subtotal) ?? offer.basePrice;
          if (total == null || fees == null || taxes == null) return null;
          return [offer.id, { total, fees, taxes, base }] as const;
        } catch {
          return null;
        }
      }),
    ).then((rows) => {
      if (!alive) return;
      const next: Record<string, PriceQuote> = {};
      for (const item of rows) {
        if (!item) continue;
        next[item[0]] = item[1];
      }
      setQuotes(next);
    });
    return () => {
      alive = false;
    };
  }, [eventId, offers, token]);

  const changes = offers.flatMap((offer) => {
    const draft = drafts[offer.id] ?? draftOf(offer);
    const price = Number(draft.price);
    const lines: string[] = [];
    if (draft.name.trim() !== offer.name) lines.push(`Nombre de ${offer.zone}: ${offer.name} → ${draft.name.trim()}`);
    if (Number.isFinite(price) && price !== offer.basePrice) {
      lines.push(`Precio de ${offer.zone}: ${formatTicketAmount(offer.basePrice)} → ${formatTicketAmount(price)}`);
    }
    if (draft.available !== offer.isAvailable) {
      lines.push(`A la venta ${offer.zone}: ${yesNo(offer.isAvailable)} → ${yesNo(draft.available)}`);
    }
    return lines;
  });
  const dirty = changes.length > 0;
  const priceOk = offers.every((offer) => {
    const draft = drafts[offer.id];
    if (!draft) return true;
    const price = Number(draft.price);
    return draft.name.trim().length > 0 && Number.isFinite(price) && price > 0;
  });

  function patch(id: string, partial: Partial<Draft>) {
    setDrafts((current) => {
      const offer = offers.find((item) => item.id === id);
      const base = current[id] ?? (offer ? draftOf(offer) : { name: '', price: '', available: true });
      return { ...current, [id]: { ...base, ...partial } };
    });
    setNotice(null);
  }

  async function save() {
    if (!dirty || !priceOk || saving) return;
    setSaving(true);
    setError(null);
    try {
      for (const offer of offers) {
        const draft = drafts[offer.id];
        if (!draft) continue;
        const price = Number(draft.price);
        const body: { name?: string; basePrice?: number; isAvailable?: boolean } = {};
        if (draft.name.trim() !== offer.name) body.name = draft.name.trim();
        if (price !== offer.basePrice) body.basePrice = price;
        if (draft.available !== offer.isAvailable) body.isAvailable = draft.available;
        if (Object.keys(body).length === 0) continue;
        await updateOffer(token, eventId, offer.id, body);
      }
      setNotice(changes.join(' · '));
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se guardó. Revisa la conexión.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Zonas y precios</h1>
        <p className={styles.quiet}>
          Precio dinámico {yesNo(row.enableDynamic)} · Umbral {surgeLabel} · Multiplicador{' '}
          {readNumber(row.surgePriceMultiplier) ?? '—'}
        </p>
      </header>
      {offers.length === 0 ? <p className={styles.quiet}>No hay zonas.</p> : null}
      <div className={styles.stack}>
        {offers.map((offer) => {
          const draft = drafts[offer.id] ?? draftOf(offer);
          const quote = quotes[offer.id];
          const shown = quote?.total ?? offer.basePrice;
          const open = openId === offer.id;
          const priceInvalid = draft.price !== '' && !(Number(draft.price) > 0);
          return (
            <div key={offer.id} className={styles.stack}>
              <button
                type="button"
                className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : offer.id)}
              >
                <span>
                  {offer.zone} · {offer.name}
                </span>
                <span className={styles.figure}>{formatTicketAmount(shown)}</span>
              </button>
              {open ? (
                <>
                  {quote ? (
                    <Money
                      label="Anunciado"
                      amount={quote.total}
                      currency
                      lines={[
                        { label: 'Base', amount: quote.base },
                        { label: 'Cargo', amount: quote.fees },
                        { label: 'IVA', amount: quote.taxes },
                      ]}
                    />
                  ) : null}
                  <Param name="Nombre de la oferta">
                    <ParameterCard
                      name="Nombre de la oferta"
                      value={draft.name || '—'}
                      effect="Nombre comercial de la zona."
                    >
                      {canWrite ? (
                        <Field
                          label="Nombre de la oferta"
                          value={draft.name}
                          onChange={(event) => patch(offer.id, { name: event.target.value })}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                  <Param name="Zona">
                    <ParameterCard name="Zona" value={offer.zone} effect="Única por evento." />
                  </Param>
                  <Param name="Descripción de la oferta">
                    <ParameterCard
                      name="Descripción de la oferta"
                      value={offer.description ?? '—'}
                      effect="Texto corto de la zona."
                    />
                  </Param>
                  <Param name="Precio base">
                    <ParameterCard
                      name="Precio base"
                      value={moneyLabel(draft.price)}
                      valueStyle="tabular"
                      effect="Lo que recibe el promotor por boleto."
                    >
                      {canWrite ? (
                        <Field
                          label="Precio base"
                          kind="money"
                          value={draft.price}
                          error={priceInvalid ? 'El precio tiene que ser mayor que $0.00.' : undefined}
                          onChange={(event) => patch(offer.id, { price: event.target.value })}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                  <Param name="Moneda de la oferta">
                    <ParameterCard name="Moneda de la oferta" value={offer.currency} effect="Moneda de esta zona." />
                  </Param>
                  <Param name="Cupo de la zona">
                    <ParameterCard
                      name="Cupo de la zona"
                      value={formatCount(offer.totalQuantity)}
                      valueStyle="tabular"
                      effect="Cupo guardado de la zona."
                    />
                  </Param>
                  <Param name="Disponibles">
                    <ParameterCard
                      name="Disponibles"
                      value={formatCount(offer.remainingQuantity)}
                      valueStyle="tabular"
                      effect="Lo calcula el inventario."
                    />
                  </Param>
                  <Param name="Vendidos">
                    <ParameterCard
                      name="Vendidos"
                      value={formatCount(offer.soldQuantity)}
                      valueStyle="tabular"
                      effect="Boletos ya vendidos en la zona."
                    />
                  </Param>
                  <Param name="Apartados en la zona">
                    <ParameterCard
                      name="Apartados en la zona"
                      value={formatCount(offer.holdQuantity)}
                      valueStyle="tabular"
                      effect="Apartados vigentes en la zona."
                    />
                  </Param>
                  <Param name="Mínimo por orden">
                    <ParameterCard
                      name="Mínimo por orden"
                      value={formatCount(offer.minPerOrder)}
                      valueStyle="tabular"
                      effect="Mínimo de boletos por orden."
                    />
                  </Param>
                  <Param name="Máximo por orden">
                    <ParameterCard
                      name="Máximo por orden"
                      value={formatCount(offer.maxPerOrder)}
                      valueStyle="tabular"
                      effect="Máximo de boletos por orden."
                    />
                  </Param>
                  <Param name="Edad mínima">
                    <ParameterCard
                      name="Edad mínima"
                      value={offer.minAge == null ? 'Sin mínimo' : formatCount(offer.minAge)}
                      valueStyle="tabular"
                      effect="Edad para comprar esta zona."
                    />
                  </Param>
                  <Param name="Tarjetas restringidas">
                    <ParameterCard name="Tarjetas restringidas" value={offer.cards} effect="Restricción de la zona." />
                  </Param>
                  <Param name="Vigencia desde">
                    <ParameterCard
                      name="Vigencia desde"
                      value={formatWhen(offer.startDate, zone)}
                      effect="Inicio de la vigencia de la zona."
                    />
                  </Param>
                  <Param name="Vigencia hasta">
                    <ParameterCard
                      name="Vigencia hasta"
                      value={formatWhen(offer.endDate, zone)}
                      effect="Fin de la vigencia de la zona."
                    />
                  </Param>
                  <Param name="A la venta">
                    <ParameterCard
                      name="A la venta"
                      value={yesNo(draft.available)}
                      effect="Apagada, la zona no se vende."
                    >
                      {canWrite ? (
                        <Switch
                          label={`A la venta ${offer.zone}`}
                          on={draft.available}
                          onChange={(available) => patch(offer.id, { available })}
                        />
                      ) : null}
                    </ParameterCard>
                  </Param>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      {error ? (
        <p className={styles.danger} role="alert">
          {error}
        </p>
      ) : null}
      {canWrite && offers.length > 0 ? (
        <div className={styles.saveBar}>
          <p className={styles.quiet} aria-live="polite">
            {dirty ? 'Sin guardar' : (notice ?? '')}
          </p>
          <TicketButton disabled={!dirty || !priceOk || saving} onClick={() => void save()}>
            Guardar sección
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}
