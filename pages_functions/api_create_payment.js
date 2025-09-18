// functions/api/create-payment.js
export async function onRequestPost({ request, env }) {
  // Simple proxy to worker logic: you can paste the worker handler logic here.
  return new Response(JSON.stringify({ error: "Stub - paste worker logic or deploy worker" }), { status: 501, headers: { 'Content-Type': 'application/json' }});
}
