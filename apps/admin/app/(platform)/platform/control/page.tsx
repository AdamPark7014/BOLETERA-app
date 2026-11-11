'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Field } from '@boletera/ui';
import { ApiError } from '@/lib/api';
import {
  getPlatformSuperOverview,
  searchPlatformSuper,
  type PlatformSuperOverview,
  type PlatformSuperSearchEntityType,
  type PlatformSuperSearchResponse,
} from '@/lib/platform-api';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import styles from '../../events/_ticket/frame.module.scss';
import { formatCount } from '../../events/_ticket/read';

const QUICK_LINKS = [
  {
    href: '/platform/health',
    title: 'Salud',
    desc: 'Reconciliación de órdenes, pagos, boletos e inventario',
  },
  {
    href: '/audit',
    title: 'Auditoría',
    desc: 'Bitácora entre organizaciones y acciones sensibles',
  },
  { href: '/fraud', title: 'Fraude', desc: 'Casos y órdenes sospechosas' },
  { href: '/orders', title: 'Órdenes', desc: 'Soporte y folios recientes' },
  { href: '/orders/refunds', title: 'Reembolsos', desc: 'Solicitudes y pendientes' },
  { href: '/reports', title: 'Reportes', desc: 'Ventas y operación' },
  { href: '/payouts', title: 'Liquidaciones', desc: 'Pagos a organizadores' },
] as const;

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Superadministrador',
  ADMIN: 'Administrador',
  PROMOTER: 'Promotor',
  ORGANIZER: 'Organizador',
  VENUE_MANAGER: 'Gerente de recinto',
  BOX_OFFICE: 'Taquilla',
  CUSTOMER: 'Comprador',
  FINANCE: 'Finanzas',
  TAQUILLA: 'Taquilla',
  TAQUILLA_SUPERVISOR: 'Supervisor de taquilla',
  AFFILIATE: 'Afiliado',
  SCANNER: 'Acceso',
};

function entityHref(
  type: PlatformSuperSearchEntityType,
  id: string,
  meta?: Record<string, string>
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
    default:
      return null;
  }
}

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  if (cause instanceof Error) return cause.message;
  return 'No se pudo buscar. Revisa la conexión.';
}

export default function PlatformControlPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <ControlBody />
      </AdminFrame>
    </Suspense>
  );
}

