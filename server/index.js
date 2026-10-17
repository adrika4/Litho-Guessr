// ============ 1. IMPORTS ============
import dns from 'node:dns';

// Some home networks block the DNS lookup MongoDB Atlas needs. For local use, ask public DNS instead.
if (process.env.USE_PUBLIC_DNS === 'true') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}
import 'dotenv/config';               // loads server/.env into process.env
import crypto from 'node:crypto';     // built-in: randomUUID() for game IDs
import express from 'express';        // web framework: routes + middleware
import cors from 'cors';              // adds headers so the browser allows cross-origin calls
import mongoose from 'mongoose';      // talks to MongoDB
import { z } from 'zod';              // validates the shape of incoming data
import { rateLimit } from 'express-rate-limit'; // blocks request spam
import { LOCATIONS } from './locations.js';     // the list of cities
import { haversineKm, scoreFromDistance } from './utils/geo.js';

// ============ 2. CONFIG ============
const TOKEN = process.env.MAPILLARY_TOKEN;   // secret, never sent to the browser by this server
const PORT = process.env.PORT || 3001;       // Render sets PORT itself in production
const TOTAL_ROUNDS = 5;
// Which website addresses may call this server (comma-separated list in .env).
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim());

// ============ 3. APP + MIDDLEWARE ============
// Middleware = functions every request passes through, in order, before reaching a route.
const app = express();
app.set('trust proxy', 1);              // behind Render's proxy, so rate limits see real client IPs
app.use(cors({ origin: CLIENT_ORIGINS }));
app.use(express.json());                // turns a JSON request body into req.body

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,             // 15 minutes
  limit: 300,                           // max requests per IP per window (one game = 6 requests)
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again later.' },
});
const startLimiter = rateLimit({        // stricter: starting a game is the expensive route
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many games started. Try again later.' },
});
app.use('/api', generalLimiter);        // applies to every route starting with /api

// ============ 4. MONGODB ============
// A schema describes what a saved score looks like. A model is the tool for saving/finding them.
const scoreSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 20 },
  score: { type: Number, required: true, min: 0, max: TOTAL_ROUNDS * 5000 },
  createdAt: { type: Date, default: Date.now },
});
scoreSchema.index({ score: -1, createdAt: 1 }); // makes "top scores" lookups fast
const Score = mongoose.model('Score', scoreSchema); // collection name becomes "scores"

if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB connected'))
    .catch((err) => console.log('MongoDB connection failed:', err.message));
} else {
  console.log('MONGODB_URI not set: leaderboard disabled');
}
const dbReady = () => mongoose.connection.readyState === 1; // 1 means connected

const nameSchema = z.object({ name: z.string().trim().min(2).max(20) });

// ============ 5. IN-MEMORY STORAGE ============
// games: gameId -> { rounds:[5 true locations], results:[...], totalScore, createdAt, submitted }
const games = new Map();

// panoCache: city name -> Promise resolving to a list of 360 photos found there.
// Storing the Promise (not the result) means two requests for the same city share one search.
const panoCache = new Map();

// Delete games older than 1 hour, every 10 minutes, so memory doesn't grow forever.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, game] of games) {
    if (game.createdAt < cutoff) games.delete(id);
  }
}, 10 * 60 * 1000);

// ============ 6. HELPERS ============
// Fisher-Yates shuffle: a fair random order, returns a copy.
function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// One request to Mapillary: 360 photos inside a box around the city.
// bbox format is west,south,east,north. d is half the box size in degrees.
async function fetchImages(loc, d) {
  const bbox = [loc.lng - d, loc.lat - d, loc.lng + d, loc.lat + d].join(',');
  const url =
    'https://graph.mapillary.com/images' +
    `?fields=id,is_pano,computed_geometry,geometry&is_pano=true&bbox=${bbox}&limit=50`;

  const r = await fetch(url, {
    headers: { Authorization: `OAuth ${TOKEN}` },
    signal: AbortSignal.timeout(10000), // give up after 10 seconds
  });
  const body = await r.json();
  return { ok: r.ok, status: r.status, body };
}

// Try a big box first. Dense cities return "too much data" (error 500), so retry smaller.
async function searchPanos(loc) {
  for (const d of [0.005, 0.0015, 0.0006]) {
    try {
      const { ok, status, body } = await fetchImages(loc, d);
      if (!ok) {
        console.log(`[${loc.name}] box ${d}: error ${status}`);
        continue; // next, smaller box
      }

      const usable = (body.data ?? [])
        .filter((img) => img.is_pano && (img.computed_geometry || img.geometry))
        .map((img) => {
          const point = img.computed_geometry ?? img.geometry; // prefer the corrected position
          const [lng, lat] = point.coordinates;                // GeoJSON order is [lng, lat]
          return { imageId: img.id, lat, lng, name: loc.name };
        });

      console.log(`[${loc.name}] box ${d}: found ${usable.length} panos`);
      return usable;
    } catch (err) {
      console.log(`[${loc.name}] request failed:`, err.message);
      panoCache.delete(loc.name); // don't remember network failures
      return [];
    }
  }
  panoCache.delete(loc.name); // every box size errored, so allow a retry later
  return [];
}

