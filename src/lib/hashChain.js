const { db } = require('../db');
const { sha256Hex } = require('./crypto');

const GENESIS_HASH = '0'.repeat(64);

// Same canonical payload shape as the original Postgres esign_event_payload():
// a deterministic JSON string, timestamp formatted explicitly in UTC so the
// chain can never depend on local clock/timezone representation.
function canonicalPayload(event) {
  return JSON.stringify({
    envelope_id: event.envelope_id,
    recipient_id: event.recipient_id ?? null,
    actor_type: event.actor_type,
    actor_user_id: event.actor_user_id ?? null,
    event_type: event.event_type,
    occurred_at: event.occurred_at,
    client_ip: event.client_ip ?? null,
    user_agent: event.user_agent ?? null,
    client_info: event.client_info ?? null,
    device_id: event.device_id ?? null,
    details: event.details ?? {},
  });
}

const insertEventStmt = db.prepare(`
  insert into esign_events
    (envelope_id, recipient_id, actor_type, actor_user_id, event_type, occurred_at,
     client_ip, user_agent, client_info, device_id, details, prev_hash, event_hash)
  values
    (@envelope_id, @recipient_id, @actor_type, @actor_user_id, @event_type, @occurred_at,
     @client_ip, @user_agent, @client_info, @device_id, @details, @prev_hash, @event_hash)
`);

const lastHashStmt = db.prepare(`
  select event_hash from esign_events where envelope_id = ? order by id desc limit 1
`);

// Appends one event to an envelope's hash chain. Node is single-threaded and
// better-sqlite3 calls are synchronous, so reading the previous hash and
// inserting the next one can never interleave with another write to the same
// envelope — the "serialize writers per envelope" guarantee the original
// needed a Postgres `select ... for update` for falls out for free here.
function logEvent(event) {
  const occurred_at = new Date().toISOString();
  const prev_hash = lastHashStmt.get(event.envelope_id)?.event_hash ?? GENESIS_HASH;
  const full = {
    envelope_id: event.envelope_id,
    recipient_id: event.recipient_id ?? null,
    actor_type: event.actor_type,
    actor_user_id: event.actor_user_id ?? null,
    event_type: event.event_type,
    occurred_at,
    client_ip: event.client_ip ?? null,
    user_agent: event.user_agent ?? null,
    client_info: event.client_info ?? null,
    device_id: event.device_id ?? null,
    details: event.details ?? {},
  };
  const event_hash = sha256Hex(prev_hash + canonicalPayload(full));
  insertEventStmt.run({
    ...full,
    client_info: JSON.stringify(full.client_info),
    details: JSON.stringify(full.details),
    prev_hash,
    event_hash,
  });
  return event_hash;
}

// Independently re-walks an envelope's event chain and confirms every link
// still holds — same purpose as the original's esign_verify_chain().
function verifyChain(envelopeId) {
  const rows = db
    .prepare('select * from esign_events where envelope_id = ? order by id asc')
    .all(envelopeId);
  let prev = GENESIS_HASH;
  const results = [];
  for (const row of rows) {
    const payload = canonicalPayload({
      ...row,
      client_info: row.client_info ? JSON.parse(row.client_info) : null,
      details: JSON.parse(row.details),
    });
    const expected = sha256Hex(prev + payload);
    const ok = row.prev_hash === prev && row.event_hash === expected;
    results.push({ event_id: row.id, ok });
    prev = row.event_hash;
  }
  return results;
}

module.exports = { logEvent, verifyChain, GENESIS_HASH };
