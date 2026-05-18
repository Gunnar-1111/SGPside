// SGP pricer — sport-agnostic. Prices a same-game parlay from contract data:
// marginal leg probabilities from each prop's projection, joint probability
// via a Gaussian copula over the contract's correlation matrix.
//
// This is the heart of SGPside. It needs nothing sport-specific — only a
// distribution per leg and a correlation matrix per game.

import type { Projection, CorrelationBlock } from "./types";

// ── Normal helpers ─────────────────────────────────────────────

function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}

function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Inverse standard-normal CDF — Acklam's rational approximation. */
function normInv(p: number): number {
  if (p <= 0) return -8;
  if (p >= 1) return 8;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

function randn(): number {
  const u = Math.max(1e-12, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

export function probToAmerican(p: number): number {
  p = Math.min(0.999, Math.max(0.001, p));
  return p >= 0.5
    ? -Math.round((p / (1 - p)) * 100)
    : Math.round(((1 - p) / p) * 100);
}

/** Marginal P(stat > point) from a projection distribution. */
function pOver(proj: Projection, point: number): number {
  if (proj.distribution === "bernoulli") {
    return Math.min(1, Math.max(0, proj.mean));
  }
  // normal — also used as the approximation for poisson / negbin
  const sd = proj.stdev && proj.stdev > 0 ? proj.stdev : Math.sqrt(Math.max(proj.mean, 1));
  return 1 - normCdf((point - proj.mean) / sd);
}

/** Cholesky factor of a correlation matrix (clamped for PSD safety). */
function cholesky(A: number[][]): number[][] {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = 0;
      for (let k = 0; k < j; k++) s += L[i][k] * L[j][k];
      if (i === j) L[i][j] = Math.sqrt(Math.max(A[i][i] - s, 1e-9));
      else L[i][j] = (A[i][j] - s) / (L[j][j] || 1e-9);
    }
  }
  return L;
}

// ── SGP leg + price ────────────────────────────────────────────

export interface Leg {
  key: string; // "<playerId>:<market>" — matches a contract correlation key
  label: string;
  point: number;
  side: "over" | "under";
  projection: Projection;
}

export interface PricedLeg {
  label: string;
  side: "over" | "under";
  marginalProb: number;
  marginalOdds: number;
}

export interface SGPPrice {
  legs: PricedLeg[];
  jointProb: number;        // P(all legs hit) — correlated, no vig
  independentProb: number;  // product of marginals — the no-correlation baseline
  correlationLift: number;  // jointProb / independentProb
  fairOdds: number;         // American, no vig
  pricedOdds: number;       // American, with SGP hold
}

const MC_SIMS = 20000;
const HOLD_PER_LEG = 0.012;

/**
 * Price a same-game parlay. Joint probability comes from a Gaussian copula:
 * each leg gets a standard-normal latent; the legs' sub-matrix of the
 * contract correlation matrix is Cholesky-factored; Monte Carlo counts the
 * fraction of draws where every leg clears its threshold.
 */
export function priceSGP(legs: Leg[], corr: CorrelationBlock | null): SGPPrice {
  const n = legs.length;
  const q = legs.map((l) => pOver(l.projection, l.point)); // P(stat > point)
  const marginal = legs.map((l, i) => (l.side === "over" ? q[i] : 1 - q[i]));
  const thr = q.map((qi) => normInv(1 - qi)); // over hits u>thr, under hits u<thr
  const independentProb = marginal.reduce((a, b) => a * b, 1);

  let jointProb: number;
  if (n <= 1) {
    jointProb = marginal[0] ?? 0;
  } else {
    const keyIndex = new Map((corr?.keys ?? []).map((k, i) => [k, i]));
    const R: number[][] = legs.map((la) =>
      legs.map((lb) => {
        if (la.key === lb.key) return 1;
        const a = keyIndex.get(la.key);
        const b = keyIndex.get(lb.key);
        return a != null && b != null && corr ? corr.matrix[a][b] : 0;
      }),
    );
    const L = cholesky(R);
    let hits = 0;
    for (let s = 0; s < MC_SIMS; s++) {
      const z = Array.from({ length: n }, () => randn());
      let all = true;
      for (let i = 0; i < n; i++) {
        let u = 0;
        for (let k = 0; k <= i; k++) u += L[i][k] * z[k];
        const hit = legs[i].side === "over" ? u > thr[i] : u < thr[i];
        if (!hit) {
          all = false;
          break;
        }
      }
      if (all) hits++;
    }
    jointProb = hits / MC_SIMS;
  }

  const priced = Math.min(0.97, jointProb * (1 + HOLD_PER_LEG * n));
  return {
    legs: legs.map((l, i) => ({
      label: l.label,
      side: l.side,
      marginalProb: marginal[i],
      marginalOdds: probToAmerican(marginal[i]),
    })),
    jointProb,
    independentProb,
    correlationLift: independentProb > 0 ? jointProb / independentProb : 1,
    fairOdds: probToAmerican(jointProb),
    pricedOdds: probToAmerican(priced),
  };
}
