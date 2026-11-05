import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const IS_VERCEL = process.env.VERCEL === '1';
const IMAGE_MODEL = 'gpt-image-2.5-sunburst';
const CREDIT_PRICE = 1;
const MAX_BODY_BYTES = 150_000;

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.NEON_DATABASE_URL || '';
const EFFECTIVE_DATABASE_URL = DATABASE_URL.replace(/([?&])sslmode=[^&]*/i, '$1sslmode=disable');
const pool = IS_VERCEL && EFFECTIVE_DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 10_000,
      ...(IS_VERCEL || process.env.PGSSLMODE === 'require' ? { ssl: { rejectUnauthorized: false } } : { ssl: false })
    })
  : null;

const memory = {
  wallets: new Map(),
  purchases: new Map(),
  history: new Map()
};

const files = {
  '/': { body: fs.readFileSync(path.join(__dirname, 'index.html')), type: 'text/html; charset=utf-8' },
  '/index.html': { body: fs.readFileSync(path.join(__dirname, 'index.html')), type: 'text/html; charset=utf-8' },
  '/styles.css': { body: fs.readFileSync(path.join(__dirname, 'styles.css')), type: 'text/css; charset=utf-8' },
  '/app.js': { body: fs.readFileSync(path.join(__dirname, 'app.js')), type: 'application/javascript; charset=utf-8' },
  '/logo.svg': { body: fs.readFileSync(path.join(__dirname, 'logo.svg')), type: 'image/svg+xml' },
  '/manus-routes.json': { body: fs.readFileSync(path.join(__dirname, 'manus-routes.json')), type: 'application/json; charset=utf-8' }
};

const schemaReady = pool ? ensureSchema() : Promise.resolve();

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const seed = `${process.env.MP_ACCESS_TOKEN || 'mp-missing'}:${process.env.OPENAI_API_KEY || 'ai-missing'}`;
  return crypto.createHash('sha256').update(seed).digest('hex');
}

function signWallet(walletId) {
  return crypto.createHmac('sha256', sessionSecret()).update(walletId).digest('base64url');
}

function makeWalletToken(walletId) {
  return `${walletId}.${signWallet(walletId)}`;
}

function readCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(raw.split(';').map((part) => part.trim().split('=')) .filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)]));
}

function walletFromRequest(req) {
  const token = readCookies(req).pixgen_wallet;
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const walletId = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = signWallet(walletId);
  if (signature.length !== expected.length) return null;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? walletId : null;
  } catch {
    return null;
  }
}

function getOrCreateWallet(req, res) {
  const existing = walletFromRequest(req);
  if (existing) return existing;
  const walletId = `w_${crypto.randomBytes(18).toString('hex')}`;
  const sameSite = IS_VERCEL ? 'None' : 'Lax';
  const secure = IS_VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `pixgen_wallet=${encodeURIComponent(makeWalletToken(walletId))}; Path=/; Max-Age=31536000; HttpOnly; SameSite=${sameSite}${secure}`);
  return walletId;
}

async function ensureSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}

function ensureDatabaseInProduction() {
  if (IS_VERCEL && !pool) {
    const error = new Error('Conecte uma integração PostgreSQL ao projeto Vercel antes de usar créditos.');
    error.code = 'DATABASE_REQUIRED';
    throw error;
  }
}

