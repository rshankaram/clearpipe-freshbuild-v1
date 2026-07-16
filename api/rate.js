// ClearPipe — Download-gate rating collector
// This file must live at api/rate.js in your repo (same api/ folder as analyze.js).
// Vercel serverless function.
//
// PRIVACY CONTRACT — do not weaken this:
// This endpoint must NEVER receive or store deal data — no deal name, company, contact,
// concern, or any form field. Only {rating, comment, timestamp} come through the wire.
// The client (index.html) is responsible for never attaching deal data to this payload;
// this file adds a second layer by only reading the three fields below and ignoring
// anything else in the request body, whatever it contains.
//
// WIRING (Shankar — pick one before this is live):
// 1. Set env var RATING_WEBHOOK_URL to a Google Sheets Apps Script Web App URL (or any
//    endpoint you own) that appends a row. This function will forward {rating, comment,
//    timestamp} to it as JSON POST. This is the "minimal collector" option agreed in the
//    build brief.
// 2. If RATING_WEBHOOK_URL is not set, this function just logs to the Vercel function
//    log (visible in the Vercel dashboard) and still returns success, so the download is
//    never blocked by a missing webhook. You can wire the real webhook later without
//    touching index.html.

const VALID_RATINGS = [
  'It blew me away',
  'It was helpful',
  "It was alright — I probably won't use it again",
  "It was below par — I won't use it again",
  'It was factually wrong — a waste of my time'
];

function sanitizeComment(value) {
  if (typeof value !== 'string') return '';
  return value.slice(0, 1000);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const rating = typeof body.rating === 'string' ? body.rating.slice(0, 200) : '';
  if (!rating) {
    res.status(400).json({ error: 'Missing rating.' });
    return;
  }

  const payload = {
    rating: rating,
    comment: sanitizeComment(body.comment),
    timestamp: new Date().toISOString()
  };

  const webhookUrl = process.env.RATING_WEBHOOK_URL;

  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      // Never block the download over a rating-delivery failure — log and move on.
      console.error('Rating webhook forward failed:', err);
    }
  } else {
    console.log('ClearPipe rating (no RATING_WEBHOOK_URL set):', JSON.stringify(payload));
  }

  res.status(200).json({ ok: true });
};
