import { beautyEssentialsAdapter } from "./beauty-essentials";
import { bonjourAdapter } from "./bonjour";
import { withResilience } from "./resilience";
import type { StoreAdapter } from "./types";

/** Registry line: adding a store means adding one import and one entry here. */
export const STORE_ADAPTERS: StoreAdapter[] = [
  withResilience(bonjourAdapter),
  withResilience(beautyEssentialsAdapter),
];

export function adapterForDomain(hostname: string): StoreAdapter | undefined {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  return STORE_ADAPTERS.find(
    (adapter) => normalized === adapter.domain || normalized.endsWith(`.${adapter.domain}`),
  );
}

export { bonjourAdapter, beautyEssentialsAdapter };
