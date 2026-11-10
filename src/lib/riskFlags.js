// Deliberately narrow — same five flags as the original, same thresholds.
// None of these mean fraud by themselves; they mean "look here first."
// No geolocation provider is wired in (same deliberate decision as before).
function computeRiskFlags(recipients) {
  const flags = new Set();
  const signed = recipients.filter((r) => r.signed_at);

  const deviceIds = [...new Set(signed.map((r) => r.sign_device_id).filter(Boolean))];
  if (signed.length > 1 && deviceIds.length === 1) flags.add('same_device_both_signers');

  const ips = [...new Set(signed.map((r) => r.sign_ip).filter(Boolean))];
  if (signed.length > 1 && ips.length === 1) flags.add('same_ip_both_signers');

  if (signed.length > 1) {
    const times = signed.map((r) => new Date(r.signed_at).getTime()).sort((a, b) => a - b);
    if (times[times.length - 1] - times[0] < 2 * 60 * 1000) {
      flags.add('signed_within_minutes_of_each_other');
    }
  }

  for (const r of signed) {
    if (r.first_viewed_at && r.signed_at) {
      const delta = new Date(r.signed_at).getTime() - new Date(r.first_viewed_at).getTime();
      if (delta < 15 * 1000) flags.add('signed_very_quickly');
    }
    if ((r.failed_otp_count || 0) > 0) flags.add('otp_attempts_failed');
  }

  return [...flags];
}

module.exports = { computeRiskFlags };
