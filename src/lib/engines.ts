// Live multi-engine contract fetcher.
//
// Per CONTRACT.md §1 each engine exposes `GET /api/contract/{date}`. The hub
// holds a registry of engine base URLs and pulls every engine's contract for
// the slate dates (today + tomorrow). Engines that 404 a date — or aren't
// reachable — are skipped silently: the hub shows whatever it gets.

import type { ContractDoc } from "./types";

interface Engine {
  name: string;
  base: string;
}

// Engine base URLs. Each is overridable by env var so the hub can point at a
// local engine dev server. Defaults are the deployed Vercel apps.
//   COURTSIDE_URL=http://localhost:3000  (etc.)
// DugoutSide / HoopSide join the registry once they expose /api/contract.
const ENGINES: Engine[] = [
  { name: "courtside", base: process.env.COURTSIDE_URL ?? "https://courtside-smoky.vercel.app" },
];

/** Slate dates the hub prices — today + tomorrow, UTC, YYYY-MM-DD. */
export function slateDates(): string[] {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(today.getUTCDate() + 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return [fmt(today), fmt(tomorrow)];
}

/**
 * Fetch every registered engine's contract for each date. One failed fetch
 * (404, network, bad JSON) drops just that engine/date — never the slate.
 * Returns the contracts that came back, newest engine code first.
 */
export async function fetchContracts(
  dates: string[] = slateDates(),
): Promise<ContractDoc[]> {
  const jobs: Promise<ContractDoc | null>[] = [];
  for (const eng of ENGINES) {
    for (const date of dates) {
      const url = `${eng.base}/api/contract/${date}`;
      jobs.push(
        fetch(url, { next: { revalidate: 300 } })
          .then((r) => (r.ok ? (r.json() as Promise<ContractDoc>) : null))
          .catch(() => null),
      );
    }
  }
  const docs = await Promise.all(jobs);
  return docs.filter(
    (d): d is ContractDoc => d != null && Array.isArray(d.games),
  );
}
