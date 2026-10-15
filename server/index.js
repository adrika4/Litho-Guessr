import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
// Only allow our own frontend to call this server.
app.use(cors({ origin: 'http://localhost:5173' }));

const TOKEN = process.env.MAPILLARY_TOKEN;
const PORT = process.env.PORT || 3001;

// TEMPORARY test route: how many Mapillary photos exist near a coordinate?
app.get('/api/probe', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng must be numbers' });
  }

  // A small box around the point: about 1 km wide.
  const d = 0.005;
  const bbox = [lng - d, lat - d, lng + d, lat + d].join(','); // west,south,east,north
  const url =
    'https://graph.mapillary.com/images' +
    `?fields=id,is_pano,thumb_1024_url,computed_geometry&bbox=${bbox}&limit=20`;

  try {
    const r = await fetch(url, { headers: { Authorization: `OAuth ${TOKEN}` } });
    const body = await r.json();
    if (!r.ok) return res.status(502).json({ error: 'Mapillary error', details: body });

    const images = body.data ?? [];
    res.json({
      total: images.length,
      panos: images.filter((i) => i.is_pano).length,
      sample: images.slice(0, 2),
    });
  } catch (err) {
    res.status(502).json({ error: 'Could not reach Mapillary' });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));