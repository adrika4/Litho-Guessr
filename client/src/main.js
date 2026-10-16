import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Viewer } from 'mapillary-js';
import 'mapillary-js/dist/mapillary.css';
import './style.css';

const API = 'http://localhost:3001';
const MAPILLARY_TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN;

// ---- Map setup ----
const map = L.map('map').setView([20, 0], 2);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

// ---- Page elements ----
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

// ---- Game state ----
let viewer = null;       // the 360 photo viewer (created once, then reused)
let gameId = null;       // given by the server
let imageIds = [];       // one Mapillary image ID per round
let totalRounds = 5;
let roundIndex = 0;
let totalScore = 0;
let results = [];
let guessMarker = null;
let guessPosition = null;
let roundOver = false;
let roundLayers = [];

function showStatus(message, showRetry = false) {
  statusText.textContent = message;
  retryBtn.hidden = !showRetry;
  statusEl.hidden = false;
}

function hideStatus() {
  statusEl.hidden = true;
}

function clearRoundLayers() {
  roundLayers.forEach((layer) => map.removeLayer(layer));
  roundLayers = [];
}

// Ask the server for a new game: it picks locations and 360 photos.
async function startGame() {
  finalEl.hidden = true;
  guessBtn.hidden = true;
  nextBtn.hidden = true;
  clearRoundLayers();
  showStatus('Finding photos... this can take up to 20 seconds');

  try {
    const res = await fetch(`${API}/api/game/start`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');

    gameId = data.gameId;
    totalRounds = data.totalRounds;
    imageIds = data.rounds.map((r) => r.imageId);
    roundIndex = 0;
    totalScore = 0;
    results = [];
    await showRound();
  } catch (err) {
    showStatus(`Could not start the game: ${err.message}`, true);
  }
}

async function showRound() {
  clearRoundLayers();
  guessMarker = null;
  guessPosition = null;
  roundOver = false;

  guessBtn.hidden = false;
  guessBtn.disabled = true;
  nextBtn.hidden = true;
  resultEl.textContent = '';
  map.setView([20, 0], 2);

  roundLabel.textContent = `Round ${roundIndex + 1} / ${totalRounds}`;
  totalLabel.textContent = `Total: ${totalScore}`;

  showStatus('Loading photo...');
  try {
    if (!viewer) {
      viewer = new Viewer({
        accessToken: MAPILLARY_TOKEN,
        container: 'mly',
        imageId: imageIds[roundIndex],
      });
    } else {
      await viewer.moveTo(imageIds[roundIndex]);
    }
    hideStatus();
  } catch (err) {
    showStatus('This photo failed to load. Press Try again to start a new game.', true);
  }
}

function endGame() {
  finalTotal.textContent = `Total score: ${totalScore} / ${totalRounds * 5000}`;
  finalList.innerHTML = '';
  results.forEach((r) => {
    const li = document.createElement('li');
    li.textContent = `${r.name}: ${r.km} km, ${r.points} points`;
    finalList.appendChild(li);
  });
  finalEl.hidden = false;
}

// Click on the map: place or move the guess marker.
map.on('click', (e) => {
  if (roundOver) return;

  if (guessMarker) {
    guessMarker.setLatLng(e.latlng);
  } else {
    guessMarker = L.circleMarker(e.latlng, { radius: 8 }).addTo(map);
    roundLayers.push(guessMarker);
  }
  guessPosition = { lat: e.latlng.lat, lng: e.latlng.lng };
  guessBtn.disabled = false;
});

// Guess button: send the guess to the server, which scores it.
guessBtn.addEventListener('click', async () => {
  if (!guessPosition || roundOver) return;
  roundOver = true;
  guessBtn.disabled = true;

  try {
    const res = await fetch(`${API}/api/game/${gameId}/guess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        round: roundIndex,
        lat: guessPosition.lat,
        lng: guessPosition.lng,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');

    totalScore = data.totalScore;
    results.push({ name: data.answer.name, km: data.km, points: data.points });

    const answerMarker = L.circleMarker([data.answer.lat, data.answer.lng], {
      radius: 8,
      color: 'green',
    }).addTo(map);
    const line = L.polyline(
      [[guessPosition.lat, guessPosition.lng], [data.answer.lat, data.answer.lng]],
      { color: 'red' }
    ).addTo(map);
    roundLayers.push(answerMarker, line);

    map.fitBounds(
      [[guessPosition.lat, guessPosition.lng], [data.answer.lat, data.answer.lng]],
      { padding: [60, 60] }
    );

    resultEl.textContent = `${data.answer.name}: ${data.km} km away. +${data.points} points`;
    totalLabel.textContent = `Total: ${totalScore}`;
    guessBtn.hidden = true;
    nextBtn.hidden = false;
    nextBtn.textContent = roundIndex === totalRounds - 1 ? 'See final score' : 'Next round';
  } catch (err) {
    roundOver = false; // let the player try again
    guessBtn.disabled = false;
    resultEl.textContent = `Guess failed: ${err.message}`;
  }
});

nextBtn.addEventListener('click', () => {
  if (roundIndex === totalRounds - 1) {
    endGame();
  } else {
    roundIndex++;
    showRound();
  }
});

playAgainBtn.addEventListener('click', startGame);
retryBtn.addEventListener('click', startGame);

startGame();