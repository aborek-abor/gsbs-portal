const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { generateCertificatePdf } = require('./certificate');
const { sendCertificateEmail } = require('./email');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin') throw new Error('not admin');
    req.admin = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

// --- Status: does a passcode exist yet? --------------------------------------
router.get('/status', async (req, res) => {
  const r = await pool.query(`SELECT 1 FROM admin_settings WHERE key = 'passcode_hash'`);
  res.json({ configured: r.rows.length > 0 });
});

// --- First-time setup: only works if no passcode exists yet -----------------
router.post('/setup', async (req, res) => {
  try {
    const existing = await pool.query(`SELECT 1 FROM admin_settings WHERE key = 'passcode_hash'`);
    if (existing.rows.length) {
      return res.status(400).json({ error: 'A passcode has already been set. Use the change-passcode flow instead.' });
    }
    const { passcode } = req.body;
    if (!passcode || String(passcode).length < 6) {
      return res.status(400).json({ error: 'Passcode must be at least 6 characters.' });
    }
    const hash = await bcrypt.hash(String(passcode), 10);
    await pool.query(
      `INSERT INTO admin_settings (key, value) VALUES ('passcode_hash', $1)`,
      [hash]
    );
    res.json({ message: 'Passcode set.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not set passcode.' });
  }
});

// --- Admin login --------------------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const { passcode } = req.body;
    const r = await pool.query(`SELECT value FROM admin_settings WHERE key = 'passcode_hash'`);
    if (!r.rows.length) return res.status(400).json({ error: 'No passcode has been set yet.' });
    const ok = await bcrypt.compare(String(passcode || ''), r.rows[0].value);
    if (!ok) return res.status(401).json({ error: 'Incorrect passcode.' });
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// --- Change passcode (requires current admin session + current passcode) ----
router.post('/change-passcode', requireAdminAuth, async (req, res) => {
  try {
    const { currentPasscode, newPasscode } = req.body;
    const r = await pool.query(`SELECT value FROM admin_settings WHERE key = 'passcode_hash'`);
    if (!r.rows.length) return res.status(400).json({ error: 'No passcode has been set yet.' });
    const ok = await bcrypt.compare(String(currentPasscode || ''), r.rows[0].value);
    if (!ok) return res.status(401).json({ error: 'Current passcode is incorrect.' });
    if (!newPasscode || String(newPasscode).length < 6) {
      return res.status(400).json({ error: 'New passcode must be at least 6 characters.' });
    }
    const hash = await bcrypt.hash(String(newPasscode), 10);
    await pool.query(`UPDATE admin_settings SET value = $1 WHERE key = 'passcode_hash'`, [hash]);
    res.json({ message: 'Passcode updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update passcode.' });
  }
});

// --- Pending applications queue ------------------------------------------------
router.get('/applications', requireAdminAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, member_id AS "memberId", applicant_name AS "applicantName", email, type,
              membership_type AS "membershipType", files, submitted, status,
              dues_amount_pesewas AS "duesAmountPesewas", dues_currency AS "duesCurrency",
              payment_status AS "paymentStatus", payment_method AS "paymentMethod"
       FROM applications WHERE status = 'pending' ORDER BY submitted ASC`
    );
    res.json({ applications: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load applications.' });
  }
});

function credentialForType(type) {
  return { code: 'CCBS', label: 'Certified Clinical Biomedical Scientist (CCBS)' };
}
function addYears(dateStr, n) {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
}

// --- Approve an application ----------------------------------------------------
router.post('/applications/:id/approve', requireAdminAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const appRes = await client.query('SELECT * FROM applications WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!appRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Application not found.' }); }
    const app = appRes.rows[0];
    if (app.status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Application already decided.' }); }
    if (app.payment_status !== 'paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Dues have not been paid yet for this application. Use "Mark as paid" first if they paid outside the online system.' });
    }

    await client.query(`UPDATE applications SET status = 'approved', decided_at = now() WHERE id = $1`, [app.id]);

    const memberRes = await client.query('SELECT * FROM members WHERE id = $1 FOR UPDATE', [app.member_id]);
    const member = memberRes.rows[0];
    await client.query(`UPDATE members SET status = 'active' WHERE id = $1`, [member.id]);

    const today = new Date().toISOString().slice(0, 10);

    if (app.type === 'new' && member.type === 'Full') {
      const cred = credentialForType(member.type);
      const certRes = await client.query("SELECT 'GSBS-CERT-' || lpad(nextval('cert_no_seq')::text, 4, '0') AS cert_no");
      const certNo = certRes.rows[0].cert_no;
      await client.query(
        `INSERT INTO credentials (member_id, code, label, cert_no, issued, expires) VALUES ($1,$2,$3,$4,$5,$6)`,
        [member.id, cred.code, cred.label, certNo, today, addYears(today, 3)]
      );
      await client.query(`INSERT INTO member_updates (member_id, text) VALUES ($1, 'Application approved. Welcome to the register.')`, [member.id]);
    } else if (app.type === 'renewal') {
      await client.query(`UPDATE credentials SET expires = $2 WHERE member_id = $1`, [member.id, addYears(today, 3)]);
      await client.query(`INSERT INTO member_updates (member_id, text) VALUES ($1, 'Renewal approved. Credential extended 3 years.')`, [member.id]);
    } else {
      await client.query(`INSERT INTO member_updates (member_id, text) VALUES ($1, 'Application approved. Welcome to the register.')`, [member.id]);
    }

    await client.query('COMMIT');
    res.json({ message: 'Approved.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not approve application.' });
  } finally {
    client.release();
  }
});

// --- Reject an application ------------------------------------------------------
router.post('/applications/:id/reject', requireAdminAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const appRes = await client.query('SELECT * FROM applications WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!appRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Application not found.' }); }
    const app = appRes.rows[0];
    if (app.status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Application already decided.' }); }

    await client.query(`UPDATE applications SET status = 'rejected', decided_at = now() WHERE id = $1`, [app.id]);
    await client.query(`UPDATE members SET status = 'lapsed' WHERE id = $1`, [app.member_id]);
    await client.query(`INSERT INTO member_updates (member_id, text) VALUES ($1, 'Application not approved. Contact the Admissions Committee for details.')`, [app.member_id]);

    await client.query('COMMIT');
    res.json({ message: 'Rejected.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not reject application.' });
  } finally {
    client.release();
  }
});

// --- Active members, with their latest credential (for the admin's Members tab) ---
router.get('/members', requireAdminAuth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT m.id, m.name, m.email, m.type, m.status,
             c.label AS "credentialLabel", c.cert_no AS "certNo", c.issued, c.expires
      FROM members m
      LEFT JOIN LATERAL (
        SELECT * FROM credentials WHERE member_id = m.id ORDER BY issued DESC LIMIT 1
      ) c ON true
      WHERE m.status = 'active'
      ORDER BY m.name ASC
    `);
    res.json({ members: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load members.' });
  }
});

