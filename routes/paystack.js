const crypto = require('crypto');
const pool = require('../db/pool');

function secretKey() { return process.env.PAYSTACK_SECRET_KEY; }
const PAYSTACK_BASE = 'https://api.paystack.co';

// Dues by membership type. Ghana-resident classes pay in Ghana cedis;
// International/Diaspora pays in US dollars. Paystack expects amounts in the
// smallest unit of whichever currency is used (pesewas for GHS, cents for
// USD), both happen to be x100 of the whole-unit amount below.
const DUES = {
  Full: { amount: 100, currency: 'GHS' },
  Student: { amount: 100, currency: 'GHS' },
  Associate: { amount: 100, currency: 'GHS' },
  International: { amount: 35, currency: 'USD' },
  Honorary: { amount: 0, currency: 'GHS' },
};

function duesFor(membershipType) {
  return DUES[membershipType] || DUES.Full;
}

function duesAmountMinorUnits(membershipType) {
  return Math.round(duesFor(membershipType).amount * 100);
}

function isPaystackConfigured() {
  return !!secretKey();
}

/**
 * Starts a Paystack transaction and returns the checkout URL to redirect the
 * applicant to. Throws if Paystack rejects the request.
 */
async function initializeTransaction({ email, amountMinorUnits, currency, reference, callbackUrl }) {
  if (!secretKey()) {
    throw new Error('Payments are not configured yet (PAYSTACK_SECRET_KEY is missing).');
  }
  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      amount: amountMinorUnits,
      currency: currency || 'GHS',
      reference,
      callback_url: callbackUrl,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error((data && data.message) || 'Paystack could not start the transaction.');
  }
  return data.data; // { authorization_url, access_code, reference }
}

/**
 * Asks Paystack directly whether a given transaction reference actually
 * succeeded. Never trust a client-supplied "it worked" without this check.
 */
async function verifyTransaction(reference) {
  if (!secretKey()) {
    throw new Error('Payments are not configured yet (PAYSTACK_SECRET_KEY is missing).');
  }
  const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey()}` },
  });
  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error((data && data.message) || 'Could not verify transaction with Paystack.');
  }
  return data.data; // includes .status ('success', 'failed', 'abandoned'), .amount, .reference
}

/** Verifies the `x-paystack-signature` header on incoming webhook requests. */
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!secretKey() || !signatureHeader) return false;
  const expected = crypto.createHmac('sha512', secretKey()).update(rawBody).digest('hex');
  return expected === signatureHeader;
}

/** Marks an application (and logs a member_updates entry) as paid, idempotently. */
async function markApplicationPaid(reference, method = 'paystack') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const appRes = await client.query(
      `SELECT * FROM applications WHERE payment_reference = $1 FOR UPDATE`,
      [reference]
    );
    if (!appRes.rows.length) { await client.query('ROLLBACK'); return null; }
    const app = appRes.rows[0];
    if (app.payment_status === 'paid') { await client.query('ROLLBACK'); return app; } // already processed
    await client.query(
      `UPDATE applications SET payment_status = 'paid', payment_method = $2, paid_at = now() WHERE id = $1`,
      [app.id, method]
    );
    await client.query(
      `INSERT INTO member_updates (member_id, text) VALUES ($1, 'Dues received. Application is now ready for committee review.')`,
      [app.member_id]
    );
    await client.query('COMMIT');
    return app;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  DUES,
  duesFor,
  duesAmountMinorUnits,
  isPaystackConfigured,
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
  markApplicationPaid,
};
