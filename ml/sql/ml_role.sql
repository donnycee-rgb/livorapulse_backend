-- A database login for the nightly ML job, allowed only what it needs:
-- read DailyFeatures, and write the three ML tables. It can't see or change
-- anything else (accounts, passwords, raw logs).
--
-- Run once in Supabase: Dashboard -> SQL Editor -> paste -> replace the
-- password -> Run. Run it after the ML tables migration has been deployed.
-- Use a long random password of letters and digits only.

CREATE ROLE livora_ml WITH LOGIN PASSWORD 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';

GRANT USAGE ON SCHEMA public TO livora_ml;
GRANT SELECT ON "DailyFeatures" TO livora_ml;
GRANT SELECT, INSERT, UPDATE ON "MlModelRun" TO livora_ml;
GRANT SELECT, INSERT, UPDATE, DELETE ON "MlUserEffect", "MlPrediction", "MlUserModel" TO livora_ml;

-- Connection string for the GitHub secret ML_DATABASE_URL (session pooler,
-- port 5432; the role name is followed by "." and the project ref):
--
--   postgresql://livora_ml.<project-ref>:<password>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
--
-- Already ran an older version of this script? Run just this line after the
-- MlUserModel migration is deployed:
--   GRANT SELECT, INSERT, UPDATE, DELETE ON "MlUserModel" TO livora_ml;
--
-- To change the password later:  ALTER ROLE livora_ml WITH PASSWORD '...';
-- To remove the login entirely:  DROP OWNED BY livora_ml; DROP ROLE livora_ml;
