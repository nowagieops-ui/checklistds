const axios = require('axios');

// Haversine distance in km between two lat/lng points.
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Best-effort IP geolocation via ip-api.com (free, no key). Never throws —
// a failed/slow lookup just means the mismatch check is skipped.
async function lookupIpLocation(ip) {
  if (!ip || /^(127\.|10\.|192\.168\.|::1$)/.test(ip)) return null;
  try {
    const { data } = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 3000 });
    if (data.status === 'success') return { lat: data.lat, lng: data.lon, label: data.city || data.country };
  } catch (e) {
    // ignore — geolocation mismatch check is best-effort only
  }
  return null;
}

// Best-effort reverse geocoding via OpenStreetMap's Nominatim (free, no key).
// Nominatim's usage policy caps this at ~1 request/sec and requires an
// identifying User-Agent — fine at this app's scale (a handful of marketers
// checking in/out twice a day), but don't reuse this for anything higher-volume
// without self-hosting Nominatim or switching to a paid geocoder.
async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;
  try {
    const { data } = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { lat, lon: lng, format: 'json', zoom: 18, addressdetails: 0 },
      headers: { 'User-Agent': 'DashspidOps/1.0 (field attendance tracking)' },
      timeout: 4000
    });
    return data && data.display_name ? data.display_name : null;
  } catch (e) {
    // ignore — address is a nice-to-have, never blocks check-in/out
  }
  return null;
}

// Flags a login/logout event as suspicious without ever blocking it — management
// reviews flagged events on the dashboard. Two checks:
//  1. This device cookie was last tied to a different marketer (possible buddy-punching).
//  2. GPS coordinates are far from where the IP address geolocates (possible spoofing/VPN).
async function evaluateAttendance({ marketerId, deviceOwnerId, deviceOwnerName, lat, lng, ip }) {
  const flags = [];

  if (deviceOwnerId && deviceOwnerId !== marketerId) {
    flags.push(`This device was last used to check in as ${deviceOwnerName}`);
  }

  const [geo, address] = await Promise.all([
    lookupIpLocation(ip),
    reverseGeocode(lat, lng)
  ]);

  if (geo && lat != null && lng != null) {
    const km = Math.round(haversineKm(lat, lng, geo.lat, geo.lng));
    if (km > 100) {
      flags.push(`GPS location is ~${km}km from the internet connection's location (${geo.label || 'unknown'})`);
    }
  }

  return { flagged: flags.length > 0, flags, address };
}

module.exports = { evaluateAttendance };
