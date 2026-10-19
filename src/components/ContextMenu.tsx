import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";

export type MenuItem =
  | { label: ReactNode; onClick: () => void; icon?: ReactNode; shortcut?: string; danger?: boolean; disabled?: boolean }
  | "separator";

interface MenuState {
  menu: { x: number; y: number; items: MenuItem[] } | null;
  close: () => void;
}

const useMenu = create<MenuState>((set) => ({ menu: null, close: () => set({ menu: null }) }));

/** Opens a menu at the pointer. Use from onContextMenu, or from a button's onClick. */
export function openMenu(e: React.MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  const target = e.type === "click" ? (e.currentTarget as HTMLElement).getBoundingClientRect() : null;
  useMenu.setState({ menu: { x: target ? target.left : e.clientX, y: target ? target.bottom + 4 : e.clientY, items } });
}

/** Opens a menu at a screen position, e.g. once async menu items are ready. */
export function openMenuAt(x: number, y: number, items: MenuItem[]) {
  useMenu.setState({ menu: { x, y, items } });
}

export function ContextMenuHost() {
  const { menu, close } = useMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Keep the menu on screen.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: menu.y + r.height > window.innerHeight - 8 ? Math.max(8, menu.y - r.height) : menu.y,
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
      window.removeEventListener("wheel", close);
    };
  }, [menu, close]);

  if (!menu) return null;
  return (
    <div ref={ref} className="menu context-menu" style={{ left: pos.x, top: pos.y }} role="menu">
      {menu.items.map((item, i) =>
        item === "separator" ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={item.danger ? "danger" : ""}
            disabled={item.disabled}
            onClick={() => (close(), item.onClick())}
          >
            <span className="menu-icon">{item.icon}</span>
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
