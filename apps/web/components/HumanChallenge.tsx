'use client';

import { useState } from 'react';
import { API_BASE, clientTenantHostHeaders } from '@/lib/api';

export type IssuedPowChallenge = {
  challengeId: string;
  salt: string;
  bits: number;
  provider?: string;
};

type Props = {
  sessionId?: string;
  challenge: IssuedPowChallenge | null;
  onSolved: (clearanceToken: string) => void;
};

/**
 * Reto antibots: botón «Soy una persona» + PoW alineada al HumanChallengeService del API.
 * Nunca bloquea sin ofrecer este reto.
 */
export function HumanChallenge({ sessionId, challenge, onSolved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function solve() {
    if (!challenge?.challengeId || !challenge.salt || !(challenge.bits > 0)) {
      setError('Falta el reto. Intenta apartar de nuevo.');
      return;
    }
    if (challenge.provider === 'turnstile') {
      setError('Turnstile no está disponible en este cliente.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const counter = await solvePow(challenge.salt, challenge.challengeId, challenge.bits);
      const res = await fetch(`${API_BASE}/inventory/challenge/solve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...clientTenantHostHeaders(),
        },
        body: JSON.stringify({
          sessionId,
          challengeId: challenge.challengeId,
          counter,
        }),
      });
      if (!res.ok) throw new Error('No se pudo confirmar el reto.');
      const body = (await res.json()) as { clearanceToken?: string };
      if (!body.clearanceToken) throw new Error('Respuesta incompleta del reto.');
      onSolved(body.clearanceToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo confirmar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="alertdialog" aria-label="Confirma que eres una persona">
      <p>Detectamos actividad inusual. Confirma que eres una persona para seguir.</p>
      <button type="button" disabled={busy} onClick={() => void solve()}>
        {busy ? 'Comprobando…' : 'Soy una persona'}
      </button>
      {error ? <p>{error}</p> : null}
    </div>
  );
}

/** Misma regla que HumanChallengeService.leadingZeroBits en el API. */
export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    for (let i = 7; i >= 0; i--) {
      if ((byte >> i) & 1) return bits;
      bits++;
    }
  }
  return bits;
}

/** Contador decimal tal que SHA-256(`${salt}:${challengeId}:${counter}`) tenga ≥ bits ceros iniciales. */
export async function solvePow(
  salt: string,
  challengeId: string,
  bits: number
): Promise<string> {
  const enc = new TextEncoder();
  for (let counter = 0; counter < 5_000_000; counter++) {
    const counterStr = String(counter);
    const digest = await crypto.subtle.digest(
      'SHA-256',
      enc.encode(`${salt}:${challengeId}:${counterStr}`)
    );
    if (leadingZeroBits(new Uint8Array(digest)) >= bits) return counterStr;
  }
  throw new Error('Prueba de trabajo no completada en tiempo razonable');
}
