import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const ChromeContext = createContext<HTMLElement | null>(null);
export function Toolbar({ children }: { children: ReactNode }) {
  const host = useContext(ChromeContext);
  return host ? createPortal(children, host) : null;
}
