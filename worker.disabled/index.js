// worker/index.js
/* Cloudflare Worker for Razorpay Payment Links + webhook + RS256 proof tokens + D1
   Bindings / secrets expected (set with wrangler secret put):
     - RAZORPAY_KEY_ID
     - RAZORPAY_KEY_SECRET
     - RAZORPAY_WEBHOOK_SECRET
     - RS_PRIV_PEM        (private RSA PEM)
     - FRONTEND_BASE      (https://your-pages.example)
   D1 binding:
     - DB (D1 database)
*/

addEventListener('fetch', event => {
  event.respondWith(router(event.request, event));
});

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/* ---------- Helpers ---------- */

function b64url(input) {
  if (typeof input === 'string') return btoa(input).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
  const s = btoa(String.fromCharCode(...new Uint8Array(input)));
  return s.replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
}

async function importRsaPrivateKey(pem) {
  const b64 = pem.replace(/-----.*?-----/g, '').replace(/\\s+/g, '');
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', raw.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

async function signJwtRS256(privateKeyPem, payloadObj, maxAgeSeconds = 300) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = Object.assign({}, payloadObj, { iat: now, exp: now + maxAgeSeconds });
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const priv = await importRsaPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

async function verifyRazorpayWebhookSignature(rawBody, signatureHeader, secret) {
  // Razorpay: header = base64(hmac_sha256(body, secret))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));
  return expected === signatureHeader;
}

/* ---------- D1 DB helpers ---------- */

async function dbInsertTransaction(env, tx) {
  const sql = `INSERT INTO transactions (txid, clip_id, order_id, amount_cents, currency, status, processor_ref, callback_url, redirect_url, metadata, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const bindings = [
    tx.txid, tx.clip_id, tx.order_id, tx.amount_cents, tx.currency, tx.status,
    tx.processor_ref || null, tx.callback_url || null, tx.redirect_url || null,
    JSON.stringify(tx.metadata || {}), tx.created_at
  ];
  await env.DB.prepare(sql).bind(...bindings).run();
}

async function dbGetClip(env, clipId) {
  try {
    const row = await env.DB.prepare('SELECT * FROM clips WHERE clip_id = ?').bind(clipId).first();
    if (row) return {
      clip_id: row.clip_id, title: row.title, type: row.type,
      price_cents: row.price_cents, currency: row.currency, poster_url: row.poster_url, stream_id: row.stream_id
    };
  } catch (e) {
    // ignore and fallback
  }
  // fallback to public JSON on frontend
  const res = await fetch(`${env.FRONTEND_BASE}/data/clips.json`);
  const arr = await res.json().catch(()=>[]);
  return arr.find(c => c.clip_id === clipId);
}

async function dbGetTransaction(env, txid) {
  const row = await env.DB.prepare('SELECT * FROM transactions WHERE txid = ?').bind(txid).first();
  if (!row) return null;
  return {
    txid: row.txid,
    clip_id: row.clip_id,
    order_id: row.order_id,
    amount_cents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    processor_ref: row.processor_ref,
    callback_url: row.callback_url,
    redirect_url: row.redirect_url,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    created_at: row.created_at,
    paid_at: row.paid_at,
    webhook_attempts: row.webhook_attempts,
    webhook_last_status: row.webhook_last_status
  };
}

async function dbUpdateTransactionPaid(env, txid, processorRef) {
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE transactions SET status = ?, processor_ref = ?, paid_at = ? WHERE txid = ?').bind('PAID', processorRef || null, now, txid).run();
}

async function dbSetWebhookPending(env, txid) {
  await env.DB.prepare('UPDATE transactions SET status = ?, webhook_attempts = webhook_attempts + 1, webhook_last_status = ? WHERE txid = ?').bind('PENDING_WEBHOOK','pending',txid).run();
}

async function dbMarkWebhookDelivered(env, txid) {
  await env.DB.prepare('UPDATE transactions SET webhook_last_status = ?, webhook_attempts = 0 WHERE txid = ?').bind('delivered', txid).run();
}

/* ---------- Router ---------- */

async function router(request, event) {
  const url = new URL(request.url);
  if (url.pathname === '/api/create-payment' && request.method === 'POST') return handleCreatePayment(request, event);
  if (url.pathname === '/payment/webhook' && request.method === 'POST') return handleRazorpayWebhook(request, event);
  if (url.pathname === '/payment/success' && request.method === 'GET') return handleSuccess(request, event);
  if (url.pathname === '/api/get-free-url' && request.method === 'GET') return handleGetFreeUrl(request, event);
  if (url.pathname === '/api/verify-proof' && request.method === 'POST') return handleVerifyProof(request, event);
  return new Response('Not found', { status: 404 });
}

/* ---------- Handlers ---------- */

async function handleCreatePayment(req, event) {
  const body = await req.json();
  const { clipId, orderType = 'clip_purchase', redirectUrl, callbackUrl, orderId } = body;
  const clip = await dbGetClip(event.env, clipId);
  if (!clip) return new Response(JSON.stringify({ error: 'clip not found' }), { status: 400, headers: JSON_HEADERS });
  if (clip.type !== 'PAID' && orderType === 'clip_purchase') return new Response(JSON.stringify({ error: 'not payable' }), { status: 400, headers: JSON_HEADERS });

  const txid = crypto.randomUUID();
  const tx = {
    txid,
    clip_id: clipId,
    order_id: orderId || null,
    amount_cents: clip.price_cents,
    currency: clip.currency,
    status: 'CREATED',
    processor_ref: null,
    callback_url: callbackUrl || null,
    redirect_url: redirectUrl || null,
    metadata: {},
    created_at: new Date().toISOString()
  };
  await dbInsertTransaction(event.env, tx);

  // Create Razorpay Payment Link
  const payload = {
    amount: clip.price_cents, // paise
    currency: clip.currency,
    reference_id: txid,
    description: clip.title,
    callback_url: `${event.env.FRONTEND_BASE}/payment/success?txid=${txid}`,
    callback_method: 'get',
    notify: { sms: false, email: false }
  };
  const basicAuth = btoa(`${event.env.RAZORPAY_KEY_ID}:${event.env.RAZORPAY_KEY_SECRET}`);
  const r = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const j = await r.json();
  if (!r.ok) {
    console.error('Razorpay error', j);
    return new Response(JSON.stringify({ error: 'payment provider error', details: j }), { status: 500, headers: JSON_HEADERS });
  }

  // Save processor ref (payment link id)
  await event.env.DB.prepare('UPDATE transactions SET processor_ref = ? WHERE txid = ?').bind(j.id, txid).run();

  return new Response(JSON.stringify({ paymentUrl: j.short_url, paymentLinkId: j.id, txid }), { status: 200, headers: JSON_HEADERS });
}

async function handleRazorpayWebhook(req, event) {
  const rawBody = await req.text();
  const sig = req.headers.get('x-razorpay-signature') || req.headers.get('X-Razorpay-Signature');
  if (!sig) return new Response('missing signature', { status: 400 });
  const ok = await verifyRazorpayWebhookSignature(rawBody, sig, event.env.RAZORPAY_WEBHOOK_SECRET);
  if (!ok) return new Response('invalid signature', { status: 400 });

  let evt;
  try { evt = JSON.parse(rawBody); } catch(e){ return new Response('bad json', { status: 400 }); }

  const payload = evt.payload || {};
  let txid = null;
  if (payload.payment_link && payload.payment_link.entity && payload.payment_link.entity.reference_id) {
    txid = payload.payment_link.entity.reference_id;
  } else if (payload.payment && payload.payment.entity && payload.payment.entity.notes && payload.payment.entity.notes.txid) {
    txid = payload.payment.entity.notes.txid;
  }

  if (!txid) {
    console.warn('txid not found in webhook payload', evt);
    return new Response('txid not found', { status: 400 });
  }

  const processorRef = (payload.payment && payload.payment.entity && payload.payment.entity.id) || (payload.payment_link && payload.payment_link.entity && payload.payment_link.entity.id) || null;
  await dbUpdateTransactionPaid(event.env, txid, processorRef);

  // server->server post to game callback
  const tx = await dbGetTransaction(event.env, txid);
  if (tx && tx.callback_url) {
    const proof = await signJwtRS256(event.env.RS_PRIV_PEM, {
      txid,
      amount: tx.amount_cents,
      currency: tx.currency,
      orderId: tx.order_id || null
    }, 300);
    try {
      const resp = await fetch(tx.callback_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txid, proof })
      });
      if (!resp.ok) {
        await dbSetWebhookPending(event.env, txid);
      } else {
        await dbMarkWebhookDelivered(event.env, txid);
      }
    } catch (e) {
      await dbSetWebhookPending(event.env, txid);
    }
  }

  return new Response('ok', { status: 200 });
}

async function handleSuccess(req, event) {
  const url = new URL(req.url);
  const txid = url.searchParams.get('txid');
  if (!txid) return new Response('missing txid', { status: 400 });
  const tx = await dbGetTransaction(event.env, txid);
  if (!tx) return new Response('invalid tx', { status: 400 });

  if (tx.status !== 'PAID' && tx.status !== 'PENDING_WEBHOOK') {
    const html = `<html><body>Payment not confirmed yet. Please wait... <script>setTimeout(()=>location.reload(),3000)</script></body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }

  const landing = tx.redirect_url || 'https://thirdparty-gaming.example/landing';
  const html = `<!doctype html><html><head>
<meta name="referrer" content="no-referrer">
<title>Redirecting…</title>
</head><body>
<form id="t" method="POST" action="${landing}">
<input type="hidden" name="txid" value="${txid}" />
</form>
<script>document.getElementById('t').submit()</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'none'; form-action 'self' ${landing};`
    }
  });
}

async function handleGetFreeUrl(req, event) {
  const url = new URL(req.url);
  const clipId = url.searchParams.get('clipId');
  if (!clipId) return new Response(JSON.stringify({ error: 'clipId required' }), { status: 400, headers: JSON_HEADERS });
  const clip = await dbGetClip(event.env, clipId);
  if (!clip) return new Response(JSON.stringify({ error: 'clip not found' }), { status: 404, headers: JSON_HEADERS });

  const hlsUrl = `https://customer.cloudflarestream.com/${clip.stream_id}/manifest/video.m3u8`;
  return new Response(JSON.stringify({ url: hlsUrl }), { headers: JSON_HEADERS });
}

async function handleVerifyProof(req, event) {
  const body = await req.json().catch(()=>({}));
  const token = body.token;
  if (!token) return new Response(JSON.stringify({ ok: false, error: 'no token' }), { headers: JSON_HEADERS });
  // Gaming site should verify RS256 token locally using public key. Here we simply accept presence.
  return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
}
