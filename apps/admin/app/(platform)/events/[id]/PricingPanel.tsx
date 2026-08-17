'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
} from '@boletera/ui';
import type { EventHub } from '@/lib/platform-api';
import styles from './event-hub.module.scss';

type Props = {
  hub: EventHub;
  canWritePrice: boolean;
  pricingSaving: string | null;
  dynamicSaving: boolean;
  onSaveOffer: (offerId: string, price: number) => Promise<void>;
  onSaveDynamic: (enabled: boolean, basePrice: number) => Promise<void>;
};

export function PricingPanel({
  hub,
  canWritePrice,
  pricingSaving,
  dynamicSaving,
  onSaveOffer,
  onSaveDynamic,
}: Props) {
  const offers = hub.event.offers ?? [];
  const [offerEdits, setOfferEdits] = useState<Record<string, string>>({});
  const [dynamicPricing, setDynamicPricing] = useState(false);

  useEffect(() => {
    const edits: Record<string, string> = {};
    offers.forEach((offer) => {
      edits[offer.id] = String(offer.basePrice);
    });
    setOfferEdits(edits);
    setDynamicPricing(Boolean((hub.event as { enableDynamic?: boolean }).enableDynamic));
  }, [hub.event, offers]);

  return (
    <div
      className={styles.tabPanel}
      role="tabpanel"
      id="hub-panel-pricing"
      aria-labelledby="hub-tab-pricing"
    >
      <Card variant="outline" padding="md">
        <CardHeader
          title="Pricing dinámico"
          description="Surge por ocupación cuando está habilitado"
        />
        {!canWritePrice ? (
          <EmptyState
            title="Sin permiso de precios"
            description="Necesitas el permiso price:write para modificar reglas y ofertas."
            illustration="error"
            tone="neutral"
            size="sm"
          />
        ) : (
          <div className={styles.cardBody}>
            <label className={styles.inlineCheck}>
              <input
                type="checkbox"
                checked={dynamicPricing}
                onChange={(event) => setDynamicPricing(event.target.checked)}
              />
              Pricing dinámico (surge por ocupación)
            </label>
            <div className={styles.actionsRow}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={dynamicSaving}
                onClick={() => {
                  const base = Number(offers[0]?.basePrice ?? 100);
                  void onSaveDynamic(dynamicPricing, base);
                }}
              >
                {dynamicSaving ? 'Guardando…' : 'Guardar reglas dinámicas'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card variant="outline" padding="md">
        <CardHeader title="Ofertas / zonas" description="Precios base en MXN" />
        {offers.length === 0 ? (
          <EmptyState
            title="Sin ofertas"
            description="Este evento aún no tiene ofertas de precio configuradas."
            illustration="inbox"
            size="sm"
          />
        ) : (
          <div className={styles.tableWrap} role="region" aria-label="Ofertas del evento">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Zona</th>
                  <th scope="col">Nombre</th>
                  <th scope="col">Precio (MXN)</th>
                  <th scope="col">
                    <span className={styles.srOnly}>Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {offers.map((offer) => (
                  <tr key={offer.id}>
                    <td>{offer.zone}</td>
                    <td>{offer.name}</td>
                    <td>
                      <input
                        className={styles.priceInput}
                        type="number"
                        min={1}
                        step={50}
                        disabled={!canWritePrice}
                        value={offerEdits[offer.id] ?? offer.basePrice}
                        onChange={(event) =>
                          setOfferEdits((prev) => ({
                            ...prev,
                            [offer.id]: event.target.value,
                          }))
                        }
                        aria-label={`Precio de ${offer.name}`}
                      />
                    </td>
                    <td>
                      {canWritePrice ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={pricingSaving === offer.id}
                          onClick={() => {
                            const price = Number(offerEdits[offer.id]);
                            if (!Number.isFinite(price) || price <= 0) return;
                            void onSaveOffer(offer.id, price);
                          }}
                        >
                          {pricingSaving === offer.id ? '…' : 'Guardar'}
                        </Button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
