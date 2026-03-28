const contactForm = document.getElementById('contactForm');
const contactOutput = document.getElementById('contactOutput');

function renderContact(data) {
  contactOutput.textContent = JSON.stringify(data, null, 2);
}

contactForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(contactForm).entries());
  renderContact({ status: 'processing', payload });

  try {
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || 'Contact submission failed');
    }

    renderContact({ status: 'success', result: body });
    contactForm.reset();
  } catch (error) {
    renderContact({ status: 'failed', error: error.message });
  }
});
