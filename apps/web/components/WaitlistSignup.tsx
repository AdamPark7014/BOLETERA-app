'use client';

import { FormEvent, useState } from 'react';
import { Field, TicketButton } from '@boletera/ui';
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
      <p className={styles.done} role="status">
        Aviso pedido.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className={styles.form}>
      <Field
        label="Correo"
        type="email"
        name="email"
        autoComplete="email"
        required
        placeholder="nombre@dominio.com"
        value={email}
        error={error || undefined}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TicketButton type="submit" disabled={loading || !email.trim()}>
        {loading ? 'Avisarme' : 'Avisarme'}
      </TicketButton>
      <p className={styles.lead}>{eventTitle}</p>
    </form>
  );
}
