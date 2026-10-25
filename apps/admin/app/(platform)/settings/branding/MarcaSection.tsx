'use client';

import { useEffect, useState } from 'react';
import { Field, ParameterCard, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import { Param } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import { asRecord, readString } from '../../events/_ticket/read';

type Slide = { url: string; label: string; alt: string };
type Card = { title: string; subtitle: string; href: string; image: string };
type City = { city: string; url: string };

type Content = {
  heroSlides: Slide[];
  curatedCards: Card[];
  cityImages: City[];
  heroHeadline: string;
  heroSubcopy: string;
};

type Theme = {
  saved: boolean;
  primaryColor: string;
  secondaryColor: string | null;
  logoUrl: string;
  faviconUrl: string | null;
  customDomain: string | null;
  subdomain: string;
};

function text(value: string | null | undefined): string {
  return value && value.trim() ? value : '—';
}

function readTheme(payload: unknown): Theme {
  const row = asRecord(payload);
  const saved = Boolean(readString(row.id));
  return {
    saved,
    primaryColor: readString(row.primaryColor) ?? '#171717',
    secondaryColor: readString(row.secondaryColor),
    logoUrl: readString(row.logoUrl) ?? '',
    faviconUrl: readString(row.faviconUrl),
    customDomain: readString(row.customDomain),
    subdomain: saved ? (readString(row.subdomain) ?? '') : '',
  };
}

function readSlide(raw: unknown): Slide | null {
  const row = asRecord(raw);
  const url = readString(row.url);
  if (!url) return null;
  return { url, label: readString(row.label) ?? '', alt: readString(row.alt) ?? '' };
}

function readCard(raw: unknown): Card | null {
  const row = asRecord(raw);
  const title = readString(row.title);
  if (!title) return null;
  return {
    title,
    subtitle: readString(row.subtitle) ?? '',
    href: readString(row.href) ?? '',
    image: readString(row.image) ?? '',
  };
}

function readContent(payload: unknown): Content {
  const row = asRecord(payload);
  const slides = Array.isArray(row.heroSlides) ? row.heroSlides.flatMap((item) => {
    const slide = readSlide(item);
    return slide ? [slide] : [];
  }) : [];
  const cards = Array.isArray(row.curatedCards) ? row.curatedCards.flatMap((item) => {
    const card = readCard(item);
    return card ? [card] : [];
  }) : [];
  const cities = asRecord(row.cityImages);
  return {
    heroSlides: slides,
    curatedCards: cards,
    cityImages: Object.entries(cities).flatMap(([city, url]) => {
      const value = readString(url);
      return value ? [{ city, url: value }] : [];
    }),
    heroHeadline: readString(row.heroHeadline) ?? '',
    heroSubcopy: readString(row.heroSubcopy) ?? '',
  };
}

function contentBody(content: Content): Record<string, unknown> {
  return {
    heroSlides: content.heroSlides,
    curatedCards: content.curatedCards,
    cityImages: Object.fromEntries(content.cityImages.map((item) => [item.city, item.url])),
    ...(content.heroHeadline.trim() ? { heroHeadline: content.heroHeadline.trim() } : {}),
    ...(content.heroSubcopy.trim() ? { heroSubcopy: content.heroSubcopy.trim() } : {}),
  };
}

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  return 'No se guardó. Revisa la conexión.';
}

