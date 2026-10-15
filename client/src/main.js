import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { haversineKm, scoreFromDistance } from './utils/geo.js';

const TOTAL_ROUNDS = 5;

// TEMPORARY list. Later the server will provide locations and photos.
const LOCATIONS = [
  { name: 'Eiffel Tower, Paris', lat: 48.8584, lng: 2.2945 },
  { name: 'Times Square, New York', lat: 40.758, lng: -73.9855 },
  { name: 'Sydney Opera House', lat: -33.8568, lng: 151.2153 },
  { name: 'Shibuya Crossing, Tokyo', lat: 35.6595, lng: 139.7005 },
  { name: 'India Gate, Delhi', lat: 28.6129, lng: 77.2295 },
  { name: 'Colosseum, Rome', lat: 41.8902, lng: 12.4922 },
  { name: 'Christ the Redeemer, Rio', lat: -22.9519, lng: -43.2105 },
  { name: 'Table Mountain, Cape Town', lat: -33.9628, lng: 18.4098 },
];

// ---- Map setup ----
const map = L.map('map').setView([20, 0], 2);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  maxZoom: 19,
  subdomains: 'abcd',
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
}).addTo(map);

// ---- Page elements ----
const photoBox = document.getElementById('photo-box');
const roundLabel = document.getElementById('round-label');
const totalLabel = document.getElementById('total-label');
const guessBtn = document.getElementById('guess-btn');
const nextBtn = document.getElementById('next-btn');
const resultEl = document.getElementById('result');
const finalEl = document.getElementById('final');
const finalTotal = document.getElementById('final-total');
const finalList = document.getElementById('final-list');
const playAgainBtn = document.getElementById('play-again-btn');

// ---- Game state (everything that changes during a game) ----
let rounds = [];         // the 5 locations chosen for this game
let roundIndex = 0;      // which round we're on (0 = first)
let totalScore = 0;
let results = [];        // one entry per finished round
let guessMarker = null;
let guessPosition = null;
let roundOver = false;
let roundLayers = [];    // map drawings to remove at the start of each round

// Fisher-Yates shuffle: a fair random ordering, no repeats.
function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clearRoundLayers() {
  roundLayers.forEach((layer) => map.removeLayer(layer));
  roundLayers = [];
}

function startGame() {
  rounds = shuffle(LOCATIONS).slice(0, TOTAL_ROUNDS);
  roundIndex = 0;
  totalScore = 0;
  results = [];
  finalEl.hidden = true;
  showRound();
}

function showRound() {
  clearRoundLayers();
  guessMarker = null;
  guessPosition = null;
  roundOver = false;

  guessBtn.hidden = false;
  guessBtn.disabled = true;
  nextBtn.hidden = true;
  resultEl.textContent = '';
  map.setView([20, 0], 2);

  roundLabel.textContent = `Round ${roundIndex + 1} / ${TOTAL_ROUNDS}`;
  totalLabel.textContent = `Total: ${totalScore}`;
  photoBox.textContent = `TEST MODE: ${rounds[roundIndex].name}`;
}

function endGame() {
  finalTotal.textContent = `Total score: ${totalScore} / ${TOTAL_ROUNDS * 5000}`;
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

// Guess button: score this round.
guessBtn.addEventListener('click', () => {
  if (!guessPosition || roundOver) return;
  roundOver = true;

  const loc = rounds[roundIndex];
  const km = haversineKm(guessPosition.lat, guessPosition.lng, loc.lat, loc.lng);
  const points = scoreFromDistance(km);

  totalScore += points;
  results.push({ name: loc.name, km: Math.round(km), points });

  const answerMarker = L.circleMarker([loc.lat, loc.lng], { radius: 8, color: 'green' }).addTo(map);
  const line = L.polyline(
    [[guessPosition.lat, guessPosition.lng], [loc.lat, loc.lng]],
    { color: 'red' }
  ).addTo(map);
  roundLayers.push(answerMarker, line);

  map.fitBounds(
    [[guessPosition.lat, guessPosition.lng], [loc.lat, loc.lng]],
    { padding: [60, 60] }
  );

  resultEl.textContent = `${Math.round(km)} km away. +${points} points`;
  totalLabel.textContent = `Total: ${totalScore}`;
  guessBtn.hidden = true;
  nextBtn.hidden = false;
  nextBtn.textContent = roundIndex === TOTAL_ROUNDS - 1 ? 'See final score' : 'Next round';
});

// Next button: go to the next round, or end the game after the last one.
nextBtn.addEventListener('click', () => {
  if (roundIndex === TOTAL_ROUNDS - 1) {
    endGame();
  } else {
    roundIndex++;
    showRound();
  }
});

playAgainBtn.addEventListener('click', startGame);

startGame();