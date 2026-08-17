'use client';

import { FormEvent, useId, useState } from 'react';
import styles from './WaitlistSignup.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export function WaitlistSignup({
  eventId,
  eventTitle,
  offerId,
}: {
  eventId: string;
  eventTitle: string;
  offerId?: string;
}) {
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/waitlist/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, email, offerId, quantity: 1 }),
      });
      if (!res.ok) throw new Error(await res.text());
      setDone(true);
    } catch {
      setError('No pudimos registrarte. Puede que ya estés en la lista con ese correo.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className={styles.done} role="status">
        <strong>Listo, ya estás en la lista</strong>
        <p>Te avisaremos por correo cuando haya boletos para {eventTitle}.</p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <h3>Agotado — lista de espera</h3>
      <p className={styles.lead}>
        Déjanos tu correo y serás de los primeros en enterarte cuando liberemos cupo.
      </p>
      <form onSubmit={onSubmit} className={styles.form}>
        <div className={styles.field}>
          {/* Etiqueta real: el placeholder desaparece al escribir. */}
          <label htmlFor={emailId}>Tu correo electrónico</label>
          <input
            id={emailId}
            type="email"
            name="email"
            autoComplete="email"
            required
            placeholder="nombre@correo.com"
            value={email}
            aria-describedby={error ? `${emailId}-error` : undefined}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Enviando…' : 'Avísenme'}
        </button>
      </form>
      {error && (
        <p id={`${emailId}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
