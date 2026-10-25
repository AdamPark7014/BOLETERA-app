'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ParameterCard, TicketButton } from '@boletera/ui';
import { useAccessMetrics } from '@/lib/queries/metrics';
import { useSession } from '@/lib/use-session';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param, Segment } from '../events/_ticket/controls';
import frame from '../events/_ticket/frame.module.scss';
import { formatCount, formatPercentPoints } from './_lib/format';
import { ACCESS_RANGE_OPTIONS, buildAccessRange, type AccessRangeKey } from './_lib/range';

const RANGE_OPTIONS = ACCESS_RANGE_OPTIONS.map((key) => ({
  value: key,
  label: buildAccessRange(key).label,
}));

export function PuertaPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <PuertaBody />
      </AdminFrame>
    </Suspense>
  );
}

function PuertaBody() {
  const router = useRouter();
  const { organizationId, status } = useSession();
  const [rangeKey, setRangeKey] = useState<AccessRangeKey>('today');
  const range = useMemo(() => buildAccessRange(rangeKey), [rangeKey]);
  const metricsParams = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      organizationId: organizationId ?? undefined,
    }),
    [organizationId, range.from, range.to],
  );
  const accessQ = useAccessMetrics(metricsParams);
  const rows = accessQ.data?.trafficByAccessPoint.rows ?? [];
  const access = accessQ.data;

  if (status !== 'loading' && !organizationId) {
    return (
      <section>
        <header className={frame.sectionHead}>
          <h1 className={frame.sectionTitle}>Puerta</h1>
          <p className={frame.quiet}>Inicia sesión con una cuenta de una organización.</p>
        </header>
      </section>
    );
  }

  return (
    <section>
      <header className={frame.sectionHead}>
        <h1 className={frame.sectionTitle}>Puerta</h1>
        <p className={frame.quiet}>Nombres que devolvió el acceso en este periodo.</p>
        <Segment
          label="Periodo"
          value={rangeKey}
          options={RANGE_OPTIONS}
          onChange={setRangeKey}
        />
      </header>

      {accessQ.error ? (
        <div className={frame.stack}>
          <p className={frame.danger}>No se leyeron las zonas.</p>
          <p className={frame.quiet}>
            {accessQ.error instanceof Error ? accessQ.error.message : 'Revisa la conexión.'}
          </p>
          <TicketButton variant="secondary" onClick={() => void accessQ.refetch()}>
            Reintentar
          </TicketButton>
        </div>
      ) : (
        <div className={frame.stack}>
          <Param name="Check-ins">
            <ParameterCard
              name="Check-ins"
              value={access ? formatCount(access.ticketsCheckedIn) : '—'}
              valueStyle="tabular"
              effect="Escaneos con éxito en el periodo."
            />
          </Param>
          <Param name="Vendidos">
            <ParameterCard
              name="Vendidos"
              value={access ? formatCount(access.ticketsSold) : '—'}
              valueStyle="tabular"
              effect="Boletos vendidos de la organización."
            />
          </Param>
          <Param name="No-show">
            <ParameterCard
              name="No-show"
              value={access ? formatPercentPoints(access.noShowRate) : '—'}
              valueStyle="tabular"
              effect="Vendidos que no entraron."
            />
          </Param>

          {accessQ.isPending && rows.length === 0 ? (
            <p className={frame.quiet}>Cargando.</p>
          ) : rows.length === 0 ? (
            <p className={frame.quiet}>No hay zonas de acceso.</p>
          ) : (
            <ul className={frame.rows} aria-label="Zonas de acceso">
              {rows.map((row) => (
                <li key={row.key} className={frame.row} data-param={row.label || row.key}>
                  <div className={frame.rowMain}>
                    <p className={frame.rowTitle}>{row.label || row.key}</p>
                    {row.percentOfTotal != null ? (
                      <p className={frame.rowMeta}>{formatPercentPoints(row.percentOfTotal)}</p>
                    ) : null}
                  </div>
                  <p className={frame.figure}>{formatCount(row.value)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={frame.saveBar}>
        <p className={frame.quiet}>{range.label}</p>
        <TicketButton variant="secondary" onClick={() => router.push('/scanner')}>
          Abrir escáner
        </TicketButton>
      </div>
    </section>
  );
}
