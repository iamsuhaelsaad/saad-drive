import { sql } from '@vercel/postgres';

let ready;

export function ensureDb() {
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS drive_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('file','folder')),
        parent_id uuid REFERENCES drive_items(id) ON DELETE CASCADE,
        telegram_file_id text,
        mime_type text,
        size_bytes bigint DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS drive_items_parent_idx ON drive_items(parent_id)`;
      await sql`CREATE INDEX IF NOT EXISTS drive_items_name_idx ON drive_items(lower(name))`;
    })().catch(error => {
      ready = undefined;
      throw error;
    });
  }
  return ready;
}
