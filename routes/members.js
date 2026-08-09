const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const { sendPasscodeResetEmail } = require('./email');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Generate one and set it as an env var. See README.');
}

const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

function pad(n) { return String(n).padStart(6, '0'); }
function addYears(dateStr, n) {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
}

// Middleware: requires a valid member JWT (issued at login)
function requireMemberAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });
  try {
    req.member = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

// --- Apply for membership -------------------------------------------------
router.post('/apply', upload.array('files', 5), async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, email, phone, type, institution, year, docs, passcode } = req.body;
    if (!name || !email || !type || !passcode) {
      return res.status(400).json({ error: 'Name, email, membership type, and a passcode are required.' });
    }
    if (String(passcode).length < 6) {
      return res.status(400).json({ error: 'Passcode must be at least 6 characters.' });
    }
    const files = (req.files || []).map(f => f.filename);

    await client.query('BEGIN');
    const idRes = await client.query("SELECT 'GSBS-' || lpad(nextval('member_id_seq')::text, 6, '0') AS id");
    const memberId = idRes.rows[0].id;
    const passcodeHash = await bcrypt.hash(String(passcode), 10);

    await client.query(
      `INSERT INTO members (id, name, email, phone, type, institution, status, passcode_hash)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
      [memberId, name, email, phone || null, type, institution || null, passcodeHash]
    );
    await client.query(
      `INSERT INTO member_updates (member_id, text) VALUES ($1, 'Application received. Awaiting Membership Admissions Committee review.')`,
      [memberId]
    );

    const appIdRes = await client.query("SELECT 'APP-' || lpad(nextval('application_id_seq')::text, 6, '0') AS id");
    const appId = appIdRes.rows[0].id;
    await client.query(
      `INSERT INTO applications (id, member_id, applicant_name, email, type, membership_type, institution, year, docs, files)
       VALUES ($1,$2,$3,$4,'new',$5,$6,$7,$8,$9)`,
      [appId, memberId, name, email, type, institution || null, year || null, docs || null, JSON.stringify(files)]
    );
    await client.query('COMMIT');

    res.json({ memberId, applicationId: appId, message: 'Application submitted. Save your Member ID and passcode to check status.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not submit application.' });
  } finally {
    client.release();
  }
});

// --- Member login ----------------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const { memberId, passcode } = req.body;
    const r = await pool.query('SELECT * FROM members WHERE id = $1', [memberId]);
    if (!r.rows.length) return res.status(401).json({ error: 'Member ID or passcode not recognized.' });
    const member = r.rows[0];
    const ok = await bcrypt.compare(String(passcode || ''), member.passcode_hash);
    if (!ok) return res.status(401).json({ error: 'Member ID or passcode not recognized.' });
    const token = jwt.sign({ memberId: member.id }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, memberId: member.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// --- Member portal data ------------------------------------------------------
router.get('/portal', requireMemberAuth, async (req, res) => {
  try {
    const memberId = req.member.memberId;
    const memberRes = await pool.query('SELECT id, name, email, phone, type, institution, status, joined FROM members WHERE id = $1', [memberId]);
    if (!memberRes.rows.length) return res.status(404).json({ error: 'Member not found.' });
    const credsRes = await pool.query('SELECT code, label, cert_no AS "certNo", issued, expires FROM credentials WHERE member_id = $1 ORDER BY issued DESC', [memberId]);
    const appsRes = await pool.query('SELECT id, type, status, submitted FROM applications WHERE member_id = $1 ORDER BY submitted DESC', [memberId]);
    const updatesRes = await pool.query('SELECT date, text FROM member_updates WHERE member_id = $1 ORDER BY date DESC, id DESC', [memberId]);
    res.json({
      member: memberRes.rows[0],
      credentials: credsRes.rows,
      applications: appsRes.rows,
      updates: updatesRes.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load portal.' });
  }
});

// --- Renewal request ---------------------------------------------------------
router.post('/renew', requireMemberAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const memberId = req.member.memberId;
    const memberRes = await client.query('SELECT * FROM members WHERE id = $1', [memberId]);
    if (!memberRes.rows.length) return res.status(404).json({ error: 'Member not found.' });
    const member = memberRes.rows[0];

    await client.query('BEGIN');
    const appIdRes = await client.query("SELECT 'APP-' || lpad(nextval('application_id_seq')::text, 6, '0') AS id");
    const appId = appIdRes.rows[0].id;
    await client.query(
      `INSERT INTO applications (id, member_id, applicant_name, email, type, membership_type, status)
       VALUES ($1,$2,$3,$4,'renewal',$5,'pending')`,
      [appId, memberId, member.name, member.email, member.type]
    );
    await client.query(
      `INSERT INTO member_updates (member_id, text) VALUES ($1, 'Renewal requested. Awaiting review.')`,
      [memberId]
    );
    await client.query('COMMIT');
    res.json({ applicationId: appId, message: 'Renewal request submitted.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not submit renewal.' });
  } finally {
    client.release();
  }
});

// --- Verify a member by name (requires a logged-in member) ------------------
router.get('/verify', requireMemberAuth, async (req, res) => {
  try {
    const q = String(req.query.name || '').trim().toLowerCase();
    if (!q) return res.json({ results: [] });
    const r = await pool.query(
      `SELECT id, name, type, status FROM members WHERE status != 'pending' AND lower(name) LIKE $1 LIMIT 10`,
      [`%${q}%`]
    );
    res.json({ results: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed.' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const membersRes = await pool.query(`SELECT count(*) FROM members WHERE status != 'pending'`);
    const credsRes = await pool.query('SELECT count(*) FROM credentials');
    res.json({
      members: parseInt(membersRes.rows[0].count, 10),
      credentials: parseInt(credsRes.rows[0].count, 10),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load stats.' });
  }
});

// --- Forgot passcode: step 1, request a reset link -----------------------
// Always responds the same way whether or not the ID/email matched anything,
// so this endpoint can't be used to check which Member IDs or emails exist.
router.post('/forgot-passcode', async (req, res) => {
  try {
    const { memberId, email } = req.body;
    const generic = { message: 'If that account exists, a reset link has been sent to the email on file.' };

    let member = null;
    if (memberId) {
      const r = await pool.query('SELECT * FROM members WHERE id = $1', [String(memberId).toUpperCase()]);
      member = r.rows[0];
    } else if (email) {
      const r = await pool.query('SELECT * FROM members WHERE lower(email) = lower($1)', [email]);
      member = r.rows[0];
    }
    if (!member) return res.json(generic);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await pool.query(
      `INSERT INTO password_resets (member_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
      [member.id, tokenHash, expiresAt]
    );

    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${appUrl}/#reset?token=${rawToken}&id=${member.id}`;
    try {
      await sendPasscodeResetEmail(member.email, resetUrl);
    } catch (mailErr) {
      console.error('Failed to send reset email:', mailErr.message);
    }
    res.json(generic);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not process request.' });
  }
});

