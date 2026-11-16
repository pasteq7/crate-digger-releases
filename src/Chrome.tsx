import {
  createContext,
  useContext,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export const ChromeContext = createContext<HTMLElement | null>(null);
export function Toolbar({ children }: { children: ReactNode }) {
  const host = useContext(ChromeContext);
  useLayoutEffect(() => {
    if (!host) return;
    const position = () => {
      for (const menu of host.querySelectorAll<HTMLDetailsElement>(
        ".toolbar-popover[open]",
      )) {
        const panel = menu.querySelector<HTMLElement>(".popover-panel");
        const anchor = menu.querySelector("summary")?.getBoundingClientRect();
        if (!panel || !anchor) continue;
        // Fixed positioning escapes the scrolling workspace; clamp both edges.
        const preferredWidth =
          parseFloat(
            getComputedStyle(panel).getPropertyValue("--popover-width"),
          ) || 290;
        const width = Math.min(preferredWidth, window.innerWidth - 24);
        const top = anchor.bottom + 8;
        const bottom = Math.min(
          window.innerHeight,
          ...[...document.querySelectorAll(".local-player, .player")]
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.height > 0)
            .map((r) => r.top),
        );
        Object.assign(panel.style, {
          position: "fixed",
          right: "auto",
          top: `${top}px`,
          left: `${Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))}px`,
          width: `${width}px`,
          maxHeight: `${Math.max(80, bottom - top - 12)}px`,
        });
      }
    };
    position();
    host.addEventListener("toggle", position, true);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      host.removeEventListener("toggle", position, true);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [host, children]);
  return host ? createPortal(children, host) : null;
}
