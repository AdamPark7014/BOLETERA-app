'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EventPicker, type EventPickerRow } from '@/components/EventPicker';
import { PosShell } from '@/components/PosShell';
import { apiJson, getTaquillaToken } from '@/lib/auth';
import { digitPressed, type Hotkey } from '@/lib/hotkeys';

export default function EventosTaquillaPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventPickerRow[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  useEffect(() => {
    apiJson<EventPickerRow[]>('/taquilla/events')
      .then((data) => setEvents(Array.isArray(data) ? data : []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return events;
    return events.filter(
      (e) =>
        e.title.toLowerCase().includes(needle) ||
        (e.venue?.name ?? '').toLowerCase().includes(needle)
    );
  }, [events, filter]);

  function openVenta(eventId: string) {
    router.push(`/venta?eventId=${encodeURIComponent(eventId)}`);
  }

  const hotkeys: Hotkey[] = [
    {
      keys: '1-9',
      label: 'Vender evento',
      whileTyping: true,
      match: (e) => digitPressed(e) != null,
      run: (e) => {
        const n = digitPressed(e);
        const row = n ? filtered[n - 1] : undefined;
        if (row) openVenta(row.id);
      },
    },
    {
      keys: 'F2',
      label: 'Buscar',
      whileTyping: true,
      run: () => {
        const input = document.querySelector<HTMLInputElement>(
          'section[aria-label="Elige función"] input'
        );
        input?.focus();
      },
    },
    {
      keys: 'Esc',
      label: 'Volver',
      whileTyping: true,
      match: (e) => e.key === 'Escape',
      run: () => router.push('/'),
    },
  ];

  return (
    <PosShell title="Elige función" backHref="/" size="md" hotkeys={hotkeys} escapeGoesBack={false}>
      <EventPicker
        events={events}
        loading={loading}
        filter={filter}
        onFilterChange={setFilter}
        showHotkeys
        onSelect={(row) => openVenta(row.id)}
      />
    </PosShell>
  );
}
