'use client';

/**
 * Bloqueos administrativos de inventario con motivo obligatorio.
 *
 * El servidor exige un motivo de al menos 8 caracteres y deja rastro en
 * `AuditEvent` (`INVENTORY_ADMIN_HOLD` / `INVENTORY_ADMIN_RELEASE`) con las
 * butacas, el motivo y la categoría. Validamos aquí lo mismo que allí para que
 * nadie descubra el requisito por un 400 después de teclear 200 identificadores.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ApiError } from '@/lib/api';
import {
  BLOCK_CATEGORIES,
  BLOCK_CATEGORY_LABEL,
  MIN_REASON_LENGTH,
  blockSeats,
  reasonError,
  releaseSeats,
  type AdminBlockResult,
  type AdminReleaseResult,
  type BlockCategory,
} from './inventory-api';
import styles from './live-inventory.module.scss';

/** Acepta comas, espacios y saltos de línea: se pega desde hoja de cálculo o del mapa. */
function parseSeatIds(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
}

export function InventoryBlocksPanel({
  token,
  eventId,
  layoutId,
  /** Butacas seleccionadas en el editor de mapa, si se llega desde ahí. */
  presetSeatIds,
}: {
  token: string;
  eventId: string;
  layoutId: string | null;
  presetSeatIds?: string[];
}) {
  const [seatsRaw, setSeatsRaw] = useState(presetSeatIds?.join('\n') ?? '');
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState<BlockCategory>('PRODUCCION');
  const [busy, setBusy] = useState<'block' | 'release' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [touchedReason, setTouchedReason] = useState(false);

  const seatIds = useMemo(() => parseSeatIds(seatsRaw), [seatsRaw]);
  const reasonProblem = reasonError(reason);
  const seatsProblem = seatIds.length === 0 ? 'Indica al menos una butaca.' : null;
  const canSubmit = !reasonProblem && !seatsProblem && !!layoutId && !busy;

  async function run(kind: 'block' | 'release') {
    if (!layoutId) return;
    setBusy(kind);
    setResult(null);
    setError(null);
    try {
      if (kind === 'block') {
        const res: AdminBlockResult = await blockSeats(token, layoutId, {
          eventId,
          seatIds,
          reason: reason.trim(),
          category,
        });
        setResult(
          `Bloqueadas ${res.holds?.length ?? seatIds.length} butacas · motivo «${res.reason}» (${
            BLOCK_CATEGORY_LABEL[res.category as BlockCategory] ?? res.category
          }) · vence ${new Date(res.expiresAt).toLocaleString('es-MX')}.`,
        );
      } else {
        const res: AdminReleaseResult = await releaseSeats(token, layoutId, {
          seatIds,
          reason: reason.trim(),
          category,
        });
        const failed = res.failed?.length ? ` · ${res.failed.length} fallaron` : '';
        setResult(
          `Liberadas ${res.released} de ${res.requested} butacas · ${res.notActive} ya no estaban bloqueadas${failed}.`,
        );
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.userMessage} (${err.status})`
          : err instanceof Error
            ? err.message
            : 'No se pudo completar la operación.',
      );
    } finally {
      setBusy(null);
    }
  }

  if (!layoutId) {
    return (
      <p className={styles.warnNote}>
        Este evento no tiene un layout de recinto asociado, y los bloqueos se piden sobre el layout.
        Asigna un recinto con mapa guardado antes de bloquear butacas.
      </p>
    );
  }

  return (
    <div className={styles.blockForm}>
      <p className={styles.warnNote}>
        <strong>Cómo funciona hoy:</strong> un bloqueo administrativo se guarda como un hold de
        taquilla con <strong>300 segundos de vigencia</strong>. Sirve para retirar butacas de la
        venta durante una operación puntual, no para reservar una zona toda la temporada: al vencer
        vuelven solas al inventario. Cada operación queda registrada en la{' '}
        <Link href="/audit">bitácora de auditoría</Link> con el motivo, la categoría y las butacas.
      </p>

      <label className={styles.field} htmlFor="block-seats">
        Butacas
        <textarea
          id="block-seats"
          rows={4}
          value={seatsRaw}
          onChange={(e) => setSeatsRaw(e.target.value)}
          placeholder="A-1, A-2, A-3…"
          aria-describedby="block-seats-hint"
          aria-invalid={seatsProblem ? true : undefined}
        />
        <span id="block-seats-hint" className={styles.fieldHint}>
          Identificadores separados por coma, espacio o salto de línea.{' '}
          {seatIds.length > 0
            ? `${seatIds.length} butaca${seatIds.length === 1 ? '' : 's'} reconocida${seatIds.length === 1 ? '' : 's'}.`
            : 'Ninguna todavía.'}
        </span>
      </label>

      <label className={styles.field} htmlFor="block-reason">
        Motivo (obligatorio)
        <textarea
          id="block-reason"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouchedReason(true)}
          aria-describedby="block-reason-hint"
          aria-invalid={touchedReason && reasonProblem ? true : undefined}
        />
        <span id="block-reason-hint" className={styles.fieldHint}>
          Mínimo {MIN_REASON_LENGTH} caracteres. Se guarda tal cual en la auditoría: escribe algo que
          se entienda dentro de seis meses ({reason.trim().length}/{MIN_REASON_LENGTH}).
        </span>
      </label>
      {touchedReason && reasonProblem && (
        <p className={styles.fieldError} role="alert">
          <span aria-hidden="true">⚠</span>
          {reasonProblem}
        </p>
      )}

      <div className={styles.formRow}>
        <label className={styles.field} htmlFor="block-category">
          Categoría
          <select
            id="block-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as BlockCategory)}
          >
            {BLOCK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {BLOCK_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={styles.submitBtn}
          disabled={!canSubmit}
          onClick={() => run('block')}
        >
          {busy === 'block' ? 'Bloqueando…' : `Bloquear ${seatIds.length || ''} butacas`}
        </button>
        <button
          type="button"
          className={styles.submitBtn}
          disabled={!canSubmit}
          onClick={() => run('release')}
        >
          {busy === 'release' ? 'Liberando…' : 'Liberar bloqueo'}
        </button>
      </div>

      {!canSubmit && (seatsProblem || reasonProblem) && (
        <p className={styles.fieldHint} role="status">
          Falta: {[seatsProblem, reasonProblem].filter(Boolean).join(' ')}
        </p>
      )}

      {result && (
        <p className={styles.result} role="status" aria-live="polite">
          {result}
        </p>
      )}
      {error && (
        <p className={styles.fieldError} role="alert">
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}
    </div>
  );
}
