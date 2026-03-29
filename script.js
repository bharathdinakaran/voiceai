const foodForm = document.getElementById('foodForm');
const cabForm = document.getElementById('cabForm');
const output = document.getElementById('output');
const voiceButtons = document.querySelectorAll('.voice-btn');

const apiBase = (window.__VOICEAI_API_BASE__ || '').replace(/\/$/, '');
const apiUrl = (path) => `${apiBase}${path}`;

const voiceState = {
  activeTarget: null,
  recorder: null,
  stream: null,
  chunks: []
};

const requiredFieldsByTarget = {
  food: ['item', 'address', 'deliveryTime', 'budgetInr'],
  cab: ['pickup', 'destination', 'scheduleTime', 'providerPreference']
};

const friendlyFieldNames = {
  item: 'food item',
  address: 'delivery address',
  deliveryTime: 'delivery time',
  budgetInr: 'budget',
  pickup: 'pickup location',
  destination: 'destination',
  scheduleTime: 'schedule time',
  providerPreference: 'provider preference (auto/ola/uber)'
};

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

function setVoiceButtonUI(activeTarget = null) {
  voiceButtons.forEach((button) => {
    const isActive = button.dataset.voiceTarget === activeTarget;
    button.textContent = isActive
      ? `⏹ Stop ${activeTarget === 'food' ? 'Food' : 'Cab'} Recording`
      : `🎤 Speak ${button.dataset.voiceTarget === 'food' ? 'Food Order' : 'Cab Booking'}`;
    button.disabled = Boolean(activeTarget && !isActive);
  });
}

async function startRecording(target) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not supported in this browser.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);

  voiceState.activeTarget = target;
  voiceState.stream = stream;
  voiceState.recorder = recorder;
  voiceState.chunks = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) voiceState.chunks.push(event.data);
  };

  recorder.start();
  setVoiceButtonUI(target);
  render({ status: 'listening', target, message: 'Recording... click stop when done speaking.' });
}

function stopRecording() {
  return new Promise((resolve, reject) => {
    const { recorder, stream, chunks, activeTarget } = voiceState;
    if (!recorder) return reject(new Error('No active recording to stop.'));

    recorder.onerror = () => reject(new Error('Voice recording failed.'));
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      bytes.forEach((b) => { binary += String.fromCharCode(b); });

      voiceState.activeTarget = null;
      voiceState.recorder = null;
      voiceState.stream = null;
      voiceState.chunks = [];
      setVoiceButtonUI(null);

      resolve({
        target: activeTarget,
        audioBase64: btoa(binary),
        mimeType: 'audio/webm'
      });
    };

    recorder.stop();
  });
}

function autofillFromTranscript(target, transcript) {
  const lower = transcript.toLowerCase();

  if (target === 'food') {
    const itemMatch = lower.match(/order\s+(.*?)\s+(from|for|at|under|deliver|delivery)/);
    if (itemMatch) foodForm.item.value = itemMatch[1].trim();

    const budgetMatch = lower.match(/(?:under|within|budget)\s*₹?\s*(\d+)/);
    if (budgetMatch) foodForm.budgetInr.value = Number(budgetMatch[1]);

    if (!foodForm.item.value && lower.includes('dosa')) foodForm.item.value = 'dosa';
    document.getElementById('voiceTranscriptFood').value = transcript;
  }

  if (target === 'cab') {
    const toMatch = lower.match(/to\s+([a-z\s]+)/);
    if (toMatch) cabForm.destination.value = toMatch[1].trim();

    if (!cabForm.destination.value && lower.includes('airport')) cabForm.destination.value = 'airport';
    document.getElementById('voiceTranscriptCab').value = transcript;
  }
}

function getMissingFields(target) {
  const form = target === 'food' ? foodForm : cabForm;
  return requiredFieldsByTarget[target].filter((field) => {
    const value = form.elements[field]?.value;
    return value === undefined || value === null || String(value).trim() === '';
  });
}

async function processVoiceCapture(target, audioBase64, mimeType) {
  const asr = await postJSON(apiUrl('/api/asr/ai4bharat'), {
    audioBase64,
    mimeType,
    languageCode: 'en',
    task: 'transcribe'
  });

  const transcript = asr.transcript || '';
  autofillFromTranscript(target, transcript);

  const missing = getMissingFields(target);
  if (missing.length > 0) {
    render({
      status: 'needs_details',
      target,
      transcript,
      ask_user_for: missing.map((field) => friendlyFieldNames[field] || field),
      message: 'Please fill the missing fields, then submit booking.'
    });
    return;
  }

  render({
    status: 'ready_to_submit',
    target,
    transcript,
    message: 'All required fields captured. Please review and submit booking.'
  });
}

voiceButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const target = button.dataset.voiceTarget;

    try {
      if (!voiceState.activeTarget) {
        await startRecording(target);
        return;
      }

      if (voiceState.activeTarget !== target) {
        return;
      }

      render({ status: 'processing_voice', target, message: 'Transcribing audio...' });
      const recorded = await stopRecording();
      await processVoiceCapture(recorded.target, recorded.audioBase64, recorded.mimeType);
    } catch (error) {
      voiceState.activeTarget = null;
      voiceState.recorder = null;
      if (voiceState.stream) {
        voiceState.stream.getTracks().forEach((t) => t.stop());
      }
      voiceState.stream = null;
      voiceState.chunks = [];
      setVoiceButtonUI(null);
      render({ status: 'failed', type: 'voice', target, error: error.message });
    }
  });
});

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
