# VOICEAI LABS — Live Booking Web App

This app provides:
- Home page (`/` or `/index.html`) with live food and cab booking console
- About Us page (`/about.html`)
- Contact page (`/contact.html`) with contact submission endpoint

## Run

```bash
cp .env.example .env
npm start
```

Open: `http://localhost:8080`

## Required environment variables

- `LIVE_BOOKING_ENABLED=true`
- `ZOMATO_BASE_URL`, `ZOMATO_API_KEY`
- `OLA_BASE_URL`, `OLA_API_KEY`
- `UBER_BASE_URL`, `UBER_API_KEY`

## API endpoints used by frontend

- `GET /api/health`
- `POST /api/book/food` → forwards to `${ZOMATO_BASE_URL}/orders`
- `POST /api/book/cab` → forwards to `${OLA_BASE_URL}/bookings` and/or `${UBER_BASE_URL}/bookings`
- `POST /api/contact` → stores/forwards contact details to optional audit webhook

If credentials are missing, booking endpoints return failure and do **not** fake bookings.


## Troubleshooting

- If UI shows `Failed to fetch`, you are likely opening HTML directly (`file://`) or backend is not running.
- Start server with `npm start` and open `http://localhost:8080`.
- Ensure `LIVE_BOOKING_ENABLED=true` and provider credentials are set in `.env`.


## Per-request credential override (optional)

If env vars are not set yet, you can pass credentials in request body for testing:

- Food booking: `zomatoBaseUrl`, `zomatoApiKey`
- Cab booking: `olaBaseUrl`, `olaApiKey`, `uberBaseUrl`, `uberApiKey`

When credentials are missing, API now returns exact missing variable names in `missing`.


## AI4Bharat Voice Layer

- Frontend records 5s microphone audio and sends it to `POST /api/asr/ai4bharat`.
- Backend proxies audio to AI4Bharat ASR and returns transcript.
- Set `.env`:
  - `AI4BHARAT_ASR_URL`
  - `AI4BHARAT_API_KEY`

Then use **Speak Food Order** or **Speak Cab Booking** on Home page to start recording, and click the same button again to stop when done speaking. The app transcribes, auto-fills detected fields, and asks for any missing required details before submit.
