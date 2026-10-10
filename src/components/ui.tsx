// Small building blocks shared by every screen: labels, meters, form controls, menus, popovers, and dialogs.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import { t } from "../i18n";

// MARK: Keyboard

interface KeyLayer {
  handler: (event: KeyboardEvent) => boolean | void;
  /// Modal layers keep shortcuts from reaching the screen underneath.
  blocking: boolean;
}

const keyLayers: KeyLayer[] = [];

window.addEventListener("keydown", (event) => {
  for (let index = keyLayers.length - 1; index >= 0; index--) {
    const layer = keyLayers[index];
    if (layer.handler(event) === true) {
      event.preventDefault();
      return;
    }
    if (layer.blocking) return;
  }
});

/// Whether a key event comes from somewhere the user is typing.
export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/// Handles key presses while the component is shown. Return `true` from the handler to consume the event. Later
/// (inner, newer) handlers run first.
export function useKeyboard(handler: (event: KeyboardEvent) => boolean | void, options: { blocking?: boolean } = {}) {
  const ref = useRef(handler);
  ref.current = handler;
  const blocking = options.blocking ?? false;
  useEffect(() => {
    const layer: KeyLayer = { handler: (event) => ref.current(event), blocking };
    keyLayers.push(layer);
    return () => {
      keyLayers.splice(keyLayers.indexOf(layer), 1);
    };
  }, [blocking]);
}

/// ⌘ on the Mac, Ctrl elsewhere.
export function isCommand(event: KeyboardEvent | React.MouseEvent | React.PointerEvent): boolean {
  return navigator.platform.toLowerCase().includes("mac") ? event.metaKey : event.ctrlKey;
}

// MARK: Labels and meters

/// Small uppercase heading used throughout the interface.
export function SectionLabel({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="section-label" style={color ? { color } : undefined}>
      {children}
    </span>
  );
}

export function VitalBar({ title, symbol, value, maximum, tint, unit }: {
  title: string;
  symbol?: string;
  value: number;
  maximum: number;
  tint: string;
  unit?: string;
}) {
  const fraction = maximum > 0 ? Math.min(Math.max(value / maximum, 0), 1) : 0;
  return (
    <div className="vital" aria-label={title}>
      <div className="vital-head">
        {symbol && <Icon name={symbol} size={14} />}
        <span>{title}</span>
        <span className="spacer" />
        <span className="mono-digits">
          {value.toLocaleString()} / {maximum.toLocaleString()}
        </span>
        {unit && <span>{unit}</span>}
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${fraction * 100}%`, background: `linear-gradient(90deg, ${tint}, color-mix(in srgb, ${tint} 75%, white))` }} />
      </div>
    </div>
  );
}

export function EmptyState({ symbol, title, children, actions }: { symbol: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty-state">
      <Icon name={symbol} size={40} strokeWidth={1.4} className="tertiary" />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions}
    </div>
  );
}

// MARK: Controls

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} />;
}

export function Segmented<T extends string | number | boolean>({ value, options, onChange, style }: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  style?: CSSProperties;
}) {
  return (
    <div className="segmented" role="radiogroup" style={style}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          className={option.value === value ? "selected" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectGroup {
  group: string;
  options: SelectOption[];
}

export function Select({ value, options, onChange, ariaLabel, style }: {
  value: string;
  options: (SelectOption | SelectGroup)[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  style?: CSSProperties;
}) {
  return (
    <select className="select" value={value} aria-label={ariaLabel} style={style} onChange={(e) => onChange(e.target.value)}>
      {options.map((option, index) =>
        "group" in option ? (
          option.options.length > 0 && (
            <optgroup key={`g${index}`} label={option.group}>
              {option.options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )
        ) : (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ),
      )}
    </select>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/// A number typed in place. Valid values apply as they're typed, clamped to the range; anything else reverts
/// when the field loses focus.
export function NumberInput({ value, onChange, min, max, decimals = 0, className = "number", ariaLabel }: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  decimals?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const format = (v: number) => (decimals > 0 ? String(Math.round(v * 10 ** decimals) / 10 ** decimals) : String(v));
  const [text, setText] = useState(format(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      className={`text-field ${className}`}
      value={text}
      aria-label={ariaLabel}
      inputMode={decimals > 0 ? "decimal" : "numeric"}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setText(format(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = decimals > 0 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
        if (!Number.isNaN(parsed)) onChange(clamp(decimals > 0 ? parsed : Math.trunc(parsed), min, max));
      }}
    />
  );
}

export function Stepper({ value, onChange, min, max, step = 1, label }: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label?: string;
}) {
  return (
    <span className="stepper" aria-label={label}>
      <button type="button" disabled={value <= min} onClick={() => onChange(clamp(value - step, min, max))} aria-label="−">
        <Icon name="minus" size={11} />
      </button>
      <button type="button" disabled={value >= max} onClick={() => onChange(clamp(value + step, min, max))} aria-label="+">
        <Icon name="plus" size={11} />
      </button>
    </span>
  );
}

// MARK: Forms

export function FormSection({ header, footer, children }: { header?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <section>
      {header && <div className="form-section-header">{header}</div>}
      <div className="form-section-body">{children}</div>
      {footer && <div className="form-section-footer">{footer}</div>}
    </section>
  );
}

/// A label with its content on the right, like SwiftUI's `LabeledContent`.
export function FormRow({ label, children, stack }: { label?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={`form-row ${stack ? "stack" : ""}`}>
      {label !== undefined && <span className="form-label">{label}</span>}
      {children}
    </div>
  );
}

export function ButtonRow({ symbol, title, onClick, destructive, disabled, help }: {
  symbol?: string;
  title: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  help?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      title={help}
      className={`form-row button-row ${destructive ? "destructive" : ""} ${disabled ? "disabled" : ""}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
    >
      {symbol && <Icon name={symbol} size={15} />}
      <span>{title}</span>
    </div>
  );
}

