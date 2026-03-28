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
