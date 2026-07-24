/** Normalize a player name for cross-source matching (case/accent/suffix/punctuation insensitive). */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[.'’]/g, "") // periods, apostrophes
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "") // generational suffixes
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Real fielding/pitching positions we display, in canonical order. Used to clean
 * provider eligibility lists (ESPN mixes in combined-slot artifacts like "1B/3B"
 * and lineup slots like "UTIL"/"BE"/"IL") and to order position-filter chips.
 */
export const POSITION_ORDER = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "OF", "DH", "SP", "RP", "P"];
const POSITION_SET = new Set(POSITION_ORDER);

/** Keep only real positions (drop combined slots + bench/IL/UTIL), deduped, source order preserved. */
export function cleanPositions(list: string[] | undefined): string[] {
  if (!list) return [];
  const out: string[] = [];
  for (const raw of list) {
    const p = raw.trim().toUpperCase();
    if (POSITION_SET.has(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Sort positions into canonical order (for filter chips); unknowns sort last. */
export function sortPositions(list: string[]): string[] {
  return [...list].sort((a, b) => {
    const ia = POSITION_ORDER.indexOf(a);
    const ib = POSITION_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

/**
 * Canonicalize an MLB team abbreviation so ESPN's and CBS's differing codes
 * compare equal. Only three teams differ between the two providers; every other
 * abbreviation is already identical, so unknown codes pass through uppercased.
 */
export function canonicalTeam(abbr: string): string {
  const a = abbr.toUpperCase();
  const aliases: Record<string, string> = {
    // White Sox: ESPN CWS / CBS+FG CHW
    CWS: "CHW",
    // Athletics: ESPN OAK / CBS+FP ATH
    OAK: "ATH",
    // Nationals: ESPN WSH / CBS WAS / FanGraphs WSN
    WSH: "WAS",
    WSN: "WAS",
    // FanGraphs uses longer codes than ESPN/CBS/FantasyPros for these:
    KCR: "KC", // Royals
    SDP: "SD", // Padres
    SFG: "SF", // Giants
    TBR: "TB", // Rays
  };
  return aliases[a] ?? a;
}

/**
 * True when two team abbreviations clearly refer to different teams. Used to
 * reject same-name cross-provider matches. Returns false when either side is
 * blank (unknown → don't block the match).
 */
export function teamsConflict(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  // "FA"/"FA " (FantasyPros real-life free agent) means no MLB team → unknown, don't reject.
  const ca = canonicalTeam(a);
  const cb = canonicalTeam(b);
  if (ca === "FA" || cb === "FA") return false;
  return ca !== cb;
}
