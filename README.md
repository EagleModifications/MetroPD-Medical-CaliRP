# MedCAD — Render + Persistent `db.json`

This project is a self-hosted MedCAD application. It does not require Base44, MongoDB, or PostgreSQL.

## Local development

Requirements: Node.js 18+

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Local data is stored in `data/db.json`.

## Render deployment

The included `render.yaml` configures:

- Node Web Service
- `npm install` build command
- `npm start` start command
- `DATA_DIR=/var/data`
- a 1 GB persistent disk mounted at `/var/data`

The live database is therefore:

```text
/var/data/db.json
```

On the first deployment, if `/var/data/db.json` does not exist, the server copies the bundled `data/db.json` to the persistent disk. After that, the persistent copy is used and is not overwritten on restart or redeploy.

### Manual Render setup

1. Push this project to GitHub.
2. In Render, create a **Web Service** from the repository.
3. Runtime: **Node**.
4. Build command: `npm install`.
5. Start command: `npm start`.
6. Add environment variable `DATA_DIR` with value `/var/data`.
7. Add a persistent disk mounted at `/var/data`.
8. Deploy.

If you use the Blueprint (`render.yaml`), Render will use the same settings automatically. Confirm the persistent disk is attached before relying on the service for production data.

## Important database rule

Do not replace the persistent `/var/data/db.json` with the GitHub copy after the application has started using it. GitHub contains the seed database; the Render persistent disk contains the live database.

Back up `/var/data/db.json` regularly.

## Authentication note

The current self-hosted build retains the original development OTP flow. The verification code is `123456` because no email provider is configured. Do not expose this authentication setup to the public internet without replacing the development OTP/reset behavior with a real email verification and password-reset system.