// Cache wrapper: search a city once, reuse the answer afterwards.
function getPanos(loc) {
  if (!panoCache.has(loc.name)) {
    panoCache.set(loc.name, searchPanos(loc));
  }
  return panoCache.get(loc.name);
}

// ============ 7. ROUTES ============
app.get('/', (req, res) => res.send('GeoGuessr server is running'));

// START: build a game. Replies with image IDs only, never the answers.
app.post('/api/game/start', startLimiter, async (req, res) => {
  try {
    const rounds = [];
    for (const loc of shuffle(LOCATIONS)) {
      if (rounds.length === TOTAL_ROUNDS) break;
      const panos = await getPanos(loc);          // from cache, or waits for the running search
      if (panos.length === 0) continue;           // no 360 photos here, skip this city
      rounds.push(panos[Math.floor(Math.random() * panos.length)]); // random photo
    }

    if (rounds.length < TOTAL_ROUNDS) {
      return res.status(503).json({ error: 'Could not find enough photos. Try again.' });
    }

    const gameId = crypto.randomUUID();
    games.set(gameId, {                            // the TRUE locations are stored here
      rounds,
      results: [],
      totalScore: 0,
      createdAt: Date.now(),
      submitted: false,
    });

    res.json({
      gameId,
      totalRounds: TOTAL_ROUNDS,
      rounds: rounds.map((r) => ({ imageId: r.imageId })), // strips lat/lng/name
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not reach Mapillary' });
  }
});

// GUESS: score one round. body: { round, lat, lng }
app.post('/api/game/:id/guess', (req, res) => {
  const game = games.get(req.params.id);          // look up the game by its ID in the Map
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const { round, lat, lng } = req.body ?? {};
  const validRound = Number.isInteger(round) && round >= 0 && round < TOTAL_ROUNDS;
  const validLat = Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const validLng = Number.isFinite(lng) && lng >= -180 && lng <= 180;
  if (!validRound || !validLat || !validLng) {
    return res.status(400).json({ error: 'Invalid round, lat or lng' });
  }

  if (game.results[round]) {
    return res.status(409).json({ error: 'Round already guessed' }); // no re-guessing
  }

  const answer = game.rounds[round];               // THE TRUE LOCATION for this round
  const km = haversineKm(lat, lng, answer.lat, answer.lng);
  const points = scoreFromDistance(km);

  game.results[round] = { km: Math.round(km), points }; // saved result for this round
  game.totalScore += points;                            // running total, kept on the server

  res.json({
    answer: { lat: answer.lat, lng: answer.lng, name: answer.name },
    km: Math.round(km),
    points,
    totalScore: game.totalScore,
  });
});

// SAVE SCORE: after all 5 rounds, store name + the SERVER's total in MongoDB.
app.post('/api/game/:id/score', async (req, res) => {
  const game = games.get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const finished = game.results.filter(Boolean).length === TOTAL_ROUNDS;
  if (!finished) return res.status(400).json({ error: 'Finish all rounds first' });
  if (game.submitted) return res.status(409).json({ error: 'Score already saved' });

  const parsed = nameSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Name must be 2-20 characters' });
  }
  if (!dbReady()) return res.status(503).json({ error: 'Leaderboard unavailable' });

  try {
    // The score comes from game.totalScore, NOT from the browser, so it can't be faked.
    await Score.create({ name: parsed.data.name, score: game.totalScore });
    game.submitted = true;
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save score' });
  }
});

// LEADERBOARD: top 10 scores.
app.get('/api/leaderboard', async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: 'Leaderboard unavailable' });
  try {
    const top = await Score.find()
      .sort({ score: -1, createdAt: 1 }) // highest first; earlier date wins ties
      .limit(10)
      .select('name score -_id')          // only these fields
      .lean();                            // plain JS objects, faster
    res.json(top);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load leaderboard' });
  }
});

// ============ 8. START ============
app.listen(PORT, (err) => {
  if (err) {
    console.error('Could not start server:', err.message);
    process.exit(1);
  }
  console.log(`Server running on http://localhost:${PORT}`);
  LOCATIONS.forEach(getPanos); // warm the cache: search every city now, in parallel
});