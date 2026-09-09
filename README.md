# Saad Drive

Private cloud-drive style app for personal use. Metadata is stored in Vercel Postgres and file binaries are stored in Telegram.

## Features
- PIN login (`/api/auth`) that returns JWT
- JWT refresh (`/api/auth/refresh`) for expired-session recovery
- Folder/file metadata tree (`/api/items`)
- Multipart upload to Telegram (`/api/upload`)
- Authenticated download proxy (`/api/download`)
- Storage stats (`/api/stats`) and health check (`/api/health`)

## Required environment variables
Set these in Vercel Project Settings:

- `JWT_SECRET` - long random secret used to sign JWT
- `APP_PIN_HASH` - SHA-256 hash of your numeric PIN
- `POSTGRES_URL` - provided by Vercel Postgres integration
- `TELEGRAM_BOT_TOKEN` - Telegram bot token
- `TELEGRAM_CHAT_ID` - target chat/channel ID for storage
- `MAX_UPLOAD_MB` (optional) - upload limit in MB (default: `20`)
- `MAX_DOWNLOAD_MB` (optional) - download limit in MB (default: `200`)
- `DOWNLOAD_TIMEOUT_MS` (optional) - Telegram download timeout in ms (default: `30000`)
- `TELEGRAM_REQUEST_TIMEOUT_MS` (optional) - Telegram API request timeout in ms (default: `20000`)
- `JWT_REFRESH_GRACE_MS` (optional) - refresh grace window after JWT expiry in ms (default: `86400000`)

### Generate `APP_PIN_HASH`
```bash
node -e "console.log(require('crypto').createHash('sha256').update('1234').digest('hex'))"
```
Replace `1234` with your PIN.

## Database setup
For a fresh database, run `schema.sql` once:

```sql
-- run contents of schema.sql
```

The API also auto-initializes the schema on first authenticated request (idempotent and safe for existing data).

## API routes
All routes except `/api/auth` and `/api/health` require an `Authorization` bearer token.

- `POST /api/auth` body: `{ "pin": "1234" }`
- `POST /api/auth/refresh` with an `Authorization` bearer token header
- `GET /api/items?parent_id=<uuid>`
- `GET /api/items?all=1`
- `POST /api/items` body: `{ "name": "Docs", "kind": "folder", "parent_id": null }`
- `PATCH /api/items` body: `{ "id": "<uuid>", "name": "New Name" }` or `{ "id": "<uuid>", "parent_id": "<folder_uuid>" }`
- `DELETE /api/items?id=<uuid>`
- `POST /api/items` body: `{ "action": "copy", "id": "<uuid>", "parent_id": "<folder_uuid|null>" }`
- `POST /api/upload` multipart first file part (recommended field: `file`), optional `parent_id`
- `GET /api/download?id=<uuid>`
- `GET /api/files?parent_id=<uuid>` (compat listing endpoint)
- `GET /api/stats`
- `GET /api/health`

## Deploy
1. Import repo into Vercel.
2. Add Vercel Postgres integration.
3. Configure environment variables above.
4. Deploy.

## Frontend wiring
Use the JWT in request `Authorization` headers. The existing UI calls:
- `/api/items` for listing and item mutations
- `/api/upload` for multipart uploads
- `/api/download?id=...` for downloads

### Upload error behavior
- `502 Telegram rejected the upload.` = Telegram API rejected/failed the upload request.
- `502 Telegram response was incomplete after upload.` = Telegram responded but did not return a file id.
- `409 ... already exists ...` = duplicate name conflict in destination folder.
- `500 Upload succeeded on Telegram but saving metadata failed.` = Telegram upload completed but database persistence failed.
  - When this happens, the API now attempts compensating cleanup by deleting the uploaded Telegram message.

## UI behavior
The frontend keeps the same API contract and storage model, with a Google Drive-inspired layout polish:
- richer file/folder/action icons
- smoother hover/focus/selection/opening transitions
- improved loading/empty/error presentation in the file list