export function MarcaBody() {
  const session = useSession();
  const [theme, setTheme] = useState<Theme | null>(null);
  const [color, setColor] = useState('#171717');
  const [logo, setLogo] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [content, setContent] = useState<Content | null>(null);
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const canEdit = hasCapability(session.role, 'settings.branding');

  useEffect(() => {
    if (!token || !canEdit) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setError(null);
    Promise.all([
      adminApi<unknown>('/admin/branding', token),
      adminApi<unknown>('/admin/site-content', token),
    ])
      .then(([branding, site]) => {
        if (!alive) return;
        const nextTheme = readTheme(branding);
        const nextContent = readContent(site);
        setTheme(nextTheme);
        setColor(nextTheme.primaryColor);
        setLogo(nextTheme.logoUrl);
        setSubdomain(nextTheme.subdomain);
        setContent(nextContent);
        setBaseline(JSON.stringify(contentBody(nextContent)));
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, canEdit, session.status, nonce]);

  const themeDirty =
    theme != null &&
    (color !== theme.primaryColor || logo !== theme.logoUrl || subdomain !== theme.subdomain);
  const contentDirty = content != null && JSON.stringify(contentBody(content)) !== baseline;
  const dirty = themeDirty || contentDirty;

  async function save() {
    if (!token || !dirty || saving) return;
    setSaving(true);
    setActionError(null);
    const lines: string[] = [];
    try {
      if (themeDirty && theme) {
        const body: Record<string, string> = {};
        if (color !== theme.primaryColor) body.primaryColor = color.trim();
        if (logo !== theme.logoUrl) body.logoUrl = logo.trim();
        if (subdomain !== theme.subdomain) body.subdomain = subdomain.trim();
        await adminApi('/admin/branding', token, { method: 'POST', body: JSON.stringify(body) });
        lines.push('Marca actualizada');
      }
      if (contentDirty && content) {
        await adminApi('/admin/site-content', token, {
          method: 'POST',
          body: JSON.stringify({ siteContent: contentBody(content) }),
        });
        lines.push('Contenido actualizado');
      }
      setNotice(lines.join(' · '));
      setNonce((current) => current + 1);
    } catch (cause) {
      setActionError(failMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canEdit && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Marca y contenido</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView error={error} context="abrir marca" onRetry={() => setNonce((current) => current + 1)} />
    );
  }
  if (loading || !theme || !content) return <p className={styles.quiet}>Cargando marca.</p>;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Marca y contenido</h1>
        <p className={styles.quiet}>
          Estos colores no pintan Black Ticket. Se guardan color primario, logo, subdominio y el
          contenido que el API ya acepta. Si no había contenido, lo que se ve es la reserva de la web.
          Lo demás se lee.
        </p>
      </header>
      <div className={styles.stack}>
        <Param name="Color primario">
          <ParameterCard name="Color primario" value={color || '—'} valueStyle="mono" effect="Columna de marca. No pinta el producto.">
            <Field label="Color primario" value={color} onChange={(event) => { setColor(event.target.value); setNotice(null); }} />
          </ParameterCard>
        </Param>
        <Param name="Color secundario">
          <ParameterCard
            name="Color secundario"
            value={text(theme.secondaryColor)}
            valueStyle="mono"
            effect="Esta ruta no lo guarda."
          />
        </Param>
        <Param name="Logo">
          <ParameterCard name="Logo" value={logo || 'Sin imagen'} effect="Dirección que usa la cartelera. No es un archivo.">
            <Field label="Logo" value={logo} onChange={(event) => { setLogo(event.target.value); setNotice(null); }} />
          </ParameterCard>
        </Param>
        <Param name="Favicon">
          <ParameterCard name="Favicon" value={text(theme.faviconUrl)} effect="Esta ruta no lo guarda." />
        </Param>
        <Param name="Dominio propio">
          <ParameterCard name="Dominio propio" value={text(theme.customDomain)} effect="Esta ruta no lo guarda." />
        </Param>
        <Param name="Subdominio">
          <ParameterCard name="Subdominio" value={subdomain || '—'} valueStyle="mono" effect="Subdominio de la cartelera.">
            <Field label="Subdominio" value={subdomain} onChange={(event) => { setSubdomain(event.target.value); setNotice(null); }} />
          </ParameterCard>
        </Param>
        <Param name="Titular">
          <ParameterCard name="Titular" value={content.heroHeadline || '—'} effect="Titular del home.">
            <Field
              label="Titular"
              value={content.heroHeadline}
              onChange={(event) => setContent((current) => current && { ...current, heroHeadline: event.target.value })}
            />
          </ParameterCard>
        </Param>
        <Param name="Subtítulo">
          <ParameterCard name="Subtítulo" value={content.heroSubcopy || '—'} effect="Bajada del home.">
            <Field
              label="Subtítulo"
              value={content.heroSubcopy}
              onChange={(event) => setContent((current) => current && { ...current, heroSubcopy: event.target.value })}
            />
          </ParameterCard>
        </Param>
        {content.heroSlides.map((slide, index) => (
          <HeroFields
            key={`hero-${index}`}
            slide={slide}
            onChange={(next) =>
              setContent((current) => {
                if (!current) return current;
                const heroSlides = current.heroSlides.slice();
                heroSlides[index] = next;
                return { ...current, heroSlides };
              })
            }
          />
        ))}
        {content.curatedCards.map((card, index) => (
          <CardFields
            key={`card-${index}`}
            card={card}
            onChange={(next) =>
              setContent((current) => {
                if (!current) return current;
                const curatedCards = current.curatedCards.slice();
                curatedCards[index] = next;
                return { ...current, curatedCards };
              })
            }
          />
        ))}
        {content.cityImages.map((city) => (
          <Param key={city.city} name={`Foto por ciudad ${city.city}`}>
            <ParameterCard name="Foto por ciudad" value={city.url} effect={city.city}>
              <Field
                label={`Foto de ${city.city}`}
                value={city.url}
                onChange={(event) =>
                  setContent((current) => {
                    if (!current) return current;
                    return {
                      ...current,
                      cityImages: current.cityImages.map((item) =>
                        item.city === city.city ? { ...item, url: event.target.value } : item,
                      ),
                    };
                  })
                }
              />
            </ParameterCard>
          </Param>
        ))}
      </div>
      {actionError ? (
        <p className={styles.danger} role="alert">
          {actionError}
        </p>
      ) : null}
      <div className={styles.saveBar}>
        <p className={styles.quiet} aria-live="polite">
          {dirty ? 'Sin guardar' : (notice ?? '')}
        </p>
        <TicketButton disabled={!dirty || saving} onClick={() => void save()}>
          Guardar sección
        </TicketButton>
      </div>
    </section>
  );
}

function HeroFields({ slide, onChange }: { slide: Slide; onChange: (next: Slide) => void }) {
  return (
    <>
      <Param name="Hero, URL">
        <ParameterCard name="Hero, URL" value={slide.url || '—'} effect="Dirección de la diapositiva.">
          <Field label="Hero, URL" value={slide.url} onChange={(event) => onChange({ ...slide, url: event.target.value })} />
        </ParameterCard>
      </Param>
      <Param name="Hero, etiqueta">
        <ParameterCard name="Hero, etiqueta" value={slide.label || '—'} effect="Etiqueta de la diapositiva.">
          <Field label="Hero, etiqueta" value={slide.label} onChange={(event) => onChange({ ...slide, label: event.target.value })} />
        </ParameterCard>
      </Param>
      <Param name="Hero, texto alterno">
        <ParameterCard name="Hero, texto alterno" value={slide.alt || '—'} effect="Texto alterno de la diapositiva.">
          <Field label="Hero, texto alterno" value={slide.alt} onChange={(event) => onChange({ ...slide, alt: event.target.value })} />
        </ParameterCard>
      </Param>
    </>
  );
}

function CardFields({ card, onChange }: { card: Card; onChange: (next: Card) => void }) {
  return (
    <>
      <Param name="Tarjeta, título">
        <ParameterCard name="Tarjeta, título" value={card.title || '—'} effect="Tarjeta curada.">
          <Field label="Tarjeta, título" value={card.title} onChange={(event) => onChange({ ...card, title: event.target.value })} />
        </ParameterCard>
      </Param>
      <Param name="Tarjeta, subtítulo">
        <ParameterCard name="Tarjeta, subtítulo" value={card.subtitle || '—'} effect="Tarjeta curada.">
          <Field label="Tarjeta, subtítulo" value={card.subtitle} onChange={(event) => onChange({ ...card, subtitle: event.target.value })} />
        </ParameterCard>
      </Param>
      <Param name="Tarjeta, enlace">
        <ParameterCard name="Tarjeta, enlace" value={card.href || '—'} effect="Enlace de la tarjeta.">
          <Field label="Tarjeta, enlace" value={card.href} onChange={(event) => onChange({ ...card, href: event.target.value })} />
        </ParameterCard>
      </Param>
      <Param name="Tarjeta, imagen">
        <ParameterCard name="Tarjeta, imagen" value={card.image || 'Sin imagen'} effect="Dirección de la imagen.">
          <Field label="Tarjeta, imagen" value={card.image} onChange={(event) => onChange({ ...card, image: event.target.value })} />
        </ParameterCard>
      </Param>
    </>
  );
}
