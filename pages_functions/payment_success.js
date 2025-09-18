// functions/payment/success.js
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const txid = url.searchParams.get('txid');
  if (!txid) return new Response('missing txid', { status: 400 });
  // Render no-referrer auto-post page or call verify endpoint
  const html = `<!doctype html><html><head><meta name="referrer" content="no-referrer"></head><body><form id="t" method="POST" action="https://thirdparty-gaming.example/landing"><input type="hidden" name="txid" value="${txid}"/></form><script>document.getElementById('t').submit()</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' }});
}