// --- Forgot passcode: step 2, use the token to set a new passcode --------
router.post('/reset-passcode', async (req, res) => {
  const client = await pool.connect();
  try {
    const { memberId, token, newPasscode } = req.body;
    if (!newPasscode || String(newPasscode).length < 6) {
      return res.status(400).json({ error: 'New passcode must be at least 6 characters.' });
    }
    const tokenHash = crypto.createHash('sha256').update(String(token || '')).digest('hex');

    await client.query('BEGIN');
    const r = await client.query(
      `SELECT * FROM password_resets
       WHERE member_id = $1 AND token_hash = $2 AND used = false AND expires_at > now()
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [String(memberId || '').toUpperCase(), tokenHash]
    );
    if (!r.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    }
    const resetRow = r.rows[0];
    const passcodeHash = await bcrypt.hash(String(newPasscode), 10);
    await client.query('UPDATE members SET passcode_hash = $1 WHERE id = $2', [passcodeHash, resetRow.member_id]);
    await client.query('UPDATE password_resets SET used = true WHERE id = $1', [resetRow.id]);
    await client.query(
      `INSERT INTO member_updates (member_id, text) VALUES ($1, 'Passcode reset via email verification.')`,
      [resetRow.member_id]
    );
    await client.query('COMMIT');
    res.json({ message: 'Passcode updated. You can now log in with your new passcode.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not reset passcode.' });
  } finally {
    client.release();
  }
});

module.exports = router;
