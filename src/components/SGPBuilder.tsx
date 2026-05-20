"use client";

import { useEffect, useMemo, useState } from "react";
import type { SlateGame, Prop, CorrelationBlock } from "@/lib/types";
import { priceSGP, probToAmericanVigged, normInv, type Leg } from "@/lib/sgp-pricer";
import { gameLineOptions, type GameLineOption } from "@/lib/game-legs";

// A slip leg is a priceable Leg plus optional book inputs. When `bookLine` or
// `bookOdds` are set, the slip re-prices against the book's number — lets the
// picker compare "ours at the book's line" vs "what the book charges," which
// separates model disagreement from juice differences.
type SlipLeg = Leg & {
  marketOdds: number | null;
  bookLine?: number | null;   // user-entered: the book's offered line (e.g. FD's u217.5)
  bookOdds?: number | null;   // user-entered: the book's juiced odds for this side
};

// Which betting market is this leg? Derived from the slip leg's `key`/`point`
// — game-line legs share `home_margin` (ML vs spread distinguished by point=0).
function legMarket(l: { key: string; point: number }): "ml" | "spread" | "total" | "prop" {
  if (l.key === "home_margin" && l.point === 0) return "ml";
  if (l.key === "home_margin") return "spread";
  if (l.key === "game_total") return "total";
  return "prop";
}

