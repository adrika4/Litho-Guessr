import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { LOCATIONS } from './locations.js';
import { haversineKm, scoreFromDistance } from './utils/geo.js';

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

const TOKEN = process.env.MAPILLARY_TOKEN;
const PORT = process.env.PORT || 3001;
const TOTAL_ROUNDS = 5;

// All running games live in memory: gameId -> game object.
// (Fine for a demo. A restart wipes them.)
const games = new Map();

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Ask Mapillary for 360 photos inside a small box around a location.
async function fetchImages(loc, d) {
  const bbox = [loc.lng - d, loc.lat - d, loc.lng + d, loc.lat + d].join(','); // west,south,east,north
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

// Try a big box first. If Mapillary says "too much data", retry with smaller boxes.
// Remember search results per city: name -> Promise of a list of 360 photos.
const panoCache = new Map();

function getPanos(loc) {
  if (!panoCache.has(loc.name)) {
    panoCache.set(loc.name, searchPanos(loc));
  }
  return panoCache.get(loc.name);
}

// Try a big box first. If Mapillary says "too much data", retry with smaller boxes.
async function searchPanos(loc) {
  for (const d of [0.005, 0.0015, 0.0006]) {
    try {
      const { ok, status, body } = await fetchImages(loc, d);

      if (!ok) {
        console.log(`[${loc.name}] box ${d}: error ${status}`);
        continue;
      }

      const usable = (body.data ?? [])
        .filter((img) => img.is_pano && (img.computed_geometry || img.geometry))
        .map((img) => {
          const point = img.computed_geometry ?? img.geometry;
          const [lng, lat] = point.coordinates; // GeoJSON order is [lng, lat]
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
// POST /api/game/start -> creates a game with 5 rounds.
// The reply contains ONLY image IDs, not the answers.
app.post('/api/game/start', async (req, res) => {
  try {
    const rounds = [];
      for (const loc of shuffle(LOCATIONS)) {
      if (rounds.length === TOTAL_ROUNDS) break;
      const panos = await getPanos(loc);
      if (panos.length === 0) continue; // no 360 photos here, skip this city
      rounds.push(panos[Math.floor(Math.random() * panos.length)]);
    }

    if (rounds.length < TOTAL_ROUNDS) {
      return res.status(503).json({ error: 'Could not find enough photos. Try again.' });
    }

    const gameId = crypto.randomUUID();
    games.set(gameId, { rounds, results: [], totalScore: 0 });

    res.json({
      gameId,
      totalRounds: TOTAL_ROUNDS,
      rounds: rounds.map((r) => ({ imageId: r.imageId })),
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not reach Mapillary' });
  }
});

// POST /api/game/:id/guess  body: { round, lat, lng }
app.post('/api/game/:id/guess', (req, res) => {
  const game = games.get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const { round, lat, lng } = req.body ?? {};
  const validRound = Number.isInteger(round) && round >= 0 && round < TOTAL_ROUNDS;
  const validLat = Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const validLng = Number.isFinite(lng) && lng >= -180 && lng <= 180;
  if (!validRound || !validLat || !validLng) {
    return res.status(400).json({ error: 'Invalid round, lat or lng' });
  }

  if (game.results[round]) {
    return res.status(409).json({ error: 'Round already guessed' });
  }

  const answer = game.rounds[round];
  const km = haversineKm(lat, lng, answer.lat, answer.lng);
  const points = scoreFromDistance(km);

  game.results[round] = { km: Math.round(km), points };
  game.totalScore += points;

  res.json({
    answer: { lat: answer.lat, lng: answer.lng, name: answer.name },
    km: Math.round(km),
    points,
    totalScore: game.totalScore,
  });
});

app.listen(PORT, (err) => {
  if (err) {
    console.error('Could not start server:', err.message);
    process.exit(1);
  }
  console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Server running on http://localhost:${PORT}`);
  LOCATIONS.forEach(getPanos); // search every city in the background, in parallel
});