-- V8.6.5: optional evidence photo/file on an approval request. Additive
-- only. Storage bucket (svma-approval-files) already created via the
-- Storage API, same as the other document buckets.

alter table public.approval_requests add column if not exists attachment_path text;
alter table public.approval_requests add column if not exists attachment_name text;
alter table public.approval_requests add column if not exists attachment_mime text;
