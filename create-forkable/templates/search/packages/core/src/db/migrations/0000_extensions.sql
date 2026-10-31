-- Extensions the embedded bundle ships. Tolerates databases where the role cannot create them.
DO $$ BEGIN
  BEGIN CREATE EXTENSION IF NOT EXISTS pg_trgm; EXCEPTION WHEN others THEN RAISE NOTICE 'pg_trgm unavailable: %', SQLERRM; END;
  BEGIN CREATE EXTENSION IF NOT EXISTS unaccent; EXCEPTION WHEN others THEN RAISE NOTICE 'unaccent unavailable: %', SQLERRM; END;
END $$;
--> statement-breakpoint
-- An IMMUTABLE unaccent wrapper usable in generated columns; identity when unaccent is missing.
DO $$ DECLARE s text; BEGIN
  SELECT n.nspname INTO s FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'unaccent';
  IF s IS NULL THEN
    EXECUTE 'CREATE OR REPLACE FUNCTION search_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $f$ SELECT $1 $f$';
  ELSE
    EXECUTE format('CREATE OR REPLACE FUNCTION search_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $f$ SELECT %I.unaccent(%L::regdictionary, $1) $f$', s, s || '.unaccent');
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION search_labels_text(text[]) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$ SELECT coalesce(array_to_string($1, ' '), '') $f$;
