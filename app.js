// Janta ka Mantar: page logic. No libraries, no trackers, no third-party requests.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const act = $('act'), btn = $('stand'), status = $('stand-status'), shareBox = $('share');
  const countEl = $('count'), prevEl = $('count-prev'), sinceEl = $('since'), barFill = $('bar-fill'), msText = $('milestone-text');
  const SITE = location.origin;
  const MARK = 'jkm-stood';                     // the only thing ever stored, and only on this phone
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = new Intl.NumberFormat('en-IN');  // Indian grouping: 1,00,000 and 1,00,00,000

  let shown = 0;          // number currently on screen
  let latest = null;      // latest signed snapshot from the server
  let mine = 0;           // +1 shown locally after standing, until the next batch includes it
  let tappedAt = 0;

  // ---------- one tap per device ----------
  const store = {
    get() { try { return localStorage.getItem(MARK); } catch { return null; } },
    set() { try { localStorage.setItem(MARK, '1'); } catch { /* private mode: still counted once this visit */ } },
  };

  // ---------- counter ----------
  const MONTHS_HI = ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'];
  const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function setSince(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return;
    const d = Number(m[3]), mo = Number(m[2]) - 1;
    sinceEl.textContent = `${d} ${MONTHS_HI[mo]} ${m[1]} से / since ${d} ${MONTHS_EN[mo]} ${m[1]}`;
  }

  const MILESTONES = [
    [1000, '1,000', '1,000'], [10000, '10,000', '10,000'], [100000, '1 लाख', '1 lakh'],
    [1000000, '10 लाख', '10 lakh'], [10000000, '1 करोड़', '1 crore'], [100000000, '10 करोड़', '10 crore'],
  ];
  function setMilestone(n) {
    const next = MILESTONES.find(([v]) => v > n) || MILESTONES[MILESTONES.length - 1];
    const prevVal = MILESTONES[MILESTONES.indexOf(next) - 1]?.[0] || 0;
    const pct = Math.min(100, Math.max(2, ((n - prevVal) / (next[0] - prevVal)) * 100));
    barFill.style.width = (100 - pct) + '%';
    msText.textContent = `अगला लक्ष्य ${next[1]} / next ${next[2]}`;
  }

  function animateTo(target) {
    const from = shown;
    if (reduceMotion || document.hidden || from === target) { shown = target; countEl.textContent = fmt.format(target); return; }
    const dur = from === 0 ? 1400 : 700, t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      shown = Math.round(from + (target - from) * eased);
      countEl.textContent = fmt.format(shown);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // never leave the number short if animation frames are paused (background tab, power saving)
    setTimeout(() => { shown = target; countEl.textContent = fmt.format(target); }, dur + 100);
  }

  function render() {
    if (!latest) return;
    const total = latest.count + mine;
    animateTo(total);
    setMilestone(total);
  }

  async function refresh() {
    try {
      const r = await fetch('/api/count', { cache: 'no-store', credentials: 'omit' });
      if (!r.ok) return;
      const snap = await r.json();
      if (mine && snap.updated > tappedAt) mine = 0;   // a batch has closed since we tapped: our tap is inside the total
      latest = snap;
      setSince(snap.since);
      render();
    } catch { /* offline: keep showing the last number */ }
  }

  // ---------- proof-of-work, solved in the background as soon as the page opens ----------
  let solution = null;
  function solveAhead() {
    solution = (async () => {
      const r = await fetch('/api/challenge', { cache: 'no-store', credentials: 'omit' });
      if (!r.ok) throw new Error('challenge');
      const ch = await r.json();
      const bits = Number(ch.challenge.split(':')[2]);
      const nonce = await new Promise((resolve, reject) => {
        const w = new Worker('/pow.js');
        w.onmessage = (e) => { w.terminate(); e.data.nonce ? resolve(e.data.nonce) : reject(new Error('pow')); };
        w.onerror = () => { w.terminate(); reject(new Error('pow')); };
        w.postMessage({ challenge: ch.challenge, bits });
      });
      return { ...ch, nonce };
    })();
    solution.catch(() => {});   // handled on tap
  }

  async function submit(retry = true) {
    const sol = await solution;
    const r = await fetch('/api/stand', {
      method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: sol.challenge, sig: sol.sig, nonce: sol.nonce }),
    });
    if (r.status === 409 && retry) { solveAhead(); return submit(false); }   // expired or already used: one fresh try
    if (!r.ok) throw new Error('stand');
  }

  // ---------- states ----------
  function setDone(justNow) {
    act.dataset.state = 'done';
    btn.disabled = true;
    btn.setAttribute('aria-pressed', 'true');
    status.textContent = justNow
      ? 'धन्यवाद। अब इसे आगे भेजिए।\nThank you. Now pass it on.'
      : 'आप पहले ही गिने जा चुके हैं। अब आगे भेजिए।\nYou’re already counted. Pass it on.';
    shareBox.hidden = false;
  }

  btn.addEventListener('click', async () => {
    if (act.dataset.state !== 'ready') return;
    act.dataset.state = 'working';
    btn.disabled = true;
    status.textContent = 'जोड़ रहे हैं…\nAdding you…';
    try {
      if (!solution) solveAhead();
      await submit();
      store.set();
      mine = 1;
      tappedAt = Math.floor(Date.now() / 1000);
      // show "before → after": the old number stays, the hand rises, then the count moves on
      prevEl.textContent = fmt.format(shown);
      act.classList.add('just');
      setDone(true);
      setTimeout(render, reduceMotion ? 0 : 700);
      setTimeout(() => act.classList.remove('just'), 9000);
      if (navigator.vibrate) navigator.vibrate(30);
    } catch {
      act.dataset.state = 'ready';
      btn.disabled = false;
      status.textContent = 'नहीं जुड़ सका। फिर से टैप करें।\nCouldn’t connect. Tap again.';
      solveAhead();
    }
  });

  // ---------- sharing ----------
  function shareText() {
    const total = latest ? latest.count + mine : 0;
    const n = total >= 100 ? `\n\n*${fmt.format(total)}* लोग अब तक / people so far` : '';   // the count only helps once it is big
    return `🇮🇳 जंतर मंतर नहीं जा सकते? *एक टैप में खड़े होइए।*\n` +
      `Can’t get to Jantar Mantar? *Stand in one tap.*\n\n` +
      `स्वतंत्र, निष्पक्ष, जवाबदेह चुनाव आयोग के लिए।\n` +
      `For a free, fair, accountable Election Commission.` + n + `\n\n` +
      `👉 ${SITE.replace(/^https?:\/\//, '')}`;
  }

  $('share-wa').addEventListener('click', () => {
    location.href = 'https://wa.me/?text=' + encodeURIComponent(shareText());
  });

  $('share-link').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    try {
      if (navigator.share) { await navigator.share({ text: shareText() }); return; }
      await navigator.clipboard.writeText(SITE);
      b.textContent = 'कॉपी हो गया / Copied';
    } catch { /* share sheet closed */ }
  });

  // Share card: drawn on the phone itself, so no server ever sees who made one.
  async function drawCard() {
    const c = $('card'), g = c.getContext('2d');
    const W = c.width, H = c.height, fam = getComputedStyle(document.body).fontFamily;
    try { await Promise.all([document.fonts.load('800 40px Mukta', 'जनता'), document.fonts.load('400 40px Mukta', 'जनता')]); } catch {}
    g.fillStyle = '#FBF9F4'; g.fillRect(0, 0, W, H);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#14213D'; g.font = `800 50px ${fam}`; g.fillText('जनता का मंतर', W / 2, 120);
    const tw = g.measureText('जनता का मंतर').width;
    g.fillStyle = '#F2801F'; g.fillRect(W / 2 - tw / 2 - 110, 104, 80, 3);
    g.fillStyle = '#1F8A3B'; g.fillRect(W / 2 + tw / 2 + 30, 104, 80, 3);
    g.fillStyle = '#4B556B'; g.font = `400 30px ${fam}`; g.fillText('The digital Jantar Mantar', W / 2, 166);
    g.textAlign = 'left'; g.fillStyle = '#14213D'; g.font = `400 76px ${fam}`;
    g.fillText('If you could,', 96, 300); g.fillText('would you be there?', 96, 385);
    g.fillRect(96, 420, 44, 3);
    g.fillStyle = '#4B556B'; g.font = `400 42px ${fam}`; g.fillText('अगर आप जा पाते, तो क्या आप वहाँ होते?', 96, 490);
    const hand = new Image(); hand.src = '/hand.webp';
    try { await hand.decode(); g.drawImage(hand, 560, 560, 424, 400); } catch {}
    const n = latest ? fmt.format(latest.count + mine) : '';
    g.fillStyle = '#F2801F'; g.font = `800 28px ${fam}`; g.fillText('अभी / NOW', 96, 640);
    g.fillStyle = '#14213D'; g.font = `800 ${n.length > 8 ? 120 : 150}px ${fam}`; g.fillText(n, 90, 780);
    g.font = `400 38px ${fam}`; g.fillStyle = '#4B556B';
    g.fillText('लोग साथ खड़े हैं', 96, 850); g.fillText('people stand with this', 96, 900);
    g.fillStyle = '#14213D'; g.font = `400 34px ${fam}`;
    g.fillText('स्वतंत्र, निष्पक्ष और जवाबदेह', 96, 1010); g.fillText('चुनाव आयोग के लिए।', 96, 1056);
    g.fillStyle = '#4B556B'; g.font = `400 28px ${fam}`;
    g.fillText('For a free, fair and accountable', 96, 1104); g.fillText('Election Commission.', 96, 1140);
    g.fillStyle = '#14213D'; g.font = `800 46px ${fam}`; g.fillText(SITE.replace(/^https?:\/\//, ''), 96, 1250);
    g.fillStyle = '#8A8F9C'; g.font = `400 24px ${fam}`; g.fillText('NON-PARTISAN  •  NO NAME  •  NO DATA  •  NO TRACKING', 96, 1300);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }

  $('share-img').addEventListener('click', async () => {
    const blob = await drawCard();
    if (!blob) return;
    const file = new File([blob], 'janta-ka-mantar.png', { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: shareText() });
        return;
      }
    } catch { return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'janta-ka-mantar.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  // ---------- tapping the finger works like tapping the button ----------
  $('hero').addEventListener('click', () => btn.click());

  // ---------- start ----------
  if (store.get()) setDone(false); else solveAhead();
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
