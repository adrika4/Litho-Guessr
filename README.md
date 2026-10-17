# Litho-Guessr

A GeoGuessr-style geography game. You are dropped into a real 360° street-level photo, look around for clues, drop a pin on a world map, and get points based on how close you were. Five rounds per game, with a saved leaderboard.

**Live demo:** `PASTE_YOUR_VERCEL_URL_HERE`
> The server runs on a free tier and sleeps when idle, so the first load can take up to a minute.

![Gameplay screenshot](docs/screenshot-game.png)
![Result screenshot](docs/screenshot-result.png)

## Features

- 360° photos you can drag to look around and move along the road (Mapillary)
- Interactive world map for placing your guess (Leaflet + OpenStreetMap)
- Five rounds, a score per round, a running total and a final summary
- Distance calculated with the haversine formula; score falls off exponentially with distance
- Global top-10 leaderboard stored in MongoDB
- Input validation, rate limiting, request timeouts and retry handling

## How it works

```
Browser (Vite + vanilla JS)  <-->  Express API (Node)  <-->  Mapillary Graph API
  Leaflet map, Mapillary viewer         scoring, game state        360° photo search
                                              |
                                              +-->  MongoDB Atlas (leaderboard)
```

1. On startup the server searches Mapillary for 360° photos around a list of cities (in parallel) and caches the results in memory.
2. `POST /api/game/start` picks 5 cities at random, takes a random cached photo from each, stores the true locations server-side under a random game ID, and returns **only the photo IDs**.
3. The browser shows each photo in the Mapillary viewer and lets the player drop a pin.
4. `POST /api/game/:id/guess` receives the pin. The server validates it, computes the distance with haversine, converts it to points, saves the round result and returns the true location.
5. After round 5 the player can save their name. `POST /api/game/:id/score` stores the **server's own total** in MongoDB, never a number sent by the browser.

## Tech stack

| Part | Tools |
|---|---|
| Frontend | Vite, vanilla JavaScript (ES modules), Leaflet, mapillary-js |
| Backend | Node.js, Express, cors, dotenv |
| Database | MongoDB Atlas with Mongoose |
| Safety | zod (input validation), express-rate-limit |
| Data and map sources | Mapillary Graph API, OpenStreetMap tiles |
| Hosting | Render (server), Vercel (client), MongoDB Atlas (database) |

## API

| Route | Body | Success response | Errors |
|---|---|---|---|
| `POST /api/game/start` | none | `{ gameId, totalRounds, rounds: [{ imageId }] }` | 503 no photos, 429 rate limited |
| `POST /api/game/:id/guess` | `{ round, lat, lng }` | `{ answer, km, points, totalScore }` | 400 invalid input, 404 unknown game, 409 round already guessed |
| `POST /api/game/:id/score` | `{ name }` | `{ ok: true }` | 400, 404, 409 already saved, 503 database unavailable |
| `GET /api/leaderboard` | none | `[{ name, score }]` (top 10) | 503, 500 |

## Scoring

Distance uses the haversine formula (great-circle distance on a sphere, `R = 6371 km`), because flat latitude/longitude math is wrong over long distances.

```
points = round(5000 * e^(-distance_km / 1492.7))
```

| Distance | Approx. points |
|---|---|
| 0 km | 5000 |
| 100 km | ~4680 |
| 1,000 km | ~2560 |
| 5,000 km | ~175 |

## Design decisions

- **Server-side scoring and state.** The browser cannot choose its own score, and the true locations are only sent after a guess. Round repeats are rejected.
- **Cached photo search.** The cache stores a promise per city, so concurrent requests share one search and games start quickly.
- **Handling Mapillary limits.** Dense cities return an error when too much data is requested, so the search retries with progressively smaller boxes. Requests have a 10-second timeout.
- **Rate limiting.** A general limit on all API routes and a stricter limit on starting games.
- **Game cleanup.** In-memory games older than one hour are deleted every ten minutes.
- **No framework on the frontend.** State is a set of plain variables and the screen is redrawn by functions, to keep every line understandable.

## Run it locally

Requirements: Node 20 or later, a free [Mapillary](https://www.mapillary.com/developer) client token, and (optional) a free MongoDB Atlas cluster.

```bash
git clone https://github.com/adrika4/Litho-Guessr.git
cd Litho-Guessr
```

**Server**

```bash
cd server
npm install
```

Create `server/.env`:

```
MAPILLARY_TOKEN=your_mapillary_token
MONGODB_URI=your_atlas_connection_string
CLIENT_ORIGIN=http://localhost:5173
PORT=3001
```

```bash
npm start
```

Without `MONGODB_URI` the game still works, but the leaderboard is disabled.

**Client** (in a second terminal)

```bash
cd client
npm install
```

Create `client/.env`:

```
VITE_MAPILLARY_TOKEN=your_mapillary_token
VITE_API_URL=http://localhost:3001
```

```bash
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `MAPILLARY_TOKEN` | server | Searches Mapillary for 360° photos |
| `MONGODB_URI` | server | Database connection string |
| `CLIENT_ORIGIN` | server | Website address(es) allowed by CORS, comma-separated |
| `PORT` | server | Set automatically by most hosts |
| `USE_PUBLIC_DNS` | server (local only) | Optional workaround for networks that block MongoDB SRV lookups |
| `VITE_MAPILLARY_TOKEN` | client | Lets the viewer load images (a public client token) |
| `VITE_API_URL` | client | Address of the server |

## Limitations

- **A determined player can find the answer.** The 360° viewer needs the photo's real position in the browser. Server-side scoring protects the score rules and the leaderboard, not the secrecy of the location.
- **Games are stored in memory.** A server restart ends any game in progress. Saved scores are safe in MongoDB.
- **Coverage is patchy.** Some cities have no 360° photos, so the server skips them. The city list is curated by hand.
- **Free hosting.** The server may sleep when idle, which slows the first request.
- **No accounts.** The leaderboard uses a typed name with no authentication.

## Ideas for next steps

- User accounts with JWT instead of free-text names
- Region-specific location packs and difficulty modes
- A round timer and a "no moving" mode
- Tests for the haversine and scoring functions
- Multiplayer rooms with WebSockets

## Credits

- Street-level imagery: [Mapillary](https://www.mapillary.com/) contributors
- Map data and tiles: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- Map library: [Leaflet](https://leafletjs.com/)
