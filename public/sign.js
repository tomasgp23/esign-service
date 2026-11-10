// Token read from the URL HASH, not the query string, so it's never sent to
// a server log or Referer header. Same deliberate choice as the original.
const token = (location.hash.match(/[#&]t=([^&]+)/) || [])[1] || '';
let session = null;
let docSha256 = null;
let docFields = [];

function show(id) {
  document.querySelectorAll('.sign-step').forEach((el) => el.classList.remove('on'));
  document.getElementById(id).classList.add('on');
}

function showError(msg) {
  document.getElementById('sgErrorMsg').textContent = msg;
  show('stError');
}

async function call(action, payload) {
  const deviceId = (() => {
    try {
      let id = localStorage.getItem('esign_device_id');
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem('esign_device_id', id);
      }
      return id;
    } catch {
      return null;
    }
  })();

  const clientInfo = {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    languages: navigator.languages,
    screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio },
    clientClock: new Date().toISOString(),
  };

  const res = await fetch(`/api/public/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, session, deviceId, clientInfo, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'request_failed');
    err.data = data;
    throw err;
  }
  return data;
}

async function boot() {
  if (!token) return showError('This link is missing its signing token.');
  try {
    const r = await call('open', {});
    if (r.state === 'already_signed') {
      document.getElementById('sgDoneMsg').textContent = 'You have already signed this document.';
      return show('stDone');
    }
    document.getElementById('sgEnvelopeTitle').textContent = r.envelopeTitle;
    document.getElementById('sgRecipientName').textContent = r.recipientName;
    document.getElementById('sgChannelPicker').textContent = r.hasMobile
      ? `We'll text a code to ${r.maskedMobile}.`
      : 'We’ll email you a code.';
    window._hasMobile = r.hasMobile;
    show('stLanding');
  } catch (err) {
    showError(err.data?.error === 'link_expired' ? 'This link has expired.' : 'This link is no longer valid.');
  }
}

document.getElementById('sgSendCodeBtn').addEventListener('click', async () => {
  try {
    const r = await call('otp_send', { channel: window._hasMobile ? 'sms' : 'email' });
    document.getElementById('sgOtpDest').textContent = r.destinationMasked;
    show('stOtp');
  } catch {
    showError('Could not send a code. Please try again shortly.');
  }
});

document.getElementById('sgVerifyBtn').addEventListener('click', async () => {
  const code = document.getElementById('sgOtpInput').value.trim();
  const errEl = document.getElementById('sgOtpError');
  errEl.style.display = 'none';
  try {
    const r = await call('otp_verify', { code });
    session = r.session;
    const ersdHtml = (r.ersd?.bodyMd || '')
      .replace(/^#+\s*/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\n/g, '<br>');
    document.getElementById('sgErsdText').innerHTML = ersdHtml;
    window._ersdId = r.ersd?.id || null;
    show('stConsent');
  } catch (err) {
    errEl.textContent =
      err.data?.error === 'locked' ? 'Too many attempts. This link has been locked.' : 'Incorrect code. Please try again.';
    errEl.style.display = 'block';
  }
});

document.getElementById('sgErsdCheck').addEventListener('change', (e) => {
  document.getElementById('sgConsentBtn').disabled = !e.target.checked;
});

document.getElementById('sgConsentBtn').addEventListener('click', async () => {
  await call('consent', { ersdId: window._ersdId, accepted: true });
  await loadDocument();
});

async function loadDocument() {
  const r = await call('document', {});
  docFields = r.fields;
  const pdfResp = await fetch(r.url);
  const pdfBytes = await pdfResp.arrayBuffer();
  const hashBuf = await crypto.subtle.digest('SHA-256', pdfBytes);
  docSha256 = [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  document.getElementById('sgPdfFrame').src = URL.createObjectURL(blob);
  show('stDocument');
  initSignaturePad();
}

// Vanilla canvas signature pad — mouse + touch, 2x scaled for crisp
// rendering on high-DPI screens. Strokes are only rasterized to a PNG on
// submit; the raw stroke points themselves are never sent anywhere.
let padCtx = null;
let drawing = false;
function initSignaturePad() {
  const canvas = document.getElementById('sgSigCanvas');
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  padCtx = canvas.getContext('2d');
  padCtx.scale(2, 2);
  padCtx.lineWidth = 2.2;
  padCtx.lineCap = 'round';

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return { x: point.clientX - r.left, y: point.clientY - r.top };
  }
  function start(e) {
    drawing = true;
    const p = pos(e);
    padCtx.beginPath();
    padCtx.moveTo(p.x, p.y);
    window._hasStroke = true;
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    padCtx.lineTo(p.x, p.y);
    padCtx.stroke();
  }
  function end() {
    drawing = false;
  }
  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: true });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
}

document.getElementById('sgClearBtn').addEventListener('click', () => {
  const canvas = document.getElementById('sgSigCanvas');
  padCtx.clearRect(0, 0, canvas.width, canvas.height);
  window._hasStroke = false;
});

document.getElementById('sgTabDraw').addEventListener('click', () => {
  document.getElementById('sgTabDraw').classList.add('active');
  document.getElementById('sgTabType').classList.remove('active');
  document.getElementById('sgPadDraw').style.display = '';
  document.getElementById('sgPadType').style.display = 'none';
});
document.getElementById('sgTabType').addEventListener('click', () => {
  document.getElementById('sgTabType').classList.add('active');
  document.getElementById('sgTabDraw').classList.remove('active');
  document.getElementById('sgPadType').style.display = '';
  document.getElementById('sgPadDraw').style.display = 'none';
});

document.getElementById('sgFinishBtn').addEventListener('click', async () => {
  const fullName = document.getElementById('sgFullName').value.trim();
  const title = document.getElementById('sgTitleInput').value.trim();
  const authorityOk = document.getElementById('sgAuthorityCheck').checked;
  if (!fullName) return alert('Please enter your printed name.');
  if (!authorityOk) return alert('Please confirm you have authority to sign.');

  const typing = document.getElementById('sgTabType').classList.contains('active');
  try {
    if (typing) {
      const typed = document.getElementById('sgTypedInput').value.trim();
      if (!typed) return alert('Please type your signature.');
      await call('signature_adopt', { type: 'typed', typedSignature: typed, typedFont: 'cursive' });
    } else {
      if (!window._hasStroke) return alert('Please draw your signature.');
      const canvas = document.getElementById('sgSigCanvas');
      const dataUrl = canvas.toDataURL('image/png');
      await call('signature_adopt', { type: 'drawn', imageBase64: dataUrl.split(',')[1] });
    }

    const r = await call('submit', { fullName, title, docSha256Client: docSha256 });
    if (r.state === 'completed') {
      document.getElementById('sgDoneMsg').textContent = 'All signers have completed this document.';
      try {
        const dl = await call('download', {});
        const link = document.getElementById('sgDownloadLink');
        link.href = dl.url;
        link.style.display = 'inline-block';
        link.textContent = 'Download signed copy';
      } catch {}
    } else {
      document.getElementById('sgDoneMsg').textContent =
        'Thanks — you’re done. We’re waiting on the other signer to finish.';
    }
    show('stDone');
  } catch (err) {
    if (err.data?.error === 'hash_mismatch') {
      alert('This document changed since you opened it. Please refresh and try again.');
    } else {
      alert('Something went wrong submitting your signature. Please try again.');
    }
  }
});

document.getElementById('sgDeclineBtn').addEventListener('click', async () => {
  if (!confirm('Are you sure you want to decline to sign this document?')) return;
  await call('decline', { reason: 'declined by signer' });
  show('stDeclined');
});

boot();
