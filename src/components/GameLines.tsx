import type { Game } from "@/lib/types";
import type { MarketLines } from "@/lib/espn-lines";
import { probToAmerican } from "@/lib/sgp-pricer";

function fmtSpread(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function fmtOdds(n: number | null): string {
  if (n == null) return "n/a";
  return n > 0 ? `+${n}` : `${n}`;
}

function Cell({
  title,
  model,
  market,
}: {
  title: string;
  model: string;
  market: string;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-widest text-white/35">
        {title}
      </div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-white/40">model</span>
        <span className="font-mono text-white/85">{model}</span>
      </div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-white/40">market</span>
        <span className="font-mono text-accent">{market}</span>
      </div>
    </div>
  );
}

export default function GameLines({
  game,
  market,
}: {
  game: Game;
  market: MarketLines | null;
}) {
  const m = game.lines;
  return (
    <div className="mb-6 rounded-xl border border-white/[0.06] bg-[#1a2235] p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">
          Game Lines
        </span>
        <span className="text-[11px] text-white/30">
          market: {market?.provider ?? "unavailable"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Cell
          title="Spread"
          model={`${game.home} ${fmtSpread(m.homeSpread)}`}
          market={
            market?.homeSpread != null
              ? `${game.home} ${fmtSpread(market.homeSpread)}`
              : "n/a"
          }
        />
        <Cell
          title="Total"
          model={`${m.total}`}
          market={market?.total != null ? `${market.total}` : "n/a"}
        />
        <Cell
          title={`Moneyline (${game.home}/${game.away})`}
          model={`${fmtOdds(probToAmerican(m.homeWinProb))} / ${fmtOdds(
            probToAmerican(m.awayWinProb),
          )}`}
          market={
            market?.homeML != null
              ? `${fmtOdds(market.homeML)} / ${fmtOdds(market.awayML)}`
              : "n/a"
          }
        />
      </div>
    </div>
  );
}
