const foodForm = document.getElementById('foodForm');
const cabForm = document.getElementById('cabForm');
const output = document.getElementById('output');

function render(data) {
  output.textContent = JSON.stringify(data, null, 2);
}

async function postJSON(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({ error: 'Invalid JSON response' }));
  if (!response.ok) {
    throw new Error(body.error || `Request failed with status ${response.status}`);
  }

  return body;
}

foodForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(foodForm).entries());
  payload.budgetInr = Number(payload.budgetInr);
  render({ status: 'processing', type: 'food', payload });

  try {
    const result = await postJSON('/api/book/food', payload);
    render({ status: 'success', type: 'food', result });
  } catch (error) {
    render({ status: 'failed', type: 'food', error: error.message });
  }
});

cabForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(cabForm).entries());
  render({ status: 'processing', type: 'cab', payload });

  try {
    const result = await postJSON('/api/book/cab', payload);
    render({ status: 'success', type: 'cab', result });
  } catch (error) {
    render({ status: 'failed', type: 'cab', error: error.message });
  }
});

fetch('/api/health')
  .then((res) => res.json())
  .then((health) => render({ startup: 'ready', health }))
  .catch(() => render({ startup: 'degraded', message: 'Could not load server health.' }));
