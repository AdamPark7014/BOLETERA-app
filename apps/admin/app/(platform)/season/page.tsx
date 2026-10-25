'use client';

import { Suspense, useEffect, useState } from 'react';
import { ParameterCard, formatTicketAmount } from '@boletera/ui';
import { adminApi } from '@/lib/api';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { asRecord, formatCount, formatWhen, readNumber, readString, yesNo } from '../events/_ticket/read';

const SEE = ['ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER'];

type Pass = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  seasonLabel: string | null;
  startsAt: string | null;
  endsAt: string | null;
  price: number | null;
  currency: string | null;
  maxQuantity: number | null;
  soldQuantity: number | null;
  benefits: string | null;
  active: boolean;
  events: string[];
};

function text(value: string | null): string {
  return value ?? '—';
}

function benefitsLabel(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function readPass(raw: unknown): Pass | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const name = readString(row.name);
  if (!id || !name) return null;
  const events = Array.isArray(row.events)
    ? row.events.flatMap((item) => {
        const title = readString(asRecord(asRecord(item).event).title);
        return title ? [title] : [];
      })
    : [];
  return {
    id,
    name,
    slug: readString(row.slug),
    description: readString(row.description),
    seasonLabel: readString(row.seasonLabel),
    startsAt: readString(row.startsAt),
    endsAt: readString(row.endsAt),
    price: readNumber(row.price),
    currency: readString(row.currency),
    maxQuantity: readNumber(row.maxQuantity),
    soldQuantity: readNumber(row.soldQuantity),
    benefits: benefitsLabel(row.benefits),
    active: row.active !== false,
    events,
  };
}

function money(value: number | null, currency: string | null): string {
  if (value == null) return '—';
  if (currency && currency !== 'MXN') {
    return `${value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
  return formatTicketAmount(value);
}

export default function SeasonPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <AbonosBody />
      </AdminFrame>
    </Suspense>
  );
}

function AbonosBody() {
  const session = useSession();
  const [passes, setPasses] = useState<Pass[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const role = session.role;
  const canSee = role === 'SUPER_ADMIN' || (role != null && SEE.includes(role));

  useEffect(() => {
    if (!token || !session.orgId || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setError(null);
    adminApi<unknown>(`/season/org/${session.orgId}`, token)
      .then((payload) => {
        if (!alive) return;
        const list = Array.isArray(payload) ? payload : [];
        const next = list.flatMap((item) => {
          const pass = readPass(item);
          return pass ? [pass] : [];
        });
        setPasses(next);
        setOpenId((current) => (current && next.some((item) => item.id === current) ? current : (next[0]?.id ?? null)));
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
  }, [token, session.orgId, canSee, session.status, nonce]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Abonos</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return <ApiErrorView error={error} context="abrir abonos" onRetry={() => setNonce((current) => current + 1)} />;
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando abonos.</p>;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Abonos</h1>
        <p className={styles.quiet}>Los que ya existen. Esta ruta no los modifica ni da de alta otro.</p>
      </header>
      {passes.length === 0 ? <p className={styles.quiet}>No hay abonos.</p> : null}
      <div className={styles.stack}>
        {passes.map((pass) => {
          const open = openId === pass.id;
          return (
            <div key={pass.id} className={styles.stack}>
              <button
                type="button"
                className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : pass.id)}
              >
                <span>{pass.name}</span>
                <span className={styles.figure}>{money(pass.price, pass.currency)}</span>
              </button>
              {open ? (
                <div className={styles.stack}>
                  <Card name="Nombre del abono" value={pass.name} effect="Nombre guardado." />
                  <Card name="Slug del abono" value={text(pass.slug)} mono effect="Único en la organización." />
                  <Card name="Descripción del abono" value={text(pass.description)} effect="Texto corto." />
                  <Card name="Temporada" value={text(pass.seasonLabel)} effect="Etiqueta de la temporada." />
                  <Card name="Abono desde" value={formatWhen(pass.startsAt)} effect="Inicio." />
                  <Card name="Abono hasta" value={formatWhen(pass.endsAt)} effect="Fin." />
                  <Card name="Precio del abono" value={money(pass.price, pass.currency)} tabular effect="Precio guardado." />
                  <Card name="Moneda del abono" value={text(pass.currency)} effect="Moneda del abono." />
                  <Card name="Cupo del abono" value={formatCount(pass.maxQuantity)} tabular effect="Cupo guardado." />
                  <Card name="Abonos vendidos" value={formatCount(pass.soldQuantity)} tabular effect="Los cuenta el servicio." />
                  <Card name="Beneficios" value={text(pass.benefits)} effect="JSON guardado. Esta ruta no lo edita." />
                  <Card name="Abono activo" value={yesNo(pass.active)} effect="Esta ruta no lo cambia." />
                  <Card
                    name="Eventos del abono"
                    value={pass.events.length ? pass.events.join(' · ') : 'Ninguno'}
                    effect="Funciones incluidas."
                  />
                  <Card
                    name="Sección del asiento"
                    value="—"
                    effect="El listado no trae la sección. Se pide al comprar."
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Card({
  name,
  value,
  effect,
  mono,
  tabular,
}: {
  name: string;
  value: string;
  effect: string;
  mono?: boolean;
  tabular?: boolean;
}) {
  return (
    <Param name={name}>
      <ParameterCard
        name={name}
        value={value}
        valueStyle={mono ? 'mono' : tabular ? 'tabular' : 'text'}
        effect={effect}
      />
    </Param>
  );
}
