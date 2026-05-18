# Projection Contract — v0.1

The interface between the per-sport `-Side` engines and the pricing hub.

Each engine **publishes projections**; the hub **prices** them (props, SGPs,
cross-sport parlays). Neither side reaches into the other:

- An engine never prices a bet or applies vig — it ships projections.
- The hub never models a sport — it consumes this contract, sport-agnostically.

If the hub needs sport-specific knowledge to *price* a leg, the contract is
wrong. The only thing the hub should need is a distribution per leg and a
correlation structure per game.

---

## 1. Transport

Each engine exposes one read endpoint:

```
GET /contract/{YYYY-MM-DD}   →   a Slate document (below)
```

A static `contract-{date}.json` file is an acceptable substitute (matches how
the engines already snapshot data). The hub polls per sport per date.

---

## 2. Slate document

```jsonc
{
  "contractVersion": "0.1",
  "engine": "hoopside",          // producing engine
  "sport": "wnba",               // nba | wnba | nfl | mlb | nhl | ufc
  "date": "2026-05-18",
  "modelVersion": "2026.05.18",  // engine build — provenance
  "games": [ <Game>, ... ]
}
```

---

## 3. Game object

```jsonc
{
  "gameId": "401736...",          // stable per engine
  "startTime": "2026-05-18T23:00:00Z",
  "home": "DAL",
  "away": "WSH",

  "lines": {                      // game-level model output, no vig
    "homeSpread": -3.5,
    "total": 164.5,
    "homeWinProb": 0.62,
    "awayWinProb": 0.38
  },

  "props": [ <Prop>, ... ],
  "correlation": <Correlation>    // optional — enables SGP pricing
}
```

`lines` doubles as the marginals for game-level SGP legs (spread, total, ML).

---

## 4. Prop object

A prop carries two things:

- **`projection`** — the player's stat *distribution* (the math). The hub uses
  it for SGP joint pricing and to compare against any book's line.
- **`line`** — the engine's *originated* prop: a half-point number with
  two-sided juice. This is the postable product, and it is **required**.

```jsonc
{
  "playerId": "4433730",          // stable per engine
  "player": "Paige Bueckers",
  "team": "DAL",
  "market": "points",             // canonical key — see §5
  "projection": {
    "mean": 20.7,
    "stdev": 6.1,                 // omit for poisson / bernoulli
    "distribution": "normal"      // normal | poisson | negbin | bernoulli
  },
  "line": {
    "point": 20.5,                // ALWAYS ends in .5 — never a whole number
    "overOdds": -118,             // American; the favoured side is negative
    "underOdds": -102
  }
}
```

### The `line` — half-point rule

Every originated prop line **ends in .5**. A whole-number line allows pushes;
an originated number must resolve.

- `point` — the projection mean rounded to the nearest half-integer. A mean
  landing exactly on a whole number shifts to either adjacent .5 (engine's
  choice — see below).
- `overOdds` / `underOdds` — American prices derived from the projection:
  `P(stat > point)` is read off the `projection` distribution, then the
  family-standard vig (2.4% per side, ~4.8% hold) is applied to each side.
- The juice is **correlated to the projection** — the side the mean sits on
  carries the heavier (negative) price; the farther the mean from `point`,
  the heavier that juice.

A 21.0 projection is posted as **either** `20.5` with the over juiced **or**
`21.5` with the under juiced — both express the same view; the engine posts
one. A mean already off a whole number (e.g. 20.7) simply rounds: `point`
20.5, over lightly juiced.

### Distribution families (all the hub supports)

| Family | Params | Use for |
|---|---|---|
| `normal` | mean, stdev | continuous-ish — points, all yardage |
| `poisson` | mean | low counts — made threes, receptions |
| `negbin` | mean, stdev | over-dispersed counts — rebounds, strikeouts, hits |
| `bernoulli` | mean (= probability) | yes/no — anytime TD, double-double |

