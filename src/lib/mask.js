function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return '***';
  const visible = user.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

function maskMobile(mobile) {
  if (!mobile) return null;
  return mobile.slice(0, -4).replace(/\d/g, '•') + mobile.slice(-4);
}

function maskTail(value) {
  if (!value) return value;
  const str = String(value);
  return '•'.repeat(Math.max(str.length - 4, 0)) + str.slice(-4);
}

module.exports = { maskEmail, maskMobile, maskTail };
