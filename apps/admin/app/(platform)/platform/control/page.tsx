'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader, DataTable } from '@boletera/ui';
import {
  getPlatformSuperOverview,
  searchPlatformSuper,
  type PlatformSuperOverview,
  type PlatformSuperSearchEntityType,
  type PlatformSuperSearchResponse,
} from '@/lib/platform-api';
import { useSession } from '@/lib/use-session';
import platform from '../../_styles/platform.module.scss';
import styles from './control.module.scss';

const QUICK_LINKS = [
  { href: '/platform/health', title: 'Salud operativa', desc: 'Reconciliación órdenes, pagos, boletos e inventario' },
  { href: '/audit', title: 'Auditoría', desc: 'Bitácora cross-tenant y acciones sensibles' },
  { href: '/fraud', title: 'Antifraude', desc: 'Flags y órdenes sospechosas' },
  { href: '/orders', title: 'Órdenes', desc: 'Soporte y folios recientes' },
  { href: '/orders/refunds', title: 'Reembolsos', desc: 'Solicitudes y pendientes' },
  { href: '/reports', title: 'Reportes', desc: 'Ventas y operación' },
  { href: '/payouts', title: 'Liquidaciones', desc: 'Pagos a organizadores' },
] as const;

function entityHref(
  type: PlatformSuperSearchEntityType,
  id: string,
  meta?: Record<string, string>,
): string | null {
  switch (type) {
    case 'event':
      return `/events/${id}`;
    case 'order':
      return `/orders/${id}`;
    case 'venue':
      return `/venues/${id}/map`;
    case 'ticket':
      return meta?.eventId ? `/events/${meta.eventId}` : null;
    case 'organization':
    case 'promoter':
      return null;
    case 'user':
    case 'customer':
      return null;
    default:
      return null;
  }
}

function kpiClass(value: number, kind: 'warn' | 'danger'): string {
  if (value <= 0) return platform.kpi;
  return `${platform.kpi} ${kind === 'danger' ? styles.kpiDanger : styles.kpiAlert}`;
}

