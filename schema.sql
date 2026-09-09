CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS drive_items (
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
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drive_items_nonempty_name_chk CHECK (length(btrim(name)) > 0),
  CONSTRAINT drive_items_not_self_parent_chk CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS drive_items_parent_idx ON drive_items(parent_id);
CREATE INDEX IF NOT EXISTS drive_items_name_idx ON drive_items(lower(name));
CREATE INDEX IF NOT EXISTS drive_items_telegram_message_idx ON drive_items(telegram_chat_id, telegram_message_id) WHERE telegram_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS drive_items_unique_root_name_idx ON drive_items(lower(name)) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS drive_items_unique_parent_name_idx ON drive_items(parent_id, lower(name)) WHERE parent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pin_auth_attempts (
  key_hash text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  lock_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pin_auth_attempts_lock_until_idx ON pin_auth_attempts(lock_until);

CREATE OR REPLACE FUNCTION set_drive_items_updated_at()
RETURNS trigger
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS drive_items_set_updated_at ON drive_items;
CREATE TRIGGER drive_items_set_updated_at
BEFORE UPDATE ON drive_items
FOR EACH ROW
EXECUTE FUNCTION set_drive_items_updated_at();
