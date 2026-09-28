-- OPTIONAL MANUAL SETUP after migration, deployment and server env configuration.
-- Enable Supabase Cron (pg_cron) and pg_net via the dashboard first.
-- In Supabase Vault UI create:
--   ayan_notification_worker_url = https://YOUR-PRODUCTION-DOMAIN/api/internal/notifications/dispatch
--   ayan_notification_worker_secret = the same secret as server CRON_SECRET (32+ characters)
-- Do not paste the values into this file or commit them.
-- The named schedule is updated, not duplicated, when run again.
SELECT cron.schedule(
 'ayan-external-notifications',
 '* * * * *',
 $job$
 SELECT net.http_post(
  url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='ayan_notification_worker_url'),
  headers := jsonb_build_object('Content-Type','application/json','Authorization',
   'Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='ayan_notification_worker_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 55000
 );
 $job$
);
