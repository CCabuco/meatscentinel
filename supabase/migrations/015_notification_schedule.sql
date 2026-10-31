-- Configure NOTIFICATION_WORKER_SECRET in Edge secrets and the matching
-- notification_worker_secret in Vault before scheduling. No secret values here.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create function public.dispatch_inspection_notifications()
returns void language plpgsql security definer set search_path='' as $$
declare worker_secret text;
begin
  -- Maintain uncertain leases even if no pending messages remain.
  update public.inspection_notifications set status='unknown',reason='Worker stopped before delivery could be confirmed',
    lease_token=null,lease_until=null where status='processing' and lease_until<now();
  if not exists(select 1 from public.notification_settings where id and email_enabled)
    or not exists(select 1 from public.inspection_notifications where status='pending' and next_attempt_at<=now()) then return; end if;
  select decrypted_secret into worker_secret from vault.decrypted_secrets where name='notification_worker_secret';
  if worker_secret is null then return; end if;
  perform net.http_post(
    url:='https://vrktfxrjyduhqkawvlnv.supabase.co/functions/v1/send-inspection-notifications',
    headers:=jsonb_build_object('Content-Type','application/json','x-notification-secret',worker_secret),
    body:='{}'::jsonb, timeout_milliseconds:=60000);
end;
$$;
revoke all on function public.dispatch_inspection_notifications() from public,anon,authenticated;
select cron.schedule('meatscentinel-inspection-email','* * * * *','select public.dispatch_inspection_notifications()');
commit;
