import type { FgStatus } from "@/lib/types";

/**
 * Warns when FanGraphs data is stale or missing (e.g. FanGraphs Cloudflare-blocks
 * our requests). Nothing renders when FG is fresh. "stale" = we're serving the
 * last-good cached FG data; "down" = FG unavailable and no cache to fall back to.
 */
export default function FgBanner({ fg }: { fg?: FgStatus }) {
  if (!fg || fg.state === "ok") return null;
  const stale = fg.state === "stale";
  const when = fg.savedAt ? new Date(fg.savedAt).toLocaleString() : null;
  return (
    <div
      className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
        stale
          ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
          : "border-red-500/30 bg-red-500/10 text-red-300"
      }`}
    >
      <span className="font-semibold">FanGraphs unavailable</span>{" "}
      {stale ? (
        <>
          — showing <b>cached stats</b>
          {when ? ` saved ${when}` : ""}. Season, projections, and Player-Rater Pace/Rem may be
          stale; hit <b>Refresh</b> once FanGraphs is back for live numbers.
        </>
      ) : (
        <>
          — season stats &amp; projections are temporarily blank (FanGraphs is blocking automated
          requests). Savant &amp; ESPN data still show; try again shortly.
        </>
      )}
    </div>
  );
}
