import { createPool, sql } from '@vercel/postgres';

let ready;
let txPool;

function getTxPool() {
  if (!txPool) txPool = createPool();
  return txPool;
}

async function createUniqueIndexesIfSafe() {
  const rootDupes = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM drive_items
      WHERE parent_id IS NULL
      GROUP BY lower(name)
      HAVING COUNT(*) > 1
    ) AS has_duplicates
  `;

  const nestedDupes = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM drive_items
      WHERE parent_id IS NOT NULL
      GROUP BY parent_id, lower(name)
      HAVING COUNT(*) > 1
    ) AS has_duplicates
  `;

  if (!rootDupes.rows[0]?.has_duplicates) {
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS drive_items_unique_root_name_idx ON drive_items(lower(name)) WHERE parent_id IS NULL`;
  }

  if (!nestedDupes.rows[0]?.has_duplicates) {
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS drive_items_unique_parent_name_idx ON drive_items(parent_id, lower(name)) WHERE parent_id IS NOT NULL`;
  }
}

export function ensureDb() {
  if (!ready) {
    ready = (async () => {
      try {
        await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
      } catch {
        // Extension may already be unavailable/managed by provider; table creation still works when UUID defaults exist.
      }

      await sql`CREATE TABLE IF NOT EXISTS drive_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('file','folder')),
        parent_id uuid REFERENCES drive_items(id) ON DELETE CASCADE,
        telegram_file_id text,
        telegram_message_id bigint,
        telegram_chat_id text,
        checksum_sha256 text,
        mime_type text,
        size_bytes bigint DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;

      await sql`ALTER TABLE drive_items ADD COLUMN IF NOT EXISTS telegram_message_id bigint`;
      await sql`ALTER TABLE drive_items ADD COLUMN IF NOT EXISTS telegram_chat_id text`;
      await sql`ALTER TABLE drive_items ADD COLUMN IF NOT EXISTS checksum_sha256 text`;

      await sql`CREATE INDEX IF NOT EXISTS drive_items_parent_idx ON drive_items(parent_id)`;
      await sql`CREATE INDEX IF NOT EXISTS drive_items_name_idx ON drive_items(lower(name))`;
      await sql`CREATE INDEX IF NOT EXISTS drive_items_telegram_message_idx ON drive_items(telegram_chat_id, telegram_message_id) WHERE telegram_message_id IS NOT NULL`;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drive_items_nonempty_name_chk') THEN
            ALTER TABLE drive_items
            ADD CONSTRAINT drive_items_nonempty_name_chk CHECK (length(btrim(name)) > 0) NOT VALID;
          END IF;
        END $$;
      `;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drive_items_not_self_parent_chk') THEN
            ALTER TABLE drive_items
            ADD CONSTRAINT drive_items_not_self_parent_chk CHECK (parent_id IS NULL OR parent_id <> id) NOT VALID;
          END IF;
        END $$;
      `;

      await sql`
        CREATE OR REPLACE FUNCTION set_drive_items_updated_at()
        RETURNS trigger
        AS $$
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `;

      await sql`DROP TRIGGER IF EXISTS drive_items_set_updated_at ON drive_items`;
      await sql`
        CREATE TRIGGER drive_items_set_updated_at
        BEFORE UPDATE ON drive_items
        FOR EACH ROW
        EXECUTE FUNCTION set_drive_items_updated_at()
      `;

      await sql`CREATE TABLE IF NOT EXISTS pin_auth_attempts (
        key_hash text PRIMARY KEY,
        attempts integer NOT NULL DEFAULT 0,
        window_started_at timestamptz NOT NULL DEFAULT now(),
        lock_until timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS pin_auth_attempts_lock_until_idx ON pin_auth_attempts(lock_until)`;

      await createUniqueIndexesIfSafe();
    })().catch(error => {
      ready = undefined;
      throw error;
    });
  }
  return ready;
}

export async function withDbTransaction(work) {
  const client = await getTxPool().connect();
  try {
    await client.sql`BEGIN`;
    const result = await work(client);
    await client.sql`COMMIT`;
    return result;
  } catch (error) {
    try {
      await client.sql`ROLLBACK`;
    } catch {
      // ignore rollback failures
    }
    throw error;
  } finally {
    client.release();
  }
}
