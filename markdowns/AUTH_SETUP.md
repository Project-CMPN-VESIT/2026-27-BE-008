# Firebase Auth and PostgreSQL setup

FinPilot uses Firebase Authentication for identity and PostgreSQL for profiles, preferences, CYRO chat, and paper-trading data. Firestore is not used for user data.

## Configure Firebase

1. Create Firebase development and production projects and register the FinPilot web app.
2. Enable Email/Password and Google sign-in in Firebase Authentication.
3. Copy the web app values into the `NEXT_PUBLIC_FIREBASE_*` variables in `.env`.
4. Configure Firebase Admin credentials for the Next.js and Python services. Prefer workload identity or a service-account file outside the repository. If using environment credentials, set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` on the server only. Never use `NEXT_PUBLIC_` for Admin credentials.

## Configure PostgreSQL

Set `DATABASE_URL` to the managed PostgreSQL connection string for the environment. Set `CYRO_CHAT_DATABASE_URL` to the same value or leave it unset; CYRO falls back to `DATABASE_URL`. Apply the schema before starting authenticated APIs:

```powershell
npm run db:migrate
# or if you have psql installed:
# psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_user_data.sql
```

The paper-trading service now requires PostgreSQL and does not initialize or migrate its former SQLite database. Back up and review `paper-trading/paper_trading.db` before importing any records. In particular, do not assign records under `default_user` to an account unless their owner is known.

## Local environment

Copy `.env.example` to `.env` and fill in environment-specific values. The root `.env` is ignored by Git. Do not commit service-account JSON, private keys, or database credentials. The Next.js app loads its `.env` automatically; the Python services load the project environment through their existing dotenv setup.

## Service access

The Next.js API verifies Firebase ID tokens before forwarding authenticated requests. CYRO and paper-trading also verify the original bearer token, and derive ownership from the verified token rather than caller-provided IDs. The local paper-trading service binds to `127.0.0.1` by default. Keep Python service ports private in deployed environments; only expose the Next.js application publicly. Never expose paper trading directly, because order pricing is validated in the Next.js layer.

## Current persistence behavior

- User profiles are synchronized from verified Firebase claims into `app_users`.
- Theme and sidebar-collapse settings are stored in `user_preferences` and mirrored locally for responsiveness.
- CYRO sessions, messages, and memory use the `cyro_*` tables.
- Paper-trading accounts, positions, and journal entries use `paper_*` tables. Orders are committed atomically and require an idempotency key.
- Legacy SQLite and anonymous-session records are left untouched until an explicit ownership mapping/import is prepared.
