const contactForm = document.getElementById('contactForm');
const contactOutput = document.getElementById('contactOutput');
const apiBase = (window.__VOICEAI_API_BASE__ || '').replace(/\/$/, '');

function renderContact(data) {
  contactOutput.textContent = JSON.stringify(data, null, 2);
}

function contactError(error) {
  if (error instanceof TypeError) {
    return 'Cannot reach backend API. Start server with `npm start` and open http://localhost:8080.';
  }
  return error.message;
}

contactForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(contactForm).entries());
  renderContact({ status: 'processing', payload });

  try {
    const response = await fetch(`${apiBase}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const body = await response.json().catch(() => ({ error: 'Invalid server response.' }));
    if (!response.ok) {
      throw new Error(body.error || 'Contact submission failed');
    }

    renderContact({ status: 'success', result: body });
    contactForm.reset();
  } catch (error) {
    renderContact({ status: 'failed', error: contactError(error) });
  }
});
