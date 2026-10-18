import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface Option<T extends string> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
}

/** A themed dropdown that replaces the browser's native <select>. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder = "—",
  className = "",
  title,
}: {
  value: T | null;
  options: Option<T>[];
  onChange: (value: T) => void;
  placeholder?: ReactNode;
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    setIndex(Math.max(0, options.findIndex((o) => o.value === value)));
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const choose = (o: Option<T> | undefined) => {
    if (o) onChange(o.value);
    setOpen(false);
  };

  return (
    <div className={`select ${open ? "open" : ""} ${className}`} ref={root} title={title}>
      <button
        type="button"
        className="select-trigger"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) return (e.preventDefault(), setOpen(true));
          if (!open) return;
          if (e.key === "Escape") setOpen(false);
          if (e.key === "ArrowDown") (e.preventDefault(), setIndex((i) => Math.min(i + 1, options.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setIndex((i) => Math.max(i - 1, 0)));
          if (e.key === "Enter") (e.preventDefault(), choose(options[index]));
        }}
      >
        <span className={current ? "" : "placeholder"}>{current?.label ?? placeholder}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="menu select-menu" role="listbox">
          {options.map((o, i) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`${i === index ? "active" : ""} ${o.value === value ? "selected" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(o)}
            >
              <span>{o.label}</span>
              {o.hint && <small>{o.hint}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
