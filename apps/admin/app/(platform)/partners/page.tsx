'use client';

import { FormEvent, useEffect, useState } from 'react';
import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/platform-api';
import { useOrgId } from '@/lib/use-org';
import platform from '../_styles/platform.module.scss';

type KeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  rateLimit: number;
  active: boolean;
  createdAt: string;
};

export default function PartnersPage() {
  const orgId = useOrgId();
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [name, setName] = useState('Integración POS');

  function reload() {
    const token = localStorage.getItem('boletera_token');
    if (!token || !orgId) return;
    listApiKeys(token, orgId).then(setKeys).catch(() => setKeys([]));
  }

  useEffect(() => {
    reload();
  }, [orgId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem('boletera_token');
    if (!token || !orgId) return;
    const created = await createApiKey(token, orgId, { name });
    setSecret(created.secret);
    setName('');
    reload();
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Partners & API Keys</h1>
          <p>Integraciones B2B estilo Palco4 Connect — inventario, órdenes y reportes</p>
        </div>
      </header>

      {secret && (
        <section className={platform.panel} style={{ borderColor: '#10b981' }}>
          <h2>Copia tu clave ahora</h2>
          <code style={{ wordBreak: 'break-all', fontSize: '0.85rem' }}>{secret}</code>
          <p style={{ marginTop: '0.75rem', color: 'var(--bl-gray-500)' }}>
            Solo se muestra una vez. Guárdala en tu vault.
          </p>
          <button type="button" className={platform.ghostBtn} onClick={() => setSecret(null)}>
            Entendido
          </button>
        </section>
      )}

      <section className={platform.panel}>
        <form onSubmit={onCreate} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre de la integración"
            required
            style={{
              flex: 1,
              minWidth: 200,
              padding: '0.625rem 0.875rem',
              borderRadius: 8,
              border: '1px solid #e7e7ea',
            }}
          />
          <button type="submit" className={platform.primaryBtn}>
            Generar API key
          </button>
        </form>
      </section>

      <section className={platform.panel}>
        <table className={platform.table}>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Prefijo</th>
              <th>Scopes</th>
              <th>Límite/min</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td>
                  <code>{k.keyPrefix}…</code>
                </td>
                <td>{k.scopes.join(', ')}</td>
                <td>{k.rateLimit}</td>
                <td>{k.active ? 'Activa' : 'Revocada'}</td>
                <td>
                  {k.active && (
                    <button
                      type="button"
                      className={platform.ghostBtn}
                      onClick={async () => {
                        const token = localStorage.getItem('boletera_token')!;
                        await revokeApiKey(token, orgId!, k.id);
                        reload();
                      }}
                    >
                      Revocar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!keys.length && <p style={{ marginTop: '1rem', color: 'var(--bl-gray-500)' }}>Sin API keys.</p>}
      </section>
    </div>
  );
}
