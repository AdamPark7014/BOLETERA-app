'use client';

/**
 * Cumplimiento de los lineamientos de PROFECO (DOF, 19 de febrero de 2026).
 *
 * El servicio y las rutas existían pero solo se podían usar con curl, que es
 * como no existir para quien tiene que cumplirlos. Esta pantalla resuelve dos
 * cosas concretas:
 *
 *  1. **Dice si el evento puede abrir la venta**, con el motivo y la fecha
 *     exacta a partir de la cual puede hacerlo. Enterarse de que faltan 24 h
 *     el día del onsale es tarde.
 *  2. **Enseña lo que se va a publicar ANTES de publicarlo.** Publicar arranca
 *     un reloj legal y deja constancia fechada: no puede ser un botón a ciegas.
 *
 * El botón de publicar no se ofrece si la previsualización tiene problemas —
 * publicar algo incompleto es peor que no publicar, porque deja registrado que
 * se sabía.
 */

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, EmptyState } from '@boletera/ui';
import { ApiError, adminApi, getStoredToken } from '@/lib/api';
import styles from './event-hub.module.scss';

type Section = {
  zone: string;
  seats: number;
  basePrice: number;
  serviceFee: number;
  taxes: number;
  totalPrice: number;
  currency: string;
};

type Preview = {
  capacity: number;
  sections: Section[];
  seatMap: { sections: string[] } | null;
  warnings: string[];
  terms: string;
  regime: { source: string; appliesAboveCapacity: number; applies: boolean; leadHours: number };
};

type Verdict = {
  compliant: boolean;
  applies: boolean;
  reason: string;
  message: string;
  publishedAt: string | null;
  earliestSaleAt: string | null;
};

const money = (value: number, currency: string) =>
  `$${value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

const fecha = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

export function CompliancePanel({ eventId, canWrite }: { eventId: string; canWrite: boolean }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = getStoredToken();
      if (!token) throw new ApiError(401, 'Sin sesión', null, '');
      const [p, v] = await Promise.all([
        adminApi<Preview>(`/events/manage/${eventId}/disclosure/preview`, token),
        adminApi<Verdict>(`/events/manage/${eventId}/disclosure/compliance`, token),
      ]);
      setPreview(p);
      setVerdict(v);
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : 'No se pudo leer el cumplimiento.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function publish() {
    setPublishing(true);
    setError(null);
    try {
      const token = getStoredToken();
      if (!token) throw new ApiError(401, 'Sin sesión', null, '');
      await adminApi(`/events/manage/${eventId}/disclosure`, token, { method: 'POST' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : 'No se pudo publicar la divulgación.');
    } finally {
      setPublishing(false);
    }
  }

  const panel = {
    className: styles.tabPanel,
    role: 'tabpanel' as const,
    id: 'hub-panel-compliance',
    'aria-labelledby': 'hub-tab-compliance',
  };

  if (loading) {
    return (
      <div {...panel}>
        <Card variant="outline" padding="md">
          <p>Comprobando cumplimiento…</p>
        </Card>
      </div>
    );
  }

  if (error && !preview) {
    return (
      <div {...panel}>
        <EmptyState title="No se pudo comprobar" description={error}>
          <Button onClick={() => void load()}>Reintentar</Button>
        </EmptyState>
      </div>
    );
  }

  // Un evento pequeño no está sujeto: decirlo explícitamente evita que alguien
  // «arregle» un incumplimiento que no existe.
  if (verdict && !verdict.applies) {
    return (
      <div {...panel}>
        <Card variant="outline" padding="md">
          <CardHeader
            title="No sujeto a los lineamientos"
            description={verdict.message}
          />
          <p className={styles.muted}>
            Los lineamientos de PROFECO publicados en el DOF el 19 de febrero de 2026 aplican a
            eventos de más de {preview?.regime.appliesAboveCapacity.toLocaleString('es-MX')}{' '}
            asistentes. Este evento declara {preview?.capacity.toLocaleString('es-MX')}.
          </p>
          <p className={styles.muted}>
            La transparencia de precio y las reglas de reembolso de la LFPC sí aplican, y el
            sistema ya las cumple.
          </p>
        </Card>
      </div>
    );
  }

  const bloqueante = verdict && !verdict.compliant;

  return (
    <div {...panel}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <Card variant="outline" padding="md">
        <CardHeader
          title="Divulgación previa a la venta"
          description={preview?.regime.source}
          actions={
            <Badge tone={bloqueante ? 'danger' : 'success'}>
              {bloqueante ? 'No cumple' : 'Cumple'}
            </Badge>
          }
        />

        <p className={bloqueante ? styles.warnText : styles.muted}>{verdict?.message}</p>

        <dl className={styles.metaGrid}>
          <div>
            <dt>Divulgado</dt>
            <dd>{fecha(verdict?.publishedAt ?? null)}</dd>
          </div>
          <div>
            <dt>La venta puede abrir desde</dt>
            <dd>{fecha(verdict?.earliestSaleAt ?? null)}</dd>
          </div>
          <div>
            <dt>Antelación exigida</dt>
            <dd>{preview?.regime.leadHours} h</dd>
          </div>
        </dl>

        {canWrite && (
          <div className={styles.panelActions}>
            <Button onClick={() => void publish()} loading={publishing}>
              {verdict?.publishedAt ? 'Volver a publicar' : 'Publicar divulgación'}
            </Button>
          </div>
        )}
        <p className={styles.muted}>
          Publicar arranca el reloj de {preview?.regime.leadHours} h y deja constancia fechada de
          lo divulgado. Cada publicación se guarda entera y no se puede alterar después.
        </p>
      </Card>

      {preview?.warnings?.length ? (
        <Card variant="outline" padding="md">
          <CardHeader
            title="Avisos"
            description="No impiden publicar, pero se publican junto con la divulgación."
          />
          <ul className={styles.warnList}>
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card variant="outline" padding="md">
        <CardHeader
          title="Lo que se publica"
          description="Precio TOTAL por sección, con cargos e IVA incluidos. Es lo que verá el comprador."
        />
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Sección</th>
                <th scope="col">Asientos</th>
                <th scope="col">Base</th>
                <th scope="col">Cargo</th>
                <th scope="col">IVA</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {preview?.sections.map((s) => (
                <tr key={s.zone}>
                  <th scope="row">{s.zone}</th>
                  <td>{s.seats.toLocaleString('es-MX')}</td>
                  <td className={styles.muted}>{money(s.basePrice, s.currency)}</td>
                  <td className={styles.muted}>{money(s.serviceFee, s.currency)}</td>
                  <td className={styles.muted}>{money(s.taxes, s.currency)}</td>
                  <td>
                    <strong>{money(s.totalPrice, s.currency)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
