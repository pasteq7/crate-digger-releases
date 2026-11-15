import type { Item, ProviderLink } from "../src/types";
export const musicProviders: {
  id: string;
  label: string;
  hosts: string[];
  subdomains?: boolean;
}[];
export function musicProviderForUrl(
  value: string,
): (typeof musicProviders)[number] | null;
export function providerSearchLinks(
  item: Item,
  country?: string,
): ProviderLink[];
export function suppliedProviderLinks(
  item: Item,
  country?: string,
): ProviderLink[];
