async function boot() {
  const me = await requireClientOrg();
  if (!me || !enforcePageRole(me)) return;
  renderSidebar(me);
  loadMembers();
}

document.getElementById('inviteBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('inviteErr');
  errEl.textContent = '';
  try {
    await api('POST', '/api/org/members/invite', {
      email: document.getElementById('inviteEmail').value,
      role: document.getElementById('inviteRole').value,
    });
    document.getElementById('inviteEmail').value = '';
    errEl.textContent = 'Invite sent.';
    errEl.classList.remove('err');
    errEl.classList.add('ok-msg');
  } catch {
    errEl.classList.remove('ok-msg');
    errEl.classList.add('err');
    errEl.textContent = 'Could not send invite.';
  }
});

async function loadMembers() {
  const { members } = await api('GET', '/api/org/members');
  const tbody = document.getElementById('memberRows');
  tbody.innerHTML = members.length
    ? members.map((m) => `<tr><td>${m.email}</td><td>${m.role}</td><td>${new Date(m.created_at).toLocaleString()}</td></tr>`).join('')
    : '<tr><td colspan="3" class="muted">No members yet.</td></tr>';
}

boot();
