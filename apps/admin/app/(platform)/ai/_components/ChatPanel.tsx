'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, EmptyState } from '@boletera/ui';
import {
  AI_CHAT_SUGGESTIONS,
  answerFromContext,
  buildGroundedContext,
  createMessage,
  type AiChatBundle,
  type AiChatMessage,
} from '../_lib/chat';
import { formatGeneratedAt } from '../_lib/format';
import styles from '../ai.module.scss';

type ChatPanelProps = {
  bundle: AiChatBundle;
  loading?: boolean;
};

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
        'Copiloto contextual: solo responde con hechos ya cargados del ai-engine (métricas, eventos, anomalías, insights). Si falta dato, lo declara. Las acciones mutantes requieren confirmación humana.',
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
    <div className={styles.chat}>
      <div className={styles.chatMeta}>
        <Badge tone="info" variant="outline">
          {bundle.rangeLabel}
        </Badge>
        {bundle.eventLabel ? (
          <Badge tone="accent" variant="outline">
            {bundle.eventLabel}
          </Badge>
        ) : (
          <Badge tone="neutral" variant="outline">
            Sin evento en foco
          </Badge>
        )}
        <span className={styles.muted}>
          {context.facts.length} hechos anclados
          {context.unavailable.length > 0
            ? ` · ${context.unavailable.length} fuentes pendientes`
            : ''}
        </span>
      </div>

      <div className={styles.chatSuggestions} role="group" aria-label="Preguntas sugeridas">
        {AI_CHAT_SUGGESTIONS.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant="secondary"
            disabled={loading}
            onClick={() => ask(item.label)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      <div className={styles.chatThread} ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <EmptyState
            size="sm"
            tone="neutral"
            illustration="inbox"
            title="Chat contextual"
            description="Pregunta por el resumen, anomalías o pronóstico. Las respuestas citan solo datos cargados."
          />
        ) : (
          <ul className={styles.chatMessages}>
            {messages.map((message) => (
              <li
                key={message.id}
                className={
                  message.role === 'user'
                    ? styles.chatBubbleUser
                    : message.role === 'system'
                      ? styles.chatBubbleSystem
                      : styles.chatBubbleAssistant
                }
              >
                <div className={styles.chatBubbleHead}>
                  <strong>
                    {message.role === 'user'
                      ? 'Tú'
                      : message.role === 'system'
                        ? 'Gobernanza'
                        : 'Copiloto'}
                  </strong>
                  <span className={styles.muted}>
                    {formatGeneratedAt(message.createdAt)}
                  </span>
                </div>
                <p className={styles.chatBody}>{message.content}</p>
                {message.citations && message.citations.length > 0 ? (
                  <ul className={styles.chatCitations}>
                    {message.citations.slice(0, 4).map((citation, index) => (
                      <li key={`${message.id}-${index}`}>
                        <span>{citation.source}</span>
                        <em>{citation.detail}</em>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form className={styles.chatComposer} onSubmit={onSubmit}>
        <label className={styles.srOnly} htmlFor="ai-chat-input">
          Pregunta al copiloto
        </label>
        <textarea
          id="ai-chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          placeholder="Ej. ¿Hay anomalías de reembolsos en este periodo?"
          disabled={loading}
        />
        <Button type="submit" size="sm" disabled={loading || !draft.trim()}>
          Preguntar
        </Button>
      </form>
    </div>
  );
}
