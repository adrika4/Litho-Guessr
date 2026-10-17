// ============ 1. IMPORTS ============
import L from 'leaflet';                        // the map library
import 'leaflet/dist/leaflet.css';              // Leaflet's required styles
import { Viewer } from 'mapillary-js';          // the 360 photo viewer
import 'mapillary-js/dist/mapillary.css';
import './style.css';                           // our own styles

// ============ 2. CONFIG ============
// Vite replaces import.meta.env.X with values from client/.env at build time.
const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const MAPILLARY_TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN; // public client token, by design

// ============ 3. MAP SETUP ============
const map = L.map('map').setView([20, 0], 2);   // centre [lat,lng], zoom 2 = whole world
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors', // required credit
}).addTo(map);

// ============ 4. PAGE ELEMENTS ============
// Grab each element from index.html once, by its id, so we can change them later.
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const retryBtn = document.getElementById('retry-btn');
const roundLabel = document.getElementById('round-label');
const totalLabel = document.getElementById('total-label');
const guessBtn = document.getElementById('guess-btn');
const nextBtn = document.getElementById('next-btn');
const resultEl = document.getElementById('result');
const finalEl = document.getElementById('final');
const finalTotal = document.getElementById('final-total');
const finalList = document.getElementById('final-list');
const playAgainBtn = document.getElementById('play-again-btn');
const submitBox = document.getElementById('submit-box');
const nameInput = document.getElementById('name-input');
const submitBtn = document.getElementById('submit-btn');
const submitMsg = document.getElementById('submit-msg');
const leaderboardEl = document.getElementById('leaderboard');

// ============ 5. STATE ============
// "State" = variables describing the game right now. The screen is redrawn from these.
let viewer = null;       // Mapillary viewer, created once then reused
let gameId = null;       // ID the server gave us; sent with every guess
let imageIds = [];       // 5 photo IDs (no coordinates!)
let totalRounds = 5;
let roundIndex = 0;      // 0-based current round
let totalScore = 0;      // copy of the server's total, for display
let results = [];        // per-round results, for the final screen
let guessMarker = null;  // the circle the player placed
let guessPosition = null;// {lat,lng} of that circle
let roundOver = false;   // true after guessing: blocks more clicks
let roundLayers = [];    // everything we drew on the map this round, to erase later

// ============ 6. SMALL HELPERS ============
function showStatus(message, showRetry = false) { // covers the photo area with a message
  statusText.textContent = message;
  retryBtn.hidden = !showRetry;
  statusEl.hidden = false;
}
function hideStatus() {
  statusEl.hidden = true;
}
function clearRoundLayers() {                     // remove last round's markers and line
  roundLayers.forEach((layer) => map.removeLayer(layer));
  roundLayers = [];
}

