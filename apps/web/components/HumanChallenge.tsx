'use client';

import { useState } from 'react';
import { API_BASE, clientTenantHostHeaders } from '@/lib/api';

type Props = {
  sessionId?: string;
  onSolved: (challengeToken: string) => void;
};

/**
 * Reto antibots: botón «Soy una persona» + prueba de trabajo ligera en el navegador.
 * Nunca bloquea sin ofrecer este reto.
 */
export function HumanChallenge({ sessionId, onSolved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function solve() {
    setBusy(true);
    setError(null);
    try {
      // POW ligera: busca un nonce cuyo hash empiece con "00".
      const proof = await lightPow();
      const res = await fetch(`${API_BASE}/inventory/challenge/solve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...clientTenantHostHeaders(),
        },
        body: JSON.stringify({ sessionId, proof }),
      });
      if (!res.ok) throw new Error('No se pudo confirmar el reto.');
      const body = (await res.json()) as { challengeToken?: string };
      if (!body.challengeToken) throw new Error('Respuesta incompleta del reto.');
      onSolved(body.challengeToken);
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

async function lightPow(): Promise<string> {
  const enc = new TextEncoder();
  for (let i = 0; i < 50_000; i++) {
    const nonce = `bt-${Date.now()}-${i}`;
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(nonce));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex.startsWith('00')) return nonce;
  }
  return `bt-fallback-${Date.now()}`;
}