// Implied probability from American odds (vigged).
function impProb(american: number): number {
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

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

// Numeric input that parses on change, with empty-string = null. Used for the
// book overrides per leg + the slip-level book SGP odds field. Accepts a +
// prefix so users can type American odds like "+676" naturally.
function NumberInput({
  value,
  placeholder,
  onChange,
  width,
}: {
  value: number | null;
  placeholder: string;
  onChange: (n: number | null) => void;
  width: string;
}) {
  const [raw, setRaw] = useState<string>(value != null ? String(value) : "");
  // Keep the input in sync if the parent clears it (e.g. on slip clear).
  useEffect(() => { setRaw(value != null ? String(value) : ""); }, [value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      value={raw}
      placeholder={placeholder}
      onChange={(e) => {
        const v = e.target.value;
        setRaw(v);
        if (v === "" || v === "-" || v === "+") {
          onChange(null);
          return;
        }
        const n = parseFloat(v.replace(/^\+/, ""));
        if (!Number.isNaN(n)) onChange(n);
      }}
      className={`${width} rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-center font-mono text-[11px] text-white/85 placeholder:text-white/25 focus:border-accent/50 focus:outline-none`}
    />
  );
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
  // The book's combined SGP price — user enters what FD/DK is offering for the
  // whole slip, so the comparison block can show ours vs theirs at a glance.
  const [bookSgpOdds, setBookSgpOdds] = useState<number | null>(null);

  // Update a slip leg's `bookLine` or `bookOdds` by index. Null clears the
  // override — the leg falls back to its original (market-anchored) point.
  function updateLegBook(idx: number, patch: Partial<Pick<SlipLeg, "bookLine" | "bookOdds">>) {
    setSlip((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

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
  const inSlip = (
    gameId: string,
    key: string,
    side: "over" | "under",
    point: number,
  ) =>
    slip.some(
      (l) =>
        l.gameId === gameId &&
        l.key === key &&
        l.side === side &&
        l.point === point,
    );

  function toggle(leg: Leg, marketOdds: number | null) {
    setSlip((prev) => {
      // Same slot = same game + matrix key (ML and spread share `home_margin`).
      const sameSlot = (l: SlipLeg) =>
        l.gameId === leg.gameId && l.key === leg.key;
      // Same leg = same slot, side, and line — clicking it again toggles off.
      const sameLeg = (l: SlipLeg) =>
        sameSlot(l) && l.side === leg.side && l.point === leg.point;
      if (prev.some(sameLeg)) {
        return prev.filter((l) => !sameLeg(l));
      }
      // Otherwise drop whatever else holds this slot — enforces mutual
      // exclusion (prop over vs under, ML vs spread vs the other side).
      return [...prev.filter((l) => !sameSlot(l)), { ...leg, marketOdds }];
    });
  }

  // Slip with book overrides applied to the BET POINT. When the user supplies
  // a `bookLine`, the leg re-prices against that threshold (pricer uses
  // leg.point as the bet threshold; marginalProb falls out for free) AND the
  // label is rewritten to show the bet line that's actually being priced —
  // otherwise the label keeps the original point and looks like the override
  // didn't take effect even though the math is using it.
  const slipForPricing = useMemo<SlipLeg[]>(
    () =>
      slip.map((l) => {
        if (l.bookLine == null) return l;
        // Replace the trailing number in the leg's label with bookLine. Covers
        // props ("Player PTS o29.5"), totals ("Over 218.5"), spreads ("NY -3.5").
        // ML legs don't have bookLine inputs, so no relabel concern there.
        const newLabel = l.label.replace(
          /-?\d+(\.\d+)?$/,
          l.bookLine % 1 === 0 ? String(l.bookLine) : l.bookLine.toFixed(1),
        );
        return { ...l, point: l.bookLine, label: newLabel };
      }),
    [slip],
  );
  const price = useMemo(
    () => (slipForPricing.length ? priceSGP(slipForPricing, corrByGame) : null),
    [slipForPricing, corrByGame],
  );

  // Parallel slip priced "as if" each leg had the book's per-leg fair prob
  // (de-vigged from bookOdds). Same correlation matrix, same SGP hold — only
  // the per-leg marginal probabilities are swapped to the book's view. Lets
  // us isolate "projection disagreement" (price.ours vs priceAtBookOdds)
  // from "correlation + juice disagreement" (priceAtBookOdds vs book's SGP).
  //
  // Legs missing bookLine OR bookOdds keep their original projection — the
  // resulting price is a mix; only fully-overridden legs swap.
  const slipAtBookOdds = useMemo<SlipLeg[]>(
    () =>
      slip.map((l) => {
        if (l.bookLine == null || l.bookOdds == null) return l;
        // Strip 3.5% per-side vig from book's quoted price (matches our hold
        // convention so the engine vs book comparison is clean).
        const vigged = impProb(l.bookOdds);
        const fairForSide = Math.max(0.01, Math.min(0.99, vigged - 0.035));
        // The book's no-vig prob applies to the SIDE the slip is on; convert
        // back to pOver so we can solve for a synthetic projection mean.
        const pOverFair = l.side === "over" ? fairForSide : 1 - fairForSide;
        const sd =
          l.projection.stdev && l.projection.stdev > 0
            ? l.projection.stdev
            : Math.sqrt(Math.max(l.projection.mean, 1));
        // (bookLine - mean) / sd = normInv(1 - pOverFair)  ⇒  mean = bookLine - sd * z
        const z = normInv(1 - pOverFair);
        const newMean = l.bookLine - sd * z;
        return {
          ...l,
          point: l.bookLine,
          projection: { mean: newMean, stdev: sd, distribution: "normal" as const },
        };
      }),
    [slip],
  );
  const priceAtBookOdds = useMemo(
    () => (slipAtBookOdds.length ? priceSGP(slipAtBookOdds, corrByGame) : null),
    [slipAtBookOdds, corrByGame],
  );
  // Only show the parallel price when AT LEAST ONE leg has full book overrides;
  // otherwise the parallel result is identical to `price` and meaningless.
  const anyBookOverride = slip.some(
    (l) => l.bookLine != null && l.bookOdds != null,
  );
  const allBookOverride = slip.every(
    (l) => l.bookLine != null && l.bookOdds != null,
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
              onClick={() => {
                setSlip([]);
                setBookSgpOdds(null);
              }}
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
            <div className="space-y-3">
              {price.legs.map((l, i) => {
                const sl = slip[i];
                const market = legMarket(sl);
                // "Ours @ book line" = our vigged odds at whatever point is
                // actually being priced (= bookLine if set, else original).
                // marginalProb comes back from priceSGP already side-aware.
                const oursJuicedAtPoint = probToAmericanVigged(l.marginalProb);
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-white/80">{l.label}</span>
                      <span className="shrink-0 font-mono text-xs">
                        <span className="text-white/85">{fmtOdds(oursJuicedAtPoint)}</span>
                        {sl?.bookOdds != null ? (
                          <span className="text-accent"> / {fmtOdds(sl.bookOdds)}</span>
                        ) : sl?.marketOdds != null ? (
                          <span className="text-accent"> / {fmtOdds(sl.marketOdds)}</span>
                        ) : null}
                      </span>
                    </div>
                    {/* Book overrides — line + odds. ML legs hide the line input. */}
                    <div className="flex items-center gap-1.5 pl-2 text-[11px] text-white/40">
                      <span>book</span>
                      {market !== "ml" && (
                        <NumberInput
                          value={sl?.bookLine ?? null}
                          placeholder="line"
                          width="w-14"
                          onChange={(n) => updateLegBook(i, { bookLine: n })}
                        />
                      )}
                      <NumberInput
                        value={sl?.bookOdds ?? null}
                        placeholder="odds"
                        width="w-14"
                        onChange={(n) => updateLegBook(i, { bookOdds: n })}
                      />
                      {sl?.bookLine != null && market !== "ml" && (
                        <span className="font-mono text-white/30">
                          orig {sl.point === Math.trunc(sl.point) ? sl.point : sl.point.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-[10px] text-white/30">
              ours @ book line {slip.some((l) => l.bookOdds != null || l.marketOdds != null) && (
                <>/ <span className="text-accent/70">book</span></>
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
                <span className="text-sm text-white/55">SGP price (ours)</span>
                <span className="font-mono text-xl font-bold text-accent">
                  {fmtOdds(price.pricedOdds)}
                </span>
              </div>
            </div>

            {/* ── SGP at book's per-leg odds (our engine, their probs) ─── */}
            {anyBookOverride && priceAtBookOdds && (
              <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-3">
                <div className="flex items-baseline justify-between text-xs text-white/45">
                  <span>If we used book&apos;s per-leg odds</span>
                  <span className="text-[10px] uppercase tracking-widest">
                    {allBookOverride ? "all legs" : "partial"}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-white/55">Joint prob</span>
                  <span className="font-mono text-sm text-white/75">
                    {(priceAtBookOdds.jointProb * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-white/55">SGP price</span>
                  <span className="font-mono text-base font-semibold text-white/85">
                    {fmtOdds(priceAtBookOdds.pricedOdds)}
                  </span>
                </div>
                <p className="pt-1 text-[10px] leading-snug text-white/30">
                  Same correlation + hold as ours, but each leg&apos;s marginal swapped to
                  the book&apos;s no-vig prob (book odds − 3.5% per side). Gap vs ours = projection
                  disagreement; gap vs book&apos;s SGP price = correlation/juice gap.
                </p>
              </div>
            )}

            {/* ── Book SGP comparison ─────────────────────────── */}
            <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-white/55">Book SGP odds</span>
                <NumberInput
                  value={bookSgpOdds}
                  placeholder="e.g. +676"
                  width="w-24"
                  onChange={setBookSgpOdds}
                />
              </div>
              {bookSgpOdds != null && (() => {
                const bookProb = impProb(bookSgpOdds);
                const oursPriced = impProb(price.pricedOdds);
                const oursFair = price.jointProb;
                // Model gap = how much our fair prob differs from the book's implied. Positive
                // → we think it's more likely than book's price reflects (potential edge).
                const probGap = (oursFair - bookProb) * 100;
                const ourHold = (oursPriced / oursFair - 1) * 100;
                // Book's implied hold IF we assume the book's fair prob equals ours. That's a
                // heuristic — if it's negative, the book is paying more than our fair (i.e. our
                // model says it's a positive-EV bet); if positive and small (3-5%) the book
                // holds about as much as we do; large positive means either the book holds a
                // lot OR the book thinks the event is less likely than we do.
                const impliedBookHold = (bookProb / oursFair - 1) * 100;
                return (
                  <div className="space-y-1 rounded bg-white/[0.02] p-2 text-xs">
                    <Row label="Book implied prob" value={`${(bookProb * 100).toFixed(1)}%`} muted />
                    <Row label="Our fair prob"     value={`${(oursFair * 100).toFixed(1)}%`} muted />
                    <div className="flex items-baseline justify-between pt-1 text-white/70">
                      <span>Model edge</span>
                      <span className={`font-mono ${probGap > 0 ? "text-emerald-400" : probGap < 0 ? "text-rose-400" : ""}`}>
                        {probGap >= 0 ? "+" : ""}{probGap.toFixed(1)}pp
                      </span>
                    </div>
                    <Row label="Our hold" value={`${ourHold.toFixed(1)}%`} muted />
                    <Row
                      label="Book hold (assuming our fair)"
                      value={`${impliedBookHold >= 0 ? "+" : ""}${impliedBookHold.toFixed(1)}%`}
                      muted
                    />
                  </div>
                );
              })()}
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
  inSlip: (
    gameId: string,
    key: string,
    side: "over" | "under",
    point: number,
  ) => boolean;
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
                  active={inSlip(game.gameId, o.leg.key, o.leg.side, o.leg.point)}
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
                          // Originated juiced odds from the contract — the price
                          // the slip shows per leg.
                          juicedOdds:
                            side === "over"
                              ? p.line.overOdds
                              : p.line.underOdds,
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
                              className={btnCls(
                                inSlip(game.gameId, key, "over", p.line.point),
                              )}
                            >
                              O
                            </button>
                            <button
                              onClick={() => toggle(mk("under"), null)}
                              className={btnCls(
                                inSlip(game.gameId, key, "under", p.line.point),
                              )}
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
