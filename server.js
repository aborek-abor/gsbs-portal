require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db/pool');

const membersRoutes = require('./routes/members');
const adminRoutes = require('./routes/admin');
const paymentsRoutes = require('./routes/payments');
const { verifyWebhookSignature, markApplicationPaid } = require('./routes/paystack');

const app = express();
app.use(cors());

// Paystack's webhook signature is computed over the exact raw request body,
// so this route must read the raw bytes BEFORE the general JSON parser below
// touches (and reformats) them.
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const rawBody = req.body; // Buffer, thanks to express.raw()
  if (!verifyWebhookSignature(rawBody, signature)) {
    return res.status(401).send('Invalid signature');
  }
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return res.status(400).send('Bad payload');
  }
  if (event.event === 'charge.success') {
    try {
      await markApplicationPaid(event.data.reference, 'paystack');
    } catch (err) {
      console.error('Webhook processing failed:', err.message);
    }
  }
  res.sendStatus(200);
});

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', membersRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentsRoutes);

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
const runMigration = require('./db/migrate');

runMigration()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`GSBS member portal listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Startup migration failed, server did not start:', err.message);
    process.exit(1);
  });
