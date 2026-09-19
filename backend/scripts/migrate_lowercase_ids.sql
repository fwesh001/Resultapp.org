-- One-time SQL migration to lowercase prefixes.
-- Run via psql as superuser or via migrate_lowercase_ids.py.
-- Preview collisions first:
-- SELECT subdomain, LOWER(student_id), COUNT(*) FROM tenant_students GROUP BY 1,2 HAVING COUNT(*)>1;

-- Dry-run preview:
-- SELECT * FROM tenant_students WHERE student_id <> LOWER(student_id) LIMIT 20;

-- Apply:
UPDATE schools SET id_prefix = LOWER(id_prefix), updated_at = NOW() WHERE id_prefix IS NOT NULL AND id_prefix <> LOWER(id_prefix);
UPDATE tenant_students SET student_id = LOWER(student_id) WHERE student_id <> LOWER(student_id);
UPDATE tenant_grades SET student_id = LOWER(student_id) WHERE student_id <> LOWER(student_id);
UPDATE result_publications SET student_id = LOWER(student_id) WHERE student_id <> LOWER(student_id);

-- Legacy tables (if exist):
DO $$ BEGIN
  PERFORM 1 FROM information_schema.tables WHERE table_name='student_academic_records';
  IF FOUND THEN
    EXECUTE 'UPDATE student_academic_records SET student_id = LOWER(student_id) WHERE student_id <> LOWER(student_id)';
  END IF;
  PERFORM 1 FROM information_schema.tables WHERE table_name='student_behavioral_records';
  IF FOUND THEN
    EXECUTE 'UPDATE student_behavioral_records SET student_id = LOWER(student_id) WHERE student_id <> LOWER(student_id)';
  END IF;
END $$;

-- Verify:
-- SELECT COUNT(*) FROM tenant_students WHERE student_id <> LOWER(student_id);
-- Should be 0