async function withTransaction(callback) {
  await schemaReady;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await callback(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensureWallet(walletId) {
  ensureDatabaseInProduction();
  if (!pool) {
    if (!memory.wallets.has(walletId)) memory.wallets.set(walletId, { walletId, credits: 3, createdAt: new Date().toISOString() });
    if (!memory.history.has(walletId)) memory.history.set(walletId, []);
    return memory.wallets.get(walletId);
  }
  await schemaReady;
  await pool.query('INSERT INTO pixgen_wallets (wallet_id) VALUES ($1) ON CONFLICT (wallet_id) DO NOTHING', [walletId]);
  const result = await pool.query('SELECT wallet_id, credits, created_at FROM pixgen_wallets WHERE wallet_id = $1', [walletId]);
  return result.rows[0];
}

async function reserveCredit(walletId) {
  await ensureWallet(walletId);
  if (!pool) {
    const wallet = memory.wallets.get(walletId);
    if (wallet.credits < 1) {
      const error = new Error('Você não tem créditos suficientes.');
      error.code = 'INSUFFICIENT_CREDITS';
      throw error;
    }
    wallet.credits -= 1;
    return wallet.credits;
  }
  return withTransaction(async (client) => {
    const result = await client.query('UPDATE pixgen_wallets SET credits = credits - 1, updated_at = NOW() WHERE wallet_id = $1 AND credits >= 1 RETURNING credits', [walletId]);
    if (!result.rows[0]) {
      const error = new Error('Você não tem créditos suficientes.');
      error.code = 'INSUFFICIENT_CREDITS';
      throw error;
    }
    return result.rows[0].credits;
  });
}

async function refundCredit(walletId) {
  if (!pool) {
    const wallet = memory.wallets.get(walletId);
    if (wallet) wallet.credits += 1;
    return;
  }
  await withTransaction((client) => client.query('UPDATE pixgen_wallets SET credits = credits + 1, updated_at = NOW() WHERE wallet_id = $1', [walletId]));
}

async function saveGeneration(walletId, image) {
  const record = {
    id: `gen_${crypto.randomBytes(12).toString('hex')}`,
    walletId,
    prompt: image.prompt,
    size: image.size,
    quality: image.quality,
    imageData: image.imageData,
    createdAt: new Date().toISOString()
  };
  if (!pool) {
    memory.history.get(walletId).unshift(record);
    return record;
  }
  await schemaReady;
  const result = await pool.query(
    'INSERT INTO pixgen_generations (generation_id, wallet_id, prompt, size, quality, image_data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING generation_id, wallet_id, prompt, size, quality, image_data, created_at',
    [record.id, walletId, record.prompt, record.size, record.quality, record.imageData]
  );
  return normalizeGeneration(result.rows[0]);
}

function normalizeGeneration(row) {
  return {
    id: row.generation_id,
    walletId: row.wallet_id,
    prompt: row.prompt,
    size: row.size,
    quality: row.quality,
    imageData: row.image_data,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

async function dashboard(walletId) {
  const wallet = await ensureWallet(walletId);
  if (!pool) {
    return { credits: wallet.credits, history: memory.history.get(walletId).slice(0, 30) };
  }
  const result = await pool.query(
    'SELECT generation_id, wallet_id, prompt, size, quality, image_data, created_at FROM pixgen_generations WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT 30',
    [walletId]
  );
  return { credits: Number(wallet.credits), history: result.rows.map(normalizeGeneration) };
}

async function recordPurchase(walletId, preference) {
  const purchase = {
    id: `pur_${crypto.randomBytes(12).toString('hex')}`,
    walletId,
    preferenceId: preference.id,
    quantity: preference.quantity,
    amount: preference.quantity * CREDIT_PRICE,
    externalReference: preference.externalReference,
    status: 'pending',
    providerPaymentId: null,
    createdAt: new Date().toISOString()
  };
  if (!pool) {
    memory.purchases.set(purchase.id, purchase);
    return purchase;
  }
  await schemaReady;
  const result = await pool.query(
    `INSERT INTO pixgen_purchases (purchase_id, wallet_id, preference_id, quantity, amount, external_reference, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     ON CONFLICT (preference_id) DO UPDATE SET quantity = EXCLUDED.quantity
     RETURNING purchase_id, wallet_id, preference_id, quantity, amount, external_reference, status, provider_payment_id, credited_at, created_at`,
    [purchase.id, walletId, purchase.preferenceId, purchase.quantity, purchase.amount, purchase.externalReference]
  );
  return normalizePurchase(result.rows[0]);
}

function normalizePurchase(row) {
  return {
    id: row.purchase_id,
    walletId: row.wallet_id,
    preferenceId: row.preference_id,
    quantity: Number(row.quantity),
    amount: Number(row.amount),
    externalReference: row.external_reference,
    status: row.status,
    providerPaymentId: row.provider_payment_id,
    creditedAt: row.credited_at ? (row.credited_at instanceof Date ? row.credited_at.toISOString() : row.credited_at) : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

async function findPurchase(paymentId, externalReference) {
  if (!pool) {
    return [...memory.purchases.values()].find((purchase) => (paymentId && purchase.providerPaymentId === String(paymentId)) || (externalReference && purchase.externalReference === externalReference)) || null;
  }
  await schemaReady;
  const result = await pool.query(
    'SELECT purchase_id, wallet_id, preference_id, quantity, amount, external_reference, status, provider_payment_id, credited_at, created_at FROM pixgen_purchases WHERE provider_payment_id = $1 OR external_reference = $2 ORDER BY created_at DESC LIMIT 1',
    [paymentId ? String(paymentId) : null, externalReference || null]
  );
  return result.rows[0] ? normalizePurchase(result.rows[0]) : null;
}

async function processApprovedPayment(payment) {
  const externalReference = String(payment.external_reference || '');
  const purchase = await findPurchase(payment.id, externalReference);
  if (!purchase) return { credited: false, status: payment.status, reason: 'purchase_not_found' };
  if (payment.status !== 'approved') return { credited: false, status: payment.status, purchase };
  const paidAmount = Number(payment.transaction_amount || 0);
  if (paidAmount + 0.01 < purchase.amount) return { credited: false, status: payment.status, reason: 'amount_mismatch', purchase };

  if (!pool) {
    const stored = memory.purchases.get(purchase.id);
    if (stored.creditedAt) return { credited: false, alreadyCredited: true, status: 'approved', credits: memory.wallets.get(purchase.walletId)?.credits ?? 0 };
    const wallet = memory.wallets.get(purchase.walletId) || { walletId: purchase.walletId, credits: 0 };
    wallet.credits += purchase.quantity;
    memory.wallets.set(purchase.walletId, wallet);
    stored.status = 'approved';
    stored.providerPaymentId = String(payment.id);
    stored.creditedAt = new Date().toISOString();
    return { credited: true, status: 'approved', credits: wallet.credits, quantity: purchase.quantity };
  }

  return withTransaction(async (client) => {
    const locked = await client.query('SELECT purchase_id, wallet_id, quantity, amount, status, provider_payment_id, credited_at FROM pixgen_purchases WHERE purchase_id = $1 FOR UPDATE', [purchase.id]);
    if (!locked.rows[0]) return { credited: false, status: 'approved', reason: 'purchase_not_found' };
    const row = locked.rows[0];
    if (row.credited_at) {
      const current = await client.query('SELECT credits FROM pixgen_wallets WHERE wallet_id = $1', [row.wallet_id]);
      return { credited: false, alreadyCredited: true, status: 'approved', credits: Number(current.rows[0]?.credits || 0) };
    }
    await client.query('INSERT INTO pixgen_wallets (wallet_id) VALUES ($1) ON CONFLICT (wallet_id) DO NOTHING', [row.wallet_id]);
    const wallet = await client.query('UPDATE pixgen_wallets SET credits = credits + $1, updated_at = NOW() WHERE wallet_id = $2 RETURNING credits', [row.quantity, row.wallet_id]);
    await client.query("UPDATE pixgen_purchases SET status = 'approved', provider_payment_id = $1, credited_at = NOW() WHERE purchase_id = $2", [String(payment.id), row.purchase_id]);
    return { credited: true, status: 'approved', credits: Number(wallet.rows[0].credits), quantity: Number(row.quantity) };
  });
}

async function mercadoPagoRequest(url, options = {}) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    const error = new Error('Configure MP_ACCESS_TOKEN no Vercel.');
    error.code = 'MERCADO_PAGO_NOT_CONFIGURED';
    throw error;
  }
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) {
    const error = new Error(data.message || data.error || 'Mercado Pago recusou a solicitação.');
    error.code = 'MERCADO_PAGO_ERROR';
    error.providerStatus = response.status;
    throw error;
  }
  return data;
}

async function createCheckout(walletId, quantity, req) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    const error = new Error('Escolha entre 1 e 100 créditos.');
    error.code = 'INVALID_QUANTITY';
    throw error;
  }
  await ensureWallet(walletId);
  const externalReference = `pixgen:${walletId}:${crypto.randomUUID()}`;
  const origin = requestOrigin(req);
  const preference = await mercadoPagoRequest('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify({
      items: [{
        id: 'pixgen-credit',
        title: `PixGen AI — ${quantity} crédito${quantity === 1 ? '' : 's'}`,
        description: 'Créditos para gerar imagens no PixGen AI',
        quantity,
        currency_id: 'BRL',
        unit_price: CREDIT_PRICE
      }],
      external_reference: externalReference,
      notification_url: `${origin}/api/webhook`,
      back_urls: {
        success: `${origin}/?payment=success`,
        failure: `${origin}/?payment=failure`,
        pending: `${origin}/?payment=pending`
      },
      auto_return: 'approved'
    })
  });
  const saved = await recordPurchase(walletId, { id: preference.id, quantity, externalReference });
  return { preferenceId: saved.preferenceId, checkoutUrl: preference.init_point || preference.sandbox_init_point, quantity, amount: saved.amount };
}

