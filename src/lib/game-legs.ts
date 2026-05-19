// Game-line legs — moneyline and spread legs built from a contract Game.
//
// The contract is sport-agnostic: a Game carries only `lines` (homeSpread,
// total, home/away win prob). That's enough to derive ML and SPREAD legs
// WITHOUT any sport knowledge:
//
//   • Moneyline — a Bernoulli leg; P(side) is the contract win prob directly.
//   • Spread    — home margin ~ Normal(μ, σ). μ = −homeSpread; σ is BACKED OUT
//                 of the contract: homeWinProb = Φ(μ/σ) ⇒ σ = μ / Φ⁻¹(p).
//
// Total legs are intentionally omitted — total variance can't be recovered
// from the contract (win prob constrains the margin, not the total). They
// need a `totalStdev` field added to the contract first.
//
// Each option carries the ESPN market number alongside the model number so
// the hub can show model-vs-market per leg.

import type { Game } from "./types";
import type { MarketLines } from "./espn-lines";
import type { Leg } from "./sgp-pricer";
import { normCdf, normInv, probToAmerican } from "./sgp-pricer";

const FALLBACK_MARGIN_STD = 13; // used only at ~pick'em, where μ≈0 ⇒ σ undefined

/** Home-margin std implied by the contract (see file header). */
function marginStd(game: Game): number {
  const mu = -game.lines.homeSpread;
  const p = Math.min(0.999, Math.max(0.001, game.lines.homeWinProb));
  const z = normInv(p);
  if (Math.abs(z) < 0.05) return FALLBACK_MARGIN_STD;
  return Math.abs(mu / z);
}

export interface GameLineOption {
  market: "ml" | "spread";
  side: "home" | "away";
  label: string;
  modelOdds: number; // model's fair American for this side
  modelPoint: number | null; // model spread (spread legs only)
  marketOdds: number | null; // ESPN American for this side
  marketPoint: number | null; // ESPN spread (spread legs only)
  leg: Leg;
}

/**
 * The four game-line options for a game: ML home/away, spread home/away.
 * Spread legs are priced against the *market* number when one is available
 * (that's the line you'd actually bet) so model-vs-market is a fair test.
 */
export function gameLineOptions(
  game: Game,
  market: MarketLines | null,
): GameLineOption[] {
  const { home, away, gameId } = game;
  const { homeSpread, homeWinProb, awayWinProb } = game.lines;

  // ── Moneyline — Bernoulli, mean = contract win prob ──────────
  const mlKey = `${gameId}:line:ml`;
  const ml = (side: "home" | "away"): GameLineOption => {
    const prob = side === "home" ? homeWinProb : awayWinProb;
    const team = side === "home" ? home : away;
    return {
      market: "ml",
      side,
      label: `${team} ML`,
      modelOdds: probToAmerican(prob),
      modelPoint: null,
      marketOdds: side === "home" ? market?.homeML ?? null : market?.awayML ?? null,
      marketPoint: null,
      leg: {
        key: mlKey,
        gameId,
        label: `${team} ML`,
        point: 0,
        side: "over", // Bernoulli ignores side; the projection mean is the prob
        projection: { mean: prob, stdev: null, distribution: "bernoulli" },
      },
    };
  };

  // ── Spread — home margin ~ Normal(μ, σ) ──────────────────────
  const mu = -homeSpread; // expected home margin
  const sd = marginStd(game);
  // Bet line: the market spread if posted, else the model's own spread.
  const betSpread = market?.homeSpread ?? homeSpread; // home perspective
  const threshold = -betSpread; // home covers ⇔ home margin > threshold
  const spreadKey = `${gameId}:line:spread`;
  const pHomeCovers = 1 - normCdf((threshold - mu) / sd);
  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  const spread = (side: "home" | "away"): GameLineOption => {
    const team = side === "home" ? home : away;
    const teamSpread = side === "home" ? betSpread : -betSpread;
    const prob = side === "home" ? pHomeCovers : 1 - pHomeCovers;
    return {
      market: "spread",
      side,
      label: `${team} ${fmt(teamSpread)}`,
      modelOdds: probToAmerican(prob),
      modelPoint: side === "home" ? homeSpread : -homeSpread,
      marketOdds: null, // ESPN scoreboard gives the spread number, not its juice
      marketPoint: side === "home"
        ? market?.homeSpread ?? null
        : market?.homeSpread != null ? -market.homeSpread : null,
      leg: {
        key: spreadKey,
        gameId,
        label: `${team} ${fmt(teamSpread)}`,
        point: threshold, // home margin threshold
        side: side === "home" ? "over" : "under",
        projection: { mean: mu, stdev: sd, distribution: "normal" },
      },
    };
  };

  return [ml("home"), ml("away"), spread("home"), spread("away")];
}
