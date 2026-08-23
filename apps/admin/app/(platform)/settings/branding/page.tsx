'use client';

import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';
import { getBranding } from '@/lib/platform-api';

export default function BrandingPage() {
  const [primaryColor, setPrimaryColor] = useState('#171717');
  const [subdomain, setSubdomain] = useState('demo');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('boletera_token');
    if (!token) return;
    getBranding(token)
      .then((data) => {
        if (data.primaryColor) setPrimaryColor(data.primaryColor);
        if (data.subdomain) setSubdomain(data.subdomain);
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    const token = localStorage.getItem('boletera_token');
    if (!token) return;
    await adminApi('/admin/branding', token, {
      method: 'POST',
      body: JSON.stringify({ primaryColor, subdomain }),
    });
    setSaved(true);
  }

  if (loading) return <p>Cargando branding…</p>;

  return (
    <div>
      <h1>White-label branding</h1>
      <label style={{ display: 'block', marginTop: '1rem' }}>
        Color primario
        <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
      </label>
      <label style={{ display: 'block', marginTop: '1rem' }}>
        Subdominio
        <input value={subdomain} onChange={(e) => setSubdomain(e.target.value)} />
      </label>
      <button type="button" onClick={save} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
        Guardar
      </button>
      {saved && <p style={{ marginTop: '0.5rem', color: 'var(--bl-gray-500)' }}>Guardado.</p>}
    </div>
  );
}
