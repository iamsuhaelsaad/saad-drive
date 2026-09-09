# Saad Drive Telegram backend pass

Adds authenticated Telegram upload and download routes to the Vercel project.

## Routes
- `POST /api/auth`: returns a 2-hour JWT after validating `APP_PIN_HASH`.
- `POST /api/upload`: multipart upload, max size from `MAX_UPLOAD_MB`, sends the file to Telegram, returns `file_id`.
- `GET /api/download?file_id=...`: authenticated Telegram proxy download.
- `GET /api/files`: protected placeholder until a metadata database is connected.

## Frontend wiring
Use `Authorization: Bearer ${sessionStorage.getItem('token')}`. Upload with `FormData` field `file`, then save the returned `file.id` with the file name. Download through `/api/download?file_id=...` with the same auth header.

## Deploy
Merge these `api` files into the deployed project, confirm all five Vercel environment variables are set for Production, then redeploy. Do not place the bot token in frontend JavaScript.

## Important
Telegram stores the binary, but it is not a folder database. The next pass must add a persistent metadata store, such as Vercel Postgres, Neon, Supabase, or another database, for folders, search, rename, delete, and reliable listing.
