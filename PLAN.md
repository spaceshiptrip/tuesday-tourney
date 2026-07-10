# Tuesday Tourney — Bowling League & Tournament App

## Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Vanilla HTML/JS score upload → Google Sheets | ✅ Built |
| 1.1 | Show version + deploy timestamp in UI footer | After test passes |
| 2 | React + Vite + Tailwind + shadcn/ui full tournament app | Planned |

---

## Phase 1 — Score Upload (Current)

### Goal

A free, serverless web app hosted on GitHub Pages that lets a user upload a screenshot of a bowling score table (taken from a TV/app display) and writes the parsed scores to a Google Sheet.

## Architecture

```
GitHub Pages (frontend)
    │
    │  POST image (base64)
    ▼
Google Apps Script Web App (backend)
    ├── OCR via Google Drive (image → Google Doc → extract text)
    ├── Parse table (standardized layout, regex/line-split)
    └── Write rows to Google Sheets via SpreadsheetApp
```

**No external APIs, no API keys, no billing.** Everything runs within the Google ecosystem + GitHub free tier.

## Components

### 1. Frontend — GitHub Pages (`index.html`)
- File input for image upload (or paste-from-clipboard)
- Preview of the selected image
- Submit button → POST to Apps Script URL
- Confirmation/error display after submission
- Optional: editable preview of parsed scores before final submit

### 2. Backend — Google Apps Script (`Code.gs`)
Deployed as a publicly accessible **Web App** (POST endpoint).

