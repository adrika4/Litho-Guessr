const EARTH_RADIUS_KM = 6371;

// Latitude/longitude are in degrees, but Math.sin and Math.cos expect radians.
const toRadians = (degrees) => (degrees * Math.PI) / 180;

// Haversine formula: distance in km between two points on a sphere.
export function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

// Score curve: 5000 for a perfect guess, falling off with distance.
export function scoreFromDistance(distanceKm) {
  return Math.round(5000 * Math.exp(-distanceKm / 1492.7));
}