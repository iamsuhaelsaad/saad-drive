# Saad Drive database pass

Adds persistent folders and file metadata with Vercel Postgres, while keeping Telegram as binary storage.

## New routes
- `GET /api/items?parent_id=` list folders/files
- `POST /api/items` create `{name,kind:"folder",parent_id:null}`
- `PATCH /api/items` rename/move `{id,name,parent_id}`
- `DELETE /api/items?id=` delete a folder or file record
- `POST /api/upload` multipart field `file`, optional `parent_id`; uploads to Telegram and persists metadata
- `GET /api/download?id=` authenticated download by metadata id

## Deploy
Add a Vercel Postgres/Neon storage integration so `POSTGRES_URL` exists, run `schema.sql` once if desired, add the Telegram/auth variables, merge the `api` folder, then redeploy. The API also creates the table/index on first authenticated request.

## Frontend wiring
Use the JWT in `Authorization: Bearer ...`. The existing UI needs to call `/api/items` to replace demo rows, send uploads to `/api/upload`, and download from `/api/download?id=...`.
