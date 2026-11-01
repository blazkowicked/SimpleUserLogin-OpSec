# Phase5 — Express + MongoDB Atlas (Polished Frontend)

Polished UI in `Phase5/` is preserved. Backend is self-contained in this folder — `Phase3/` untouched.

## What was built (all inside Phase5/)
- `server.js` — Express app, serves `LoginPage.html`/`SignupPage.html`/`LandingPage.html` + `Style.css` statically, mounts `/api/auth/*`, blocks `.env`/`server.js`
- `config/db.js` — `mongoose.connect(MONGODB_URI)`
- `models/User.js` — `{email unique, passwordHash}` with timestamps
- `routes/auth.js` — `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me` (JWT, bcrypt, express-validator, 503 if DB not connected)
- `middleware/auth.js` — Bearer JWT verify
- `index.js` — refactored from `localStorage users/currentUser` to `fetch('/api/auth/...')` + `localStorage token`, guards `LandingPage.html`
- `Style.css` — polished + `.error` / `button:disabled` additions
- `package.json`, `.gitignore` (`node_modules/`, `.env`), `.env.example`, `.env` (placeholder)

## What YOU do next (Atlas already created)
1. **Set env:**
   ```bash
   cd Phase5
   # edit .env — replace placeholder with your real Atlas URI:
   # SRV (short):
   # MONGODB_URI=mongodb+srv://appuser:REALPASS@cluster0.tjelkqj.mongodb.net/userlogin?retryWrites=true&w=majority&appName=Cluster0
   # If SRV gives querySrv ECONNREFUSED on Windows (Firewall/DNS blocks SRV), use NON-SRV from Atlas → Connect → Drivers → toggle to mongodb://:
   # MONGODB_URI=mongodb://appuser:REALPASS@ac-x8bmxja-shard-00-00.tjelkqj.mongodb.net:27017,ac-x8bmxja-shard-00-01.tjelkqj.mongodb.net:27017,ac-x8bmxja-shard-00-02.tjelkqj.mongodb.net:27017/userlogin?ssl=true&replicaSet=atlas-j6tkw8-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0
   # Generate JWT_SECRET:
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # paste output as JWT_SECRET=... in .env
   ```
   Keep `.env` — never commit (already in Phase5/.gitignore:5). `.env.example` is template for group. Your current `.env` is already set to working NON-SRV URI.

2. **Install & run:**
   ```bash
   npm install   # if not already
   npm run dev   # http://localhost:3000/LoginPage.html  (also /health)
   # or npm start
   ```

3. **Verify:**
   - `http://localhost:3000/health` → `{"status":"ok","db":"connected"}`
   - Sign up → check Atlas `Browse Collections → userlogin.users` has `{email, passwordHash}` (no plaintext)
   - Login → `LandingPage.html` shows `Welcome, you@email` + `Member since ...`
   - Directly open `LandingPage.html` without token → redirects to `LoginPage.html`
   - `Logout` → clears `token` → back to login

## API
- `POST /api/auth/signup {email, password, confirmPassword}` → `201 {token, user}` / `400` / `409`
- `POST /api/auth/login {email, password}` → `200 {token, user}` / `401`
- `GET /api/auth/me` header `Authorization: Bearer <token>` → `200 {email, createdAt}`

## Email
`utils/mailer.js` sends through Gmail SMTP and exports `sendMail({ to, subject, text, html })` and `buildUrl(path)`.

| Variable | Purpose |
| --- | --- |
| `SMTP_USER` | Gmail address that sends the mail |
| `SMTP_PASS` | 16-character Gmail app password (spaces are stripped) |
| `MAIL_FROM` | Sender, e.g. `App Name <same-gmail-address>`. Must be the `SMTP_USER` address, as Gmail rewrites others |
| `APP_URL` | Public site URL with no trailing slash, used by `buildUrl` |

- **Dev console mode:** outside production nothing is sent. Each email is printed to the server console, so the SMTP variables are optional locally.
- **Production:** if `SMTP_USER`, `SMTP_PASS` or `MAIL_FROM` is missing, a warning is logged at startup and `sendMail` fails. Login still works. Vercel Production and Preview deployments both count as production.
- **Test endpoint:** `POST /api/admin/test-email` with an admin Bearer token sends a test email to that admin's own address. Limited to 3 per 15 minutes per admin. Returns `200 {"sent":true}` or `502 {"error":"Email could not be sent"}`, and writes a `test_email_sent` / `test_email_failed` audit entry.

## Email verification and password reset
Signup, every user login and every admin login need a 6-digit code sent by email. Passwords alone no longer return a JWT.

**OTP flow:** the first request returns `{ otpRequired, pendingToken, maskedEmail, message }`. `OtpPage.html` then posts the code and token to `verify-otp`, which returns the normal JWT.

| Endpoint | Body | Purpose |
| --- | --- | --- |
| `POST /api/auth/verify-otp`, `POST /api/admin/verify-otp` | `{pendingToken, code}` | Check the code, return the JWT |
| `POST /api/auth/resend-otp`, `POST /api/admin/resend-otp` | `{pendingToken}` | Send a new code |
| `POST /api/auth/forgot-password` | `{email}` | Email a reset link. Same response whether or not the email exists |
| `POST /api/auth/reset-password` | `{token, password, confirmPassword}` | Set the new password |

- **Codes:** stored as hashes, expire after 10 minutes, 5 attempts, 3 sends, 60-second resend cooldown. Pending tokens last 15 minutes and cannot be used as JWTs.
- **Lockout:** using all 5 attempts counts as one failed login, and failed logins only clear after a correct code.
- **Signup:** no account exists until the code is verified. A registered address gets a "someone tried to sign up" notice instead of a code, with an identical response.
- **Reset links:** built from `APP_URL`, stored as hashes, single use, expire after 20 minutes. A reset clears the lock and logs the user out everywhere.
- **Existing users:** read as `emailVerified: false` until their next verified login or password reset.
- **Admin temporary passwords:** `PUT /api/admin/users/:userId/password` sets a temporary password, ends the user's sessions, cancels their pending logins and reset links, emails them, and audits which admin did it. The temporary password is never emailed. After the login code, `verify-otp` returns `{ passwordChangeRequired, changeToken }` instead of a JWT, and `POST /api/auth/force-change-password` with `{changeToken, password, confirmPassword}` sets the new password and returns the JWT.
- **Email is required to log in:** if Gmail fails, logins return `502` instead of skipping the code. In dev, codes print to the server console.

## Notes
- If `MONGODB_URI` is placeholder, server still runs but `/api/auth/*` returns `503 Database not connected...` — set real URI and restart.
- `JWT_SECRET` already set to random hex for you.
- Home Wi-Fi SRV issue: `mongodb+srv://` needs SRV DNS lookup (`_mongodb._tcp...`); Node's lookup can be blocked by Windows Firewall even when `nslookup` works. NON-SRV `mongodb://` 3-host URI bypasses SRV and is used in your current `Phase5/.env:3` — verified working (`health: connected`, signup/login/me all pass).
- Phase3 stays as reference insecure demo — untouched.
- DB is empty after test (testuser cleaned). Sign up via UI to create real users.
