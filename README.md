# Fantasy Baseball Dashboard

A local web app that shows a **combined view of your fantasy baseball teams across ESPN and CBS** on one page. Responsive — works on desktop and Android browsers.

## Architecture

Every site is a **provider adapter** that maps its own data into one shared, normalized model (`src/lib/types.ts`). The UI never sees site-specific fields, so adding another site later means writing one more adapter.

```
src/
  app/
    page.tsx            # dashboard UI (client) — fetches /api/teams
    api/teams/route.ts  # fetches all configured providers in parallel
  lib/
    types.ts            # normalized model every provider emits
    config.ts           # reads credentials from .env.local (server only)
    providers.ts        # registry of configured providers
    espn/               # ESPN adapter (unofficial v3 API, cookie auth)
    cbs/                # CBS adapter (API token preferred, cookie fallback)
  components/           # TeamCard, RosterTable
```

A failure in one provider doesn't break the page — its error shows as a banner and the other team still renders.

## Setup

```bash
npm install        # already done
cp .env.local.example .env.local
# edit .env.local with your league details (see below)
npm run dev        # http://localhost:3000
```

## Getting your credentials

### ESPN (private league)

1. **League & team id** — open your team page on `fantasy.espn.com`. The URL contains `leagueId=XXXXX` and `teamId=N`.
2. **Auth cookies** — in a browser logged into ESPN: DevTools → Application → Cookies → `https://fantasy.espn.com`:
   - `espn_s2` → `ESPN_S2`
   - `SWID` (copy the value *including* the `{ }` braces) → `ESPN_SWID`

These cookies are long-lived but expire eventually; if you start getting `401`, re-copy them.

### CBS (private league)

CBS has no clean public API. Two options, in order of preference:

1. **API token (recommended).** In your CBS *League Office*, look for an **API Access** setting and enable it — CBS gives you an access token. Put it in `CBS_ACCESS_TOKEN`. Set `CBS_LEAGUE_HOST` to your league subdomain (`myleague` from `myleague.baseball.cbssports.com`) and `CBS_TEAM_ID` to your team's id.
2. **Cookie fallback.** If your league has no API access, scraping the logged-in HTML is the fallback (`CBS_COOKIE`). The HTML parser isn't written yet because it must match your league's actual page markup — share a sample of your CBS roster page and it can be completed.

> The first CBS API call logs the raw rosters response (truncated) to the server console. The field mapping has already been locked against a real league response, so this is just a sanity aid. See `src/lib/cbs/client.ts`.

## Status

- **ESPN** — fully implemented and validated against the unofficial v3 read API. Note ESPN baseball uses two distinct numeric id-spaces: `eligibleSlots` are lineup-slot ids (→ `SLOT_MAP`), while `defaultPositionId` has its own enumeration (→ `POSITION_MAP`). Both maps live in `src/lib/espn/constants.ts` — the one place to fix if a label ever looks off.
- **CBS** — fully implemented and validated against a live API-token response. Uses two endpoints:
  - `/league/rosters` for the roster. Lineup membership comes from each player's `roster_status` (`A`=starter, `RS`/`ML`=bench, `I`=injured), **not** `roster_pos` (which is just the position label).
  - `/league/standings/overall` for the W-L record, season points (`points_scored` → `pointsFor`), and a computed overall rank. This is both an H2H **and** points league, so both are surfaced. The standings call is best-effort: if it fails, the roster still loads and the record falls back to `0`.
- **CBS scrape mode** (`CBS_COOKIE`) remains an unimplemented stub — unnecessary while the API-token path works.
- Secrets live only in `.env.local` (gitignored) and are read server-side; they never reach the browser.
