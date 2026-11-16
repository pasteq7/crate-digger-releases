import type { Appearance, Palette } from "../src/types";
export const themeTokens: (keyof Palette)[];
export const themePresets: Palette[];
export function contrast(a: string, b: string): number;
export function mix(a: string, b: string, amount: number): string;
export function deriveTheme(value: {
  background: string;
  surface: string;
  accent: string;
  name?: string;
  id?: string;
}): Palette;
export function validateTheme(value: unknown): Palette;
export function validateAppearance(value: unknown): Appearance;
