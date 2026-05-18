"use client";

import { useMemo, useState } from "react";
import type { ContractDoc, Prop } from "@/lib/types";
import { priceSGP, type Leg } from "@/lib/sgp-pricer";

const MARKET_LABEL: Record<string, string> = {
  points: "PTS",
  rebounds: "REB",
  assists: "AST",
  threes: "3PM",
};

function fmtOdds(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function btnCls(active: boolean): string {
  return `w-9 rounded py-1 font-mono text-xs transition-colors ${
    active
      ? "bg-accent text-bg-primary"
      : "bg-white/[0.05] text-white/55 hover:text-white"
  }`;
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className={muted ? "text-white/35" : "text-white/55"}>{label}</span>
      <span className={`font-mono ${muted ? "text-white/40" : "text-white/80"}`}>
        {value}
      </span>
    </div>
  );
}

export default function SGPBuilder({ doc }: { doc: ContractDoc }) {
  const game = doc.games[0];
  const [slip, setSlip] = useState<Leg[]>([]);

  const inSlip = (p: Prop, side: "over" | "under") =>
    slip.some((l) => l.key === `${p.playerId}:${p.market}` && l.side === side);

  function toggle(p: Prop, side: "over" | "under") {
    const key = `${p.playerId}:${p.market}`;
    setSlip((prev) => {
      if (prev.some((l) => l.key === key && l.side === side)) {
        return prev.filter((l) => !(l.key === key && l.side === side));
      }
      const leg: Leg = {
        key,
        side,
        point: p.line.point,
        projection: p.projection,
        label: `${p.player} ${MARKET_LABEL[p.market] ?? p.market} ${
          side === "over" ? "o" : "u"
        }${p.line.point}`,
      };
      return [...prev.filter((l) => l.key !== key), leg]; // drop opposite side
    });
  }

  const price = useMemo(
    () => (slip.length ? priceSGP(slip, game.correlation) : null),
    [slip, game.correlation],
  );

  const byPlayer = useMemo(() => {
    const m = new Map<string, Prop[]>();
    for (const p of game.props) {
      if (!m.has(p.player)) m.set(p.player, []);
      m.get(p.player)!.push(p);
    }
    return [...m.entries()];
  }, [game.props]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      {/* leg picker */}
      <div>
        <div className="mb-3 text-[11px] uppercase tracking-[0.15em] text-white/40">
          Tap a market to add an over / under leg
        </div>
        <div className="space-y-3">
          {byPlayer.map(([player, props]) => (
            <div
              key={player}
              className="rounded-xl border border-white/[0.06] bg-[#1a2235] p-4"
            >
              <div className="mb-2 text-sm font-semibold">{player}</div>
              <div className="space-y-1.5">
                {props.map((p) => (
                  <div key={p.market} className="flex items-center gap-2 text-sm">
                    <span className="w-10 text-white/45">
                      {MARKET_LABEL[p.market] ?? p.market}
                    </span>
                    <span className="w-12 font-mono text-white/80">
                      {p.line.point}
                    </span>
                    <button
                      onClick={() => toggle(p, "over")}
                      className={btnCls(inSlip(p, "over"))}
                    >
                      O
                    </button>
                    <button
                      onClick={() => toggle(p, "under")}
                      className={btnCls(inSlip(p, "under"))}
                    >
                      U
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* slip */}
      <div className="h-fit rounded-xl border border-white/[0.06] bg-[#1a2235] p-5 lg:sticky lg:top-6">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">
            SGP Slip
          </span>
          {slip.length > 0 && (
            <button
              onClick={() => setSlip([])}
              className="text-[11px] text-white/35 hover:text-white/70"
            >
              clear
            </button>
          )}
        </div>

        {!price ? (
          <p className="text-sm text-white/35">
            Add legs to price a same-game parlay.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              {price.legs.map((l, i) => (
                <div
                  key={i}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="text-white/80">{l.label}</span>
                  <span className="shrink-0 font-mono text-white/40">
                    {fmtOdds(l.marginalOdds)}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-1.5 border-t border-white/[0.06] pt-4">
              <Row
                label="Joint probability"
                value={`${(price.jointProb * 100).toFixed(1)}%`}
              />
              <Row
                label="If independent"
                value={`${(price.independentProb * 100).toFixed(1)}%`}
                muted
              />
              <Row
                label="Correlation lift"
                value={`${price.correlationLift.toFixed(2)}x`}
                muted
              />
            </div>

            <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-white/55">Fair price</span>
                <span className="font-mono text-base font-semibold text-white/85">
                  {fmtOdds(price.fairOdds)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-white/55">SGP price</span>
                <span className="font-mono text-xl font-bold text-accent">
                  {fmtOdds(price.pricedOdds)}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
