CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS drive_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('file','folder')),
  parent_id uuid REFERENCES drive_items(id) ON DELETE CASCADE,
  telegram_file_id text,
  mime_type text,
  size_bytes bigint DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drive_items_nonempty_name_chk CHECK (length(btrim(name)) > 0),
  CONSTRAINT drive_items_not_self_parent_chk CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS drive_items_parent_idx ON drive_items(parent_id);
CREATE INDEX IF NOT EXISTS drive_items_name_idx ON drive_items(lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS drive_items_unique_root_name_idx ON drive_items(lower(name)) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS drive_items_unique_parent_name_idx ON drive_items(parent_id, lower(name)) WHERE parent_id IS NOT NULL;

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
