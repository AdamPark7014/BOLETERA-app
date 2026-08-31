'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, PageHeader, Section } from '@boletera/ui';
import type { CuratedMarketingCard, SiteContent, SiteHeroSlide } from '@boletera/shared';
import { adminApi, getStoredToken } from '@/lib/api';
import { readLogoFileAsDataUrl } from '../branding/branding-utils';
import styles from './content.module.scss';

function emptySlide(): SiteHeroSlide {
  return { url: '', label: 'Nueva diapositiva', alt: 'Imagen promocional' };
}

function emptyCard(): CuratedMarketingCard {
  return {
    title: 'Nueva tarjeta',
    subtitle: '',
    href: '/categoria/MUSIC',
    image: '',
  };
}

export default function SiteContentPage() {
  const [content, setContent] = useState<SiteContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newCityName, setNewCityName] = useState('');

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

  const updateCard = useCallback((index: number, patch: Partial<CuratedMarketingCard>) => {
    setContent((prev) => {
      if (!prev) return prev;
      const curatedCards = prev.curatedCards.map((c, i) => (i === index ? { ...c, ...patch } : c));
      return { ...prev, curatedCards };
    });
  }, []);

  async function onPickImage(file: File | null, apply: (dataUrl: string) => void) {
    if (!file) return;
    try {
      const dataUrl = await readLogoFileAsDataUrl(file);
      apply(dataUrl);
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
      const payload: SiteContent = {
        ...content,
        heroHeadline: content.heroHeadline?.trim() || undefined,
        heroSubcopy: content.heroSubcopy?.trim() || undefined,
      };
      await adminApi('/admin/site-content', token, {
        method: 'POST',
        body: JSON.stringify({ siteContent: payload }),
      });
      setNotice('Contenido guardado. La tienda lo refleja al recargar.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  const cityEntries = content
    ? Object.entries(content.cityImages).sort(([a], [b]) => a.localeCompare(b, 'es'))
    : [];

  return (
    <>
      <PageHeader
        title="Contenido web"
        description="Hero de la tienda, imágenes promocionales y fotos por ciudad. Los eventos se editan en cada ficha del evento (póster y banner)."
      />

      {loading && <p className={styles.muted}>Cargando…</p>}

      {!loading && content && (
        <>
          <Section
            title="Copy del hero"
            description="Opcional. Si lo dejas vacío, la tienda usa el texto por defecto (útil en subdominios que no digan «todo México»)."
          >
            <div className={styles.copyFields}>
              <Input
                label="Titular"
                value={content.heroHeadline ?? ''}
                placeholder="Vive la emoción en vivo"
                onChange={(e) =>
                  setContent((prev) =>
                    prev ? { ...prev, heroHeadline: e.target.value } : prev,
                  )
                }
              />
              <label className={styles.textareaLabel}>
                <span>Subcopy</span>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  value={content.heroSubcopy ?? ''}
                  placeholder="Boletos oficiales para conciertos, festivales y deportes…"
                  onChange={(e) =>
                    setContent((prev) =>
                      prev ? { ...prev, heroSubcopy: e.target.value } : prev,
                    )
                  }
                />
              </label>
            </div>
          </Section>

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
                          onChange={(e) =>
                            onPickImage(e.target.files?.[0] ?? null, (url) =>
                              updateSlide(index, { url }),
                            )
                          }
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
            </div>
          </Section>

          <Section
            title="Tarjetas destacadas"
            description="Se muestran en «Experiencias destacadas» y cuando la cartelera está vacía. URL de imagen o subida local (data-URL, como el logo)."
          >
            <div className={styles.slides}>
              {content.curatedCards.map((card, index) => (
                <Card key={index} padding="md" className={styles.slideCard}>
                  <div className={styles.preview}>
                    {card.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={card.image} alt="" />
                    ) : (
                      <span>Sin imagen</span>
                    )}
                  </div>
                  <div className={styles.fields}>
                    <Input
                      label="Título"
                      value={card.title}
                      onChange={(e) => updateCard(index, { title: e.target.value })}
                    />
                    <Input
                      label="Subtítulo"
                      value={card.subtitle}
                      onChange={(e) => updateCard(index, { subtitle: e.target.value })}
                    />
                    <Input
                      label="Enlace"
                      value={card.href}
                      placeholder="/categoria/MUSIC"
                      onChange={(e) => updateCard(index, { href: e.target.value })}
                    />
                    <Input
                      label="URL de imagen"
                      value={
                        card.image.startsWith('data:')
                          ? '(imagen cargada desde archivo)'
                          : card.image
                      }
                      placeholder="https://…"
                      onChange={(e) => updateCard(index, { image: e.target.value })}
                      disabled={card.image.startsWith('data:')}
                    />
                    <div className={styles.row}>
                      <label className={styles.fileBtn}>
                        Subir archivo
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          hidden
                          onChange={(e) =>
                            onPickImage(e.target.files?.[0] ?? null, (image) =>
                              updateCard(index, { image }),
                            )
                          }
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
                                  curatedCards: prev.curatedCards.filter((_, i) => i !== index),
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
                    prev
                      ? { ...prev, curatedCards: [...prev.curatedCards, emptyCard()] }
                      : prev,
                  )
                }
              >
                Añadir tarjeta
              </Button>
            </div>
          </Section>

          <Section
            title="Imágenes por ciudad"
            description="Clave = nombre exacto de la ciudad (como sale en facetas). URL o archivo."
          >
            <div className={styles.slides}>
              {cityEntries.map(([city, url]) => (
                <Card key={city} padding="md" className={styles.slideCard}>
                  <div className={styles.preview}>
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={city} />
                    ) : (
                      <span>Sin imagen</span>
                    )}
                  </div>
                  <div className={styles.fields}>
                    <Input label="Ciudad" value={city} disabled />
                    <Input
                      label="URL de imagen"
                      value={url.startsWith('data:') ? '(imagen cargada desde archivo)' : url}
                      placeholder="https://…"
                      onChange={(e) =>
                        setContent((prev) => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            cityImages: { ...prev.cityImages, [city]: e.target.value },
                          };
                        })
                      }
                      disabled={url.startsWith('data:')}
                    />
                    <div className={styles.row}>
                      <label className={styles.fileBtn}>
                        Subir archivo
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          hidden
                          onChange={(e) =>
                            onPickImage(e.target.files?.[0] ?? null, (image) =>
                              setContent((prev) => {
                                if (!prev) return prev;
                                return {
                                  ...prev,
                                  cityImages: { ...prev.cityImages, [city]: image },
                                };
                              }),
                            )
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setContent((prev) => {
                            if (!prev) return prev;
                            const next = { ...prev.cityImages };
                            delete next[city];
                            return { ...prev, cityImages: next };
                          })
                        }
                      >
                        Quitar
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
            <div className={styles.addCity}>
              <Input
                label="Nueva ciudad"
                value={newCityName}
                placeholder="Guadalajara"
                onChange={(e) => setNewCityName(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const name = newCityName.trim();
                  if (!name) return;
                  setContent((prev) => {
                    if (!prev) return prev;
                    if (prev.cityImages[name]) return prev;
                    return {
                      ...prev,
                      cityImages: { ...prev.cityImages, [name]: '' },
                    };
                  });
                  setNewCityName('');
                }}
              >
                Añadir ciudad
              </Button>
            </div>
          </Section>

          <div className={styles.actions}>
            <Button type="button" variant="primary" loading={saving} onClick={save}>
              Guardar contenido
            </Button>
          </div>
          {notice && <p className={styles.notice}>{notice}</p>}
        </>
      )}
    </>
  );
}
