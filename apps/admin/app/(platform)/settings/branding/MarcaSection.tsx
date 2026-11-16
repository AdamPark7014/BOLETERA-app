'use client';

import { NoAccess } from '@/app/(platform)/events/_ticket/NoAccess';
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
  const slides = Array.isArray(row.heroSlides)
    ? row.heroSlides.flatMap((item) => {
        const slide = readSlide(item);
        return slide ? [slide] : [];
      })
    : [];
  const cards = Array.isArray(row.curatedCards)
    ? row.curatedCards.flatMap((item) => {
        const card = readCard(item);
        return card ? [card] : [];
      })
    : [];
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

export function MarcaBody({ title = 'Marca' }: { title?: string }) {
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
          <h1 className={styles.sectionTitle}>{title}</h1>
          <NoAccess />
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir marca"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (loading || !theme || !content) return <p className={styles.quiet}>Cargando marca.</p>;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>{title}</h1>
      </header>
      <div className={styles.stack}>
        <Param name="Color primario">
          <ParameterCard
            name="Color primario"
            value={color || '—'}
            valueStyle="mono"
            effect="Color de tus páginas de venta."
          >
            <Field
              label="Color primario"
              value={color}
              onChange={(event) => {
                setColor(event.target.value);
                setNotice(null);
              }}
            />
          </ParameterCard>
        </Param>
        <Param name="Color secundario">
          <ParameterCard
            name="Color secundario"
            value={text(theme.secondaryColor)}
            valueStyle="mono"
            effect="No se edita desde aquí."
          />
        </Param>
        <Param name="Logo">
          <ParameterCard
            name="Logo"
            value={logo || 'Sin imagen'}
            effect="Dirección web de la imagen del logo."
          >
            <Field
              label="Logo"
              value={logo}
              onChange={(event) => {
                setLogo(event.target.value);
                setNotice(null);
              }}
            />
          </ParameterCard>
        </Param>
        <Param name="Favicon">
          <ParameterCard
            name="Favicon"
            value={text(theme.faviconUrl)}
            effect="No se edita desde aquí."
          />
        </Param>
        <Param name="Dominio propio">
          <ParameterCard
            name="Dominio propio"
            value={text(theme.customDomain)}
            effect="No se edita desde aquí."
          />
        </Param>
        <Param name="Subdominio">
          <ParameterCard
            name="Subdominio"
            value={subdomain || '—'}
            valueStyle="mono"
            effect="Subdominio de la cartelera."
          >
            <Field
              label="Subdominio"
              value={subdomain}
              onChange={(event) => {
                setSubdomain(event.target.value);
                setNotice(null);
              }}
            />
          </ParameterCard>
        </Param>
        <Param name="Titular">
          <ParameterCard
            name="Titular"
            value={content.heroHeadline || '—'}
            effect="Titular de la portada."
          >
            <Field
              label="Titular"
              value={content.heroHeadline}
              onChange={(event) =>
                setContent((current) => current && { ...current, heroHeadline: event.target.value })
              }
            />
          </ParameterCard>
        </Param>
        <Param name="Subtítulo">
          <ParameterCard
            name="Subtítulo"
            value={content.heroSubcopy || '—'}
            effect="Texto bajo el titular de la portada."
          >
            <Field
              label="Subtítulo"
              value={content.heroSubcopy}
              onChange={(event) =>
                setContent((current) => current && { ...current, heroSubcopy: event.target.value })
              }
            />
          </ParameterCard>
        </Param>
        {content.heroSlides.map((slide, index) => (
          <HeroFields
            key={`hero-${index}`}
            slide={slide}
            position={index + 1}
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
            position={index + 1}
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
                        item.city === city.city ? { ...item, url: event.target.value } : item
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
          Guardar cambios
        </TicketButton>
      </div>
    </section>
  );
}

function HeroFields({
  slide,
  position,
  onChange,
}: {
  slide: Slide;
  position: number;
  onChange: (next: Slide) => void;
}) {
  const fields: { key: keyof Slide; label: string }[] = [
    { key: 'url', label: `Imagen ${position}: enlace` },
    { key: 'label', label: `Imagen ${position}: etiqueta` },
    { key: 'alt', label: `Imagen ${position}: descripción` },
  ];
  return (
    <>
      {fields.map(({ key, label }) => (
        <Param key={key} name={label}>
          <ParameterCard name={label} value={slide[key] || '—'}>
            <Field
              label={label}
              value={slide[key]}
              onChange={(event) => onChange({ ...slide, [key]: event.target.value })}
            />
          </ParameterCard>
        </Param>
      ))}
    </>
  );
}

function CardFields({
  card,
  position,
  onChange,
}: {
  card: Card;
  position: number;
  onChange: (next: Card) => void;
}) {
  const fields: { key: keyof Card; label: string; empty?: string }[] = [
    { key: 'title', label: `Tarjeta ${position}: título` },
    { key: 'subtitle', label: `Tarjeta ${position}: subtítulo` },
    { key: 'href', label: `Tarjeta ${position}: enlace` },
    { key: 'image', label: `Tarjeta ${position}: imagen`, empty: 'Sin imagen' },
  ];
  return (
    <>
      {fields.map(({ key, label, empty }) => (
        <Param key={key} name={label}>
          <ParameterCard name={label} value={card[key] || empty || '—'}>
            <Field
              label={label}
              value={card[key]}
              onChange={(event) => onChange({ ...card, [key]: event.target.value })}
            />
          </ParameterCard>
        </Param>
      ))}
    </>
  );
}
