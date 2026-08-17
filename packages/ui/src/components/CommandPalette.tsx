'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { cx } from '../lib/cx';
import { bestMatch, fuzzyMatch, highlightSegments } from '../lib/fuzzy';
import {
  useControllableState,
  useEscapeKey,
  useLockBodyScroll,
  useMounted,
} from '../lib/hooks';
import styles from './CommandPalette.module.scss';

/** Comando ejecutable desde la paleta. */
export interface CommandAction {
  id: string;
  /** Texto principal; es lo que se busca y se resalta. */
  label: string;
  /** Segunda linea con contexto. */
  description?: string;
  /** Terminos alternativos por los que tambien debe encontrarse. */
  keywords?: readonly string[];
  /** Nombre del grupo. Los comandos sin grupo van a "General". */
  group?: string;
  /** Icono decorativo. */
  icon?: ReactNode;
  /** Teclas mostradas a la derecha, p. ej. `['G', 'E']`. */
  shortcut?: readonly string[];
  disabled?: boolean;
  /** Se ejecuta al elegir el comando. La paleta se cierra despues. */
  onSelect: () => void;
}

export interface CommandPaletteProps {
  actions: readonly CommandAction[];
  /** Apertura controlada. Omitela para dejar que la paleta se gestione sola. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Registra el atajo global Cmd+K / Ctrl+K. Por defecto `true`. */
  hotkey?: boolean;
  placeholder?: string;
  /** Mensaje cuando la busqueda no arroja resultados. */
  emptyMessage?: string;
  /** Orden explicito de los grupos. Los no listados van al final, alfabeticamente. */
  groupOrder?: readonly string[];
  className?: string;
}

const DEFAULT_GROUP = 'General';

interface ScoredAction {
  action: CommandAction;
  score: number;
  indices: readonly number[];
}

/**
 * Paleta de comandos tipo Raycast: se abre con Cmd+K o Ctrl+K, filtra por
 * coincidencia difusa, agrupa los resultados y se maneja por completo con el
 * teclado (flechas, Inicio/Fin, Enter, Escape).
 *
 * Implementa el patron `combobox` con `listbox`: el foco permanece en el campo
 * de texto y la opcion activa se comunica con `aria-activedescendant`.
 *
 * @example
 * <CommandPalette actions={[{ id: 'new', label: 'Nuevo evento', onSelect: crear }]} />
 */
