'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Field, TicketButton } from '@boletera/ui';
import styles from '../../events/_ticket/frame.module.scss';
import {
  AI_CHAT_SUGGESTIONS,
  answerFromContext,
  buildGroundedContext,
  createMessage,
  type AiChatBundle,
  type AiChatMessage,
} from '../_lib/chat';
import { formatGeneratedAt } from '../_lib/format';

type ChatPanelProps = {
  bundle: AiChatBundle;
  loading?: boolean;
};

function roleLabel(role: AiChatMessage['role']): string {
  if (role === 'user') return 'Tú';
  if (role === 'system') return 'Gobernanza';
  return 'Copiloto';
}

export function ChatPanel({ bundle, loading = false }: ChatPanelProps) {
  const context = useMemo(() => buildGroundedContext(bundle), [bundle]);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    setMessages([
      createMessage(
        'system',
        'Copiloto contextual: solo responde con hechos ya calculados en esta pantalla (métricas, eventos, anomalías, recomendaciones); no usa modelo de lenguaje. Si falta dato, lo declara. Las acciones que cambian datos requieren confirmación humana.'
      ),
    ]);
  }, []);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages]);

  function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    const userMsg = createMessage('user', trimmed);
    const reply = answerFromContext(trimmed, context);
    const assistantMsg = createMessage('assistant', reply.content, reply.citations);
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setDraft('');
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    ask(draft);
  }

  return (
    <div className={styles.stack}>
      <p className={styles.tertiary}>
        {bundle.rangeLabel} · {bundle.eventLabel ?? 'sin evento en foco'} · {context.facts.length}{' '}
        hechos anclados
        {context.unavailable.length > 0
          ? ` · ${context.unavailable.length} fuentes pendientes`
          : ''}
      </p>
      <div
        role="group"
        aria-label="Preguntas sugeridas"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
      >
        {AI_CHAT_SUGGESTIONS.map((item) => (
          <TicketButton
            key={item.id}
            variant="ghost"
            disabled={loading}
            onClick={() => ask(item.label)}
          >
            {item.label}
          </TicketButton>
        ))}
      </div>
      <div ref={listRef} aria-live="polite" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <ul className={styles.rows}>
          {messages.map((message) => (
            <li
              key={message.id}
              className={styles.row}
              style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}
            >
              <div className={styles.stack} style={{ gap: 4 }}>
                <p className={styles.rowMeta}>
                  {roleLabel(message.role)} · {formatGeneratedAt(message.createdAt)}
                </p>
                <p
                  className={message.role === 'system' ? styles.tertiary : styles.quiet}
                  style={message.role === 'user' ? { color: 'var(--text)' } : undefined}
                >
                  {message.content}
                </p>
                {message.citations?.slice(0, 4).map((citation, index) => (
                  <p key={`${message.id}-${index}`} className={styles.tertiary}>
                    {citation.source} · {citation.detail}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <form className={styles.stack} onSubmit={onSubmit}>
        <Field
          label="Pregunta al copiloto"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="¿Hay anomalías de reembolsos en este periodo?"
          disabled={loading}
        />
        <div>
          <TicketButton type="submit" variant="secondary" disabled={loading || !draft.trim()}>
            Preguntar
          </TicketButton>
        </div>
      </form>
    </div>
  );
}
