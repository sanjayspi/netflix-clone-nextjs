// functions/payment/webhook.js
export async function onRequestPost({ request, env }) {
  const body = await request.text();
  // Verify Razorpay webhook here and forward to DB
  return new Response('ok');
}
