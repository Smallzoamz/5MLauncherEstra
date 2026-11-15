CREATE TABLE IF NOT EXISTS public.launcher_server_directory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  canonical_name text NOT NULL CHECK (char_length(trim(canonical_name)) BETWEEN 1 AND 100),
  primary_address text NOT NULL UNIQUE CHECK (char_length(trim(primary_address)) BETWEEN 3 AND 253),
  aliases text[] NOT NULL DEFAULT '{}'::text[],
  tag text NOT NULL DEFAULT 'Roleplay',
  patch_manifest_url text NOT NULL DEFAULT '',
  custom_banner_url text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS launcher_server_directory_active_idx
  ON public.launcher_server_directory (is_active, sort_order, canonical_name);

ALTER TABLE public.launcher_server_directory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "launcher_server_directory_public_read" ON public.launcher_server_directory;
CREATE POLICY "launcher_server_directory_public_read"
  ON public.launcher_server_directory
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE OR REPLACE FUNCTION public.touch_launcher_server_directory_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS launcher_server_directory_updated_at ON public.launcher_server_directory;
CREATE TRIGGER launcher_server_directory_updated_at
  BEFORE UPDATE ON public.launcher_server_directory
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_launcher_server_directory_updated_at();

INSERT INTO public.launcher_server_directory (slug, canonical_name, primary_address, aliases, tag, sort_order)
VALUES (
  'noxtis-legacy',
  'Noxtis Legacy',
  '89.38.101.136:30120',
  ARRAY['89.38.101.136'],
  'Roleplay',
  10
)
ON CONFLICT (slug) DO NOTHING;
