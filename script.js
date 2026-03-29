const foodForm = document.getElementById('foodForm');
const cabForm = document.getElementById('cabForm');
const output = document.getElementById('output');

const apiBase = (window.__VOICEAI_API_BASE__ || '').replace(/\/$/, '');
const apiUrl = (path) => `${apiBase}${path}`;

function render(data) {
  output.textContent = JSON.stringify(data, null, 2);
}

function friendlyNetworkError(error) {
  if (error instanceof TypeError) {
    return 'Cannot reach backend API. Start server with `npm start` and open http://localhost:8080 (not file://).';
  }
  return error.message;
}

async function postJSON(url, payload) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw new Error(friendlyNetworkError(error));
  }

  const body = await response.json().catch(() => ({ error: 'Invalid JSON response from server.' }));
  if (!response.ok) {
    const message = {
      error: body.error || `Request failed with status ${response.status}`,
      provider: body.provider || null,
      missing: body.missing || null,
      fix: body.fix || null,
      details: body.details || null
    };
    throw new Error(JSON.stringify(message));
  }

  return body;
}

foodForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(foodForm).entries());
  payload.budgetInr = Number(payload.budgetInr);
  render({ status: 'processing', type: 'food', payload });

  try {
    const result = await postJSON(apiUrl('/api/book/food'), payload);
    render({ status: 'success', type: 'food', result });
  } catch (error) {
    let parsed = error.message;
    try { parsed = JSON.parse(error.message); } catch {}
    render({ status: 'failed', type: 'food', error: parsed });
  }
});

cabForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(cabForm).entries());
  render({ status: 'processing', type: 'cab', payload });

  try {
    const result = await postJSON(apiUrl('/api/book/cab'), payload);
    render({ status: 'success', type: 'cab', result });
  } catch (error) {
    let parsed = error.message;
    try { parsed = JSON.parse(error.message); } catch {}
    render({ status: 'failed', type: 'cab', error: parsed });
  }
});

if (location.protocol === 'file:') {
  render({
    startup: 'degraded',
    message: 'You opened this page as a file. Run `npm start` and open http://localhost:8080 for real booking.'
  });
} else {
  fetch(apiUrl('/api/health'))
    .then((res) => res.json())
    .then((health) => render({ startup: 'ready', health }))
    .catch((error) => render({ startup: 'degraded', message: friendlyNetworkError(error) }));
}
