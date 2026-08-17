'use client';

import { useRouter } from 'next/navigation';
import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CommandPalette, type CommandAction } from '@boletera/ui';
import { http } from '@/lib/http';
import { queryKeys } from '@/lib/query-keys';
import type { EventRow } from '@/lib/platform-api';
import { useVenues } from '@/lib/queries';
import type { OrderRow } from '@/lib/queries/orders';
import { useSession } from '@/lib/use-session';
import { ShellIcon } from './icons';
import { flattenNavItems } from './nav-config';
import { useTheme } from './use-theme';

export type CommandPaletteMode = 'all' | 'shortcuts';

type ShellCommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: CommandPaletteMode;
  onToggleCompact: () => void;
};

function ShellCommandPaletteComponent({
  open,
  onOpenChange,
  mode = 'all',
  onToggleCompact,
}: ShellCommandPaletteProps) {
  const router = useRouter();
  const { signOut, revokeAll } = useSession();
  const { cycle, setPreference } = useTheme();
  const { data: venues = [] } = useVenues();

  const eventsQuery = useQuery({
    queryKey: queryKeys.events.list({}),
    queryFn: ({ signal }) => http<EventRow[]>('/admin/events', { signal }),
    enabled: open && mode === 'all',
  });

  const ordersQuery = useQuery({
    queryKey: queryKeys.orders.list({}),
    queryFn: ({ signal }) => http<OrderRow[]>('/admin/orders', { signal }),
    enabled: open && mode === 'all',
  });

  const events = eventsQuery.data ?? [];
  const orders = ordersQuery.data ?? [];

  const actions = useMemo<CommandAction[]>(() => {
    const go = (href: string) => () => {
      router.push(href);
    };

    const shortcutHelp: CommandAction[] = [
      {
        id: 'help-cmdk',
        label: 'Abrir buscador de comandos',
        description: 'Cmd+K o Ctrl+K en cualquier pantalla',
        group: 'Atajos',
        icon: <ShellIcon name="keyboard" size={16} />,
        shortcut: ['⌘', 'K'],
        onSelect: () => undefined,
      },
      {
        id: 'help-compact',
        label: 'Barra lateral compacta',
        description: 'Tecla [',
        group: 'Atajos',
        icon: <ShellIcon name="panelLeft" size={16} />,
        shortcut: ['['],
        onSelect: onToggleCompact,
      },
      {
        id: 'help-theme',
        label: 'Ciclar tema',
        description: 'Sistema → claro → oscuro',
        group: 'Atajos',
        icon: <ShellIcon name="monitor" size={16} />,
        onSelect: cycle,
      },
      {
        id: 'help-escape',
        label: 'Cerrar paneles',
        description: 'Escape cierra menús, drawers y la paleta',
        group: 'Atajos',
        icon: <ShellIcon name="close" size={16} />,
        shortcut: ['Esc'],
        onSelect: () => undefined,
      },
    ];

    if (mode === 'shortcuts') {
      return shortcutHelp;
    }

    const navActions: CommandAction[] = flattenNavItems().map((item) => ({
      id: `nav-${item.id}`,
      label: item.label,
      description: item.href,
      group: 'Navegación',
      keywords: item.keywords,
      icon: <ShellIcon name={item.icon} size={16} />,
      onSelect: go(item.href),
    }));

    const actionItems: CommandAction[] = [
      {
        id: 'action-new-event',
        label: 'Crear evento',
        description: 'Ir al formulario de nuevo evento',
        group: 'Acciones',
        keywords: ['nuevo', 'crear', 'evento'],
        icon: <ShellIcon name="events" size={16} />,
        shortcut: ['G', 'N'],
        onSelect: go('/events/new'),
      },
      {
        id: 'action-orders',
        label: 'Revisar órdenes',
        group: 'Acciones',
        keywords: ['pedidos'],
        icon: <ShellIcon name="orders" size={16} />,
        onSelect: go('/orders'),
      },
      {
        id: 'action-scanner',
        label: 'Abrir escáner',
        group: 'Acciones',
        keywords: ['check-in', 'entrada'],
        icon: <ShellIcon name="scanner" size={16} />,
        onSelect: go('/scanner'),
      },
      {
        id: 'action-analytics',
        label: 'Ver analítica',
        group: 'Acciones',
        icon: <ShellIcon name="analytics" size={16} />,
        onSelect: go('/analytics'),
      },
      {
        id: 'action-toggle-compact',
        label: 'Alternar barra compacta',
        description: 'Mostrar solo iconos en la navegación',
        group: 'Acciones',
        keywords: ['sidebar', 'compacto', 'colapsar'],
        icon: <ShellIcon name="panelLeft" size={16} />,
        shortcut: ['['],
        onSelect: onToggleCompact,
      },
      {
        id: 'action-theme-cycle',
        label: 'Cambiar tema',
        description: 'Ciclar sistema → claro → oscuro',
        group: 'Acciones',
        keywords: ['oscuro', 'claro', 'dark', 'light'],
        icon: <ShellIcon name="sun" size={16} />,
        onSelect: cycle,
      },
      {
        id: 'action-theme-light',
        label: 'Usar tema claro',
        group: 'Acciones',
        icon: <ShellIcon name="sun" size={16} />,
        onSelect: () => setPreference('light'),
      },
      {
        id: 'action-theme-dark',
        label: 'Usar tema oscuro',
        group: 'Acciones',
        icon: <ShellIcon name="moon" size={16} />,
        onSelect: () => setPreference('dark'),
      },
      {
        id: 'action-signout',
        label: 'Cerrar sesión',
        group: 'Cuenta',
        keywords: ['logout', 'salir'],
        icon: <ShellIcon name="logout" size={16} />,
        onSelect: () => {
          void signOut().finally(() => router.push('/login'));
        },
      },
      {
        id: 'action-revoke-all',
        label: 'Cerrar todas las sesiones',
        description: 'Revoca tokens en todos los dispositivos',
        group: 'Cuenta',
        keywords: ['revoke', 'seguridad'],
        icon: <ShellIcon name="close" size={16} />,
        onSelect: () => {
          void revokeAll().finally(() => router.push('/login'));
        },
      },
    ];

    const venueActions: CommandAction[] = venues.flatMap((venue) => [
      {
        id: `venue-3d-${venue.id}`,
        label: `${venue.name} — Estudio 3D`,
        description: 'Abrir estudio 3D',
        group: 'Venues',
        keywords: [venue.name, venue.slug, '3d', 'estudio'],
        icon: <ShellIcon name="mapPin" size={16} />,
        onSelect: go(`/venues/${venue.id}/3d?studio=1`),
      },
      {
        id: `venue-map-${venue.id}`,
        label: `${venue.name} — Vista planta`,
        description: 'Abrir mapa en planta',
        group: 'Venues',
        keywords: [venue.name, venue.slug, 'planta', 'mapa'],
        icon: <ShellIcon name="mapPin" size={16} />,
        onSelect: go(`/venues/${venue.id}/map`),
      },
    ]);

    const eventActions: CommandAction[] = events.slice(0, 40).map((event) => ({
      id: `event-${event.id}`,
      label: event.title,
      description: event.venue?.name ? `${event.venue.name} · ${event.status}` : event.status,
      group: 'Eventos',
      keywords: [event.slug, event.status],
      icon: <ShellIcon name="events" size={16} />,
      onSelect: go(`/events/${event.id}`),
    }));

    const orderActions: CommandAction[] = orders.slice(0, 30).map((order) => ({
      id: `order-${order.id}`,
      label: order.publicId || `Orden · ${order.buyerName}`,
      description: `${order.buyerName} · ${order.event.title}`,
      group: 'Órdenes',
      keywords: [order.buyerEmail, order.buyerName, order.status, order.publicId],
      icon: <ShellIcon name="orders" size={16} />,
      onSelect: go(`/orders/${order.id}`),
    }));

    return [
      ...navActions,
      ...actionItems,
      ...shortcutHelp,
      ...venueActions,
      ...eventActions,
      ...orderActions,
    ];
  }, [
    cycle,
    events,
    mode,
    onToggleCompact,
    orders,
    revokeAll,
    router,
    setPreference,
    signOut,
    venues,
  ]);

  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      actions={actions}
      placeholder={
        mode === 'shortcuts'
          ? 'Atajos de teclado…'
          : 'Buscar módulos, acciones, eventos, órdenes…'
      }
      emptyMessage="Sin coincidencias. Prueba con otro término."
      groupOrder={['Acciones', 'Navegación', 'Eventos', 'Órdenes', 'Venues', 'Atajos', 'Cuenta']}
    />
  );
}

export const ShellCommandPalette = memo(ShellCommandPaletteComponent);
