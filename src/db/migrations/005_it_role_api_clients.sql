-- ============================================================
-- 005 — an 'it' role (scoped to API/webhook control only), and a proper
-- client_id + secret table for external integrations — adapted from the
-- existing "BDN Sales CRM" repo's own partner-API pattern
-- (supabase/migrations/0103_partner_api.sql: api_clients + a short-lived
-- signed bearer token, re-checked against live revocation status) rather
-- than a single static API key, so the two systems work the same way for
-- anyone integrating both.
-- ============================================================

create table users_new (
  id               text primary key,
  org_id           text references organizations(id),
  email            text not null,
  email_normalized text not null,
  password_hash    text not null,
  role             text not null check (role in ('platform_admin','org_admin','it','member')),
  invited_by       text references users(id),
  created_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (email_normalized)
);
insert into users_new select * from users;
drop table users;
alter table users_new rename to users;

create table invites_new (
  id          text primary key,
  org_id      text not null references organizations(id),
  email       text not null,
  role        text not null check (role in ('org_admin','it','member')),
  token_hash  text not null unique,
  invited_by  text references users(id),
  expires_at  text not null,
  accepted_at text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
insert into invites_new select * from invites;
drop table invites;
alter table invites_new rename to invites;

-- One row per issued integration credential. The secret is shown once at
-- creation and only its hash is ever stored — same as every other token in
-- this codebase. client_id is not secret (it's how a request identifies
-- which credential/org it's using); the secret is what proves possession.
create table api_clients (
  id            text primary key,
  org_id        text not null references organizations(id),
  name          text not null default 'default',
  client_id     text not null unique,
  secret_hash   text not null,
  is_active     integer not null default 1,
  created_by    text references users(id),
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at  text
);

create index idx_api_clients_org on api_clients (org_id);