async function getMercadoPagoPayment(paymentId) {
  if (!/^\d+$/.test(String(paymentId))) {
    const error = new Error('Identificador de pagamento inválido.');
    error.code = 'INVALID_PAYMENT_ID';
    throw error;
  }
  return mercadoPagoRequest(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
}

function requestOrigin(req) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const forwardedProto = String(req.headers['x-forwarded-proto'] || (IS_VERCEL ? 'https' : 'http')).split(',')[0].trim();
  const host = forwardedHost || process.env.VERCEL_URL || `localhost:${PORT}`;
  return `${forwardedProto}://${host}`;
}

async function readBody(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error('Corpo da requisição muito grande.');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch {
    const error = new Error('JSON inválido.');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function text(res, status, body, type, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': type, ...extraHeaders });
  res.end(body);
}

function errorResponse(res, error) {
  const statusByCode = {
    INSUFFICIENT_CREDITS: 402,
    INVALID_QUANTITY: 400,
    INVALID_PAYMENT_ID: 400,
    INVALID_JSON: 400,
    BODY_TOO_LARGE: 413,
    DATABASE_REQUIRED: 503,
    MERCADO_PAGO_NOT_CONFIGURED: 503,
    MERCADO_PAGO_ERROR: 502
  };
  const status = statusByCode[error.code] || 500;
  if (status >= 500) console.error(`[pixgen] ${error.code || 'SERVER_ERROR'}: ${error.message}`);
  json(res, status, { error: error.message || 'Não foi possível concluir a operação.', code: error.code || 'SERVER_ERROR' });
}

function validatePrompt(value) {
  const prompt = String(value || '').trim();
  if (prompt.length < 3) {
    const error = new Error('Descreva a imagem com pelo menos 3 caracteres.');
    error.code = 'INVALID_PROMPT';
    throw error;
  }
  if (prompt.length > 2000) {
    const error = new Error('O prompt pode ter no máximo 2.000 caracteres.');
    error.code = 'INVALID_PROMPT';
    throw error;
  }
  return prompt;
}

function normalizeImageOptions(body) {
  const sizes = new Set(['1024x1024', '1536x1024', '1024x1536']);
  const qualities = new Set(['low', 'medium', 'high']);
  return {
    size: sizes.has(body.size) ? body.size : '1024x1024',
    quality: qualities.has(body.quality) ? body.quality : 'medium'
  };
}

async function generateImage(walletId, body) {
  const prompt = validatePrompt(body.prompt);
  const { size, quality } = normalizeImageOptions(body);
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('Configure OPENAI_API_KEY no Vercel.');
    error.code = 'OPENAI_NOT_CONFIGURED';
    throw error;
  }

  const creditsLeft = await reserveCredit(walletId);
  try {
    const identifier = crypto.createHash('sha256').update(walletId).digest('hex').slice(0, 64);
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, size, quality, n: 1, output_format: 'png', safety_identifier: identifier })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || 'A API de imagens não aceitou o pedido.');
      error.code = 'IMAGE_PROVIDER_ERROR';
      throw error;
    }
    const first = data?.data?.[0];
    if (!first) {
      const error = new Error('A API não retornou uma imagem.');
      error.code = 'IMAGE_EMPTY';
      throw error;
    }
    let imageData = first.b64_json ? `data:image/png;base64,${first.b64_json}` : first.url;
    if (!imageData) {
      const error = new Error('A resposta da API não contém uma imagem utilizável.');
      error.code = 'IMAGE_EMPTY';
      throw error;
    }
    if (imageData.startsWith('http')) {
      const imageResponse = await fetch(imageData);
      if (!imageResponse.ok) throw new Error('Não foi possível guardar a imagem retornada.');
      const buffer = Buffer.from(await imageResponse.arrayBuffer());
      imageData = `data:image/png;base64,${buffer.toString('base64')}`;
    }
    const record = await saveGeneration(walletId, { prompt, size, quality, imageData });
    return { image: record, credits: creditsLeft };
  } catch (error) {
    await refundCredit(walletId).catch((refundError) => console.error(`[pixgen] falha ao devolver crédito: ${refundError.message}`));
    throw error;
  }
}

