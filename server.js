import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

function loadEnv() {
  if (!existsSync('.env')) return;
  const raw = readFileSync('.env', 'utf8');
  for (const line of raw.split('\n')) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) continue;
    const idx = clean.indexOf('=');
    if (idx === -1) continue;
    const key = clean.slice(0, idx).trim();
    const value = clean.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const PORT = Number(process.env.PORT || 8080);
const LIVE_BOOKING_ENABLED = process.env.LIVE_BOOKING_ENABLED === 'true';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const requiredFields = {
  food: ['item', 'address', 'deliveryTime', 'budgetInr'],
  cab: ['pickup', 'destination', 'scheduleTime', 'providerPreference']
};

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function validateRequired(body, fields) {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === null || String(body[field]).trim() === '') {
      return `Missing required field: ${field}`;
    }
  }
  return null;
}

async function parseJson(req) {
  let buf = '';
  for await (const chunk of req) {
    buf += chunk;
  }
  try {
    return JSON.parse(buf || '{}');
  } catch {
    return null;
  }
}

async function providerRequest({ baseUrl, token, path, payload }) {
  if (!baseUrl || !token) throw new Error('Provider credentials are not configured.');

  const endpoint = `${baseUrl.replace(/\/$/, '')}${path}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = { raw };
  }

  if (!response.ok) {
    throw new Error(`Provider call failed (${response.status}): ${JSON.stringify(parsed)}`);
  }

  return parsed;
}

async function sendAuditLog(event) {
  const webhook = process.env.BOOKING_AUDIT_WEBHOOK;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
  } catch {
    // non-blocking
  }
}

async function handleFoodBooking(req, res) {
  const body = await parseJson(req);
  if (!body) return sendJson(res, 400, { error: 'Invalid JSON body.' });

  const err = validateRequired(body, requiredFields.food);
  if (err) return sendJson(res, 400, { error: err });
  if (!LIVE_BOOKING_ENABLED) {
    return sendJson(res, 403, { error: 'LIVE_BOOKING_ENABLED is false. Real booking is disabled.' });
  }

  const payload = {
    item: body.item,
    address: body.address,
    delivery_time: body.deliveryTime,
    budget_inr: Number(body.budgetInr),
    notes: body.notes || ''
  };

  try {
    const result = await providerRequest({
      baseUrl: process.env.ZOMATO_BASE_URL,
      token: process.env.ZOMATO_API_KEY,
      path: '/orders',
      payload
    });

    await sendAuditLog({ type: 'food_order', provider: 'zomato', request: payload, response: result, at: new Date().toISOString() });
    return sendJson(res, 200, { provider: 'zomato', status: 'booked', result });
  } catch (error) {
    return sendJson(res, 502, { error: error.message });
  }
}

async function handleCabBooking(req, res) {
  const body = await parseJson(req);
  if (!body) return sendJson(res, 400, { error: 'Invalid JSON body.' });

  const err = validateRequired(body, requiredFields.cab);
  if (err) return sendJson(res, 400, { error: err });
  if (!LIVE_BOOKING_ENABLED) {
    return sendJson(res, 403, { error: 'LIVE_BOOKING_ENABLED is false. Real booking is disabled.' });
  }

  const payload = {
    pickup: body.pickup,
    destination: body.destination,
    schedule_time: body.scheduleTime,
    service_type: body.serviceType || 'sedan',
    rider_notes: body.notes || ''
  };

  const pref = String(body.providerPreference || 'auto').toLowerCase();
  const providers = pref === 'ola' ? ['ola'] : pref === 'uber' ? ['uber'] : ['ola', 'uber'];
  const errors = [];

  for (const provider of providers) {
    try {
      const result = await providerRequest({
        baseUrl: provider === 'ola' ? process.env.OLA_BASE_URL : process.env.UBER_BASE_URL,
        token: provider === 'ola' ? process.env.OLA_API_KEY : process.env.UBER_API_KEY,
        path: '/bookings',
        payload
      });

      await sendAuditLog({ type: 'cab_booking', provider, request: payload, response: result, at: new Date().toISOString() });
      return sendJson(res, 200, { provider, status: 'booked', result });
    } catch (error) {
      errors.push({ provider, error: error.message });
    }
  }

  return sendJson(res, 502, { error: 'No provider booking succeeded.', details: errors });
}



async function handleContact(req, res) {
  const body = await parseJson(req);
  if (!body) return sendJson(res, 400, { error: 'Invalid JSON body.' });

  const required = ['name', 'email', 'message'];
  const err = validateRequired(body, required);
  if (err) return sendJson(res, 400, { error: err });

  const payload = {
    name: body.name,
    email: body.email,
    company: body.company || '',
    message: body.message,
    at: new Date().toISOString()
  };

  await sendAuditLog({ type: 'contact_submission', ...payload });
  return sendJson(res, 200, { status: 'received', payload });
}

async function serveStatic(res, pathName) {
  const safePath = normalize(pathName).replace(/^\/+/, '');
  const filePath = safePath === '' ? 'index.html' : safePath;
  const abs = join(process.cwd(), filePath);

  try {
    const content = await readFile(abs);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, {
      status: 'ok',
      liveBookingEnabled: LIVE_BOOKING_ENABLED,
      providers: {
        zomatoConfigured: Boolean(process.env.ZOMATO_BASE_URL && process.env.ZOMATO_API_KEY),
        olaConfigured: Boolean(process.env.OLA_BASE_URL && process.env.OLA_API_KEY),
        uberConfigured: Boolean(process.env.UBER_BASE_URL && process.env.UBER_API_KEY)
      }
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/book/food') return handleFoodBooking(req, res);
  if (req.method === 'POST' && url.pathname === '/api/book/cab') return handleCabBooking(req, res);
  if (req.method === 'POST' && url.pathname === '/api/contact') return handleContact(req, res);
  if (req.method === 'GET') return serveStatic(res, url.pathname);

  sendJson(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, () => {
  console.log(`VOICEAI LABS server running at http://localhost:${PORT}`);
});
