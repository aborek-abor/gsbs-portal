# GSBS Member Portal — Live Backend

This is the real, database-backed version of the Ghanaian Society for
Biomedical Scientists member portal: applications, admissions review,
member accounts, credentials, and certificate numbers are all stored in a
real Postgres database, and the admin passcode is a properly hashed,
server-checked secret rather than anything sitting in the page itself.

## What's in here

```
server.js           Express app entry point
routes/members.js    Public + member API (apply, login, portal, verify, renew)
routes/admin.js      Admin API (setup, login, applications queue, approve/reject, change passcode)
db/schema.sql        Postgres table + sequence definitions
db/migrate.js        Runs schema.sql against DATABASE_URL
db/pool.js           Shared Postgres connection pool
public/index.html    The site itself (served as static files by Express)
uploads/              Applicant-uploaded files land here at runtime (not committed)
```

## Deploying: GitHub → Railway

### 1. Push this to GitHub

If you don't already have a repo for this:

```bash
cd gsbs-live
git init
git add .
git commit -m "Initial commit: GSBS member portal backend"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

### 2. Create the Railway project

1. Go to [railway.app](https://railway.app) and click **New Project**.
2. Choose **Deploy from GitHub repo**, and select this repository.
3. Railway will detect it's a Node app and start a build automatically. Let
   it fail the first time, that's expected, it doesn't have a database or
   secrets yet.

### 3. Add a Postgres database

1. In your Railway project, click **New** → **Database** → **Add PostgreSQL**.
2. Railway automatically creates a `DATABASE_URL` variable and makes it
   available to every service in the project, including your app. You don't
   need to copy or paste anything.

### 4. Set the remaining environment variable

1. Click on your app service (not the database) → **Variables**.
2. Add `JWT_SECRET`. Generate a real value first, don't leave this blank or
   guessable:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
3. Paste the output in as the value.

`DATABASE_URL` should already be listed here automatically since step 3
connected the database to this service. If it isn't, click **New Variable**
→ **Add Reference** → select the Postgres service's `DATABASE_URL`.

### 5. Run the migration once

The tables need to exist before the app can use them. From your local
machine, with Railway's CLI:

```bash
npm install -g @railway/cli
railway login
railway link          # select this project
railway run npm run migrate
```

If you'd rather not install the CLI, you can instead temporarily add a
`postbuild` script that runs the migration on every deploy (safe to leave in
permanently, since the schema uses `CREATE TABLE IF NOT EXISTS`):

```json
"scripts": {
  "postbuild": "node db/migrate.js"
}
```

Railway does not run a separate `build` step for a plain Node app by
default, if `postbuild` doesn't fire, just run the CLI command above once.

### 6. Deploy

Push to `main` (or click **Deploy** in the Railway dashboard). Railway will
build and start the app, and give you a live `*.up.railway.app` URL under
**Settings → Networking → Generate Domain**.

### 7. First visit: set the admin passcode

Go to `https://<your-app>.up.railway.app/#admin`. Since no passcode has
been set yet, you'll be prompted to create one right there, choose something
real, not a placeholder. This is stored as a bcrypt hash in the database,
never in plain text anywhere.

## Setting up dues collection (Paystack)

Applicants can pay their membership dues online via Paystack (cards and
Mobile Money) at the time they apply. The Membership Admissions Committee
cannot approve an application until it's marked paid, either automatically
through Paystack, or manually if someone pays by cash or bank transfer.

1. Sign up at [paystack.com](https://paystack.com). You do **not** need to
   finish business verification to start testing, Paystack gives you test
   keys immediately.
2. In the Paystack dashboard, go to **Settings → API Keys & Webhooks**.
   Copy your **Test Secret Key** (starts with `sk_test_`).
3. In Railway, add a variable: `PAYSTACK_SECRET_KEY` with that value.
4. Still on that Paystack page, add a webhook URL:
   `https://<your-live-site>/api/payments/webhook`
   This is how Paystack confirms a payment really happened, independent of
   whatever the applicant's browser reports.
5. Test with Paystack's [published test card and Mobile Money
   numbers](https://paystack.com/docs/payments/test-payments/) before
   switching to live keys.
6. Once you're ready to accept real payments, replace `PAYSTACK_SECRET_KEY`
   with your **Live Secret Key** (starts with `sk_live_`) instead, this
   requires completing Paystack's business verification first.

Dues amounts by membership type are set in `routes/paystack.js` (the
`DUES_GHS` object near the top). Edit the figures there and redeploy to
change pricing.

## A few things worth knowing before real applicants use this

- **File uploads are stored on local disk** (`/uploads`), which works, but
  Railway's filesystem is not guaranteed to persist across redeploys. For
  anything beyond a pilot, move file storage to a real object store (Railway
  has an S3-compatible bucket add-on, or use AWS S3 directly) before relying
  on uploaded documents long-term.
- **Passcodes for applicants** are currently auto-generated 6-digit numbers
  shown once at submission time, same behavior as the prototype. Worth
  deciding whether that's the right UX for real members versus letting them
  choose their own.
- **Email is collected but nothing is sent.** Applicants aren't notified
  when their application is approved or rejected, they'd need to check the
  portal themselves. Adding real email notifications (Postmark, SendGrid,
  Resend, etc.) is a natural next step.
- **Backups.** Railway's Postgres plugin supports automated backups, turn
  this on once real member data is in the system.

## Local development

```bash
cp .env.example .env
# fill in DATABASE_URL (point at a local Postgres) and JWT_SECRET
npm install
npm run migrate
npm start
```

Then visit `http://localhost:3000`.
