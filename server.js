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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function sendJson(res, code, payload) {
  res.writeHead(code, {
    ...corsHeaders,
    'Content-Type': 'application/json; charset=utf-8'
  });
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


function resolveProviderConfig({ baseUrlEnv, apiKeyEnv, baseUrlOverride, apiKeyOverride, providerName }) {
  const baseUrl = (baseUrlOverride || process.env[baseUrlEnv] || '').trim();
  const token = (apiKeyOverride || process.env[apiKeyEnv] || '').trim();
  const missing = [];
  if (!baseUrl) missing.push(baseUrlEnv);
  if (!token) missing.push(apiKeyEnv);

  return {
    providerName,
    baseUrl,
    token,
    missing,
    ok: missing.length === 0
  };
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

  const zomato = resolveProviderConfig({
    baseUrlEnv: 'ZOMATO_BASE_URL',
    apiKeyEnv: 'ZOMATO_API_KEY',
    baseUrlOverride: body.zomatoBaseUrl,
    apiKeyOverride: body.zomatoApiKey,
    providerName: 'zomato'
  });

  if (!zomato.ok) {
    return sendJson(res, 400, {
      error: 'Provider credentials are not configured.',
      provider: 'zomato',
      missing: zomato.missing,
      fix: 'Set missing env vars in .env or pass zomatoBaseUrl and zomatoApiKey in request body.'
    });
  }

  try {
    const result = await providerRequest({
      baseUrl: zomato.baseUrl,
      token: zomato.token,
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

  const configByProvider = {
    ola: resolveProviderConfig({
      baseUrlEnv: 'OLA_BASE_URL',
      apiKeyEnv: 'OLA_API_KEY',
      baseUrlOverride: body.olaBaseUrl,
      apiKeyOverride: body.olaApiKey,
      providerName: 'ola'
    }),
    uber: resolveProviderConfig({
      baseUrlEnv: 'UBER_BASE_URL',
      apiKeyEnv: 'UBER_API_KEY',
      baseUrlOverride: body.uberBaseUrl,
      apiKeyOverride: body.uberApiKey,
      providerName: 'uber'
    })
  };

  for (const provider of providers) {
    const config = configByProvider[provider];
    if (!config.ok) {
      errors.push({
        provider,
        error: 'Provider credentials are not configured.',
        missing: config.missing,
        fix: `Set ${config.missing.join(', ')} in .env or pass ${provider}BaseUrl and ${provider}ApiKey in request body.`
      });
      continue;
    }

    try {
      const result = await providerRequest({
        baseUrl: config.baseUrl,
        token: config.token,
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




function extractTranscript(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.transcript === 'string') return payload.transcript;
  if (typeof payload.text === 'string') return payload.text;
  if (Array.isArray(payload.output) && payload.output[0]) {
    const first = payload.output[0];
    if (typeof first.source === 'string') return first.source;
    if (typeof first.transcript === 'string') return first.transcript;
    if (typeof first.text === 'string') return first.text;
  }
  if (Array.isArray(payload.data) && payload.data[0]) {
    const first = payload.data[0];
    if (typeof first.transcript === 'string') return first.transcript;
    if (typeof first.text === 'string') return first.text;
  }
  return '';
}

async function handleAi4BharatAsr(req, res) {
  const body = await parseJson(req);
  if (!body) return sendJson(res, 400, { error: 'Invalid JSON body.' });

  const required = ['audioBase64'];
  const err = validateRequired(body, required);
  if (err) return sendJson(res, 400, { error: err });

  const endpoint = (process.env.AI4BHARAT_ASR_URL || '').trim();
  const key = (process.env.AI4BHARAT_API_KEY || '').trim();
  if (!endpoint || !key) {
    return sendJson(res, 400, {
      error: 'AI4Bharat ASR is not configured.',
      missing: [!endpoint ? 'AI4BHARAT_ASR_URL' : null, !key ? 'AI4BHARAT_API_KEY' : null].filter(Boolean),
      fix: 'Set AI4BHARAT_ASR_URL and AI4BHARAT_API_KEY in .env.'
    });
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        audioContent: body.audioBase64,
        audioFormat: body.mimeType || 'audio/webm',
        languageCode: body.languageCode || 'en',
        task: body.task || 'transcribe'
      })
    });

    const rawText = await response.text();
    let parsed;
    try { parsed = rawText ? JSON.parse(rawText) : {}; } catch { parsed = { rawText }; }
    if (!response.ok) {
      return sendJson(res, 502, { error: `AI4Bharat ASR failed (${response.status})`, details: parsed });
    }

    const transcript = extractTranscript(parsed);
    await sendAuditLog({ type: 'asr_transcription', provider: 'ai4bharat', transcript, at: new Date().toISOString() });
    return sendJson(res, 200, { provider: 'ai4bharat', transcript, raw: parsed });
  } catch (error) {
    return sendJson(res, 502, { error: error.message });
  }
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
    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type': contentTypes[ext] || 'application/octet-stream'
    });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return sendJson(res, 200, {
      apiBaseUrl: process.env.PUBLIC_API_BASE_URL || '',
      liveBookingEnabled: LIVE_BOOKING_ENABLED
    });
  }

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
  if (req.method === 'POST' && url.pathname === '/api/asr/ai4bharat') return handleAi4BharatAsr(req, res);
  if (req.method === 'GET') return serveStatic(res, url.pathname);

  sendJson(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, () => {
  console.log(`VOICEAI LABS server running at http://localhost:${PORT}`);
});
