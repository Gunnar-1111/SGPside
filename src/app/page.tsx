import { fetchContracts, slateDates } from "@/lib/engines";
import { fetchMarketLines } from "@/lib/espn-lines";
import SGPBuilder from "@/components/SGPBuilder";
import type { SlateGame } from "@/lib/types";

// Re-pull contracts + market lines every 5 minutes.
export const revalidate = 300;

export default async function Home() {
  const dates = slateDates(); // [today, tomorrow]
  const docs = await fetchContracts(dates);

  // Flatten every engine's games into one slate, attaching the live market
  // line per game. Market fetches run in parallel within each contract.
  const slate: SlateGame[] = [];
  for (const doc of docs) {
    const markets = await Promise.all(
      doc.games.map((g) =>
        fetchMarketLines(doc.sport, doc.date, g.home, g.away),
      ),
    );
    doc.games.forEach((game, i) => {
      slate.push({
        engine: doc.engine,
        sport: doc.sport,
        date: doc.date,
        game,
        market: markets[i],
      });
    });
  }

  const sports = [...new Set(slate.map((s) => s.sport))];

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-8">
        <div className="flex items-baseline gap-3">
          <h1 className="text-3xl font-bold tracking-tight">
            SGP<span className="text-accent">side</span>
          </h1>
          <span className="text-xs uppercase tracking-[0.2em] text-white/35">
            Cross-Sport Parlay Pricer
          </span>
        </div>
        <p className="mt-1.5 text-sm text-white/45">
          {slate.length} game{slate.length === 1 ? "" : "s"} · {dates[0]} →{" "}
          {dates[1]}
          {sports.length ? ` · ${sports.join(", ")}` : ""}
        </p>
      </header>

      {slate.length ? (
        <SGPBuilder slate={slate} />
      ) : (
        <p className="text-white/40">
          No contracts for {dates[0]} or {dates[1]}. Engines publish to{" "}
          <code className="text-white/60">/api/contract/&#123;date&#125;</code>{" "}
          — none responded.
        </p>
      )}

      <footer className="mt-12 text-[11px] leading-relaxed text-white/25">
        Joint probabilities via a Gaussian copula over each engine&apos;s
        correlation matrix; cross-game legs priced independent. Contracts pulled
        live from the engines; market lines live from ESPN. Model output for
        origination, not betting advice.
      </footer>
    </main>
  );
}