async function handleWebhook(req, res, body, url) {
  const type = body.type || body.topic || url.searchParams.get('type') || url.searchParams.get('topic');
  const paymentId = body?.data?.id || body.id || url.searchParams.get('data.id') || url.searchParams.get('id');
  if (type && !String(type).toLowerCase().includes('payment') && type !== 'payment') return json(res, 200, { received: true, ignored: true });
  if (!paymentId) return json(res, 200, { received: true, ignored: true });
  try {
    const payment = await getMercadoPagoPayment(paymentId);
    const result = await processApprovedPayment(payment);
    return json(res, 200, { received: true, ...result });
  } catch (error) {
    console.error(`[pixgen] webhook: ${error.message}`);
    return json(res, 200, { received: true, retryable: true });
  }
}

async function handleApi(req, res, url) {
  const walletId = getOrCreateWallet(req, res);
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, database: Boolean(pool) });
  if (req.method === 'GET' && url.pathname === '/api/me') return json(res, 200, await dashboard(walletId));
  if (req.method === 'POST' && url.pathname === '/api/generate') {
    const body = await readBody(req);
    return json(res, 200, await generateImage(walletId, body));
  }
  if (req.method === 'POST' && url.pathname === '/api/checkout') {
    const body = await readBody(req);
    const quantity = Number(body.quantity);
    return json(res, 200, await createCheckout(walletId, quantity, req));
  }
  if (req.method === 'GET' && url.pathname === '/api/verify-payment') {
    const paymentId = url.searchParams.get('payment_id');
    const payment = await getMercadoPagoPayment(paymentId || '');
    const external = String(payment.external_reference || '');
    if (!external.includes(`:${walletId}:`)) return json(res, 403, { error: 'Esse pagamento não pertence a esta carteira.' });
    const result = await processApprovedPayment(payment);
    const current = await dashboard(walletId);
    return json(res, 200, { ...result, credits: current.credits });
  }
  if (req.method === 'POST' && url.pathname === '/api/webhook') {
    const body = await readBody(req);
    return handleWebhook(req, res, body, url);
  }
  return json(res, 404, { error: 'Endpoint não encontrado.' });
}

async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', requestOrigin(req));
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      return res.end();
    }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if ((req.method === 'GET' || req.method === 'HEAD') && files[url.pathname]) {
      const isHtml = files[url.pathname].type.startsWith('text/html');
      return text(res, 200, files[url.pathname].body, files[url.pathname].type, { 'Cache-Control': isHtml ? 'no-store' : 'public, max-age=3600' });
    }
    if (req.method === 'GET' && url.pathname === '/favicon.ico') return text(res, 200, files['/logo.svg'].body, files['/logo.svg'].type, { 'Cache-Control': 'public, max-age=3600' });
    return text(res, 404, 'Página não encontrada', 'text/plain; charset=utf-8');
  } catch (error) {
    return errorResponse(res, error);
  }
}

export default handler;

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = http.createServer(handler);
  server.listen(PORT, '0.0.0.0', () => console.log(`PixGen AI em http://localhost:${PORT}`));
}