async function loadMemberAndCredential(memberId) {
  const memberRes = await pool.query('SELECT * FROM members WHERE id = $1', [memberId]);
  if (!memberRes.rows.length) return null;
  const member = memberRes.rows[0];
  const credRes = await pool.query('SELECT * FROM credentials WHERE member_id = $1 ORDER BY issued DESC LIMIT 1', [memberId]);
  const credential = credRes.rows[0] || null;
  return { member, credential };
}

function formatCertDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// --- Download a member's certificate as a PDF -------------------------------
router.get('/members/:id/certificate', requireAdminAuth, async (req, res) => {
  try {
    const loaded = await loadMemberAndCredential(req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Member not found.' });
    if (!loaded.credential) return res.status(400).json({ error: 'This member has no issued credential yet.' });

    const pdfBuffer = await generateCertificatePdf({
      name: loaded.member.name,
      credentialTitle: loaded.credential.label,
      discipline: 'Biomedical Sciences',
      dateIssued: formatCertDate(loaded.credential.issued),
      memberId: loaded.member.id,
      certNo: loaded.credential.cert_no,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="GSBS_Certificate_${loaded.member.id}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not generate certificate.' });
  }
});

// --- Email a member's certificate to them -----------------------------------
router.post('/members/:id/send-certificate', requireAdminAuth, async (req, res) => {
  try {
    const loaded = await loadMemberAndCredential(req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Member not found.' });
    if (!loaded.credential) return res.status(400).json({ error: 'This member has no issued credential yet.' });

    const pdfBuffer = await generateCertificatePdf({
      name: loaded.member.name,
      credentialTitle: loaded.credential.label,
      discipline: 'Biomedical Sciences',
      dateIssued: formatCertDate(loaded.credential.issued),
      memberId: loaded.member.id,
      certNo: loaded.credential.cert_no,
    });

    const result = await sendCertificateEmail(loaded.member.email, loaded.member.name, pdfBuffer);
    await pool.query(
      `INSERT INTO member_updates (member_id, text) VALUES ($1, 'Certificate emailed to the address on file.')`,
      [loaded.member.id]
    );
    if (result && result.skipped) {
      return res.json({ message: 'Certificate generated, but no email was sent because RESEND_API_KEY is not configured yet.' });
    }
    res.json({ message: 'Certificate emailed to the member.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send certificate.' });
  }
});

// --- Manually record a payment made outside the online system (cash, bank
// transfer, etc.). Requires the admin to explicitly confirm, since this
// bypasses Paystack's own verification. ------------------------------------
router.post('/applications/:id/mark-paid', requireAdminAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Application not found.' });
    const app = r.rows[0];
    if (app.payment_status === 'paid') return res.status(400).json({ error: 'Already marked as paid.' });

    await pool.query(
      `UPDATE applications SET payment_status = 'paid', payment_method = 'manual', paid_at = now() WHERE id = $1`,
      [app.id]
    );
    await pool.query(
      `INSERT INTO member_updates (member_id, text) VALUES ($1, 'Dues recorded as received outside the online payment system.')`,
      [app.member_id]
    );
    res.json({ message: 'Marked as paid.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update payment status.' });
  }
});

module.exports = router;
