'use client';

import { ParameterCard } from '@boletera/ui';
import { formatTicketAmount } from '@boletera/ui';
import { Param } from './controls';
import styles from './frame.module.scss';
import {
  asRecord,
  categoryLabel,
  formatCount,
  formatWhen,
  readNumber,
  readOffers,
  readString,
  statusLabel,
  yesNo,
} from './read';

export function EventSection({ event }: { event: unknown }) {
  const row = asRecord(event);
  const venue = asRecord(row.venue);
  const meta = asRecord(row.metadata);
  const zone = readString(row.timezone) ?? 'America/Mexico_City';
  const offers = readOffers(event);
  const prices = offers.map((offer) => offer.basePrice).filter((price) => price > 0);
  const minFromOffers = prices.length > 0 ? Math.min(...prices) : null;
  const maxFromOffers = prices.length > 0 ? Math.max(...prices) : null;
  const minPrice = minFromOffers ?? readNumber(row.minPrice);
  const maxPrice = maxFromOffers ?? readNumber(row.maxPrice);
  const holdable = readNumber(row.holdableCapacity);

  const cards: {
    name: string;
    value: string;
    effect: string;
    valueStyle?: 'text' | 'tabular' | 'mono';
  }[] = [
    { name: 'Título', value: readString(row.title) ?? '—', effect: 'Nombre en la ficha y en la venta.' },
    {
      name: 'Descripción',
      value: readString(row.description) ?? '—',
      effect: 'Texto de la ficha.',
    },
    {
      name: 'Slug',
      value: readString(row.slug) ?? '—',
      effect: 'Identidad de la URL. Se lee después de crear.',
      valueStyle: 'mono',
    },
    {
      name: 'Recinto',
      value: readString(venue.name) ?? '—',
      effect: 'Sala de la función.',
    },
    { name: 'Inicio', value: formatWhen(row.startsAt, zone), effect: 'Hora de la función.' },
    { name: 'Fin', value: formatWhen(row.endsAt, zone), effect: 'Cierre de la función.' },
    { name: 'Zona horaria', value: zone, effect: 'Cómo se leen las horas.', valueStyle: 'mono' },
    { name: 'Categoría', value: categoryLabel(row.category), effect: 'Clasificación de la función.' },
    { name: 'Estado', value: statusLabel(row.status), effect: 'Borrador, programado, en vivo, terminado, cancelado o reprogramado.' },
    { name: 'Publicado', value: formatWhen(row.publishedAt, zone), effect: 'Instante en que quedó publicado.' },
    { name: 'Cancelado', value: formatWhen(row.cancelledAt, zone), effect: 'Instante de la cancelación.' },
    {
      name: 'Motivo de cancelación',
      value: readString(row.cancellationReason) ?? '—',
      effect: 'Texto que ve el comprador.',
    },
    {
      name: 'Serie',
      value: readString(row.seriesId) ?? 'Ninguna',
      effect: 'Enlaza las funciones de la residencia.',
      valueStyle: 'mono',
    },
    {
      name: 'Orden en la serie',
      value: formatCount(readNumber(row.seriesOrder)),
      effect: 'Lugar de esta función en la serie.',
      valueStyle: 'tabular',
    },
    {
      name: 'Precio mínimo',
      value: minPrice == null ? '—' : formatTicketAmount(minPrice),
      effect: offers.length > 0 ? 'El menor de las ofertas guardadas.' : 'No hay ofertas. El número es el del evento.',
      valueStyle: 'tabular',
    },
    {
      name: 'Precio máximo',
      value: maxPrice == null ? '—' : formatTicketAmount(maxPrice),
      effect: offers.length > 0 ? 'El mayor de las ofertas guardadas.' : 'No hay ofertas. El número es el del evento.',
      valueStyle: 'tabular',
    },
    { name: 'Moneda', value: readString(row.currency) ?? 'MXN', effect: 'Moneda del evento.' },
    {
      name: 'Cupo del evento',
      value: formatCount(readNumber(row.totalCapacity)),
      effect: 'Aforo declarado de la función.',
      valueStyle: 'tabular',
    },
    {
      name: 'Imagen',
      value: readString(row.image) ? 'Con imagen' : 'Sin imagen',
      effect: 'Sale por el medio del evento, fuera de esta ficha.',
    },
    {
      name: 'Banner',
      value: readString(row.bannerImage) ? 'Con imagen' : 'Sin imagen',
      effect: 'Igual que la imagen.',
    },
  ];

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>{readString(row.title) ?? 'Evento'}</h1>
      </header>
      <div className={styles.stack}>
        {cards.map((card) => (
          <Param key={card.name} name={card.name}>
            <ParameterCard name={card.name} value={card.value} effect={card.effect} valueStyle={card.valueStyle} />
          </Param>
        ))}
        <Param name="Políticas">
          <ParameterCard
            name="Políticas"
            value={`Reembolso ${yesNo(row.refundable)}`}
            effect="Reventa, transferencia, reembolso y cupo apartable."
            closedNote={`Reventa ${yesNo(row.allowResale)} · Transferencia ${yesNo(row.transferAllowed)} · Reembolso ${yesNo(row.refundable)} · No transferible ${yesNo(row.nonTransferable)} · Cupo apartable ${holdable == null ? 'Sin tope' : formatCount(holdable)}`}
            advanced={
              <p className={styles.quiet}>
                Género {readString(row.genre) ?? '—'} · Clasificación {readString(row.rating) ?? '—'} · Tipo{' '}
                {readString(meta.eventKind) ?? '—'}
              </p>
            }
          />
        </Param>
      </div>
    </section>
  );
}