The engine picks the family it believes — it knows the stat. The hub computes
`P(stat > line)` from the family. No sport logic in the hub.

---

## 5. Canonical market keys

Engines map internal markets to these. The hub treats them as opaque pricing
keys; the sport grouping is for **display only**.

- **basketball** (nba, wnba): `points` `rebounds` `assists` `threes` `steals`
  `blocks` `turnovers` `pra` `pr` `pa` `ra` `double_double`
- **football** (nfl): `passing_yards` `passing_tds` `interceptions`
  `rushing_yards` `rushing_attempts` `receiving_yards` `receptions`
  `anytime_td`
- **baseball** (mlb): `hits` `total_bases` `home_runs` `rbis` `runs`
  `pitcher_strikeouts` `hits_allowed` `earned_runs` `walks`
- **hockey** (nhl): `shots_on_goal` `points` `goals` `assists` `saves`

New keys are added here, not invented per engine.

---

## 6. Correlation — SGP support

An SGP is correlated legs within **one game**. The contract supports two ways
to carry that correlation; an engine provides whichever it can.

### Mode A — correlation matrix (default, light)

```jsonc
"correlation": {
  "mode": "matrix",
  "keys": ["home_margin", "game_total", "DAL:points", "4433730:points", ...],
  "matrix": [[1.0, ...], ...]     // symmetric, pairwise correlations
}
```

`keys` spans **game-outcome markets** (`home_margin`, `game_total`,
`<team>:points`) and **per-player props** (`<playerId>:<market>`). The hub
reconstructs the joint via a **Gaussian copula** — marginals from §3/§4,
dependence from this matrix — and prices any SGP from it. Small payload.

### Mode B — simulation sample (optional, exact)

```jsonc
"correlation": {
  "mode": "sample",
  "n": 10000,
  "samples": [
    { "result": {"home": 88, "away": 84},
      "players": { "4433730": {"points": 24, "rebounds": 6, ...}, ... } },
    ...
  ]
}
```

The hub prices an SGP by counting joint occurrences in the sample —
correlation is exact and automatic. Heavy payload: gzip it, or serve via a
separate `/contract/{date}/sim` endpoint, or cap `n` at ~2000.

### No correlation block

The hub still prices straight props and **cross-sport parlays** (independent
legs — multiply no-vig probabilities). It will price an SGP only with a
`no-correlation` warning, since independent-leg SGP pricing is materially wrong.

---

## 7. Versioning & provenance

- `contractVersion` — this spec's version; the hub rejects majors it can't read.
- `engine` + `modelVersion` — provenance, so a mispriced slate is traceable.
- `playerId` / `gameId` — stable within an engine. No cross-sport collision
  (different player pools), so no global namespace is needed.

---

## 8. What the hub does with this (validates the contract)

- **Prop price** — the engine's originated `line` (§4) is its posted prop; the
  hub surfaces it directly. To find an edge it also reads `P(stat > line)` off
  the `projection` distribution against a book's line. Same projection, both.
- **SGP price** — joint probability of the legs via §6 (copula or sample),
  including game-outcome legs from `lines`. Apply SGP hold.
- **Cross-sport parlay** — legs from different games/sports are independent →
  multiply each leg's no-vig probability. Apply parlay hold.

Book odds are a **separate hub input** (an odds feed) — the contract carries
only projections. The hub pairs projection (this contract) with market line
(odds feed) to find edges.

---

## 9. Engine adoption checklist

1. Map internal markets → §5 canonical keys.
2. Expose `GET /contract/{date}` returning the §2 Slate document.
3. Provide §3 `lines` + §4 `props` (required).
4. Provide §6 `correlation` — Mode A from a leg-correlation estimate, or
   Mode B if the engine already runs a player-level game simulation
   (CourtSide and DugoutSide do; HoopSide's sim is game-level only so it
   would start Mode A or add a player-level sim).

First integration target: **Ironside or CourtSide** — SGP work is already
started there. Validate hub pricing against the market on one engine before
wiring the rest.
