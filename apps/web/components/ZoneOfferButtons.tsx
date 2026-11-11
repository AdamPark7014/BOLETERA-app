'use client';

import { usePathname, useRouter } from 'next/navigation';
import styles from './ZoneOfferButtons.module.scss';

export function ZoneOfferButtons({
  offers,
  currency,
  activeZone,
}: {
  offers: {
    id: string;
    zone: string;
    name?: string;
    basePrice: string;
    remainingQuantity?: number;
  }[];
  currency: string;
  activeZone?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function pick(zone: string) {
    const params = new URLSearchParams();
    params.set('zone', zone);
    router.replace(`${pathname}?${params}`, { scroll: false });
    requestAnimationFrame(() => {
      document.getElementById('compra')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  return (
    <ul className={styles.list}>
      {offers.map((o) => {
        const active = activeZone === o.zone;
        return (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => pick(o.zone)}
              className={active ? styles.active : styles.row}
              aria-pressed={active}
            >
              <div>
                <strong>{o.name || `Zona ${o.zone.toUpperCase()}`}</strong>
                <span>
                  {typeof o.remainingQuantity === 'number'
                    ? `${o.remainingQuantity} disponibles · ver en mapa`
                    : 'Ver asientos en mapa'}
                </span>
              </div>
              <em>
                ${Number(o.basePrice).toLocaleString('es-MX', { maximumFractionDigits: 0 })}{' '}
                {currency}
              </em>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
