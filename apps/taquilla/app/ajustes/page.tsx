'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getOrgId, getTaquillaToken, getTaquillaUser, isManager } from '@/lib/auth';
import { PosShell } from '@/components/PosShell';
import { connectSerialPrinter, getSerialPort, isSerialSupported } from '@/lib/thermal';
import { listManifests, type ManifestMeta } from '@/lib/manifest';
import { getLocalQuotas } from '@/lib/pos';
import styles from './ajustes.module.scss';

export default function AjustesPage() {
  const router = useRouter();
  const [serialOk, setSerialOk] = useState(false);
  const [pin, setPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [msg, setMsg] = useState('');
  const [manager, setManager] = useState(false);
  const [role, setRole] = useState('');
  const [manifests, setManifests] = useState<ManifestMeta[]>([]);
  const [quotas, setQuotas] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!getTaquillaToken()) {
      router.replace('/login');
      return;
    }
    setSerialOk(Boolean(getSerialPort()));
    setManager(isManager());
    setRole(getTaquillaUser()?.role ?? '');
    setQuotas(getLocalQuotas());
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

  async function savePin() {
    const orgId = getOrgId();
    if (!orgId || !pin) return;
    const res = await apiFetch('/taquilla/manager-pin', {
      method: 'POST',
      body: JSON.stringify({ organizationId: orgId, pin, currentPin: currentPin || undefined }),
    });
    setMsg(res.ok ? 'PIN actualizado' : await res.text());
    if (res.ok) {
      setPin('');
      setCurrentPin('');
    }
  }

  return (
    <PosShell title="Ajustes" eyebrow="Terminal" backHref="/" size="md">
      {msg && <p className={styles.msg}>{msg}</p>}

      <section className={styles.section}>
        <h2>Impresora térmica</h2>
        <p>Web Serial {isSerialSupported() ? 'disponible' : 'no disponible en este navegador'}.</p>
        <p>Estado: {serialOk ? 'conectada' : 'sin puerto'}</p>
        <button type="button" onClick={() => void connectPrinter()}>
          Conectar impresora USB
        </button>
      </section>

      <section className={styles.section}>
        <h2>Datos descargados para operar sin red</h2>
        {manifests.length === 0 ? (
          <p>Sin manifiestos descargados. Hazlo desde Acceso (F6) antes de abrir puertas.</p>
        ) : (
          <ul className={styles.list}>
            {manifests.map((m) => (
              <li key={m.eventId}>
                <strong>{m.eventTitle ?? m.eventId}</strong>
                <span>
                  {m.count.toLocaleString('es-MX')} boletos · emitido{' '}
                  {new Date(m.issuedAt).toLocaleString('es-MX')}
                  {m.complete ? '' : ' · INCOMPLETO'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.note}>
          El manifiesto sirve para verificar pertenencia y estado sin red. No verifica la firma del
          QR ni conoce cancelaciones posteriores a su emisión.
        </p>
        {Object.keys(quotas).length > 0 && (
          <ul className={styles.list}>
            {Object.entries(quotas).map(([eventId, qty]) => (
              <li key={eventId}>
                <strong>Cupo local</strong>
                <span>
                  {eventId} · {qty} boletos vendibles sin red
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* El API exige rol de gerencia para cambiar el PIN. Ocultarlo al cajero
          evita que descubra por un 403 que existe una puerta que no le toca. */}
      {manager ? (
        <section className={styles.section}>
          <h2>PIN de gerente</h2>
          <p>Requerido para anulaciones, cambios, cortesías, descuentos, retiros y diferencias de caja.</p>
          <input
            type="password"
            placeholder="PIN actual"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
          />
          <input
            type="password"
            placeholder="Nuevo PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
          <button type="button" onClick={() => void savePin()}>
            Guardar PIN
          </button>
        </section>
      ) : (
        <section className={styles.section}>
          <h2>Permisos de esta terminal</h2>
          <p>
            Sesión con rol <strong>{role || 'TAQUILLA'}</strong>. Puedes vender, entregar will-call,
            consultar boletos y hacer tu corte.
          </p>
          <p className={styles.note}>
            No puedes editar precios, cambiar el PIN de gerente ni autorizar anulaciones, cortesías,
            descuentos o retiros: esas operaciones piden PIN de gerencia y quedan auditadas.
          </p>
        </section>
      )}
    </PosShell>
  );
}