export default function PlatformControlPage() {
  const { token, role } = useSession();
  const [data, setData] = useState<PlatformSuperOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<PlatformSuperSearchResponse | null>(null);

  useEffect(() => {
    if (!token || role !== 'SUPER_ADMIN') return;
    getPlatformSuperOverview(token)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Error al cargar'));
  }, [token, role]);

  const runSearch = useCallback(
    async (q: string) => {
      if (!token || role !== 'SUPER_ADMIN') return;
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setSearchResult(null);
        setSearchError(null);
        return;
      }
      setSearching(true);
      setSearchError(null);
      try {
        const result = await searchPlatformSuper(token, trimmed);
        setSearchResult(result);
      } catch (e) {
        setSearchResult(null);
        setSearchError(e instanceof Error ? e.message : 'Error en búsqueda');
      } finally {
        setSearching(false);
      }
    },
    [token, role],
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void runSearch(query);
    }, 320);
    return () => window.clearTimeout(handle);
  }, [query, runSearch]);

  if (role !== 'SUPER_ADMIN') {
    return (
      <div className={platform.panel}>
        <h2>Acceso restringido</h2>
        <p>Esta consola solo está disponible para superusuarios de plataforma.</p>
        <Link href="/dashboard">Volver al inicio</Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Control de plataforma"
        description="Centro de operaciones global: salud del sistema, búsqueda cross-tenant y accesos rápidos."
        actions={
          <Link href="/platform/health" className={platform.primaryBtn}>
            Salud operativa
          </Link>
        }
      />

      {error && <p role="alert">{error}</p>}

      <section className={`${platform.panel} ${styles.searchPanel}`}>
        <h2>Búsqueda global</h2>
        <p className={styles.searchMeta}>
          Usuarios, clientes, eventos, órdenes, boletos, venues, organizaciones y promotores.
        </p>
        <div className={styles.searchRow}>
          <input
            id="platform-search"
            className={styles.searchInput}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Correo, folio, código de boleto, slug, nombre…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Buscar en toda la plataforma"
          />
          {searching && <span className={styles.searchMeta}>Buscando…</span>}
        </div>
        {searchError && (
          <p role="alert" className={styles.searchMeta}>
            {searchError}
          </p>
        )}
        {searchResult && searchResult.totalCount === 0 && (
          <p className={styles.searchMeta}>Sin coincidencias para «{searchResult.query}».</p>
        )}
        {searchResult && searchResult.totalCount > 0 && (
          <div className={styles.searchGroups}>
            <p className={styles.searchMeta}>
              {searchResult.totalCount} coincidencia{searchResult.totalCount === 1 ? '' : 's'} · hasta{' '}
              {searchResult.limit} por tipo
            </p>
            {searchResult.groups.map((group) => (
              <div key={group.entityType} className={styles.searchGroup}>
                <div className={styles.searchGroupHead}>
                  <h3>{group.label}</h3>
                  <span>
                    {group.items.length}/{group.total}
                  </span>
                </div>
                <ul className={styles.resultList}>
                  {group.items.map((item) => {
                    const href = entityHref(group.entityType, item.id, item.meta);
                    const body = (
                      <>
                        <strong>{item.title}</strong>
                        {item.subtitle && <small>{item.subtitle}</small>}
                      </>
                    );
                    return (
                      <li key={`${group.entityType}-${item.id}`}>
                        {href ? (
                          <Link href={href} className={styles.resultItem}>
                            {body}
                          </Link>
                        ) : (
                          <div className={`${styles.resultItem} ${styles.resultStatic}`}>{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {data && (
        <>
          <div className={platform.kpiRow}>
            <div className={platform.kpi}>
              <span>Órdenes hoy</span>
              <strong>{data.health.ordersToday}</strong>
            </div>
            <div className={kpiClass(data.health.failedPayments, 'danger')}>
              <span>Pagos fallidos</span>
              <strong>{data.health.failedPayments}</strong>
            </div>
            <div className={kpiClass(data.health.pendingRefunds, 'warn')}>
              <span>Reembolsos pendientes</span>
              <strong>{data.health.pendingRefunds}</strong>
            </div>
            <div className={platform.kpi}>
              <span>Organizaciones</span>
              <strong>{data.totals.organizations}</strong>
            </div>
            <div className={platform.kpi}>
              <span>Usuarios</span>
              <strong>{data.totals.users}</strong>
            </div>
            <div className={platform.kpi}>
              <span>Eventos</span>
              <strong>{data.totals.events}</strong>
            </div>
            <div className={platform.kpi}>
              <span>Órdenes</span>
              <strong>{data.totals.orders}</strong>
            </div>
            <div className={platform.kpi}>
              <span>Venues</span>
              <strong>{data.totals.venues}</strong>
            </div>
          </div>

          <section className={platform.panel}>
            <h2>Accesos rápidos</h2>
            <div className={styles.quickLinks}>
              {QUICK_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className={styles.quickLink}>
                  <strong>{link.title}</strong>
                  <span>{link.desc}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className={platform.panel}>
            <h2>Usuarios por rol</h2>
            <div className={platform.chipGrid}>
              {Object.entries(data.usersByRole).map(([r, n]) => (
                <span key={r} className={platform.chipOn}>
                  {r}: {n}
                </span>
              ))}
            </div>
          </section>

          <section className={platform.panel}>
            <h2>Organizaciones</h2>
            <DataTable
              columns={[
                { key: 'name', header: 'Nombre', sortValue: (row) => row.name },
                { key: 'slug', header: 'Slug' },
                {
                  key: 'verified',
                  header: 'Verificada',
                  render: (row) => (row.verified ? 'Sí' : 'No'),
                },
                { key: 'users', header: 'Usuarios', align: 'right' },
                { key: 'events', header: 'Eventos', align: 'right' },
                { key: 'venues', header: 'Venues', align: 'right' },
              ]}
              data={data.organizations}
              rowKey={(row) => row.id}
              label="Organizaciones en plataforma"
              empty="Sin organizaciones"
            />
          </section>
        </>
      )}
    </div>
  );
}
