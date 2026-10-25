'use client';

import { useEffect, useState } from 'react';
import { ParameterCard, TicketButton, formatTicketAmount } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { Param } from './controls';
import styles from './frame.module.scss';
import { asRecord, formatCount, formatWhen, readNumber, readString } from './read';

type SectionRow = {
  zone: string;
  seats: number;
  total: number;
  currency: string | null;
};

type DisclosureView = {
  published: boolean;
  publishedAt: string | null;
  hash: string | null;
  capacity: number | null;
  sections: SectionRow[];
  message: string | null;
};

function money(amount: number, currency: string | null): string {
  if (currency && currency !== 'MXN') {
    return `${amount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
  return formatTicketAmount(amount);
}

function readSections(raw: unknown): SectionRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const row = asRecord(item);
    const zone = readString(row.zone);
    const seats = readNumber(row.seats);
    const total = readNumber(row.totalPrice);
    if (!zone || seats == null || total == null) return [];
    return [{ zone, seats, total, currency: readString(row.currency) }];
  });
}

function readPreview(payload: unknown): { capacity: number | null; sections: SectionRow[] } {
  const row = asRecord(payload);
  return { capacity: readNumber(row.capacity), sections: readSections(row.sections) };
}

function readPublished(payload: unknown): DisclosureView {
  const row = asRecord(payload);
  if (row.published === false) {
    return {
      published: false,
      publishedAt: null,
      hash: null,
      capacity: null,
      sections: [],
      message: readString(row.message),
    };
  }
  return {
    published: row.published === true || Boolean(readString(row.contentHash)),
    publishedAt: readString(row.publishedAt),
    hash: readString(row.contentHash),
    capacity: readNumber(row.capacity),
    sections: readSections(row.sections),
    message: null,
  };
}

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  return 'No se guardó. Revisa la conexión.';
}

export function ComplianceSection({
  eventId,
  token,
  canPublish,
}: {
  eventId: string;
  token: string;
  canPublish: boolean;
}) {
  const [previewCapacity, setPreviewCapacity] = useState<number | null>(null);
  const [previewSections, setPreviewSections] = useState<SectionRow[]>([]);
  const [published, setPublished] = useState<DisclosureView | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      adminApi<unknown>(`/events/manage/${eventId}/disclosure/preview`, token),
      adminApi<unknown>(`/events/manage/${eventId}/disclosure/compliance`, token),
      adminApi<unknown>(`/events/${eventId}/disclosure`, token),
    ])
      .then(([preview, compliance, disclosure]) => {
        if (!alive) return;
        const nextPreview = readPreview(preview);
        const check = asRecord(compliance);
        setPreviewCapacity(nextPreview.capacity);
        setPreviewSections(nextPreview.sections);
        setVerdict(readString(check.message));
        setPublished(readPublished(disclosure));
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [eventId, token, nonce]);

  async function publish() {
    if (!canPublish || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = asRecord(
        await adminApi<unknown>(`/events/manage/${eventId}/disclosure`, token, {
          method: 'POST',
          body: '{}',
        }),
      );
      const capacity = readNumber(result.capacity);
      setNotice(
        capacity == null
          ? 'Divulgación publicada. Republicar crea otra fila.'
          : `Divulgación publicada · aforo ${formatCount(capacity)}`,
      );
      setNonce((current) => current + 1);
    } catch (cause) {
      setActionError(failMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  if (error instanceof ApiError && error.isForbidden) {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Cumplimiento</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Cumplimiento</h1>
          <p className={styles.danger} role="alert">
            {failMessage(error)}
          </p>
        </header>
        <TicketButton variant="secondary" onClick={() => setNonce((current) => current + 1)}>
          Reintentar
        </TicketButton>
      </section>
    );
  }
  if (loading || !published) return <p className={styles.quiet}>Cargando cumplimiento.</p>;

  const capacity = published.published ? published.capacity : previewCapacity;
  const sections = published.published && published.sections.length > 0 ? published.sections : previewSections;
  const capacityEffect = published.published
    ? previewCapacity != null && previewCapacity !== published.capacity
      ? `El vivo ahora es ${formatCount(previewCapacity)}. Republicar crea otra fila. No se teclea.`
      : 'Quedó asentado al publicar. Republicar crea otra fila. No se teclea.'
    : 'Lo calcula el servicio al publicar. No se teclea.';

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Cumplimiento</h1>
        <p className={styles.quiet}>
          Divulgación para aforos de más de 20,000, al menos 24 h antes de la venta.
        </p>
        {verdict ? <p className={styles.tertiary}>{verdict}</p> : null}
        {published.message && !published.published ? (
          <p className={styles.tertiary}>{published.message}</p>
        ) : null}
      </header>
      <div className={styles.stack}>
        <Param name="Aforo divulgado">
          <ParameterCard
            name="Aforo divulgado"
            value={formatCount(capacity)}
            valueStyle="tabular"
            effect={capacityEffect}
          />
        </Param>
        <Param name="Payload">
          <ParameterCard
            name="Payload"
            value={published.published ? `${formatCount(sections.length)} secciones` : 'Sin publicar'}
            valueStyle="tabular"
            effect="Lo que se sirvió. Inmutable."
          />
        </Param>
        <Param name="Hash">
          <ParameterCard
            name="Hash"
            value={published.hash ?? 'Sin publicar'}
            valueStyle="mono"
            effect="SHA-256 del payload. No se edita."
          />
        </Param>
        <Param name="Quién publicó">
          <ParameterCard
            name="Quién publicó"
            value="—"
            effect={
              published.publishedAt
                ? `Esta lectura no trae el nombre. Publicada ${formatWhen(published.publishedAt)}.`
                : 'Esta lectura no trae el nombre de quien publicó.'
            }
          />
        </Param>
        {sections.map((section) => (
          <Param key={section.zone} name={section.zone}>
            <ParameterCard
              name={section.zone}
              value={money(section.total, section.currency)}
              valueStyle="tabular"
              effect={`${formatCount(section.seats)} butacas en lo que se divulga.`}
            />
          </Param>
        ))}
      </div>
      {actionError ? (
        <p className={styles.danger} role="alert">
          {actionError}
        </p>
      ) : null}
      {canPublish ? (
        <div className={styles.saveBar}>
          <p className={styles.quiet} aria-live="polite">
            {notice ?? 'Republicar crea otra fila.'}
          </p>
          <TicketButton disabled={busy} onClick={() => void publish()}>
            Publicar divulgación
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}
