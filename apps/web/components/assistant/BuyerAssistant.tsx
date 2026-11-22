'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './BuyerAssistant.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type Props = {
  eventId: string;
  eventTitle?: string;
};

/**
 * Montar en la ficha del evento (p. ej. bajo el panel de compra).
 * Inserción sugerida: apps/web/app/events/[slug]/EventStage.tsx
 * justo después de <EventPurchaseClient ... /> (aprox. línea 158 en layout móvil
 * y el equivalente tras el cliente en escritorio).
 */
export function BuyerAssistant({ eventId, eventTitle }: Props) {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(`${API}/smart-search/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { assistant?: boolean } | null) => {
        if (alive) setAvailable(Boolean(data?.assistant));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!available) return null;

  async function ask() {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError('');
    setAnswer('');
    try {
      const sessionId =
        typeof window !== 'undefined'
          ? localStorage.getItem('bt-assistant-session') ||
            (() => {
              const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              localStorage.setItem('bt-assistant-session', id);
              return id;
            })()
          : undefined;
      const res = await fetch(`${API}/smart-search/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, question: q, sessionId }),
      });
      if (!res.ok || !res.body) {
        setError('No pude responder. Prueba de nuevo o ve a Ayuda.');
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim()) as {
              text?: string;
              error?: string;
              done?: boolean;
            };
            if (payload.error) setError(payload.error);
            if (payload.text) {
              text += payload.text;
              setAnswer(text);
            }
          } catch {
            /* ignore partial */
          }
        }
      }
      if (!text && !error) setAnswer('No encontré eso en la ficha. Revisa Ayuda.');
    } catch {
      setError('Sin conexión. Revisa Ayuda.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.wrap}>
      {!open ? (
        <button type="button" className={styles.trigger} onClick={() => setOpen(true)}>
          Pregúntale a Black Ticket
        </button>
      ) : (
        <section className={styles.panel} aria-label="Asistente del comprador">
          <header className={styles.head}>
            <h2>Pregúntale a Black Ticket</h2>
            <button type="button" className={styles.close} onClick={() => setOpen(false)}>
              Cerrar
            </button>
          </header>
          <p className={styles.hint}>
            Sobre {eventTitle || 'este evento'}: horarios, zonas, accesibilidad, reembolso y reventa.
          </p>
          <label className={styles.label} htmlFor={`ask-${eventId}`}>
            Tu pregunta
          </label>
          <textarea
            id={`ask-${eventId}`}
            className={styles.input}
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="¿A qué hora abren puertas?"
          />
          <button
            type="button"
            className={styles.send}
            disabled={loading || !question.trim()}
            onClick={ask}
          >
            {loading ? 'Pensando…' : 'Preguntar'}
          </button>
          {error ? (
            <p className={styles.error} role="alert">
              {error}{' '}
              <Link href="/ayuda">Ir a Ayuda</Link>
            </p>
          ) : null}
          {answer ? (
            <p className={styles.answer} aria-live="polite">
              {answer}
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
