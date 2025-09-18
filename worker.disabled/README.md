README - ott-razorpay-worker

This Worker implements:
 - POST /api/create-payment  (creates Razorpay payment link)
 - POST /payment/webhook    (Razorpay webhook handler)
 - GET  /payment/success    (user redirect auto-POST to game)
 - GET  /api/get-free-url   (returns HLS manifest url for a clip)
 - POST /api/verify-proof   (optional verification endpoint)

Bindings/secrets: set via wrangler secret put:
 - RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
 - RS_PRIV_PEM (private key PEM)
Set D1 binding "DB" to a D1 database and apply migrations/001_init.sql
Set FRONTEND_BASE var to your Pages URL.

Deploy:
 - wrangler publish
