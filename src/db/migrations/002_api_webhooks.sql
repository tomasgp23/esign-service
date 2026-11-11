-- ============================================================
-- 002 — per-org API key + webhook support, template variable schema
-- ============================================================

-- SQLite's ALTER TABLE ADD COLUMN forbids UNIQUE directly on the new
-- column, so the uniqueness is a separate partial index below (partial so
-- the many orgs with no key yet, all NULL, don't collide with each other).
alter table organizations add column api_key_hash text;
alter table organizations add column api_key_prefix text;
alter table organizations add column api_key_created_at text;
alter table organizations add column webhook_url text;
alter table organizations add column webhook_secret text;

create unique index idx_org_api_key_hash on organizations (api_key_hash) where api_key_hash is not null;

-- Declared variable names for an html template, auto-extracted from its
-- body_html at save time (same {{token}} regex as the merge renderer).
-- Only meaningful for kind='html'; null/empty for kind='pdf'.
alter table esign_templates add column variables text not null default '[]';

create table webhook_deliveries (
  id           text primary key,
  org_id       text not null references organizations(id),
  envelope_id  text not null references esign_envelopes(id),
  event_type   text not null,
  url          text not null,
  payload      text not null,
  attempt      integer not null default 1,
  status_code  integer,
  delivered_at text,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create index idx_webhook_deliveries_org on webhook_deliveries (org_id, created_at);