function ControlBody() {
  const session = useSession();
  const token = session.token;
  const isSuper = session.role === 'SUPER_ADMIN';
  const [data, setData] = useState<PlatformSuperOverview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<PlatformSuperSearchResponse | null>(null);
  const [orgsOpen, setOrgsOpen] = useState(false);

  useEffect(() => {
    if (!token || !isSuper) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setError(null);
    getPlatformSuperOverview(token)
      .then((overview) => {
        if (alive) setData(overview);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, isSuper, session.status, nonce]);

  const runSearch = useCallback(
    async (q: string) => {
      if (!token || !isSuper) return;
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setSearchResult(null);
        setSearchError(null);
        return;
      }
      setSearching(true);
      setSearchError(null);
      try {
        setSearchResult(await searchPlatformSuper(token, trimmed));
      } catch (cause) {
        setSearchResult(null);
        setSearchError(failMessage(cause));
      } finally {
        setSearching(false);
      }
    },
    [token, isSuper]
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void runSearch(query);
    }, 320);
    return () => window.clearTimeout(handle);
  }, [query, runSearch]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!isSuper && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Control</h1>
          <p className={styles.quiet}>
            Esta consola la abre solo el superadministrador de plataforma.
          </p>
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir control"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (loading || !token) return <p className={styles.quiet}>Cargando control.</p>;

  const figures: { label: string; value: number }[] = data
    ? [
        { label: 'Órdenes hoy', value: data.health.ordersToday },
        { label: 'Pagos fallidos', value: data.health.failedPayments },
        { label: 'Reembolsos pendientes', value: data.health.pendingRefunds },
        { label: 'Organizaciones', value: data.totals.organizations },
        { label: 'Usuarios', value: data.totals.users },
        { label: 'Eventos', value: data.totals.events },
        { label: 'Órdenes', value: data.totals.orders },
        { label: 'Recintos', value: data.totals.venues },
      ]
    : [];

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Control</h1>
        <p className={styles.quiet}>
          Toda la plataforma: búsqueda entre organizaciones, cifras y accesos. Solo lectura.
        </p>
      </header>

      <div className={styles.stack}>
        <Field
          label="Buscar en toda la plataforma"
          kind="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Correo, folio, código de boleto, slug, nombre"
          autoComplete="off"
          spellCheck={false}
          hint="Usuarios, clientes, eventos, órdenes, boletos, recintos, organizaciones y promotores. Mínimo 2 letras."
        />
        {searching ? <p className={styles.tertiary}>Buscando.</p> : null}
        {searchError ? (
          <p className={styles.danger} role="alert">
            {searchError}
          </p>
        ) : null}
        {searchResult && searchResult.totalCount === 0 ? (
          <p className={styles.quiet}>Nada para «{searchResult.query}».</p>
        ) : null}
        {searchResult && searchResult.totalCount > 0 ? (
          <>
            <p className={styles.tertiary}>
              {formatCount(searchResult.totalCount)} coincidencia
              {searchResult.totalCount === 1 ? '' : 's'} · hasta {searchResult.limit} por tipo
            </p>
            {searchResult.groups.map((group) => (
              <div key={group.entityType}>
                <div className={styles.row}>
                  <p className={styles.rowTitle}>{group.label}</p>
                  <span />
                  <p className={styles.figure}>
                    {formatCount(group.items.length)}/{formatCount(group.total)}
                  </p>
                </div>
                <ul className={styles.rows}>
                  {group.items.map((item) => {
                    const href = entityHref(group.entityType, item.id, item.meta);
                    const body = (
                      <div className={styles.rowMain}>
                        <p className={styles.rowTitle}>{item.title}</p>
                        {item.subtitle ? <p className={styles.rowMeta}>{item.subtitle}</p> : null}
                      </div>
                    );
                    return (
                      <li key={`${group.entityType}-${item.id}`} className={styles.row}>
                        {href ? (
                          <Link href={href} style={{ color: 'inherit', textDecoration: 'none' }}>
                            {body}
                          </Link>
                        ) : (
                          body
                        )}
                        <span />
                        {href ? <span className={styles.tertiary}>Abrir</span> : <span />}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </>
        ) : null}
      </div>

      {data ? (
        <>
          <header className={styles.sectionHead} style={{ marginTop: 24 }}>
            <p className={styles.rowTitle}>Cifras</p>
          </header>
          <div className={styles.rows}>
            {figures.map((item) => (
              <div key={item.label} className={styles.row}>
                <p className={styles.rowTitle}>{item.label}</p>
                <span />
                <p className={styles.figure}>{formatCount(item.value)}</p>
              </div>
            ))}
          </div>

          <header className={styles.sectionHead} style={{ marginTop: 24 }}>
            <p className={styles.rowTitle}>Accesos</p>
          </header>
          <ul className={styles.rows}>
            {QUICK_LINKS.map((link) => (
              <li key={link.href} className={styles.row}>
                <Link
                  href={link.href}
                  className={styles.rowMain}
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  <p className={styles.rowTitle}>{link.title}</p>
                  <p className={styles.rowMeta}>{link.desc}</p>
                </Link>
                <span />
                <span className={styles.tertiary}>Abrir</span>
              </li>
            ))}
          </ul>

          <header className={styles.sectionHead} style={{ marginTop: 24 }}>
            <p className={styles.rowTitle}>Usuarios por rol</p>
          </header>
          {Object.keys(data.usersByRole).length === 0 ? (
            <p className={styles.quiet}>Sin usuarios.</p>
          ) : null}
          <div className={styles.rows}>
            {Object.entries(data.usersByRole).map(([role, count]) => (
              <div key={role} className={styles.row}>
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>{ROLE_LABEL[role] ?? role}</p>
                  <p className={styles.rowMeta}>
                    <span className={styles.mono}>{role}</span>
                  </p>
                </div>
                <span />
                <p className={styles.figure}>{formatCount(count)}</p>
              </div>
            ))}
          </div>

          <div className={styles.stack} style={{ marginTop: 24 }}>
            <button
              type="button"
              className={orgsOpen ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
              aria-expanded={orgsOpen}
              onClick={() => setOrgsOpen((current) => !current)}
            >
              <span>Organizaciones</span>
              <span className={styles.figure}>{formatCount(data.organizations.length)}</span>
            </button>
            {orgsOpen ? (
              data.organizations.length === 0 ? (
                <p className={styles.quiet}>Sin organizaciones.</p>
              ) : (
                <ul className={styles.rows} aria-label="Organizaciones en plataforma">
                  {data.organizations.map((org) => (
                    <li key={org.id} className={styles.row}>
                      <div className={styles.rowMain}>
                        <p className={styles.rowTitle}>{org.name}</p>
                        <p className={styles.rowMeta}>
                          <span className={styles.mono}>{org.slug}</span> ·{' '}
                          {org.verified ? 'Verificada' : 'Sin verificar'}
                        </p>
                      </div>
                      <p className={styles.rowMeta}>
                        {formatCount(org.users)} usuarios · {formatCount(org.events)} eventos
                      </p>
                      <p className={styles.figure}>{formatCount(org.venues)} recintos</p>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
