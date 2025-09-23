// main.js — All-ages build with Levels, Lockpick mini-game, and safety guards
console.log('All-ages build — with guards — loaded');

document.addEventListener('DOMContentLoaded', () => {
  // ---------- Helpers ----------
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const on = (sel, ev, cb) => { const el = $(sel); if (el) el.addEventListener(ev, cb); return !!el; };
  const onAll = (sel, ev, cb) => { const els = $$(sel); els.forEach(el => el.addEventListener(ev, cb)); return els.length; };
  const byId = id => document.getElementById(id);
  const randBetween = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

  // ---------- Levels / Presets ----------
  const PRESETS = {
    kid: {
      timer: 240,
      penalties: { wrong: 4, time: 0.5, idle: 2, hint: 2, failPin: 2 },
      seqLen: [3, 4],
      freqTolBase: 75,
      mathRange: [0, 20],
      mathOps: ['+', '-'],
      tone: 'friendly',
      pins: 3,
      pinSpeed: [650, 900],   // ms per full up+down cycle
      pinZoneSize: [22, 28]   // px
    },
    standard: {
      timer: 180,
      penalties: { wrong: 10, time: 1, idle: 5, hint: 5, failPin: 4 },
      seqLen: [4, 5],
      freqTolBase: 60,
      mathRange: [0, 100],
      mathOps: ['+', '-', '*'],
      tone: 'neutral',
      pins: 3,
      pinSpeed: [500, 750],
      pinZoneSize: [16, 24]
    },
    expert: {
      timer: 120,
      penalties: { wrong: 15, time: 2, idle: 8, hint: 8, failPin: 6 },
      seqLen: [5, 6],
      freqTolBase: 50,
      mathRange: [0, 200],
      mathOps: ['+', '-', '*'],
      tone: 'intense',
      pins: 4,
      pinSpeed: [380, 560],
      pinZoneSize: [12, 18]
    }
  };

  let LEVEL = 'standard';
  let HINT_COST = PRESETS[LEVEL].penalties.hint;

  // ---------- Constants ----------
  const SYMBOLS = ["▲", "●", "◆", "■", "★", "✦"];

  // ---------- SFX (tiny placeholders to avoid external files) ----------
  const sfx = { ok: new Audio(), err: new Audio() };
  sfx.ok.src  = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYAAABkYXRhAAAAAA==";
  sfx.err.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYAAABkYXRhAAAAAA==";
  let muted = false;
  function setMuted(next) {
    muted = next;
    const btn = byId('btn-mute');
    if (btn) {
      btn.setAttribute('aria-pressed', String(muted));
      btn.textContent = muted ? 'Unmute SFX' : 'Mute SFX';
    }
  }

  // ---------- AI Config ----------
  const AI_CONFIG = {
    baseThreats: {
      wrongAnswer: PRESETS[LEVEL].penalties.wrong,
      timePenalty: PRESETS[LEVEL].penalties.time,
      idlePenalty: PRESETS[LEVEL].penalties.idle
    },
    scrambleThreshold: 70,
    panicThreshold: 85
  };

  // ---------- State ----------
  let state = {
    timerSeconds: PRESETS[LEVEL].timer,
    threat: 0,
    running: true,
    paused: false,
    tasks: { cracker: false, frequency: false, sequence: false },
    currentGame: 'choice',
    aiState: {
      failedAttempts: 0,
      lastActionTime: Date.now(),
      difficultyLevel: 1,
      scrambledInputs: false,
      sendingFakeClues: false
    },
    reducedMotion: false,
    colorblind: false
  };

  // ---------- Matrix Rain ----------
  const canvas = byId('matrix-bg');
  const ctx = canvas.getContext('2d');
  let fontSize = 14, drops = [];

  function resizeCanvas() {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    drops = Array(Math.ceil(canvas.width / fontSize)).fill(1);
  }

  function drawMatrix() {
    if (state.reducedMotion) return;
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0F0';
    ctx.font = fontSize + 'px monospace';
    for (let i = 0; i < drops.length; i++) {
      const t = String.fromCharCode(0x30A0 + Math.random() * 33);
      ctx.fillText(t, i * fontSize, drops[i] * fontSize);
      if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    }
  }

  // ---------- UI Helpers ----------
  function showScreen(id) {
    $$('.task-screen, .task-container').forEach(s => s.classList.add('hidden'));
    if (id === 'frequency' || id === 'sequence') byId('task-' + id)?.classList.remove('hidden');
    else byId('screen-' + id)?.classList.remove('hidden');
    state.currentGame = id;
  }

  function updateTimerDisplay() {
    const m = Math.floor(state.timerSeconds / 60), s = state.timerSeconds % 60;
    byId('timeLeft').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function play(type) {
    if (muted) return;
    const a = sfx[type];
    try { a.currentTime = 0; a.play(); } catch {}
  }

  function addToLog(msg, type = 'ok') {
    const log = byId('log'); if (!log) return;
    const t = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = `log-line ${type}`;
    div.innerHTML = `[<span>${t}</span>] ${msg}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function levelTone(kidText, normalText) {
    return PRESETS[LEVEL].tone === 'friendly' ? kidText : normalText;
  }

  // ---------- Threat / AI ----------
  function updateAIState(kind) {
    const now = Date.now();
    const elapsed = now - state.aiState.lastActionTime;

    if (kind === 'fail') {
      state.aiState.failedAttempts++;
      if (state.aiState.failedAttempts >= 3) {
        state.aiState.difficultyLevel = Math.min(3, state.aiState.difficultyLevel + 1);
      }
    }
    if (kind === 'success') {
      state.aiState.failedAttempts = Math.max(0, state.aiState.failedAttempts - 1);
    }
    if (kind === 'idle' && elapsed > 15000) {
      addToLog(levelTone('System noticed inactivity…', 'AI: Detected suspicious inactivity...'), 'warn');
      updateThreat(AI_CONFIG.baseThreats.idlePenalty);
    }

    if (state.threat >= AI_CONFIG.scrambleThreshold && !state.aiState.scrambledInputs) {
      state.aiState.scrambledInputs = true;
      addToLog(levelTone('UI might shuffle a bit!', 'AI: Implementing countermeasures...'), 'warn');
      scrambleUI();
    }
    if (state.threat >= AI_CONFIG.panicThreshold && !state.aiState.sendingFakeClues) {
      state.aiState.sendingFakeClues = true;
      addToLog(levelTone('Emergency mode!', 'AI: Emergency protocols activated!'), 'err');
      sendFakeClues();
    }

    state.aiState.lastActionTime = now;
  }

  function updateThreat(inc = 0) {
    const adj = inc * state.aiState.difficultyLevel;
    state.threat = Math.min(100, state.threat + adj);

    const bar = byId('threatBar'), val = byId('threatValue');
    if (bar && val) {
      bar.style.width = `${state.threat}%`;
      val.textContent = `${Math.round(state.threat)}%`;
      bar.parentElement?.setAttribute('aria-valuenow', Math.round(state.threat));
      if (state.threat < 40) bar.style.backgroundColor = 'var(--threat-low)';
      else if (state.threat < 70) bar.style.backgroundColor = 'var(--threat-med)';
      else bar.style.backgroundColor = 'var(--threat-high)';
    }

    updateAIState(inc > 0 ? 'fail' : 'success');
  }

  function scrambleUI() {
    $$('#game-container button:not(#restartBtn)').forEach((b, i, arr) => {
      b.style.order = Math.floor(Math.random() * arr.length);
    });
  }

  function sendFakeClues() {
    const kid = [
      'Tip: Try the pattern again 👀',
      'Hint: Slide a bit to the right ➡️',
      'Press “Show Sequence” again!'
    ];
    const std = [
      'NOTICE: Recalibrating defense matrix',
      'CAUTION: Initiating counter-intrusion protocols',
      'ALERT: Backup systems engaged'
    ];
    const pool = (LEVEL === 'kid') ? kid : std;

    const loop = () => {
      if (state.running && state.aiState.sendingFakeClues) {
        addToLog(pool[Math.floor(Math.random() * pool.length)], Math.random() > 0.5 ? 'warn' : 'info');
        setTimeout(loop, Math.random() * 5000 + 3000);
      }
    };
    loop();
  }

  function completeTask(taskKey) {
    state.tasks[taskKey] = true;
    document.querySelector(`[data-task="${taskKey}"]`)?.classList.add('done');
    updateObjectivesCounter();
    if (Object.values(state.tasks).every(x => x)) endGame(true);
  }

  function calculateScore() {
    let sc = 0;
    if (Object.values(state.tasks).every(x => x)) sc += 1000;
    sc += state.timerSeconds * 10;
    sc += Math.max(0, 1000 - (state.threat * 10));
    sc *= state.aiState.difficultyLevel;
    return Math.round(sc);
  }

  function endGame(won = false) {
    state.running = false;
    byId('overlay')?.classList.remove('hidden');
    const title = byId('overlayTitle'), msg = byId('overlayMsg');

    if (!title || !msg) return;

    if (won) {
      const score = calculateScore();
      title.textContent = levelTone('Round Complete! 🎉', 'MISSION ACCOMPLISHED');
      msg.textContent = `Final Score: ${score}\n` + levelTone('Great job! Ready for a tougher level?', 'System successfully breached!');
      play('ok');
      showWinExtras(score);
    } else {
      title.textContent = levelTone('Round Over — try again!', 'MISSION FAILED');
      const reason = state.timerSeconds <= 0
        ? levelTone('Time’s up!', 'Time ran out!')
        : levelTone('Alert reached max!', 'Security detected the intrusion!');
      msg.textContent = reason;
      play('err');
    }
  }

  function showWinExtras(finalScore) {
    const wrap = byId('winExtras'); if (!wrap) return;
    wrap.classList.remove('hidden');
    byId('lbDiff').textContent = `(${labelForDifficulty(LEVEL)})`;
    // Achievements
    const ach = [];
    if (state.timerSeconds > PRESETS[LEVEL].timer * 0.5) ach.push('Speedrunner');
    if (state.threat < 30) ach.push('Ghost (Low Alert)');
    if (state.aiState.failedAttempts === 0) ach.push('Flawless');
    if (!state.reducedMotion) ach.push('Style: Full FX');
    const list = byId('achievementsList'); if (list) { list.innerHTML = ach.map(a => `<li>• ${a}</li>`).join('') || '<li>• Nice Work</li>'; }
    // Leaderboard preview
    renderLeaderboardPreview(LEVEL);
    // Save and share handlers
    on('#saveScoreBtn', 'click', () => {
      const name = (byId('playerName')?.value || 'Anon').toString().slice(0, 16);
      saveScore(LEVEL, name, finalScore);
      renderLeaderboardPreview(LEVEL);
      addToLog(`Score saved: ${name} — ${finalScore}`, 'info');
    });
    on('#shareScoreBtn', 'click', async () => {
      const name = (byId('playerName')?.value || 'Anon').toString().slice(0, 16);
      const text = `CyberHeistAI — ${labelForDifficulty(LEVEL)}\n${name}: ${finalScore}\n`+
                   `Threat ${Math.round(state.threat)}% | Time ${byId('timeLeft')?.textContent}`;
      try { await navigator.clipboard.writeText(text); addToLog('Results copied to clipboard!', 'ok'); } catch {}
    });
  }

  function labelForDifficulty(val) {
    return val === 'kid' ? 'Rookie' : val === 'expert' ? 'Elite' : 'Operative';
  }

  function saveScore(diff, name, score) {
    const key = `ch_lb_${diff}`;
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    arr.push({ name, score });
    arr.sort((a,b) => b.score - a.score);
    const top = arr.slice(0, 10);
    localStorage.setItem(key, JSON.stringify(top));
  }

  function renderLeaderboardPreview(diff) {
    const key = `ch_lb_${diff}`;
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    const el = byId('leaderboardList'); if (!el) return;
    el.innerHTML = arr.map((r, i) => `<li>${i+1}. ${r.name} — ${r.score}</li>`).join('') || '<li>No scores yet.</li>';
  }

  function updateObjectivesCounter() {
    const total = Object.keys(state.tasks).length;
    const done = Object.values(state.tasks).filter(Boolean).length;
    const el = byId('objCounter');
    if (el) el.textContent = `${done}/${total}`;
  }

  // ---------- Math Game ----------
  function generateMathQuestion() {
    const P = PRESETS[LEVEL];
    const [min, max] = P.mathRange, ops = P.mathOps;
    const n1 = Math.floor(Math.random() * (max - min + 1)) + min;
    const n2 = Math.floor(Math.random() * (max - min + 1)) + min;
    const op = ops[Math.floor(Math.random() * ops.length)];
    const ans = (op === '+') ? n1 + n2 : (op === '-') ? n1 - n2 : n1 * n2;
    const qEl = byId('math-question');
    if (qEl) qEl.dataset.answer = String(ans);
    return `${n1} ${op} ${n2} = ?`;
  }

  function setupMathGame() {
    const q = byId('math-question'), input = byId('math-answer');
    if (!q || !input) return;

    const ask = () => { q.textContent = generateMathQuestion(); input.value = ''; input.focus(); };
    ask();

    on('#btn-submit-math', 'click', () => {
      if (input.value === q.dataset.answer) {
        addToLog(levelTone('Nice solving! ✅', 'Math hack successful!'));
        completeTask('cracker'); showScreen('choice'); play('ok');
      } else {
        updateThreat(PRESETS[LEVEL].penalties.wrong);
        addToLog(levelTone('Close! Try a new one 😊', 'Incorrect answer!'), 'err');
        play('err');
      }
    });

    on('#btn-new-problem', 'click', () => {
      updateThreat(HINT_COST);
      addToLog('Problem skipped. Alert +', 'warn');
      ask();
    });

    on('#btn-hint-math', 'click', () => {
      updateThreat(HINT_COST);
      const ans = Number(q.dataset.answer);
      addToLog(`HINT: ≈ ${Math.max(0, ans - 3)}–${ans + 3}`, 'info');
    });
  }

  // ---------- Lockpick Mini-game ----------
  // 3–4 vertical tracks; each has a green zone at random position; a marker moves up/down.
  // Player hits SET PIN; if marker is inside the zone, the pin sets. Set all to complete.
  let lockpick = null;

  function setupLockpickGame() {
    const P = PRESETS[LEVEL];
    const container = byId('lockpickPins'), status = byId('lockpickStatus');
    if (!container) return;

    container.innerHTML = ''; if (status) status.textContent = '';

    const pins = [];
    const height = 130; // px, track height
    let activeIndex = 0;

    for (let i = 0; i < P.pins; i++) {
      const pin = document.createElement('div'); pin.className = 'pin';
      const track = document.createElement('div'); track.className = 'track';
      const marker = document.createElement('div'); marker.className = 'marker';
      const zone = document.createElement('div'); zone.className = 'zone';
      const label = document.createElement('div'); label.className = 'label'; label.textContent = `PIN ${i + 1}`;

      const zoneSize = randBetween(P.pinZoneSize[0], P.pinZoneSize[1]);
      const zoneTop = randBetween(10, height - zoneSize - 10);
      zone.style.height = zoneSize + 'px'; zone.style.top = zoneTop + 'px';

      const speed = randBetween(P.pinSpeed[0], P.pinSpeed[1]);
      let dir = 1, y = height - 4;
      marker.style.bottom = '0px';

      track.appendChild(marker); track.appendChild(zone);
      pin.appendChild(track); pin.appendChild(label);
      container.appendChild(pin);

      pins.push({ pin, marker, zoneTop, zoneSize, speed, dir, y, set: false });
    }

    let last = performance.now();
    function tick(now) {
      if (!lockpick || !state.running || state.currentGame !== 'lockpick') return;
      const dt = now - last; last = now;
      pins.forEach(p => {
        if (p.set) return;
        // move marker up/down between 0 and height
        const perMs = (height * 2) / p.speed; // px per ms (down+up cycle)
        p.y -= p.dir * perMs * dt;            // y from top
        if (p.y <= 0) { p.y = 0; p.dir = -1; }
        if (p.y >= height) { p.y = height; p.dir = 1; }
        p.marker.style.top = `${p.y}px`;
      });
      lockpick.raf = requestAnimationFrame(tick);
    }

    function inZone(p) {
      const top = p.y, bottom = p.y + 8;
      return bottom >= p.zoneTop && top <= (p.zoneTop + p.zoneSize);
    }

    on('#btn-set-pin', 'click', () => {
      const p = pins[activeIndex]; if (!p || p.set) return;
      if (inZone(p)) {
        p.set = true;
        p.pin.classList.add('set');
        addToLog(levelTone(`Pin ${activeIndex + 1} set! ✅`, `PIN ${activeIndex + 1} set.`));
        const next = pins.findIndex(x => !x.set);
        if (next === -1) {
          addToLog(levelTone('Lock opened! 🔓', 'Lock bypassed.'));
          completeTask('cracker'); showScreen('choice'); play('ok');
          cancelAnimationFrame(lockpick.raf); lockpick = null;
          return;
        }
        activeIndex = next;
      } else {
        updateThreat(P.penalties.failPin);
        addToLog(levelTone('Missed the zone — try again 😊', 'Pin failed! Zone missed.'), 'warn');
        play('err');
      }
    });

    lockpick = { raf: requestAnimationFrame(tick) };
  }

  // ---------- Frequency Lock ----------
  let freqTarget = 0, freqTolerance = 50;

  function setupFrequencyGame() {
    const slider = byId('freqSlider'), P = PRESETS[LEVEL];
    if (!slider) return;

    freqTarget = Math.floor(Math.random() * 1000);
    freqTolerance = Math.max(15, P.freqTolBase - state.aiState.difficultyLevel * 5);

    byId('freqTarget').textContent = String(freqTarget);
    byId('freqTol').textContent = '±' + Math.round(freqTolerance);
    byId('freqCurrent').textContent = slider.value;
    byId('freqStatus').textContent = '';

    slider.oninput = () => { byId('freqCurrent').textContent = slider.value; };

    on('#freqLockBtn', 'click', () => {
      const current = parseInt(slider.value, 10);
      if (Math.abs(current - freqTarget) <= freqTolerance) {
        addToLog(levelTone('Nice tune! 🔓', 'Frequency bypass successful!'));
        completeTask('frequency'); showScreen('choice'); play('ok');
      } else {
        updateThreat(P.penalties.wrong);
        addToLog(levelTone('Close — adjust a little more!', 'Frequency lock failed!'), 'err');
        byId('freqStatus').textContent = 'Missed window — adjust and try again.';
        play('err');
      }
    });

    on('#btn-hint-freq', 'click', () => {
      updateThreat(HINT_COST);
      addToLog(`HINT: ${currentHintForFrequency()}`, 'info');
    });
  }

  function currentHintForFrequency() {
    const slider = byId('freqSlider'); if (!slider) return '';
    const current = parseInt(slider.value, 10);
    if (current < freqTarget - freqTolerance) return 'Increase the frequency (right).';
    if (current > freqTarget + freqTolerance) return 'Decrease the frequency (left).';
    return 'You are within range — lock it!';
  }

  // ---------- Sequence Decoder ----------
  function setupSequenceGame() {
    const P = PRESETS[LEVEL];
    const wrap = byId('symbols'); if (!wrap) return;

    let sequence = [], player = [], canClick = false;

    wrap.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const sym = document.createElement('div');
      sym.className = 'sym';
      sym.textContent = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
      sym.tabIndex = 0;

      const record = () => {
        if (!canClick) return;
        player.push(i);
        sym.classList.add('flash');
        setTimeout(() => sym.classList.remove('flash'), 200);

        if (player.length === sequence.length) {
          if (player.every((v, idx) => v === sequence[idx])) {
            addToLog(levelTone('Pattern matched! 🔓', 'Sequence decoded!'));
            completeTask('sequence'); showScreen('choice'); play('ok');
          } else {
            updateThreat(P.penalties.wrong);
            addToLog(levelTone('Not quite — watch again!', 'Wrong sequence!'), 'err');
            player = []; play('err');
          }
        }
      };

      sym.onclick = record;
      sym.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); record(); } };
      wrap.appendChild(sym);
    }

    const [minL, maxL] = P.seqLen;
    const len = Math.floor(Math.random() * (maxL - minL + 1)) + minL;
    for (let i = 0; i < len; i++) sequence.push(Math.floor(Math.random() * 9));

    on('#showSeqBtn', 'click', () => {
      canClick = false; player = [];
      let i = 0;
      const show = () => {
        if (i < len) {
          const s = wrap.children[sequence[i]];
          s.classList.add('flash');
          setTimeout(() => { s.classList.remove('flash'); i++; setTimeout(show, 250); }, 450);
        } else { canClick = true; }
      };
      show();
    });

    on('#btn-hint-seq', 'click', () => {
      updateThreat(HINT_COST);
      addToLog('HINT: Re-watch the pattern. Pace is steady.', 'info');
    });
  }

  // ---------- Events ----------
  on('#btn-lockpick', 'click', () => { showScreen('lockpick'); setupLockpickGame(); });
  on('#btn-math', 'click', () => { showScreen('math'); setupMathGame(); });

  // Back buttons
  onAll('[data-nav="choice"]', 'click', () => {
    showScreen('choice');
    if (lockpick?.raf) cancelAnimationFrame(lockpick.raf);
    lockpick = null;
  });

  // Objectives (make them open the right screens)
  onAll('[data-task="cracker"]', 'click', () => showScreen('choice'));
  onAll('[data-task="frequency"]', 'click', () => { showScreen('frequency'); setupFrequencyGame(); });
  onAll('[data-task="sequence"]', 'click', () => { showScreen('sequence'); setupSequenceGame(); });

  // Stabilize / Restart
  on('#stabilizeBtn', 'click', () => {
    if (state.threat > 0) {
      state.threat = Math.max(0, state.threat - 10);
      updateThreat();
      addToLog(levelTone('Stabilized! 🔧', 'Signal stabilized. Threat reduced.'), 'ok');
      play('ok');
    }
  });
  on('#restartBtn', 'click', () => location.reload());


  // Settings (guards so nothing breaks if missing)
  // Removed in-HUD difficulty selector; difficulty lives in main menu settings
  // ----- Main Menu -----
 on('#btn-start', 'click', () => {
  const stored = localStorage.getItem('ch_difficulty');
  const menuLevel = byId('menu-level')?.value || stored || 'standard';
  LEVEL = menuLevel;
  HINT_COST = PRESETS[LEVEL].penalties.hint;
  localStorage.setItem('ch_difficulty', LEVEL);

  byId('main-menu')?.classList.add('hidden');
  byId('game-container')?.classList.remove('hidden');
  init();
});

 // Settings open/close in main menu
 on('#btn-settings', 'click', () => {
  const current = byId('menu-level')?.value || localStorage.getItem('ch_difficulty') || 'standard';
  const sel = byId('menu-level-settings'); if (sel) sel.value = current;
  $$('#main-menu .menu-content').forEach(el => el.classList.add('hidden'));
  byId('menu-settings')?.classList.remove('hidden');
});

 // Live apply and store when changing difficulty in Settings
 on('#menu-level-settings', 'change', e => {
   const chosen = e.target.value;
   if (['kid','standard','expert'].includes(chosen)) {
     localStorage.setItem('ch_difficulty', chosen);
   }
 });

 on('#btn-settings-back', 'click', () => {
  const sel = byId('menu-level-settings');
  if (sel) {
    const chosen = sel.value;
    localStorage.setItem('ch_difficulty', chosen);
  }
  $$('#main-menu .menu-content').forEach(el => el.classList.add('hidden'));
  // Show the first menu-content (main)
  const main = $$('#main-menu .menu-content')[0]; if (main) main.classList.remove('hidden');
});


  on('#btn-howto', 'click', () => {
    byId('tutorialDialog')?.showModal();
  });
  on('#btn-leaderboard', 'click', () => {
    populateLeaderboardDialog();
    byId('leaderboardDialog')?.showModal();
  });
  on('#leaderboardClose', 'click', () => byId('leaderboardDialog')?.close());
  
on('#btn-tutorial', 'click', () => {
  state.paused = true;                  // pause timer
  byId('tutorialDialog')?.showModal();
});

on('#tutorialClose', 'click', () => {
  state.paused = false;                 // resume timer
  byId('tutorialDialog')?.close();
});

  // Mute toggle
  on('#btn-mute', 'click', () => setMuted(!muted));

  on('#rmToggle', 'change', e => {
    state.reducedMotion = e.target.checked;
    canvas.style.display = state.reducedMotion ? 'none' : 'block';
  });

  on('#cbToggle', 'change', e => {
    state.colorblind = e.target.checked;
    document.documentElement.classList.toggle('cb-mode', state.colorblind);
  });

  // Next button: shift focus from objectives to right panel
  on('#btn-next-focus', 'click', () => {
    const obj = byId('panel-objectives'); const right = byId('panel-right');
    if (!obj || !right) return;
    obj.classList.add('zoom-out'); obj.classList.remove('zoom-in');
    right.classList.add('zoom-in'); right.classList.remove('zoom-out');
  });

  // ---------- Init ----------
  function init() {
    resizeCanvas(); addEventListener('resize', resizeCanvas);
    setInterval(drawMatrix, 33);

    // Apply stored difficulty into settings select if any
    const stored = localStorage.getItem('ch_difficulty');
    if (stored && byId('menu-level')) byId('menu-level').value = stored;

    const loop = setInterval(() => {
  if (!state.running || state.paused) return; // << check pause
  state.timerSeconds--;
  updateTimerDisplay();
  if (state.timerSeconds % 10 === 0) updateThreat(AI_CONFIG.baseThreats.timePenalty);
  updateAIState('idle');
  if (state.timerSeconds <= 0 || state.threat >= 100) {
    endGame(false); clearInterval(loop);
  }
}, 1000);


    updateTimerDisplay();
    updateThreat(0);
    addToLog('System breach initiated...', 'info');
    addToLog('OBJECTIVES: 1) Access Token (Lockpick/Math)  2) Frequency  3) Sequence', 'info');
    addToLog('Tips: STABILIZE to reduce alert; hints/skip increase alert a bit.', 'info');
    showScreen('choice');
    updateObjectivesCounter();

    // Initial zoom focus on objectives
    const obj = byId('panel-objectives'); const right = byId('panel-right');
    if (obj && right) {
      obj.classList.add('zoom-in'); right.classList.add('zoom-out');
    }
  }

  function populateLeaderboardDialog() {
    const diffs = ['kid', 'standard', 'expert'];
    diffs.forEach(d => {
      const key = `ch_lb_${d}`;
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      const el = byId(`lb-${d}`); if (!el) return;
      el.innerHTML = arr.map((r, i) => `<li>${i+1}. ${r.name} — ${r.score}</li>`).join('') || '<li>No scores yet.</li>';
    });
  }
});
// test change for CodeRabbit
if (true) { console.log("debugging line"); }
