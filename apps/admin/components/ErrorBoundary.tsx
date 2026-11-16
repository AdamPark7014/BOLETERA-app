'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BlackTicketRoot, TicketButton, TicketState } from '@boletera/ui';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Error no controlado en el panel administrativo', error, info);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    // El texto técnico del error queda en la consola; la pantalla no lo muestra.
    return (
      <BlackTicketRoot density="admin">
        <main
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            background: 'var(--ink)',
            color: 'var(--text)',
          }}
        >
          <TicketState
            kind="error"
            title="No pudimos mostrar esta pantalla"
            action={
              <TicketButton
                onClick={() => {
                  this.setState({ error: null });
                  window.location.reload();
                }}
              >
                Reintentar
              </TicketButton>
            }
          />
        </main>
      </BlackTicketRoot>
    );
  }
}
