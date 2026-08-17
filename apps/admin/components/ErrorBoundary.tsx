'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

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
    return (
      <main
        role="alert"
        style={{ maxWidth: 560, margin: '10vh auto', padding: 32, textAlign: 'center' }}
      >
        <h1>No pudimos mostrar esta pantalla</h1>
        <p>{this.state.error.message || 'Ocurrió un error inesperado.'}</p>
        <button
          type="button"
          onClick={() => {
            this.setState({ error: null });
            window.location.reload();
          }}
        >
          Reintentar
        </button>
      </main>
    );
  }
}