// ============ 7. GAME FLOW ============
// Ask the server for a new game.
async function startGame() {
  finalEl.hidden = true;
  guessBtn.hidden = true;
  nextBtn.hidden = true;
  clearRoundLayers();
  showStatus('Finding photos... this can take up to 20 seconds');

  try {
    const res = await fetch(`${API}/api/game/start`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error'); // 503, 429, etc.

    gameId = data.gameId;
    totalRounds = data.totalRounds;
    imageIds = data.rounds.map((r) => r.imageId);   // keep only the IDs
    roundIndex = 0;
    totalScore = 0;
    results = [];
    await showRound();
  } catch (err) {
    showStatus(`Could not start the game: ${err.message}`, true); // true = show Try again
  }
}

// Set up the screen for the current round.
async function showRound() {
  clearRoundLayers();
  guessMarker = null;
  guessPosition = null;
  roundOver = false;

  guessBtn.hidden = false;
  guessBtn.disabled = true;      // nothing to submit until the player clicks the map
  nextBtn.hidden = true;
  resultEl.textContent = '';
  map.setView([20, 0], 2);       // reset to the world view

  roundLabel.textContent = `Round ${roundIndex + 1} / ${totalRounds}`;
  totalLabel.textContent = `Total: ${totalScore}`;

  showStatus('Loading photo...');
  try {
    if (!viewer) {
      viewer = new Viewer({ accessToken: MAPILLARY_TOKEN, container: 'mly', imageId: imageIds[roundIndex] });
    } else {
      await viewer.moveTo(imageIds[roundIndex]);    // reuse the viewer, jump to next photo
    }
    hideStatus();
  } catch (err) {
    showStatus('This photo failed to load. Press Try again to start a new game.', true);
  }
}

// Show the final screen and the leaderboard.
function endGame() {
  finalTotal.textContent = `Total score: ${totalScore} / ${totalRounds * 5000}`;
  finalList.innerHTML = '';
  results.forEach((r) => {
    const li = document.createElement('li');
    li.textContent = `${r.name}: ${r.km} km, ${r.points} points`; // textContent = safe from HTML injection
    finalList.appendChild(li);
  });
  submitBox.hidden = false;
  submitBtn.disabled = false;
  nameInput.value = '';
  submitMsg.textContent = '';
  loadLeaderboard();
  finalEl.hidden = false;
}

// Fetch the top 10 from the server and list them.
async function loadLeaderboard() {
  leaderboardEl.innerHTML = '';
  const addRow = (text) => {
    const li = document.createElement('li');
    li.textContent = text;
    leaderboardEl.appendChild(li);
  };
  try {
    const res = await fetch(`${API}/api/leaderboard`);
    if (!res.ok) throw new Error('unavailable');
    const rows = await res.json();
    if (rows.length === 0) addRow('No scores yet. Be the first!');
    rows.forEach((r) => addRow(`${r.name}: ${r.score}`));
  } catch (err) {
    addRow('Leaderboard unavailable right now.');
  }
}

// ============ 8. EVENT LISTENERS ============
// A listener = "call this function whenever that thing happens".

// Click on the map: place the pin, or move it if it exists.
map.on('click', (e) => {
  if (roundOver) return;                           // ignore clicks after guessing
  if (guessMarker) {
    guessMarker.setLatLng(e.latlng);               // move existing marker
  } else {
    guessMarker = L.circleMarker(e.latlng, { radius: 8 }).addTo(map);
    roundLayers.push(guessMarker);                 // remember it so we can erase it
  }
  guessPosition = { lat: e.latlng.lat, lng: e.latlng.lng };
  guessBtn.disabled = false;
});

// Guess: send the pin to the server; it scores it.
guessBtn.addEventListener('click', async () => {
  if (!guessPosition || roundOver) return;
  roundOver = true;
  guessBtn.disabled = true;                        // prevents double-clicks

  try {
    const res = await fetch(`${API}/api/game/${gameId}/guess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // tells the server the body is JSON
      body: JSON.stringify({ round: roundIndex, lat: guessPosition.lat, lng: guessPosition.lng }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');

    totalScore = data.totalScore;                  // server's running total
    results.push({ name: data.answer.name, km: data.km, points: data.points });

    // Reveal the true location: green circle + red line from your guess.
    const answerMarker = L.circleMarker([data.answer.lat, data.answer.lng], { radius: 8, color: 'green' }).addTo(map);
    const line = L.polyline(
      [[guessPosition.lat, guessPosition.lng], [data.answer.lat, data.answer.lng]],
      { color: 'red' }
    ).addTo(map);
    roundLayers.push(answerMarker, line);
    map.fitBounds([[guessPosition.lat, guessPosition.lng], [data.answer.lat, data.answer.lng]], { padding: [60, 60] });

    resultEl.textContent = `${data.answer.name}: ${data.km} km away. +${data.points} points`;
    totalLabel.textContent = `Total: ${totalScore}`;
    guessBtn.hidden = true;
    nextBtn.hidden = false;
    nextBtn.textContent = roundIndex === totalRounds - 1 ? 'See final score' : 'Next round';
  } catch (err) {
    roundOver = false;                             // allow another try
    guessBtn.disabled = false;
    resultEl.textContent = `Guess failed: ${err.message}`;
  }
});

// Next: go to the next round, or finish after the last one.
nextBtn.addEventListener('click', () => {
  if (roundIndex === totalRounds - 1) {
    endGame();
  } else {
    roundIndex++;
    showRound();
  }
});

// Save score to the leaderboard.
submitBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (name.length < 2) {
    submitMsg.textContent = 'Name must be 2-20 characters';
    return;
  }
  submitBtn.disabled = true;
  try {
    const res = await fetch(`${API}/api/game/${gameId}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),              // note: we send NO score, only the name
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');
    submitBox.hidden = true;
    submitMsg.textContent = 'Score saved!';
    loadLeaderboard();
  } catch (err) {
    submitMsg.textContent = `Could not save: ${err.message}`;
    submitBtn.disabled = false;
  }
});

playAgainBtn.addEventListener('click', startGame);
retryBtn.addEventListener('click', startGame);

// ============ 9. BOOT ============
startGame(); // runs once when the page loads