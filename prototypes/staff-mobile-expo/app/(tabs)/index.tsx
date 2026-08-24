import { useEffect, useState } from 'react';

import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';

import { UserRole } from '@boletera/shared';

import { Screen } from '@/components/Screen';

import { useAuth } from '@/lib/auth-context';

import {

  getAdminDashboard,

  getPlatformOverview,

  getPromoterDashboard,

  type AdminDashboard,

  type PlatformOverview,

  type PromoterDashboard,

} from '@/lib/api';

import { roleLabel } from '@/lib/navigation';

import { colors, radii, spacing } from '@/lib/theme';



export default function HomeTab() {

  const { session, expiringSoon, timeLeftMs } = useAuth();

  const [loading, setLoading] = useState(true);

  const [promoter, setPromoter] = useState<PromoterDashboard | null>(null);

  const [admin, setAdmin] = useState<AdminDashboard | null>(null);

  const [platform, setPlatform] = useState<PlatformOverview | null>(null);



  useEffect(() => {

    if (!session?.token) return;

    const role = session.role;

    const token = session.token;

    const orgId = session.organizationId;



    async function load() {

      setLoading(true);

      try {

        if (role === UserRole.PROMOTER && orgId) {

          setPromoter(await getPromoterDashboard(orgId, token, 'DAY'));

        } else if (role === UserRole.SUPER_ADMIN) {

          setPlatform(await getPlatformOverview(token));

        } else if (

          role === UserRole.ADMIN ||

          role === UserRole.VENUE_MANAGER

        ) {

          setAdmin(await getAdminDashboard(token));

        }

      } catch {

        // Home still renders a shell if API fails

      } finally {

        setLoading(false);

      }

    }



    load();

  }, [session]);



  const minsLeft = timeLeftMs != null ? Math.ceil(timeLeftMs / 60_000) : null;



  return (

    <Screen>

      <Text style={styles.kicker}>NEXARA</Text>

      <Text style={styles.title}>Hola, {session?.email?.split('@')[0] ?? 'staff'}</Text>

      <Text style={styles.role}>{roleLabel(session?.role ?? '')}</Text>



      {expiringSoon && minsLeft != null ? (

        <View style={styles.banner}>

          <Text style={styles.bannerText}>Sesión expira en ~{minsLeft} min</Text>

        </View>

      ) : null}



      {loading ? (

        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />

      ) : (

        <View style={styles.cards}>

          {promoter ? (

            <>

              <MetricCard label="Ventas hoy" value={formatMoney(promoter.metrics.totalRevenue, promoter.metrics.currency)} />

              <MetricCard label="Órdenes" value={String(promoter.metrics.totalOrders)} />

              <MetricCard label="Boletos" value={String(promoter.metrics.totalTicketsSold)} />

            </>

          ) : null}

          {admin ? (

            <>

              <MetricCard label="Ingresos hoy" value={formatMoney(admin.revenueToday, 'MXN')} />

              <MetricCard label="Órdenes hoy" value={String(admin.ordersToday)} />

              <MetricCard label="Eventos activos" value={String(admin.activeEvents)} />

            </>

          ) : null}

          {platform ? (
            <>
              <MetricCard label="Organizaciones" value={String(platform.totals.organizations)} />
              <MetricCard label="Órdenes hoy (global)" value={String(platform.health.ordersToday)} />
              <MetricCard label="Eventos" value={String(platform.totals.events)} />
            </>
          ) : null}

          {!promoter && !admin && !platform ? (

            <View style={styles.card}>

              <Text style={styles.cardTitle}>Panel operativo</Text>

              <Text style={styles.cardCopy}>

                Usa las pestañas inferiores según tu rol: venta en taquilla, escaneo de acceso o

                consulta de eventos.

              </Text>

            </View>

          ) : null}

        </View>

      )}

    </Screen>

  );

}



function MetricCard({ label, value }: { label: string; value: string }) {

  return (

    <View style={styles.card}>

      <Text style={styles.metricLabel}>{label}</Text>

      <Text style={styles.metricValue}>{value}</Text>

    </View>

  );

}



function formatMoney(amount: number, currency: string) {

  try {

    return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(amount);

  } catch {

    return `$${amount.toFixed(2)}`;

  }

}



const styles = StyleSheet.create({

  kicker: {

    color: colors.accent,

    fontWeight: '800',

    letterSpacing: 4,

    fontSize: 12,

    marginBottom: spacing.xs,

  },

  title: { fontSize: 26, fontWeight: '700', color: colors.text },

  role: { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.lg },

  banner: {

    backgroundColor: colors.accentMuted,

    padding: spacing.sm,

    borderRadius: radii.sm,

    marginBottom: spacing.md,

  },

  bannerText: { color: '#fff', fontWeight: '600', textAlign: 'center' },

  cards: { gap: spacing.sm },

  card: {

    backgroundColor: colors.bgCard,

    borderRadius: radii.md,

    padding: spacing.md,

    borderWidth: 1,

    borderColor: colors.border,

  },

  cardTitle: { color: colors.text, fontWeight: '700', fontSize: 16, marginBottom: spacing.xs },

  cardCopy: { color: colors.textSecondary, lineHeight: 20 },

  metricLabel: { color: colors.textMuted, fontSize: 13 },

  metricValue: { color: colors.text, fontSize: 24, fontWeight: '700', marginTop: 4 },

});

