// The SGPside projection contract (see CONTRACT.md). What every -Side engine
// emits and the hub consumes.

export type Distribution = "normal" | "poisson" | "negbin" | "bernoulli";

export interface Projection {
  mean: number;
  stdev: number | null;
  distribution: Distribution;
}

export interface OriginatedLine {
  point: number;
  overOdds: number;
  underOdds: number;
}

export interface Prop {
  playerId: string;
  player: string;
  team: string;
  market: string;
  projection: Projection;
  line: OriginatedLine;
}

export interface GameLines {
  homeSpread: number;
  total: number;
  homeWinProb: number;
  awayWinProb: number;
}

export interface CorrelationBlock {
  mode: string;
  keys: string[];
  matrix: number[][];
}

export interface Game {
  gameId: string;
  startTime: string;
  home: string;
  away: string;
  lines: GameLines;
  props: Prop[];
  correlation: CorrelationBlock | null;
}

export interface ContractDoc {
  contractVersion: string;
  engine: string;
  sport: string;
  date: string;
  modelVersion: string;
  games: Game[];
}
