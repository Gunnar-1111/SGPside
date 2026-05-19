// Game-line legs — moneyline, spread, and total legs built from a contract Game.
//
// The contract is sport-agnostic: a Game carries `lines` (homeSpread, total,
// totalStdev, home/away win prob). That's enough to derive every game leg
// WITHOUT sport knowledge:
//
//   • Moneyline — home margin > 0. Same latent as the spread; σ is BACKED OUT
//                 of the contract (homeWinProb = Φ(μ/σ) ⇒ σ = μ / Φ⁻¹(p)), so
//                 P(margin > 0) = homeWinProb — the marginal is unchanged.
//   • Spread    — home margin ~ Normal(μ, σ), same μ/σ as the moneyline.
//   • Total     — game total ~ Normal(total, totalStdev). totalStdev is now
//                 carried by the contract (engines emit their sim's stdev).
//
// Moneyline + spread legs key to `home_margin`, total legs to `game_total` —
// the two game-level keys in the contract correlation matrix — so they
// correlate with player props through the copula. A Knicks scorer's points
// and a Knicks moneyline/spread now lift together (home_margin ↔ a home
// player's points is positive; ↔ a road player's is negative).
//
// Each option carries the ESPN market number alongside the model number so
// the hub can show model-vs-market per leg.

import type { Game } from "./types";
import type { MarketLines } from "./espn-lines";
import type { Leg } from "./sgp-pricer";
import { normCdf, normInv, probToAmerican } from "./sgp-pricer";

const FALLBACK_MARGIN_STD = 13; // used only at ~pick'em, where μ≈0 ⇒ σ undefined
const FALLBACK_TOTAL_STD = 14; // used when a contract predates the totalStdev field

/** Home-margin std implied by the contract (see file header). */
function marginStd(game: Game): number {
  const mu = -game.lines.homeSpread;
  const p = Math.min(0.999, Math.max(0.001, game.lines.homeWinProb));
  const z = normInv(p);
  if (Math.abs(z) < 0.05) return FALLBACK_MARGIN_STD;
  return Math.abs(mu / z);
}

export interface GameLineOption {
  market: "ml" | "spread" | "total";
  side: "home" | "away" | "over" | "under";
  label: string;
  modelOdds: number; // model's fair American for this side
  modelPoint: number | null; // model spread / total (not ML)
  marketOdds: number | null; // ESPN American (ML only — ESPN gives no prop juice)
  marketPoint: number | null; // ESPN spread / total
  leg: Leg;
}

/**
 * Game-line options for a game: ML home/away, spread home/away, total
 * over/under. Spread and total legs are priced against the *market* number
 * when one is posted (that's the line you'd actually bet) so model-vs-market
 * is a fair test.
 */
export function gameLineOptions(
  game: Game,
  market: MarketLines | null,
): GameLineOption[] {
  const { home, away, gameId } = game;
  const { homeSpread, total, homeWinProb, awayWinProb } = game.lines;
  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  // Home margin ~ Normal(μ, σ). Both moneyline AND spread legs are bets on
  // this same latent, so both key to `home_margin` and correlate with player
  // props through the copula. σ is backed out of the contract (see marginStd);
  // P(margin > 0) then equals homeWinProb exactly, so the ML marginal is
  // unchanged — it's just correlation-aware now.
  const mu = -homeSpread; // expected home margin
  const sd = marginStd(game);

  // ── Moneyline — home margin > 0 ──────────────────────────────
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
        key: "home_margin", // matrix game-level key — correlates with props
        gameId,
        label: `${team} ML`,
        point: 0, // home wins ⇔ home margin > 0
        side: side === "home" ? "over" : "under",
        projection: { mean: mu, stdev: sd, distribution: "normal" },
      },
    };
  };

  // ── Spread — home margin ~ Normal(μ, σ) ──────────────────────
  const betSpread = market?.homeSpread ?? homeSpread; // home perspective
  const spreadThr = -betSpread; // home covers ⇔ home margin > spreadThr
  const pHomeCovers = 1 - normCdf((spreadThr - mu) / sd);

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
        key: "home_margin", // matrix game-level key — correlates with props
        gameId,
        label: `${team} ${fmt(teamSpread)}`,
        point: spreadThr,
        side: side === "home" ? "over" : "under",
        projection: { mean: mu, stdev: sd, distribution: "normal" },
      },
    };
  };

  // ── Total — game total ~ Normal(total, totalStdev) ───────────
  const totalSd = game.lines.totalStdev ?? FALLBACK_TOTAL_STD;
  const betTotal = market?.total ?? total;
  const pOver = 1 - normCdf((betTotal - total) / totalSd);

  const totalLeg = (side: "over" | "under"): GameLineOption => {
    const prob = side === "over" ? pOver : 1 - pOver;
    return {
      market: "total",
      side,
      label: `${side === "over" ? "Over" : "Under"} ${betTotal}`,
      modelOdds: probToAmerican(prob),
      modelPoint: total,
      marketOdds: null, // ESPN gives the total number, not the o/u juice
      marketPoint: market?.total ?? null,
      leg: {
        key: "game_total", // matrix game-level key — correlates with props
        gameId,
        label: `${home}/${away} ${side === "over" ? "o" : "u"}${betTotal}`,
        point: betTotal,
        side,
        projection: { mean: total, stdev: totalSd, distribution: "normal" },
      },
    };
  };

  return [
    ml("home"), ml("away"),
    spread("home"), spread("away"),
    totalLeg("over"), totalLeg("under"),
  ];
}
