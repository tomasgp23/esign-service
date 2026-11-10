const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { db } = require('../db');
const { sha256Hex } = require('./crypto');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const COOKIE_NAME = 'esign_session';

function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('insert into user_sessions (id, user_id, token_hash, expires_at) values (?,?,?,?)').run(
    crypto.randomUUID(),
    userId,
    tokenHash,
    expiresAt,
  );
  return { token, expiresAt };
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
  };
}

function resolveSession(token) {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const row = db
    .prepare(
      `select s.*, u.id as user_id, u.org_id, u.email, u.role
       from user_sessions s join users u on u.id = s.user_id
       where s.token_hash = ?`,
    )
    .get(tokenHash);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { userId: row.user_id, orgId: row.org_id, email: row.email, role: row.role };
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  sessionCookieOptions,
  resolveSession,
  COOKIE_NAME,
};
