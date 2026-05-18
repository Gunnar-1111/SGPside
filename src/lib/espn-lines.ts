// Live market lines (spread / total / moneyline) from ESPN's scoreboard.
//
// Per CONTRACT.md §8, book odds are a SEPARATE hub input — they are not part
// of the engine contract. SGPside pulls them here and shows model vs market.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MarketLines {
  provider: string;
  homeSpread: number | null; // home perspective — negative = home favored
  total: number | null;
  homeML: number | null;
  awayML: number | null;
}

// ESPN league path per contract sport key.
const SPORT_PATH: Record<string, string> = {
  nba: "basketball/nba",
  wnba: "basketball/wnba",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
  nfl: "football/nfl",
};

function asNum(v: unknown): number | null {
  const n = parseFloat(String(v).replace(/[ou+\s]/g, ""));
  return Number.isNaN(n) ? null : n;
}

function asOdds(v: unknown): number | null {
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}

/** Fetch the market line for one game, matched by date + team abbreviations. */
export async function fetchMarketLines(
  sport: string,
  date: string,
  home: string,
  away: string,
): Promise<MarketLines | null> {
  const path = SPORT_PATH[sport] ?? "basketball/nba";
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard` +
    `?dates=${date.replace(/-/g, "")}`;

  let data: any;
  try {
    const res = await fetch(url, { next: { revalidate: 300 } }); // 5-min cache
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  for (const ev of data.events ?? []) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const cs: any[] = comp.competitors ?? [];
    const h = cs.find((c) => c.homeAway === "home");
    const a = cs.find((c) => c.homeAway === "away");
    if (h?.team?.abbreviation !== home || a?.team?.abbreviation !== away) {
      continue;
    }
    const o = comp.odds?.[0];
    if (!o) return null;
    return {
      provider: o.provider?.name ?? "market",
      homeSpread:
        typeof o.spread === "number"
          ? o.spread
          : asNum(o.pointSpread?.home?.close?.line),
      total:
        typeof o.overUnder === "number"
          ? o.overUnder
          : asNum(o.total?.over?.close?.line),
      homeML: asOdds(o.moneyline?.home?.close?.odds),
      awayML: asOdds(o.moneyline?.away?.close?.odds),
    };
  }
  return null;
}
