async function redirectIfLoggedIn() {
  try {
    const me = await api('GET', '/api/auth/me');
    location.href = me.role === 'platform_admin' ? 'platform.html' : 'envelopes.html';
    return true;
  } catch {
    return false;
  }
}

async function boot() {
  if (await redirectIfLoggedIn()) return;
  const { needsSetup } = await api('GET', '/api/auth/needs-setup');
  document.getElementById(needsSetup ? 'setupView' : 'authView').classList.remove('hidden');
}

document.getElementById('setupBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('setupErr');
  errEl.textContent = '';
  try {
    await api('POST', '/api/auth/setup', {
      email: document.getElementById('setupEmail').value,
      password: document.getElementById('setupPassword').value,
    });
    location.href = 'platform.html';
  } catch (err) {
    if (err.data?.error === 'already_set_up') return boot();
    errEl.textContent = 'Could not create account.';
  }
});

document.getElementById('tabLogin').addEventListener('click', () => {
  document.getElementById('tabLogin').classList.add('active');
  document.getElementById('tabSignup').classList.remove('active');
  document.getElementById('loginPane').classList.remove('hidden');
  document.getElementById('signupPane').classList.add('hidden');
});
document.getElementById('tabSignup').addEventListener('click', () => {
  document.getElementById('tabSignup').classList.add('active');
  document.getElementById('tabLogin').classList.remove('active');
  document.getElementById('signupPane').classList.remove('hidden');
  document.getElementById('loginPane').classList.add('hidden');
});

document.getElementById('loginBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('loginErr');
  errEl.textContent = '';
  try {
    const me = await api('POST', '/api/auth/login', {
      email: document.getElementById('loginEmail').value,
      password: document.getElementById('loginPassword').value,
    });
    location.href = me.role === 'platform_admin' ? 'platform.html' : 'envelopes.html';
  } catch (err) {
    errEl.textContent =
      err.data?.error === 'org_disabled' ? 'This organization has been disabled.' :
      err.data?.error === 'invalid_credentials' ? 'Incorrect email or password.' : 'Login failed.';
  }
});

document.getElementById('signupBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('signupErr');
  errEl.textContent = '';
  try {
    await api('POST', '/api/auth/signup', {
      orgName: document.getElementById('suOrgName').value,
      adminEmail: document.getElementById('suEmail').value,
      adminPassword: document.getElementById('suPassword').value,
    });
    location.href = 'envelopes.html';
  } catch (err) {
    errEl.textContent =
      err.data?.message || (err.data?.error === 'email_already_registered' ? 'That email is already registered.' : 'Could not register.');
  }
});

boot();