export function NumberField({ title, value, onChange, min, max, step = 1, decimals = 0 }: {
  title: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
}) {
  return (
    <FormRow label={title}>
      <NumberInput value={value} onChange={onChange} min={min} max={max} decimals={decimals} ariaLabel={title} />
      <Stepper value={value} onChange={onChange} min={min} max={max} step={step} label={title} />
    </FormRow>
  );
}

export function ToggleRow({ title, on, onChange }: { title: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <FormRow label={title}>
      <Toggle on={on} onChange={onChange} label={title} />
    </FormRow>
  );
}

export function Disclosure({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <details className="disclosure">
      <summary>
        <Icon name="chevron.right" size={13} />
        {title}
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

// MARK: Dialogs

export function Modal({ children, onClose, width }: { children: ReactNode; onClose?: () => void; width?: number }) {
  useKeyboard(
    (event) => {
      if (event.key === "Escape" && onClose) {
        onClose();
        return true;
      }
    },
    { blocking: true },
  );
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={width ? { width } : undefined} role="dialog">
        {children}
      </div>
    </div>,
    document.body,
  );
}

export interface DialogButton {
  title: string;
  role?: "default" | "destructive" | "cancel";
  action?: () => void;
}

/// A centered alert with a title, a message, and buttons, like the original app's alerts and confirmations.
export function Alert({ title, message, buttons, onDismiss }: {
  title: string;
  message?: string;
  buttons?: DialogButton[];
  onDismiss: () => void;
}) {
  const list = buttons ?? [{ title: t("OK"), role: "default" as const }];
  useKeyboard(
    (event) => {
      if (event.key === "Enter") {
        const primary = list.find((b) => b.role === "default") ?? (list.length === 1 ? list[0] : undefined);
        if (primary) {
          onDismiss();
          primary.action?.();
          return true;
        }
      }
    },
    { blocking: true },
  );
  return (
    <Modal onClose={onDismiss}>
      <div className="alert">
        <h3>{title}</h3>
        {message && <p>{message}</p>}
        <div className="alert-buttons">
          {list.map((button) => (
            <button
              key={button.title}
              type="button"
              className={`btn alert-button ${button.role ?? ""}`}
              onClick={() => {
                onDismiss();
                button.action?.();
              }}
            >
              {button.title}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/// A destructive confirmation with a cancel button.
export function Confirm({ title, message, confirmTitle, onConfirm, onDismiss }: {
  title: string;
  message?: string;
  confirmTitle: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <Alert
      title={title}
      message={message}
      onDismiss={onDismiss}
      buttons={[
        { title: confirmTitle, role: "destructive", action: onConfirm },
        { title: t("Cancel"), role: "cancel" },
      ]}
    />
  );
}

// MARK: Popovers

/// A floating panel anchored below (or above, if there's no room) an element. Clicking elsewhere or pressing
/// Escape closes it.
export function Popover({ anchor, onClose, children, width, maxHeight = 480 }: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const p = ref.current.getBoundingClientRect();
    const left = Math.min(Math.max(8, a.left + a.width / 2 - p.width / 2), window.innerWidth - p.width - 8);
    const below = a.bottom + 8;
    const top = below + p.height > window.innerHeight - 8 ? Math.max(8, a.top - p.height - 8) : below;
    setPosition({ left, top });
  }, [anchor]);

  useKeyboard(
    (event) => {
      if (event.key === "Escape") {
        onClose();
        return true;
      }
    },
    { blocking: false },
  );

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor?.contains(target)) return;
      // Menus opened from inside the popover live outside it.
      if ((target as HTMLElement).closest?.(".menu, .modal-backdrop")) return;
      onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="popover"
      style={{ width, maxHeight, left: position?.left ?? -9999, top: position?.top ?? -9999, visibility: position ? "visible" : "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}

// MARK: Menus

export type MenuEntry =
  | { label: string; icon?: string; action: () => void; disabled?: boolean; destructive?: boolean; checked?: boolean }
  | { separator: true }
  | { header: string }
  | { note: string };

interface OpenMenu {
  entries: MenuEntry[];
  x: number;
  y: number;
}

let openMenu: OpenMenu | null = null;
const menuListeners = new Set<() => void>();

function setOpenMenu(menu: OpenMenu | null) {
  openMenu = menu;
  for (const listener of menuListeners) listener();
}

/// Shows a menu at a point on screen, such as where the user right-clicked.
export function showMenu(entries: MenuEntry[], x: number, y: number) {
  setOpenMenu({ entries, x, y });
}

/// Shows a menu below an element, such as a button.
export function showMenuBelow(element: HTMLElement, entries: MenuEntry[]) {
  const rect = element.getBoundingClientRect();
  showMenu(entries, rect.left, rect.bottom + 4);
}

/// Props that open a context menu on right-click.
export function contextMenu(entries: () => MenuEntry[]) {
  return {
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      showMenu(entries(), event.clientX, event.clientY);
    },
  };
}

/// Draws whichever menu is open. Mounted once, at the root.
export function MenuHost() {
  const menu = useSyncExternalStore(
    (listener) => {
      menuListeners.add(listener);
      return () => menuListeners.delete(listener);
    },
    () => openMenu,
  );
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPosition(null);
      return;
    }
    const rect = ref.current.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(menu.x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - rect.height - 4)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (event.type === "mousedown" && ref.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpenMenu(null);
      }
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);

  if (!menu) return null;
  return createPortal(
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={{ left: position?.left ?? menu.x, top: position?.top ?? menu.y, visibility: position ? "visible" : "hidden" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.entries.map((entry, index) => {
        if ("separator" in entry) return <div key={index} className="menu-separator" />;
        if ("header" in entry) return <div key={index} className="menu-header">{entry.header}</div>;
        if ("note" in entry) return <div key={index} className="menu-note">{entry.note}</div>;
        return (
          <button
            key={index}
            type="button"
            role="menuitem"
            className={`menu-item ${entry.destructive ? "destructive" : ""}`}
            disabled={entry.disabled}
            onClick={() => {
              setOpenMenu(null);
              entry.action();
            }}
          >
            {entry.checked !== undefined && <span className="check">{entry.checked && <Icon name="checkmark" size={13} />}</span>}
            {entry.icon && <Icon name={entry.icon} size={14} />}
            {entry.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