export function CommandPalette({
  actions,
  open: controlledOpen,
  onOpenChange,
  hotkey = true,
  placeholder = 'Buscar comandos, eventos, pedidos...',
  emptyMessage = 'Sin coincidencias. Prueba con otro termino.',
  groupOrder,
  className,
}: CommandPaletteProps) {
  const baseId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const mounted = useMounted();

  const [open, setOpen] = useControllableState(controlledOpen, false, onOpenChange);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const close = useCallback(() => setOpen(false), [setOpen]);

  useEscapeKey(close, open);
  useLockBodyScroll(open);

  useEffect(() => {
    if (!hotkey) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen(!open);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [hotkey, open, setOpen]);

  // Cada apertura empieza limpia: la paleta es para actuar, no para recordar.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const scored = useMemo<ScoredAction[]>(() => {
    const enabled = actions.filter((action) => !action.disabled);
    if (query.trim().length === 0) {
      return enabled.map((action) => ({ action, score: 0, indices: [] }));
    }
    const results: ScoredAction[] = [];
    for (const action of enabled) {
      const match = bestMatch(action.label, action.keywords ?? [], query);
      if (!match) continue;
      const labelMatch = fuzzyMatch(action.label, query);
      results.push({ action, score: match.score, indices: labelMatch?.indices ?? [] });
    }
    return results.sort((a, b) => b.score - a.score);
  }, [actions, query]);

  const groups = useMemo(() => {
    const map = new Map<string, ScoredAction[]>();
    for (const entry of scored) {
      const name = entry.action.group ?? DEFAULT_GROUP;
      const bucket = map.get(name);
      if (bucket) bucket.push(entry);
      else map.set(name, [entry]);
    }

    const order = groupOrder ?? [];
    return Array.from(map.entries()).sort(([a], [b]) => {
      const rankA = order.indexOf(a);
      const rankB = order.indexOf(b);
      if (rankA !== -1 || rankB !== -1) {
        return (rankA === -1 ? order.length : rankA) - (rankB === -1 ? order.length : rankB);
      }
      return a.localeCompare(b, 'es-MX');
    });
  }, [scored, groupOrder]);

  // Orden plano visible, que es sobre el que navegan las flechas.
  const flat = useMemo(() => groups.flatMap(([, entries]) => entries), [groups]);

  useEffect(() => {
    setActiveIndex((current) => (current >= flat.length ? 0 : current));
  }, [flat.length]);

  const run = useCallback(
    (entry: ScoredAction | undefined) => {
      if (!entry) return;
      close();
      entry.action.onSelect();
    },
    [close],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (flat.length === 0) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setActiveIndex((current) => (current + 1) % flat.length);
          break;
        case 'ArrowUp':
          event.preventDefault();
          setActiveIndex((current) => (current - 1 + flat.length) % flat.length);
          break;
        case 'Home':
          event.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setActiveIndex(flat.length - 1);
          break;
        case 'Enter':
          event.preventDefault();
          run(flat[activeIndex]);
          break;
        default:
          break;
      }
    },
    [flat, activeIndex, run],
  );

  // Mantiene visible la opcion activa al navegar con el teclado.
  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  if (!open || !mounted) return null;

  const activeId = flat[activeIndex] ? `${baseId}-option-${flat[activeIndex].action.id}` : undefined;
  let cursor = -1;

  return (
    <div className={cx(styles.layer, className)}>
      <div className={styles.backdrop} onClick={close} role="presentation" />

      <div className={styles.palette} role="dialog" aria-modal="true" aria-label="Paleta de comandos">
        <div className={styles.searchRow}>
          <svg className={styles.searchIcon} viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5 14 14" />
          </svg>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            role="combobox"
            value={query}
            placeholder={placeholder}
            aria-label="Buscar comandos"
            aria-expanded="true"
            aria-controls={`${baseId}-list`}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className={styles.escHint}>Esc</kbd>
        </div>

        <div ref={listRef} id={`${baseId}-list`} role="listbox" aria-label="Comandos" className={styles.list}>
          {flat.length === 0 ? (
            <p className={styles.empty}>{emptyMessage}</p>
          ) : (
            groups.map(([groupName, entries]) => (
              <div key={groupName} role="group" aria-label={groupName} className={styles.group}>
                <p className={styles.groupLabel}>{groupName}</p>
                {entries.map((entry) => {
                  cursor += 1;
                  const isActive = cursor === activeIndex;
                  const index = cursor;
                  return (
                    <div
                      key={entry.action.id}
                      id={`${baseId}-option-${entry.action.id}`}
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive}
                      className={cx(styles.option, isActive && styles.optionActive)}
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => run(entry)}
                    >
                      {entry.action.icon ? (
                        <span className={styles.optionIcon} aria-hidden="true">
                          {entry.action.icon}
                        </span>
                      ) : null}

                      <span className={styles.optionText}>
                        <span className={styles.optionLabel}>
                          {highlightSegments(entry.action.label, entry.indices).map(
                            (segment, segmentIndex) =>
                              segment.matched ? (
                                <mark key={segmentIndex} className={styles.mark}>
                                  {segment.text}
                                </mark>
                              ) : (
                                <span key={segmentIndex}>{segment.text}</span>
                              ),
                          )}
                        </span>
                        {entry.action.description ? (
                          <span className={styles.optionDescription}>{entry.action.description}</span>
                        ) : null}
                      </span>

                      {entry.action.shortcut && entry.action.shortcut.length > 0 ? (
                        <span className={styles.shortcut} aria-hidden="true">
                          {entry.action.shortcut.map((key) => (
                            <kbd key={key}>{key}</kbd>
                          ))}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <footer className={styles.footer} aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navegar
          </span>
          <span>
            <kbd>↵</kbd> ejecutar
          </span>
          <span>
            <kbd>Esc</kbd> cerrar
          </span>
        </footer>
      </div>
    </div>
  );
}
