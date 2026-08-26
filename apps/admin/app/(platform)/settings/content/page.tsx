'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, PageHeader, Section } from '@boletera/ui';
import type { SiteContent, SiteHeroSlide } from '@boletera/shared';
import { adminApi, getStoredToken } from '@/lib/api';
import { readLogoFileAsDataUrl } from '../branding/branding-utils';
import styles from './content.module.scss';

function emptySlide(): SiteHeroSlide {
  return { url: '', label: 'Nueva diapositiva', alt: 'Imagen promocional' };
}

export default function SiteContentPage() {
  const [content, setContent] = useState<SiteContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }
    adminApi<SiteContent>('/admin/site-content', token)
      .then(setContent)
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, []);

  const updateSlide = useCallback((index: number, patch: Partial<SiteHeroSlide>) => {
    setContent((prev) => {
      if (!prev) return prev;
      const heroSlides = prev.heroSlides.map((s, i) => (i === index ? { ...s, ...patch } : s));
      return { ...prev, heroSlides };
    });
  }, []);

  async function onPickImage(index: number, file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await readLogoFileAsDataUrl(file);
      updateSlide(index, { url: dataUrl });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'No se pudo leer la imagen');
    }
  }

  async function save() {
    if (!content) return;
    setSaving(true);
    setNotice(null);
    try {
      const token = getStoredToken();
      if (!token) throw new Error('Inicia sesión de nuevo');
      await adminApi('/admin/site-content', token, {
        method: 'POST',
        body: JSON.stringify({ siteContent: content }),
      });
      setNotice('Contenido guardado. La tienda lo refleja al recargar.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Contenido web"
        description="Hero de la tienda, imágenes promocionales y fotos por ciudad. Los eventos se editan en cada ficha del evento (póster y banner)."
      />

      {loading && <p className={styles.muted}>Cargando…</p>}

      {!loading && content && (
        <Section title="Carrusel del hero" description="Orden de arriba a abajo = orden en la home.">
          <div className={styles.slides}>
            {content.heroSlides.map((slide, index) => (
              <Card key={index} padding="md" className={styles.slideCard}>
                <div className={styles.preview}>
                  {slide.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={slide.url} alt={slide.alt} />
                  ) : (
                    <span>Sin imagen</span>
                  )}
                </div>
                <div className={styles.fields}>
                  <Input
                    label="Etiqueta"
                    value={slide.label}
                    onChange={(e) => updateSlide(index, { label: e.target.value })}
                  />
                  <Input
                    label="Texto alternativo"
                    value={slide.alt}
                    onChange={(e) => updateSlide(index, { alt: e.target.value })}
                  />
                  <Input
                    label="URL de imagen"
                    value={slide.url.startsWith('data:') ? '(imagen cargada desde archivo)' : slide.url}
                    placeholder="https://… o /hero/foto.jpg"
                    onChange={(e) => updateSlide(index, { url: e.target.value })}
                    disabled={slide.url.startsWith('data:')}
                  />
                  <div className={styles.row}>
                    <label className={styles.fileBtn}>
                      Subir archivo
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        hidden
                        onChange={(e) => onPickImage(index, e.target.files?.[0] ?? null)}
                      />
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setContent((prev) =>
                          prev
                            ? {
                                ...prev,
                                heroSlides: prev.heroSlides.filter((_, i) => i !== index),
                              }
                            : prev,
                        )
                      }
                    >
                      Quitar
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <div className={styles.actions}>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setContent((prev) =>
                  prev ? { ...prev, heroSlides: [...prev.heroSlides, emptySlide()] } : prev,
                )
              }
            >
              Añadir diapositiva
            </Button>
            <Button type="button" variant="primary" loading={saving} onClick={save}>
              Guardar contenido
            </Button>
          </div>
          {notice && <p className={styles.notice}>{notice}</p>}
        </Section>
      )}
    </>
  );
}
