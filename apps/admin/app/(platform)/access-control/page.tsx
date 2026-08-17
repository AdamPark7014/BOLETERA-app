'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  AreaChart,
  Badge,
  Button,
  DataTable,
  DonutChart,
  EmptyState,
  formatNumber,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  StatusDot,
  Tabs,
  type DataTableColumn,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import {
  useAccessMetrics,
  useMetricsAlerts,
  useMetricsTimeseries,
} from '@/lib/queries/metrics';
import { useTeam } from '@/lib/queries/organization';
import { useSession } from '@/lib/use-session';
import {
  accessIncidents,
  alertTone,
  buildDevices,
  buildDoors,
  buildEffectivePolicies,
  checkInSeries,
  privilegeSlices,
  type AccessTab,
  type DeviceRow,
  type DoorRow,
  type EffectivePolicy,
} from './_lib/access';
import { formatCount, formatPercentPoints } from './_lib/format';
import { ACCESS_RANGE_OPTIONS, buildAccessRange, type AccessRangeKey } from './_lib/range';
import styles from './access.module.scss';

export default function AccessControlPage() {
  const { organizationId } = useSession();
  const [rangeKey, setRangeKey] = useState<AccessRangeKey>('today');
  const [tab, setTab] = useState<AccessTab>('doors');

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
  const timeseriesQ = useMetricsTimeseries({
    ...metricsParams,
    granularity: range.granularity,
    metric: 'checkins',
  });
  const alertsQ = useMetricsAlerts(metricsParams);
  const teamQ = useTeam(organizationId);

  const team = teamQ.data ?? [];
  const access = accessQ.data;
  const doorSource = access?.trafficByAccessPoint.rows ?? [];
  const doorTotal = access?.trafficByAccessPoint.total ?? 0;

  const doors = useMemo(() => buildDoors(doorSource, doorTotal), [doorSource, doorTotal]);
  const devices = useMemo(() => buildDevices(doorSource, doorTotal), [doorSource, doorTotal]);
  const policies = useMemo(() => buildEffectivePolicies(team), [team]);
  const slices = useMemo(() => privilegeSlices(team), [team]);
  const incidents = useMemo(
    () => accessIncidents(alertsQ.data?.alerts ?? []),
    [alertsQ.data?.alerts],
  );

  const arrivalPoints = useMemo(() => {
    const fromTs = timeseriesQ.data?.series?.[0]?.points;
    if (fromTs?.length) return fromTs;
    return access?.checkInByHour.points ?? [];
  }, [access?.checkInByHour.points, timeseriesQ.data?.series]);

  const throughputSeries = useMemo(
    () => checkInSeries(arrivalPoints, range.granularity),
    [arrivalPoints, range.granularity],
  );

  const scannerOps = team.filter((m) => m.active && m.role === 'SCANNER').length;
  const adminOps = team.filter((m) => m.active && m.role === 'ADMIN').length;
  const attendanceRate =
    access && access.ticketsSold > 0
      ? (access.ticketsCheckedIn / access.ticketsSold) * 100
      : null;

  const doorColumns = useMemo<DataTableColumn<DoorRow>[]>(
    () => [
      {
        key: 'label',
        header: 'Puerta / zona',
        width: 220,
        sortValue: (row) => row.label,
        render: (row) => (
          <div>
            <strong>{row.label}</strong>
            <div className={styles.muted}>{row.zoneHint}</div>
          </div>
        ),
      },
      {
        key: 'checkIns',
        header: 'Check-ins',
        width: 120,
        align: 'right',
        sortValue: (row) => row.checkIns,
        render: (row) => formatCount(row.checkIns),
      },
      {
        key: 'share',
        header: 'Participación',
        width: 160,
        sortValue: (row) => row.share,
        render: (row) => (
          <div className={styles.stack} style={{ gap: '0.35rem' }}>
            <span>{formatPercentPoints(row.share)}</span>
            <div className={styles.barTrack} aria-hidden="true">
              <div className={styles.barFill} style={{ width: `${Math.min(100, row.share)}%` }} />
            </div>
          </div>
        ),
      },
    ],
    [],
  );

  const deviceColumns = useMemo<DataTableColumn<DeviceRow>[]>(
    () => [
      {
        key: 'label',
        header: 'Dispositivo / punto',
        width: 220,
        sortValue: (row) => row.label,
        render: (row) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <StatusDot tone={row.tone} pulse={row.share >= 15} label={row.label} />
          </div>
        ),
      },
      {
        key: 'statusLabel',
        header: 'Estado',
        width: 130,
        sortValue: (row) => row.statusLabel,
        render: (row) => (
          <Badge tone={row.tone} variant="soft" size="sm" dot>
            {row.statusLabel}
          </Badge>
        ),
      },
      {
        key: 'checkIns',
        header: 'Tráfico',
        width: 110,
        align: 'right',
        sortValue: (row) => row.checkIns,
        render: (row) => formatCount(row.checkIns),
      },
      {
        key: 'share',
        header: 'Share',
        width: 100,
        align: 'right',
        sortValue: (row) => row.share,
        render: (row) => formatPercentPoints(row.share),
      },
    ],
    [],
  );

  const policyColumns = useMemo<DataTableColumn<EffectivePolicy>[]>(
    () => [
      {
        key: 'name',
        header: 'Política efectiva',
        width: 220,
        sortValue: (row) => row.name,
        render: (row) => (
          <div>
            <strong>{row.name}</strong>
            <div className={styles.muted}>{row.description}</div>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Estado',
        width: 140,
        sortValue: (row) => row.status,
        render: (row) => (
          <Badge tone={row.tone} variant="soft" size="sm" dot>
            {row.status}
          </Badge>
        ),
      },
      {
        key: 'assigned',
        header: 'Asignados',
        width: 110,
        align: 'right',
        sortValue: (row) => row.assigned,
        render: (row) => formatCount(row.assigned),
      },
      {
        key: 'permissions',
        header: 'Permisos',
        render: (row) => (
          <ul className={styles.permList}>
            {row.permissions.map((perm) => (
              <li key={perm}>
                <Badge tone="neutral" variant="outline" size="sm">
                  {perm}
                </Badge>
              </li>
            ))}
          </ul>
        ),
      },
    ],
    [],
  );

  const loading = accessQ.isPending;
  const error = accessQ.error ?? teamQ.error;

  if (!organizationId) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Sin organización"
          description="Inicia sesión con una cuenta vinculada a una organización."
          illustration="inbox"
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Operaciones · Accesos"
        title="Access Control"
        description="Puertas, zonas, políticas efectivas, dispositivos, throughput e incidentes de acceso."
        actions={
          <Link href="/scanner" className={styles.scannerLink}>
            <Button type="button" variant="secondary">
              Abrir scanner
            </Button>
          </Link>
        }
      >
        <div className={styles.toolbar}>
          <SegmentedControl
            label="Rango de acceso"
            value={rangeKey}
            onValueChange={setRangeKey}
            options={ACCESS_RANGE_OPTIONS.map((key) => ({
              value: key,
              label: buildAccessRange(key).label,
            }))}
          />
          <span className={styles.muted}>
            {range.label} · datos de métricas y equipo
          </span>
        </div>
      </PageHeader>

      <Section columns={4} gap="sm" aria-label="Indicadores de acceso">
        <KpiCard
          label="Check-ins"
          value={formatCount(access?.ticketsCheckedIn ?? 0)}
          loading={loading}
          hint={`${formatCount(access?.ticketsSold ?? 0)} vendidos`}
          tone="accent"
          trend={arrivalPoints.slice(-12).map((p) => p.value)}
        />
        <KpiCard
          label="No-show"
          value={access ? formatPercentPoints(access.noShowRate) : '—'}
          loading={loading}
          hint={`${formatCount(access?.ticketsNoShow ?? 0)} boletos`}
          tone={(access?.noShowRate ?? 0) >= 30 ? 'danger' : (access?.noShowRate ?? 0) >= 15 ? 'warning' : 'success'}
        />
        <KpiCard
          label="Puertas activas"
          value={formatCount(doors.length)}
          loading={loading}
          hint={`${formatCount(doorTotal)} check-ins en puntos`}
          tone="info"
        />
        <KpiCard
          label="Incidentes"
          value={formatCount(incidents.length)}
          loading={alertsQ.isPending}
          hint="Alertas dominio access"
          tone={incidents.length > 0 ? 'warning' : 'neutral'}
        />
      </Section>

      <Tabs
        label="Secciones de access control"
        value={tab}
        onValueChange={(id) => {
          if (
            id === 'doors' ||
            id === 'policies' ||
            id === 'devices' ||
            id === 'throughput' ||
            id === 'incidents'
          ) {
            setTab(id);
          }
        }}
        items={[
          { id: 'doors', label: 'Puertas / zonas', badge: formatCount(doors.length) },
          { id: 'policies', label: 'Políticas', badge: formatCount(policies.filter((p) => p.assigned > 0).length) },
          { id: 'devices', label: 'Dispositivos', badge: formatCount(devices.length) },
          { id: 'throughput', label: 'Throughput' },
          { id: 'incidents', label: 'Incidentes', badge: formatCount(incidents.length) },
        ]}
      />

      {error ? (
        <QueryError
          error={error}
          onRetry={() => {
            void accessQ.refetch();
            void timeseriesQ.refetch();
            void alertsQ.refetch();
            void teamQ.refetch();
          }}
        />
      ) : null}

      {!error && tab === 'doors' ? (
        <div className={styles.layout}>
          <div className={styles.stack}>
            {doors.length === 0 && !loading ? (
              <div className={styles.card}>
                <EmptyState
                  title="Sin tráfico por puerta"
                  description="Cuando haya escaneos con punto de acceso, aparecerán aquí como puertas y zonas."
                  illustration="inbox"
                  action={
                    <Link href="/scanner">
                      <Button type="button">Ir al scanner</Button>
                    </Link>
                  }
                />
              </div>
            ) : (
              <DataTable
                label="Puertas y zonas"
                columns={doorColumns}
                data={doors}
                rowKey={(row) => row.id}
                loading={loading && doors.length === 0}
                maxHeight={440}
              />
            )}
          </div>
          <aside className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Cobertura operativa</h2>
                <p>Operadores con rol de acceso.</p>
              </div>
            </div>
            <ul className={styles.sideList}>
              <li className={styles.sideRow}>
                <span>Scanner</span>
                <strong>{formatCount(scannerOps)}</strong>
              </li>
              <li className={styles.sideRow}>
                <span>Admins</span>
                <strong>{formatCount(adminOps)}</strong>
              </li>
              <li className={styles.sideRow}>
                <span>Asistencia</span>
                <strong>
                  {attendanceRate === null ? '—' : formatPercentPoints(attendanceRate)}
                </strong>
              </li>
            </ul>
          </aside>
        </div>
      ) : null}

      {!error && tab === 'policies' ? (
        <div className={styles.layout}>
          <div className={styles.stack}>
            <DataTable
              label="Políticas efectivas por rol"
              columns={policyColumns}
              data={policies}
              rowKey={(row) => row.id}
              loading={teamQ.isPending && policies.length === 0}
              maxHeight={480}
            />
            <p className={styles.muted}>
              Políticas derivadas de asignaciones reales del equipo (
              {formatNumber(team.filter((m) => m.active).length)} activos). No son plantillas
              ficticias.
            </p>
          </div>
          <aside className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Privilegio efectivo</h2>
                <p>Distribución de roles activos.</p>
              </div>
            </div>
            {slices.length === 0 ? (
              <EmptyState
                title="Sin privilegios asignados"
                description="Invita personal en Staff para materializar políticas."
                illustration="inbox"
                size="sm"
              />
            ) : (
              <DonutChart
                label="Roles activos"
                slices={slices}
                centerLabel="Activos"
                height={220}
              />
            )}
          </aside>
        </div>
      ) : null}

      {!error && tab === 'devices' ? (
        <div className={styles.stack}>
          {devices.length === 0 && !loading ? (
            <div className={styles.card}>
              <EmptyState
                title="Sin dispositivos reportando"
                description="Los puntos de acceso con tráfico alimentan el inventario de dispositivos."
                illustration="inbox"
                action={
                  <Link href="/scanner">
                    <Button type="button" variant="secondary">
                      Abrir scanner
                    </Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <DataTable
              label="Dispositivos y puntos de acceso"
              columns={deviceColumns}
              data={devices}
              rowKey={(row) => row.id}
              loading={loading && devices.length === 0}
              maxHeight={480}
            />
          )}
        </div>
      ) : null}

      {!error && tab === 'throughput' ? (
        <div className={styles.layout}>
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Throughput de check-ins</h2>
                <p>Curva de llegadas en el rango {range.label.toLowerCase()}.</p>
              </div>
              <Badge tone="accent" variant="outline" size="sm">
                {range.granularity === 'hour' ? 'Horaria' : 'Diaria'}
              </Badge>
            </div>
            {throughputSeries.length === 0 && !loading && !timeseriesQ.isPending ? (
              <EmptyState
                title="Sin throughput"
                description="No hay check-ins en este rango. Prueba ampliar el periodo o escanear en vivo."
                illustration="chart"
                size="sm"
              />
            ) : (
              <AreaChart
                label="Throughput de check-ins"
                series={throughputSeries}
                height={260}
                formatValue={formatCount}
                smooth
              />
            )}
          </div>
          <aside className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Resumen</h2>
                <p>Volumen del periodo.</p>
              </div>
            </div>
            <ul className={styles.sideList}>
              <li className={styles.sideRow}>
                <span>Vendidos</span>
                <strong>{formatCount(access?.ticketsSold ?? 0)}</strong>
              </li>
              <li className={styles.sideRow}>
                <span>Check-ins</span>
                <strong>{formatCount(access?.ticketsCheckedIn ?? 0)}</strong>
              </li>
              <li className={styles.sideRow}>
                <span>No-show</span>
                <strong>{formatCount(access?.ticketsNoShow ?? 0)}</strong>
              </li>
              <li className={styles.sideRow}>
                <span>Puntos con tráfico</span>
                <strong>{formatCount(doors.length)}</strong>
              </li>
            </ul>
          </aside>
        </div>
      ) : null}

      {!error && tab === 'incidents' ? (
        <div className={styles.layout}>
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Incidentes de acceso</h2>
                <p>Alertas del dominio access en el rango seleccionado.</p>
              </div>
              <Link href="/scanner">
                <Button type="button" size="sm" variant="secondary">
                  Resolver en scanner
                </Button>
              </Link>
            </div>
            {incidents.length === 0 ? (
              <EmptyState
                title="Sin incidentes de acceso"
                description="No hay alertas de acceso en este periodo."
                illustration="success"
                tone="success"
                size="sm"
              />
            ) : (
              <ul className={styles.incidentList}>
                {incidents.map((incident) => (
                  <li key={incident.id} className={styles.incidentRow}>
                    <div className={styles.incidentMeta}>
                      <h3 className={styles.incidentTitle}>{incident.title}</h3>
                      <Badge tone={alertTone(incident.severity)} variant="soft" size="sm">
                        {incident.severity}
                      </Badge>
                    </div>
                    <p className={styles.incidentHint}>{incident.explanation}</p>
                    {incident.suggestedAction ? (
                      <p className={styles.muted}>{incident.suggestedAction}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <aside className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Severidad</h2>
                <p>Conteo de alertas access.</p>
              </div>
            </div>
            <ul className={styles.sideList}>
              {(['critical', 'warning', 'info'] as const).map((severity) => (
                <li key={severity} className={styles.sideRow}>
                  <Badge tone={alertTone(severity)} variant="outline" size="sm">
                    {severity}
                  </Badge>
                  <strong>
                    {formatCount(incidents.filter((item) => item.severity === severity).length)}
                  </strong>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
