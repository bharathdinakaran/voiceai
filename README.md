# VOICEAI LABS — Live Booking Web App

This app provides a real booking console for:
- Food orders via **Zomato API**
- Cab bookings via **Ola API** / **Uber API**

## Run

```bash
cp .env.example .env
npm install
npm start
```

Open: `http://localhost:8080`

## Required environment variables

- `LIVE_BOOKING_ENABLED=true`
- `ZOMATO_BASE_URL`, `ZOMATO_API_KEY`
- `OLA_BASE_URL`, `OLA_API_KEY`
- `UBER_BASE_URL`, `UBER_API_KEY`

## API endpoints used by frontend

- `POST /api/book/food` → forwards to `${ZOMATO_BASE_URL}/orders`
- `POST /api/book/cab` → forwards to `${OLA_BASE_URL}/bookings` and/or `${UBER_BASE_URL}/bookings`
- `GET /api/health`

If credentials are missing, the server returns a failure response and does **not** fake bookings.
