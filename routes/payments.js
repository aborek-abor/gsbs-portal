const express = require('express');
const pool = require('../db/pool');
const { verifyTransaction, markApplicationPaid } = require('./paystack');

const router = express.Router();

// Paystack redirects the applicant's browser here after they finish paying
// (or cancel). We never trust this redirect on its own, we ask Paystack
// directly whether the transaction actually succeeded before doing anything.
router.get('/callback', async (req, res) => {
  const reference = req.query.reference || req.query.trxref;
  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  if (!reference) {
    return res.redirect(`${appUrl}/#payment-result?status=error`);
  }
  try {
    const result = await verifyTransaction(reference);
    if (result.status === 'success') {
      await markApplicationPaid(reference, 'paystack');
      return res.redirect(`${appUrl}/#payment-result?status=success`);
    }
    return res.redirect(`${appUrl}/#payment-result?status=failed`);
  } catch (err) {
    console.error('Payment callback verification failed:', err.message);
    return res.redirect(`${appUrl}/#payment-result?status=error`);
  }
});

// Lets the applicant check their own payment status and, if unpaid, restart
// payment without needing to be logged in yet (they may not have a passcode
// handy right after applying).
router.get('/status/:memberId', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT payment_status, dues_amount_pesewas, payment_reference
       FROM applications WHERE member_id = $1 ORDER BY submitted DESC LIMIT 1`,
      [req.params.memberId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Application not found.' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not check payment status.' });
  }
});

module.exports = router;
