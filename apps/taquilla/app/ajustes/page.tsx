'use client';

import { formatDateTime } from '@boletera/ui';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@boletera/ui';
import { apiFetch, getOrgId, getTaquillaToken, getTaquillaUser, isManager } from '@/lib/auth';
import { PosShell } from '@/components/PosShell';
import { connectSerialPrinter, getSerialPort, isSerialSupported } from '@/lib/thermal';
import { listManifests, type ManifestMeta } from '@/lib/manifest';
import { fetchPosSettings, getLocalQuotas, updatePosSettings } from '@/lib/pos';
import styles from './ajustes.module.scss';

export default function AjustesPage() {
  const router = useRouter();
  const [serialOk, setSerialOk] = useState(false);
  // `navigator` no existe en el servidor: se lee tras hidratar para que el texto coincida.
  const [serialSupported, setSerialSupported] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [msg, setMsg] = useState('');
  const [manager, setManager] = useState(false);
  const [role, setRole] = useState('');
  const [manifests, setManifests] = useState<ManifestMeta[]>([]);
  const [quotas, setQuotas] = useState<Record<string, number>>({});
  const [savingPin, setSavingPin] = useState(false);
  const [varianceThreshold, setVarianceThreshold] = useState('50');
  const [lookbackHours, setLookbackHours] = useState('12');
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    if (!getTaquillaToken()) {
      router.replace('/login');
      return;
    }
    setSerialOk(Boolean(getSerialPort()));
    setSerialSupported(isSerialSupported());
    setManager(isManager());
    setRole(getTaquillaUser()?.role ?? '');
    setQuotas(getLocalQuotas());
    void fetchPosSettings()
      .then((s) => {
        setVarianceThreshold(String(s.cashVariancePinThreshold));
        setLookbackHours(String(s.eventsLookbackHours));
      })
      .catch(() => {
        /* sin red: se quedan los valores por omisión */
      });
  }, [router]);

  const refreshManifests = useCallback(() => {
    void listManifests().then(setManifests);
  }, []);

  useEffect(refreshManifests, [refreshManifests]);

  async function connectPrinter() {
    const ok = await connectSerialPrinter();
    setSerialOk(ok);
    setMsg(ok ? 'Impresora conectada' : 'No se pudo conectar (requiere Chrome y permiso USB)');
  }

  async function savePosSettings() {
    setSavingSettings(true);
    try {
      const saved = await updatePosSettings({
        posCashVariancePinThreshold: Number(varianceThreshold),
        posEventsLookbackHours: Number(lookbackHours),
      });
      setVarianceThreshold(String(saved.cashVariancePinThreshold));
      setLookbackHours(String(saved.eventsLookbackHours));
      setMsg('Ajustes de caja guardados');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'No se pudieron guardar los ajustes');
    } finally {
      setSavingSettings(false);
    }
  }

  async function savePin() {
    const orgId = getOrgId();
    if (!orgId || !pin) return;
    setSavingPin(true);
    try {
      const res = await apiFetch('/taquilla/manager-pin', {
        method: 'POST',
        body: JSON.stringify({ organizationId: orgId, pin, currentPin: currentPin || undefined }),
      });
      setMsg(res.ok ? 'PIN actualizado' : await res.text());
      if (res.ok) {
        setPin('');
        setCurrentPin('');
      }
    } finally {
      setSavingPin(false);
    }
  }

  return (
    <PosShell title="Ajustes" backHref="/" size="md">
      {msg && <p className={styles.msg}>{msg}</p>}

      <section className={styles.section}>
        <h2>Impresora térmica</h2>
        <p>
          Conexión por USB{' '}
          {serialSupported === null
            ? '…'
            : serialSupported
              ? 'disponible en este navegador'
              : 'no disponible en este navegador (usa Chrome o Edge)'}
          .
        </p>
        <p>Estado: {serialOk ? 'conectada' : 'sin conectar'}</p>
        <Button type="button" variant="secondary" size="lg" onClick={() => void connectPrinter()}>
          Conectar impresora USB
        </Button>
      </section>

      <section className={styles.section}>
        <h2>Datos descargados para operar sin red</h2>
        {manifests.length === 0 ? (
          <p>No hay listas de boletos descargadas. Descárgalas desde Puerta (F6) antes de abrir.</p>
        ) : (
          <ul className={styles.list}>
            {manifests.map((m) => (
              <li key={m.eventId}>
                <strong>{m.eventTitle ?? m.eventId}</strong>
                <span>
                  {String(m.count)} boletos · emitido {formatDateTime(m.issuedAt)}
                  {m.complete ? '' : ' · incompleta'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {Object.keys(quotas).length > 0 && (
          <ul className={styles.list}>
            {Object.entries(quotas).map(([eventId, qty]) => (
              <li key={eventId}>
                <strong>Cupo local</strong>
                <span>{qty} boletos que se pueden vender sin red</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* El API exige rol de gerencia para cambiar el PIN. Ocultarlo al cajero
          evita que descubra por un 403 que existe una puerta que no le toca. */}
      {manager ? (
        <section className={styles.section}>
          <h2>Caja y cartelera</h2>
          <p>
            Descuadre a partir del cual el corte pide PIN, y cuántas horas atrás se listan
            funciones en venta.
          </p>
          <div className={styles.pinFields}>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="1"
              placeholder="Descuadre (pesos)"
              value={varianceThreshold}
              onChange={(e) => setVarianceThreshold(e.target.value.replace(/[^\d.]/g, ''))}
            />
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={168}
              step="1"
              placeholder="Horas de cartelera"
              value={lookbackHours}
              onChange={(e) => setLookbackHours(e.target.value.replace(/\D/g, ''))}
            />
            <Button
              type="button"
              variant="secondary"
              size="lg"
              loading={savingSettings}
              loadingLabel="Guardando…"
              disabled={!varianceThreshold || !lookbackHours}
              onClick={() => void savePosSettings()}
            >
              Guardar ajustes de caja
            </Button>
          </div>
        </section>
      ) : null}

      {manager ? (
        <section className={styles.section}>
          <h2>PIN de gerente</h2>
          <p>
            Requerido para anulaciones, cambios, cortesías, descuentos, retiros y diferencias de
            caja.
          </p>
          <div className={styles.pinFields}>
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              placeholder="PIN actual"
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
            />
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              placeholder="Nuevo PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
            <Button
              type="button"
              variant="primary"
              loading={savingPin}
              loadingLabel="Guardando…"
              disabled={!pin}
              onClick={() => void savePin()}
            >
              Guardar PIN
            </Button>
          </div>
        </section>
      ) : (
        <section className={styles.section}>
          <h2>Permisos de esta terminal</h2>
          <p>
            Sesión de <strong>{roleLabel(role)}</strong>.
          </p>
          <p className={styles.note}>Precios, PIN y anulaciones los autoriza gerencia.</p>
        </section>
      )}
    </PosShell>
  );
}

function roleLabel(role: string) {
  const names: Record<string, string> = {
    TAQUILLA: 'taquilla',
    SCANNER: 'control de acceso',
    SUPERVISOR: 'supervisor',
    ADMIN: 'administración',
    SUPER_ADMIN: 'administración',
  };
  return names[role] ?? 'taquilla';
}
