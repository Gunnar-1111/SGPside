"use client";

import { useMemo, useState } from "react";
import type { SlateGame, Prop, CorrelationBlock } from "@/lib/types";
import { priceSGP, type Leg } from "@/lib/sgp-pricer";
import { gameLineOptions, type GameLineOption } from "@/lib/game-legs";

// A slip leg is a priceable Leg plus the market odds for that leg, when a
// market number exists (moneyline legs). Props / spreads carry null — priceSGP
// ignores the extra field.
type SlipLeg = Leg & { marketOdds: number | null };

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
  return `rounded px-2 py-1 font-mono text-xs transition-colors ${
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

export default function SGPBuilder({ slate }: { slate: SlateGame[] }) {
  const [slip, setSlip] = useState<SlipLeg[]>([]);
  const [openId, setOpenId] = useState<string | null>(
    slate[0]?.game.gameId ?? null,
  );

  // Every game's correlation block, keyed by gameId — passed to the pricer so
  // same-game legs stay correlated and cross-game legs go independent.
  const corrByGame = useMemo<Record<string, CorrelationBlock | null>>(
    () =>
      Object.fromEntries(
        slate.map((sg) => [sg.game.gameId, sg.game.correlation]),
      ),
    [slate],
  );

  // Legs are identified by gameId + key — game-line legs share matrix keys
  // ("game_total", "home_margin") across games, so the gameId is what keeps
  // a total leg in game A distinct from one in game B.
  const inSlip = (gameId: string, key: string, side: "over" | "under") =>
    slip.some(
      (l) => l.gameId === gameId && l.key === key && l.side === side,
    );

  function toggle(leg: Leg, marketOdds: number | null) {
    setSlip((prev) => {
      const sameSlot = (l: SlipLeg) =>
        l.gameId === leg.gameId && l.key === leg.key;
      if (prev.some((l) => sameSlot(l) && l.side === leg.side)) {
        return prev.filter((l) => !(sameSlot(l) && l.side === leg.side));
      }
      // Drop the opposite side of this same slot — enforces mutual exclusion
      // (over vs under of a prop/total, home vs away of an ML/spread).
      return [...prev.filter((l) => !sameSlot(l)), { ...leg, marketOdds }];
    });
  }

  const price = useMemo(
    () => (slip.length ? priceSGP(slip, corrByGame) : null),
    [slip, corrByGame],
  );

  // Group the slate by date for the picker.
  const byDate = useMemo(() => {
    const m = new Map<string, SlateGame[]>();
    for (const sg of slate) {
      if (!m.has(sg.date)) m.set(sg.date, []);
      m.get(sg.date)!.push(sg);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [slate]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      {/* ── leg picker ─────────────────────────────────────── */}
      <div className="space-y-5">
        {byDate.map(([date, games]) => (
          <div key={date}>
            <div className="mb-2 text-[11px] uppercase tracking-[0.15em] text-white/40">
              {date}
            </div>
            <div className="space-y-2">
              {games.map((sg) => (
                <GameCard
                  key={sg.game.gameId}
                  sg={sg}
                  open={openId === sg.game.gameId}
                  onToggleOpen={() =>
                    setOpenId((cur) =>
                      cur === sg.game.gameId ? null : sg.game.gameId,
                    )
                  }
                  inSlip={inSlip}
                  toggle={toggle}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── slip ───────────────────────────────────────────── */}
      <div className="h-fit rounded-xl border border-white/[0.06] bg-[#1a2235] p-5 lg:sticky lg:top-6">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">
            Parlay Slip
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
            Add legs from any game to price a parlay. Legs in the same game are
            correlated; legs across games price independent.
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
                  <span className="shrink-0 font-mono text-xs">
                    <span className="text-white/70">
                      {fmtOdds(l.marginalOdds)}
                    </span>
                    {slip[i]?.marketOdds != null && (
                      <span className="text-accent">
                        {" "}
                        / {fmtOdds(slip[i].marketOdds!)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div className="mb-2 mt-1 text-[10px] text-white/30">
              leg odds: model{" "}
              {slip.some((l) => l.marketOdds != null) && (
                <>
                  / <span className="text-accent/70">market</span>
                </>
              )}
            </div>

            <div className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-4">
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

// ── one game card — collapsed header + expanded leg picker ────────

function GameCard({
  sg,
  open,
  onToggleOpen,
  inSlip,
  toggle,
}: {
  sg: SlateGame;
  open: boolean;
  onToggleOpen: () => void;
  inSlip: (gameId: string, key: string, side: "over" | "under") => boolean;
  toggle: (leg: Leg, marketOdds: number | null) => void;
}) {
  const { game, sport, market } = sg;

  const lineOpts = useMemo(
    () => gameLineOptions(game, market),
    [game, market],
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
    <div className="rounded-xl border border-white/[0.06] bg-[#1a2235]">
      <button
        onClick={onToggleOpen}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[9px] uppercase text-white/45">
            {sport}
          </span>
          <span className="text-sm font-semibold">
            {game.away} @ {game.home}
          </span>
        </span>
        <span className="text-white/30">{open ? "–" : "+"}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-white/[0.06] p-4">
          {/* game lines */}
          <div>
            <div className="mb-2 text-[10px] uppercase tracking-widest text-white/35">
              Game lines — model / market
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {lineOpts.map((o) => (
                <GameLineRow
                  key={`${o.market}:${o.side}`}
                  opt={o}
                  active={inSlip(game.gameId, o.leg.key, o.leg.side)}
                  onClick={() => toggle(o.leg, o.marketOdds)}
                />
              ))}
            </div>
          </div>

          {/* player props */}
          {byPlayer.length > 0 && (
            <div>
              <div className="mb-2 text-[10px] uppercase tracking-widest text-white/35">
                Player props
              </div>
              <div className="space-y-1.5">
                {byPlayer.map(([player, props]) => (
                  <div key={player}>
                    <div className="mb-1 text-xs font-semibold text-white/70">
                      {player}
                    </div>
                    <div className="space-y-1">
                      {props.map((p) => {
                        const key = `${p.playerId}:${p.market}`;
                        const mk = (side: "over" | "under"): Leg => ({
                          key,
                          gameId: game.gameId,
                          side,
                          point: p.line.point,
                          projection: p.projection,
                          label: `${p.player} ${
                            MARKET_LABEL[p.market] ?? p.market.toUpperCase()
                          } ${side === "over" ? "o" : "u"}${p.line.point}`,
                        });
                        return (
                          <div
                            key={p.market}
                            className="flex items-center gap-2 text-sm"
                          >
                            <span className="w-10 text-white/45">
                              {MARKET_LABEL[p.market] ?? p.market.toUpperCase()}
                            </span>
                            <span className="w-12 font-mono text-white/80">
                              {p.line.point}
                            </span>
                            <button
                              onClick={() => toggle(mk("over"), null)}
                              className={btnCls(inSlip(game.gameId, key, "over"))}
                            >
                              O
                            </button>
                            <button
                              onClick={() => toggle(mk("under"), null)}
                              className={btnCls(inSlip(game.gameId, key, "under"))}
                            >
                              U
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── one game-line option (ML, spread, or total) ──────────────────

function GameLineRow({
  opt,
  active,
  onClick,
}: {
  opt: GameLineOption;
  active: boolean;
  onClick: () => void;
}) {
  // ML rows compare fair odds; spread rows compare the signed spread number;
  // total rows compare the (unsigned) total number.
  let model: string, market: string;
  if (opt.market === "ml") {
    model = fmtOdds(opt.modelOdds);
    market = opt.marketOdds != null ? fmtOdds(opt.marketOdds) : "n/a";
  } else if (opt.market === "spread") {
    const sgn = (n: number) => (n > 0 ? `+${n}` : `${n}`);
    model = opt.modelPoint != null ? sgn(opt.modelPoint) : "n/a";
    market = opt.marketPoint != null ? sgn(opt.marketPoint) : "n/a";
  } else {
    model = opt.modelPoint != null ? `${opt.modelPoint}` : "n/a";
    market = opt.marketPoint != null ? `${opt.marketPoint}` : "n/a";
  }

  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between rounded border px-2 py-1.5 text-left text-xs transition-colors ${
        active
          ? "border-accent/60 bg-accent/10"
          : "border-white/[0.06] bg-white/[0.02] hover:border-white/20"
      }`}
    >
      <span className="text-white/80">{opt.label}</span>
      <span className="font-mono">
        <span className="text-white/55">{model}</span>
        <span className="text-accent"> / {market}</span>
      </span>
    </button>
  );
}
