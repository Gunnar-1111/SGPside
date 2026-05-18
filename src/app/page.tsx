import contractData from "@/data/contract.json";
import type { ContractDoc } from "@/lib/types";
import { fetchMarketLines } from "@/lib/espn-lines";
import GameLines from "@/components/GameLines";
import SGPBuilder from "@/components/SGPBuilder";

const doc = contractData as unknown as ContractDoc;

export default async function Home() {
  const game = doc.games[0];
  const market = game
    ? await fetchMarketLines(doc.sport, doc.date, game.home, game.away)
    : null;

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-8">
        <div className="flex items-baseline gap-3">
          <h1 className="text-3xl font-bold tracking-tight">
            SGP<span className="text-accent">side</span>
          </h1>
          <span className="text-xs uppercase tracking-[0.2em] text-white/35">
            Same-Game Parlay Pricer
          </span>
        </div>
        <p className="mt-1.5 text-sm text-white/45">
          {game ? `${game.away} @ ${game.home}` : "No game"} · {doc.engine}/
          {doc.sport} · {doc.date}
        </p>
      </header>

      {game ? (
        <>
          <GameLines game={game} market={market} />
          <SGPBuilder doc={doc} />
        </>
      ) : (
        <p className="text-white/40">No contract data loaded.</p>
      )}

      <footer className="mt-12 text-[11px] leading-relaxed text-white/25">
        Joint probabilities via a Gaussian copula over the engine&apos;s
        correlation matrix. Model lines from the engine contract; market lines
        live from ESPN. Model output for origination, not betting advice.
      </footer>
    </main>
  );
}