Steps it performs:
1. Receives `base64`-encoded image from frontend
2. Saves image temporarily to Google Drive
3. Converts file to a Google Doc (triggers Drive's built-in OCR)
4. Extracts text from the resulting Doc
5. Deletes temp Drive files
6. Parses the extracted text against the known table layout
7. Appends parsed rows to the target Google Sheet
8. Returns JSON `{ success, rows }` to frontend

### 3. Google Sheet
- Pre-existing sheet that Apps Script has edit access to
- Columns match the bowling score table structure (TBD — needs sample image)

## Key Assumptions / Constraints
- Score tables are **standardized digital text** displayed on a TV screen — consistent layout, legible font. This makes OCR reliable and parsing straightforward.
- Drive OCR returns raw text (no column positions), so the parser must be tuned to the exact table format.
- Apps Script free tier limits: 6 min execution time, 100 MB Drive, 20k Sheets cells/day — all well within scope for this use case.

## Table Layout (from sample images)

```
Team: Team 2          1st   2nd   3rd   Totals
Roger Webb            167   167   167   501
Rob Mochizuki         127   188   129   444
Andrew Choy           180   192   181   553
Michael Fajardo       175   202   135   512

Games 1 to 3
              Pins    649   749   612   2010
             +HDCP    152   152   152   456
            Totals  X 801  √901  X764  X 2466
```

- One image = one team's 3-game series
- 4 players per team (may vary)
- `X` = loss, `√` = win on that game's total (including handicap)
- Handicap (`+HDCP`) is constant across all games

### Target Google Sheet Columns

One row per player per upload session:

| Date | Team | Player | Game1 | Game2 | Game3 | Series |
|------|------|--------|-------|-------|-------|--------|

Summary rows (Pins, +HDCP, Totals) written as additional rows with player name set to the label (e.g. `"Pins"`, `"+HDCP"`, `"Totals"`).

Win/loss markers (`X`/`√`) stored in separate columns alongside each game total for the Totals row.

## Open Questions Before Coding
1. **Sheet structure** — confirm column layout above, or adjust (e.g. separate tab for summary data)?
2. **Date** — auto-stamp upload date, or let user enter the session/league date?
3. **Multi-team** — will users upload one team at a time, or is there a second team's sheet to capture too?
4. **Auth** — is the frontend public or should it be access-controlled?

## File Structure (implemented)

```
tuesday-tourney/
├── index.html            # Upload UI
├── style.css             # Styles
├── app.js                # Frontend logic (set APPS_SCRIPT_URL here)
├── apps-script/
│   └── Code.gs           # Paste into Google Apps Script editor
└── data/                 # Sample images
```

## Setup Steps

### 1. Google Sheet
1. Create a new Google Sheet
2. Copy its ID from the URL: `docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`
3. The script will auto-create a "Scores" tab with headers on first run

### 2. Google Apps Script
1. Go to [script.google.com](https://script.google.com) → New project
2. Paste the contents of `apps-script/Code.gs` into the editor
3. Replace `YOUR_GOOGLE_SHEET_ID_HERE` with your Sheet ID
4. Enable the Drive Advanced Service: **Services (+) → Drive API → Add**
5. Click **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the Web App URL

### 3. Frontend
1. Open `app.js` and replace `YOUR_APPS_SCRIPT_URL_HERE` with the URL from step 2.6
2. Push to GitHub, enable **Settings → Pages → Deploy from main branch root**

### 4. Test
Upload one of the images from `data/` and verify rows appear in the Sheet.

---

## Phase 2 — Full Tournament App (React / Vite / Tailwind / shadcn/ui)

### Vision

Expand from a single-purpose upload tool into a full bowling league management and brackets tournament app. The Google Sheet remains the source of truth for raw scores; the React app reads from it (or a lightweight backend) to drive standings, bracket logic, and visualizations.

### Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | React 18 + TypeScript | Component model fits bracket/table UI well |
| Build | Vite | Fast HMR, zero-config GitHub Pages deploy |
| Styling | Tailwind CSS v3 | Utility-first; required by shadcn and Tremor |
| Components | shadcn/ui | Radix primitives + Tailwind; unstyled base, full ownership |
| Charts | shadcn/ui Charts (Recharts) | Ships with shadcn, Tailwind-aware, composable |
| Dashboards | Tremor | Higher-level chart/stat/card components built on Tailwind |
| Bracket viz | React Flow | Node-edge graph renderer; ideal for elimination bracket trees |
| Routing | React Router v6 | Standard SPA routing; works with GitHub Pages (hash mode) |
| Data fetching | TanStack Query | Caching + background refetch for Sheet API calls |
| State | Zustand | Lightweight global state (current tournament, selected team) |

### Graph / Visualization Libraries (all Tailwind-compatible)

**shadcn/ui Charts** (`recharts` under the hood)
- Bar charts: per-player game scores over the season
- Line charts: team pin totals week over week
- Radar charts: per-player consistency across games

**Tremor**
- `BarList` for quick leaderboard rankings
- `AreaChart` for cumulative series totals over the season
- `DonutChart` for win/loss breakdown per team
- `Metric` + `BadgeDelta` cards for dashboard KPIs (avg pins, HDCP, W/L record)

**React Flow**
- Single-elimination and double-elimination bracket trees
- Nodes = match cards (teams, scores, winner indicator)
- Edges = bracket progression lines
- Custom node renderer using shadcn Card components

### App Pages & Routes

```
/                   Dashboard — current standings, recent upload, KPI cards
/upload             Score upload (Phase 1 feature, ported to React)
/bracket            Tournament bracket view (React Flow)
/teams              Team roster and per-player stats
/teams/:teamId      Team detail — player cards, game history charts
/scores             Full score history table with filters
/players/:playerId  Player detail — series trend, avg per game, W/L
```

### Component Architecture

```
src/
├── components/
│   ├── ui/                  # shadcn/ui generated components (Button, Card, Table…)
│   ├── bracket/
│   │   ├── BracketView.tsx  # React Flow canvas
│   │   ├── MatchNode.tsx    # Custom node: team names, scores, winner badge
│   │   └── useBracket.ts    # Bracket state machine (seed, advance, reset)
│   ├── charts/
│   │   ├── SeriesTrend.tsx  # shadcn AreaChart — weekly series totals
│   │   ├── GameBreakdown.tsx# shadcn BarChart — G1/G2/G3 per player
│   │   ├── TeamDonut.tsx    # Tremor DonutChart — team W/L
│   │   └── LeaderBoard.tsx  # Tremor BarList — ranked by avg series
│   ├── scores/
│   │   ├── UploadZone.tsx   # Port of Phase 1 upload UI
│   │   ├── ScoreTable.tsx   # shadcn Table — score history
│   │   └── ParsePreview.tsx # Editable confirmation before submitting
│   └── layout/
│       ├── Shell.tsx        # Sidebar nav + top bar
│       └── Nav.tsx
├── hooks/
│   ├── useScores.ts         # TanStack Query — fetch scores from Sheet/API
│   ├── useTournament.ts     # Tournament bracket state
│   └── useUpload.ts         # Image → Apps Script → Sheet flow
├── lib/
│   ├── sheets.ts            # Google Sheets API client
│   ├── parser.ts            # Port of Code.gs parseScores() to TypeScript
│   └── bracket.ts           # Seeding, match generation, advancement logic
├── pages/
│   ├── Dashboard.tsx
│   ├── Bracket.tsx
│   ├── Teams.tsx
│   ├── Scores.tsx
│   └── Upload.tsx
└── types/
    └── index.ts             # Score, Player, Team, Match, Tournament interfaces
```

### Data Model (TypeScript)

```ts
interface Player   { id: string; name: string; teamId: string }
interface Team     { id: string; name: string; players: Player[] }
interface GameScore { game1: number; game2: number; game3: number; series: number }
interface ScoreRow {
  date: string; team: string; player: string;
  game1: number; game2: number; game3: number; series: number;
  rowType: 'player' | 'pins' | 'hdcp' | 'totals';
}
interface Match {
  id: string; round: number; position: number;
  teamA?: Team; teamB?: Team; winner?: Team;
  scores?: { teamA: number; teamB: number };
}
interface Tournament {
  id: string; name: string; format: 'single-elim' | 'double-elim';
  teams: Team[]; matches: Match[]; startDate: string;
}
```

### Backend Evolution

Phase 1 uses Google Apps Script as the only backend. Phase 2 options:

| Option | Effort | Notes |
|--------|--------|-------|
| Keep Apps Script | Low | Add more endpoints (GET scores, GET teams) |
| Add Cloudflare Worker | Medium | More control, free tier, TypeScript, Hono framework |
| Firebase (Firestore + Functions) | Higher | Real-time updates, auth, generous free tier |

Recommended path: extend Apps Script for Phase 2 (it already has Sheets access), migrate to Cloudflare Worker + D1 if query complexity grows.

### Migration Path from Phase 1

1. Scaffold: `npm create vite@latest tuesday-tourney -- --template react-ts`
2. Install Tailwind, shadcn/ui, Tremor, React Flow, React Router, TanStack Query, Zustand
3. Port `parseScores()` from `Code.gs` to `src/lib/parser.ts`
4. Port upload UI (`UploadZone.tsx`) from `index.html` / `app.js`
5. Build `useScores` hook to read existing Sheet data
6. Build Dashboard and Scores pages (data already exists in Sheet)
7. Build bracket logic and React Flow bracket view
8. Add player/team detail pages with charts
9. Deploy: `vite build` → GitHub Pages via `gh-pages` branch or GitHub Actions
