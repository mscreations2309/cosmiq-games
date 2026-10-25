/* Quiz Show — Jeopardy-style board with physical-looking team buzzers. */
(function () {
  'use strict';

  const BUILTIN = window.QUIZ_SETS || [];
  const VALUES = [100, 200, 300, 400, 500];
  const QUESTION_TIME = 20;
  const BUZZ_WINDOW_MS = 40; // presses landing within this window are compared by timestamp
  const PALETTE = ['#e53935', '#1e7be0', '#2e9e48', '#f2b705', '#8e44ad', '#f57c1f', '#e8508f', '#11a3a3'];
  const DEFAULT_TEAMS = [
    { name: 'Red Team', color: '#e53935' }, { name: 'Blue Team', color: '#1e7be0' },
    { name: 'Green Team', color: '#2e9e48' }, { name: 'Yellow Team', color: '#f2b705' },
  ];
  const LS = { progress: 'qz-progress', custom: 'qz-custom-sets', teams: 'qz-teams', set: 'qz-set' };

  // ---------------------------------------------------------------- helpers
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') {
          for (const [sk, sv] of Object.entries(v)) {
            if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
          }
        } else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'text') el.textContent = v;
        else if (k in el) el[k] = v;
        else el.setAttribute(k, v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (_) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { IFPD.toast('Could not save (storage full?)'); } };
  const clone = o => JSON.parse(JSON.stringify(o));
  const rgba = (hex, a) => {
    const v = parseInt(hex.slice(1, 7), 16);
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
  };
  const sfx = (n, o) => IFPD.sfx.play(n, o);
  const kbd = k => h('kbd', { class: 'qz-kbd', text: k }); // key hint, shown in keyboard mode only
  function teamVars(color) {
    return {
      '--c': color, '--cl': IFPD.draw.shade(color, 0.55), '--cd': IFPD.draw.shade(color, -0.35), '--cdd': IFPD.draw.shade(color, -0.65),
      '--ca1': rgba(color, 0.1), '--ca3': rgba(color, 0.32), '--ca6': rgba(color, 0.65),
    };
  }

  // ---------------------------------------------------------------- question sets
  function validSet(s) {
    return !!s && typeof s.name === 'string' && Array.isArray(s.categories) && s.categories.length === 5 &&
      s.categories.every(c => c && typeof c.name === 'string' && Array.isArray(c.questions) && c.questions.length === 5 &&
        c.questions.every(q => q && typeof q.q === 'string' && typeof q.a === 'string'));
  }
  const customSets = () => load(LS.custom, []).filter(validSet);
  const allSets = () => BUILTIN.concat(customSets());
  const findSet = id => allSets().find(s => s.id === id) || null;
  const isBuiltin = id => BUILTIN.some(s => s.id === id);

  // Accepts our own export format and a few common variants.
  function normalizeImport(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('not a question set');
    const cats = obj.categories || obj.board || obj.columns;
    if (!Array.isArray(cats) || cats.length < 5) throw new Error('it needs 5 categories');
    const out = { name: String(obj.name || obj.title || 'Imported set').slice(0, 60), categories: [] };
    for (const c of cats.slice(0, 5)) {
      const qs = c && (c.questions || c.clues);
      if (!Array.isArray(qs) || qs.length < 5) throw new Error('each category needs 5 questions');
      out.categories.push({
        name: String(c.name || c.title || c.category || '').slice(0, 40),
        questions: qs.slice(0, 5).map(q => ({ q: String((q && (q.q ?? q.question ?? q.clue)) ?? ''), a: String((q && (q.a ?? q.answer)) ?? '') })),
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- state
  const S = {
    screen: 'setup',
    teams: load(LS.teams, null) || clone(DEFAULT_TEAMS.slice(0, 3)),
    setId: load(LS.set, 'general'),
    set: null,          // snapshot of the set being played
    used: new Array(25).fill(false),
    q: null,            // { c, r, phase: opening|open|answering|revealed, time, locked:[], answering, result }
    editing: null,
    finished: false,
  };
  S.teams = S.teams.filter(t => t && typeof t.name === 'string' && /^#[0-9a-f]{6}$/i.test(t.color)).slice(0, 4);
  if (S.teams.length < 2) S.teams = clone(DEFAULT_TEAMS.slice(0, 2));
  if (!findSet(S.setId)) S.setId = 'general';

  function saveProgress() {
    if (!S.set || S.finished) { localStorage.removeItem(LS.progress); return; }
    const q = S.q ? Object.assign({}, S.q, { phase: S.q.phase === 'opening' ? 'open' : S.q.phase }) : null;
    store(LS.progress, { v: 1, teams: S.teams, setId: S.setId, set: S.set, used: S.used, q, savedAt: Date.now() });
  }
  function savedProgress() {
    const p = load(LS.progress, null);
    if (!p || !validSet(p.set) || !Array.isArray(p.teams) || p.teams.length < 2 || !Array.isArray(p.used) || p.used.length !== 25) return null;
    return p;
  }

  // ---------------------------------------------------------------- page chrome
  const page = IFPD.setupPage({ title: 'Quiz Show', onRestart: () => confirmRestart() });
  const stage = page.stage;
  const app = document.getElementById('app');
  const setupBtn = h('button', { class: 'ifpd-btn', text: '⚙ Teams & Sets', onclick: () => { sfx('click'); showSetup(); } });
  const editBtn = h('button', { class: 'ifpd-btn', text: '✎ Questions', onclick: () => { sfx('click'); openEditor(S.screen === 'game' && S.set ? S.setId : S.setId); } });
  page.extra.append(setupBtn, editBtn);

  function setScreen(el, name) {
    closePopover();
    app.textContent = '';
    app.append(el);
    S.screen = name;
    setupBtn.hidden = name === 'setup';
    if (name !== 'game') keyHelp();
  }

  // ---------------------------------------------------------------- setup screen
  function showSetup() {
    IFPD.overlay.hide();
    if (S.q && S.screen === 'game') saveProgress();
    const scr = h('div', { class: 'qz-screen qz-scroll qz-setup', 'data-keyboard-menu': '' });
    const inner = h('div', { class: 'qz-setup-inner' });
    scr.append(inner);
    inner.append(h('div', { class: 'qz-logo' }, 'QUIZ SHOW', h('small', { text: 'Pick a tile · buzz in first · answer to score' })));

    const prog = savedProgress();
    if (prog) {
      const left = prog.used.filter(u => !u).length;
      inner.append(h('div', { class: 'qz-resume' },
        h('span', null, '⏸ Game in progress — ', h('b', { text: prog.teams.map(t => `${t.name} ${t.score}`).join(' · ') }), ` — ${left} of 25 questions left`),
        h('button', { class: 'ifpd-btn good', text: '▶ Resume', onclick: () => { sfx('tap'); resumeGame(prog); } }),
        h('button', { class: 'ifpd-btn', text: '✕ Discard', onclick: () => { sfx('click'); localStorage.removeItem(LS.progress); S.set = null; showSetup(); } })));
    }

    const cols = h('div', { class: 'qz-cols' });
    inner.append(cols);

    // teams
    const teamPanel = h('div', { class: 'qz-panel' }, h('h3', { text: 'Teams' }));
    const teamList = h('div');
    teamPanel.append(teamList);
    const addBtn = h('button', { class: 'ifpd-btn', text: '＋ Add team', onclick: () => {
      if (S.teams.length >= 4) return;
      const free = DEFAULT_TEAMS.find(d => !S.teams.some(t => t.color === d.color)) || DEFAULT_TEAMS[S.teams.length];
      S.teams.push({ name: free.name, color: free.color });
      sfx('pop'); drawTeams();
    } });
    teamPanel.append(h('div', { class: 'qz-row-btns' }, addBtn));
    function drawTeams() {
      teamList.textContent = '';
      S.teams.forEach((t, i) => {
        const row = h('div', { class: 'qz-team-row' });
        row.append(h('div', { class: 'badge', style: { background: t.color }, text: String(i + 1) }));
        row.append(h('input', { class: 'qz-input', value: t.name, maxLength: 18, placeholder: `Team ${i + 1}`, oninput: e => { t.name = e.target.value; store(LS.teams, S.teams); } }));
        const sw = h('div', { class: 'qz-swatches' });
        for (const c of PALETTE) {
          sw.append(h('button', {
            class: 'qz-swatch' + (t.color === c ? ' on' : ''), style: { background: c }, title: c,
            onclick: () => {
              const other = S.teams.find(o => o !== t && o.color === c);
              if (other) other.color = t.color; // swap so colours stay unique
              t.color = c; sfx('click'); store(LS.teams, S.teams); drawTeams();
            },
          }));
        }
        row.append(sw);
        if (S.teams.length > 2) row.append(h('button', { class: 'ifpd-btn qz-x', text: '✕', title: 'Remove team', onclick: () => { S.teams.splice(i, 1); sfx('click'); store(LS.teams, S.teams); drawTeams(); } }));
        teamList.append(row);
      });
      addBtn.hidden = S.teams.length >= 4;
      store(LS.teams, S.teams);
    }
    drawTeams();
    cols.append(teamPanel);

    // question sets
    const setPanel = h('div', { class: 'qz-panel' }, h('h3', { text: 'Question set' }));
    const sets = h('div', { class: 'qz-sets' });
    for (const s of allSets()) {
      const card = h('div', { class: 'qz-set' + (s.id === S.setId ? ' on' : ''), onclick: () => { S.setId = s.id; store(LS.set, s.id); sfx('click'); sets.querySelectorAll('.qz-set').forEach(x => x.classList.toggle('on', x === card)); } },
        h('button', { class: 'qz-set-pick', title: 'Use this set' }, // a real button so Tab / arrows / Enter reach it
          h('div', { class: 'radio' }),
          h('div', { class: 'meta' }, h('b', null, s.name, isBuiltin(s.id) ? null : h('span', { class: 'tag', text: 'custom' })), h('span', { text: s.categories.map(c => c.name).join(' · ') }))),
        h('button', { class: 'ifpd-btn', text: '✎ Edit', onclick: e => { e.stopPropagation(); sfx('click'); openEditor(s.id); } }));
      sets.append(card);
    }
    setPanel.append(sets);
    setPanel.append(h('div', { class: 'qz-row-btns' },
      h('button', { class: 'ifpd-btn', text: '＋ New set', onclick: () => { sfx('click'); openEditor(null); } }),
      h('button', { class: 'ifpd-btn', text: '⤒ Import JSON', onclick: () => { sfx('click'); importFile(); } })));
    setPanel.append(h('p', { class: 'qz-hint', text: 'Edit a set to change categories, questions and answers. Custom sets are saved on this panel.' }));
    const right = h('div', { class: 'qz-right' }, setPanel);
    cols.append(right);

    const startBtn = h('button', { class: 'ifpd-btn primary qz-start', text: prog ? '▶ Start NEW game' : '▶ Start game', onclick: () => { sfx('tap'); startGame(); } });
    right.append(startBtn);
    setScreen(scr, 'setup');
    focusStart();
  }
  function focusStart() { // keyboard mode: the setup screen opens on its main button
    if (!kbMode() || S.screen !== 'setup') return;
    const b = app.querySelector('.qz-resume .good') || app.querySelector('.qz-start');
    if (b) b.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- game
  let ui = null; // references into the game screen

  function startGame() {
    const set = findSet(S.setId) || BUILTIN[0];
    S.setId = set.id;
    S.set = clone({ id: set.id, name: set.name, categories: set.categories });
    S.teams = S.teams.map((t, i) => ({ name: (t.name || '').trim() || `Team ${i + 1}`, color: t.color, score: 0 }));
    store(LS.teams, S.teams.map(t => ({ name: t.name, color: t.color })));
    S.used = new Array(25).fill(false);
    S.q = null;
    S.finished = false;
    saveProgress();
    buildGame();
    sfx('whoosh');
  }

  function resumeGame(p) {
    S.teams = p.teams.map(t => ({ name: String(t.name), color: t.color, score: Number(t.score) || 0 }));
    S.setId = p.setId;
    S.set = p.set;
    S.used = p.used.map(Boolean);
    S.finished = false;
    S.q = null;
    buildGame();
    if (p.q && !S.used[p.q.c * 5 + p.q.r]) {
      S.q = Object.assign({ locked: [], answering: -1, result: null, time: QUESTION_TIME }, p.q);
      showQuestionCard(false);
    }
    IFPD.toast('Game resumed');
  }

  function buildGame() {
    IFPD.overlay.hide();
    const scr = h('div', { class: 'qz-screen qz-game' });
    const wrap = h('div', { class: 'qz-board-wrap' });
    const board = h('div', { class: 'qz-board' });
    const tiles = [];
    S.set.categories.forEach(c => board.append(h('div', { class: 'qz-cat', text: c.name })));
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const t = h('button', { class: 'qz-tile', text: String(VALUES[r]), onclick: () => { if (!S.q) { kb.c = c; kb.r = r; } openTile(c, r); } });
        tiles[c * 5 + r] = t;
        board.append(t);
      }
    }
    wrap.append(board);
    const strip = h('div', { class: 'qz-teams' });
    const teams = S.teams.map((t, i) => {
      const buzzer = h('div', { class: 'qz-buzzer off' }, h('div', { class: 'base' }), h('div', { class: 'rim' }), h('div', { class: 'dome' }), h('span', { class: 'lbl', text: 'BUZZ' }), kbd(String(i + 1)));
      const score = h('button', { class: 'qz-score', onclick: e => { e.stopPropagation(); openPopover(i); } });
      const state = h('div', { class: 'state' });
      const zone = h('div', { class: 'qz-team', style: teamVars(t.color) }, buzzer, h('div', { class: 'info' }, h('div', { class: 'name', text: t.name }), score, state));
      // Buzzers react on pointerdown (not click) for the lowest latency; every finger is independent.
      buzzer.addEventListener('pointerdown', e => {
        if (IFPD.isPalm(e)) return;
        e.preventDefault();
        buzzer.classList.add('down');
        try { buzzer.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ }
        pressBuzzer(i, e.timeStamp);
      });
      const release = () => buzzer.classList.remove('down');
      buzzer.addEventListener('pointerup', release);
      buzzer.addEventListener('pointercancel', release);
      buzzer.addEventListener('lostpointercapture', release);
      strip.append(zone);
      return { zone, buzzer, score, state, lbl: buzzer.querySelector('.lbl') };
    });
    scr.append(wrap, strip);
    ui = { scr, wrap, board, tiles, strip, teams, card: null };
    kb.shown = kbMode();
    setScreen(scr, 'game');
    sizeBuzzers();
    refresh();
  }

  function sizeBuzzers() {
    if (!ui || S.screen !== 'game') return;
    const r = ui.strip.getBoundingClientRect();
    const per = (r.width - 36) / S.teams.length;
    const bz = Math.max(70, Math.min(r.height - 30, per * 0.4, 220));
    const info = per - bz - 40; // room left for name + score
    ui.strip.style.setProperty('--bz', Math.round(bz) + 'px');
    ui.strip.style.setProperty('--sfs', Math.round(Math.max(26, Math.min(r.height * 0.3, info * 0.3, 66))) + 'px');
    ui.strip.style.setProperty('--nfs', Math.round(Math.max(17, Math.min(r.height * 0.15, info * 0.16, 32))) + 'px');
  }
  new ResizeObserver(() => sizeBuzzers()).observe(stage);

  // Sync every piece of the game screen with state.
  function refresh() {
    if (!ui || S.screen !== 'game') return;
    const q = S.q;
    S.used.forEach((u, i) => ui.tiles[i].classList.toggle('used', u || (!!q && i === q.c * 5 + q.r)));
    ui.tiles.forEach((t, i) => t.classList.toggle('qz-kbsel', kb.shown && !q && i === kb.c * 5 + kb.r));
    S.teams.forEach((t, i) => {
      const T = ui.teams[i];
      T.score.textContent = String(t.score);
      T.score.classList.toggle('neg', t.score < 0);
      const locked = q && q.locked.includes(i);
      const canBuzz = q && q.phase === 'open' && !locked;
      const answering = q && q.phase === 'answering' && q.answering === i;
      T.buzzer.classList.toggle('off', !canBuzz && !answering);
      T.buzzer.classList.toggle('lit', !!answering);
      T.zone.classList.toggle('answering', !!answering);
      T.zone.classList.toggle('out', !!locked);
      T.lbl.textContent = locked ? '✗' : 'BUZZ';
      T.state.textContent = !q ? '' : answering ? '🎤 Answering…' : locked ? 'Locked out' : q.phase === 'open' ? 'Ready to buzz!' : '';
    });
    renderCard();
    keyHelp();
  }

  // ---------------------------------------------------------------- question flow
  function openTile(c, r) {
    if (S.q || S.used[c * 5 + r] || S.screen !== 'game') return;
    S.q = { c, r, phase: 'opening', time: QUESTION_TIME, locked: [], answering: -1, result: null };
    sfx('flip');
    sfx('whoosh', { pitch: 1.3 });
    saveProgress();
    const tile = ui.tiles[c * 5 + r];
    const wr = ui.wrap.getBoundingClientRect(), tr = tile.getBoundingClientRect();
    const fly = h('div', { class: 'qz-fly', text: String(VALUES[r]) });
    const from = { left: tr.left - wr.left + 'px', top: tr.top - wr.top + 'px', width: tr.width + 'px', height: tr.height + 'px', transform: 'rotateY(0deg)', fontSize: getComputedStyle(tile).fontSize };
    const to = { left: '18px', top: '14px', width: wr.width - 36 + 'px', height: wr.height - 24 + 'px', transform: 'rotateY(180deg)', fontSize: '140px' };
    Object.assign(fly.style, from);
    ui.wrap.append(fly);
    tile.classList.add('used');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      fly.remove();
      if (!S.q || S.q.phase !== 'opening') return;
      S.q.phase = 'open';
      showQuestionCard(true);
    };
    if (fly.animate) {
      const anim = fly.animate([from, { ...to, transform: 'rotateY(90deg)', offset: 0.5 }, { ...to, transform: 'rotateY(0deg)' }], { duration: 650, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' });
      anim.onfinish = finish;
    }
    setTimeout(finish, 900); // safety net
  }

  function showQuestionCard(fresh) {
    if (!ui) return;
    if (ui.card) ui.card.remove();
    const q = S.q, cat = S.set.categories[q.c], item = cat.questions[q.r];
    const C = 2 * Math.PI * 52;
    const ring = h('div', { class: 'qz-ring' });
    ring.innerHTML = `<svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="52" fill="none" stroke-width="11"/><circle class="fg" cx="60" cy="60" r="52" fill="none" stroke-width="11" stroke-linecap="round" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="0"/></svg><div class="num"></div>`;
    const card = h('div', { class: 'qz-qcard' },
      h('div', { class: 'qz-qhead' }, h('div', { class: 'qz-qcat', text: `${cat.name} · ${VALUES[q.r]}` }), ring),
      h('div', { class: 'qz-qtext', text: item.q }),
      h('div', { class: 'qz-answer', hidden: true }),
      h('div', { class: 'qz-status' }),
      h('div', { class: 'qz-controls' }));
    ui.wrap.append(card);
    ui.card = card;
    ui.ring = { el: ring, fg: ring.querySelector('.fg'), num: ring.querySelector('.num'), C, shown: '' };
    fitQuestion();
    if (fresh) sfx('ding', { volume: 0.6 });
    refresh();
  }

  function fitQuestion() {
    if (!ui || !ui.card) return;
    const el = ui.card.querySelector('.qz-qtext');
    const r = ui.wrap.getBoundingClientRect();
    const len = el.textContent.length;
    const base = Math.min(r.width * 0.05, r.height * 0.1);
    el.style.fontSize = Math.round(Math.max(26, base * (len > 110 ? 0.72 : len > 70 ? 0.85 : 1))) + 'px';
    const ans = ui.card.querySelector('.qz-answer');
    ans.style.fontSize = Math.round(Math.max(26, base * 0.95)) + 'px';
  }
  new ResizeObserver(() => fitQuestion()).observe(stage);

  function renderCard() {
    if (!ui || !ui.card || !S.q) return;
    const q = S.q, card = ui.card, item = S.set.categories[q.c].questions[q.r], val = VALUES[q.r];
    const status = card.querySelector('.qz-status'), ctl = card.querySelector('.qz-controls'), ans = card.querySelector('.qz-answer');
    status.textContent = '';
    ctl.textContent = '';
    card.style.removeProperty('--qc');
    card.style.removeProperty('--qg');
    const chip = i => h('span', { class: 'qz-chip', style: { background: S.teams[i].color, '--c': S.teams[i].color }, text: S.teams[i].name });
    if (q.phase === 'open' || q.phase === 'opening') {
      const n = q.locked.length;
      status.append(n ? `✗ Wrong! ${S.teams.length - n} team${S.teams.length - n > 1 ? 's' : ''} can still buzz…` : '🔔 Buzz in to answer!');
      ctl.append(h('button', { class: 'ifpd-btn', onclick: () => reveal('skip') }, '👁 Reveal answer', kbd('R')));
    } else if (q.phase === 'answering') {
      const t = S.teams[q.answering];
      card.style.setProperty('--qc', t.color);
      card.style.setProperty('--qg', rgba(t.color, 0.8));
      status.append(chip(q.answering), ' is answering!');
      ctl.append(
        h('button', { class: 'ifpd-btn good', onclick: () => judge(true) }, `✓ Correct  +${val}`, kbd('C')),
        h('button', { class: 'ifpd-btn bad', onclick: () => judge(false) }, `✗ Wrong  −${val}`, kbd('X')));
    } else if (q.phase === 'revealed') {
      const res = q.result || {};
      if (res.team != null) {
        card.style.setProperty('--qc', S.teams[res.team].color);
        status.append('✓ ', chip(res.team), ` scores +${val}!`);
      } else if (res.reason === 'timeout') status.append('⏰ Time\'s up!');
      else if (res.reason === 'allwrong') status.append('Nobody got it this time.');
      else status.append('Answer revealed');
      ctl.append(h('button', { class: 'ifpd-btn primary', onclick: () => backToBoard() }, '↩ Back to board', kbd('B')));
    }
    ans.hidden = q.phase !== 'revealed';
    if (!ans.hidden && !ans.textContent) ans.append(h('small', { text: 'Answer' }), item.a);
    updateRing(true);
  }

  function updateRing(force) {
    if (!ui || !ui.ring || !S.q) return;
    const q = S.q, R = ui.ring;
    const t = Math.max(0, q.time);
    const label = q.phase === 'answering' ? '⏸' : String(Math.ceil(t));
    if (!force && label === R.shown && q.phase !== 'open') return;
    R.fg.setAttribute('stroke-dashoffset', (R.C * (1 - t / QUESTION_TIME)).toFixed(2));
    if (label !== R.shown) { R.num.textContent = label; R.shown = label; }
    R.el.classList.toggle('warn', t <= 10 && t > 5);
    R.el.classList.toggle('danger', t <= 5);
    R.el.classList.toggle('paused', q.phase === 'answering');
  }

  let pending = null;
  function pressBuzzer(i, ts) {
    const q = S.q;
    if (!q || q.phase !== 'open' || q.locked.includes(i)) {
      sfx('click', { volume: 0.6, pitch: 0.8 });
      return;
    }
    sfx('click');
    if (!pending) {
      pending = [];
      setTimeout(resolveBuzz, BUZZ_WINDOW_MS);
    }
    if (!pending.some(p => p.team === i)) pending.push({ team: i, ts, n: pending.length });
  }

  function resolveBuzz() {
    const list = pending;
    pending = null;
    const q = S.q;
    if (!list || !q || q.phase !== 'open') return;
    list.sort((a, b) => (a.ts - b.ts) || (a.n - b.n)); // earliest timestamp wins; exact tie → first delivered
    const win = list[0].team;
    q.phase = 'answering';
    q.answering = win;
    sfx('buzzer', { pan: S.teams.length > 1 ? -0.8 + (1.6 * win) / (S.teams.length - 1) : 0 });
    saveProgress();
    refresh();
  }

  function judge(ok) {
    const q = S.q;
    if (!q || q.phase !== 'answering') return;
    const i = q.answering, val = VALUES[q.r], team = S.teams[i];
    if (ok) {
      team.score += val;
      q.phase = 'revealed';
      q.result = { team: i };
      sfx('correct');
      IFPD.confetti(1200);
    } else {
      team.score -= val;
      q.locked.push(i);
      q.answering = -1;
      sfx('wrong');
      if (q.locked.length >= S.teams.length) { q.phase = 'revealed'; q.result = { reason: 'allwrong' }; } else q.phase = 'open';
    }
    bump(i);
    saveProgress();
    refresh();
  }

  function reveal(reason) {
    const q = S.q;
    if (!q || q.phase === 'revealed') return;
    q.phase = 'revealed';
    q.answering = -1;
    q.result = { reason };
    sfx(reason === 'timeout' ? 'buzzer' : 'flip');
    saveProgress();
    refresh();
  }

  function backToBoard() {
    const q = S.q;
    if (!q) return;
    S.used[q.c * 5 + q.r] = true;
    S.q = null;
    sfx('whoosh');
    const card = ui && ui.card;
    if (card) {
      card.classList.add('closing');
      setTimeout(() => card.remove(), 260);
      ui.card = null;
      ui.ring = null;
    }
    saveProgress();
    refresh();
    if (S.used.every(Boolean)) setTimeout(endGame, 450);
  }

  function bump(i) {
    const el = ui && ui.teams[i] && ui.teams[i].score;
    if (!el) return;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function endGame() {
    if (S.screen !== 'game' || !S.used.every(Boolean) || S.q) return;
    S.finished = true;
    saveProgress();
    const best = Math.max(...S.teams.map(t => t.score));
    const winners = S.teams.filter(t => t.score === best);
    const ranking = S.teams.slice().sort((a, b) => b.score - a.score).map(t => `${1 + S.teams.filter(o => o.score > t.score).length}. ${t.name} — ${t.score}`).join('\n');
    const title = winners.length === 1 ? `🏆 ${winners[0].name} wins!` : `🤝 It's a tie: ${winners.map(w => w.name).join(' & ')}!`;
    sfx('win');
    IFPD.confetti(4000);
    setTimeout(() => IFPD.confetti(3000), 1200);
    IFPD.overlay.show({
      title,
      text: 'Final scores\n' + ranking,
      buttons: [
        { label: '▶ Play again', kind: 'primary', onClick: () => startGame() },
        { label: '⚙ New teams / set', kind: 'plain', onClick: () => showSetup() },
      ],
    });
  }

  function confirmRestart() {
    if (S.screen !== 'game') { sfx('click'); showSetup(); return; }
    IFPD.overlay.show({
      title: 'Restart the game?',
      text: 'All scores go back to 0 and every question returns to the board.',
      buttons: [
        { label: '↻ Restart', kind: 'bad', onClick: () => startGame() },
        { label: 'Cancel', kind: 'plain', onClick: () => {} },
      ],
    });
  }

  // ---------------------------------------------------------------- score adjust popover
  let pop = null, popTimer = 0;
  function closePopover() { if (pop) { pop.remove(); pop = null; clearTimeout(popTimer); } }
  function openPopover(i) {
    const same = pop && pop.dataset.team === String(i);
    closePopover();
    if (same) return;
    sfx('tap');
    const adj = d => {
      S.teams[i].score += d;
      sfx(d > 0 ? 'snap' : 'click');
      bump(i);
      saveProgress();
      refresh();
      clearTimeout(popTimer);
      popTimer = setTimeout(closePopover, 4000);
    };
    pop = h('div', { class: 'qz-pop' },
      h('button', { class: 'ifpd-btn bad', text: '−100', onclick: e => { e.stopPropagation(); adj(-100); } }),
      h('button', { class: 'ifpd-btn good', text: '+100', onclick: e => { e.stopPropagation(); adj(100); } }));
    pop.dataset.team = String(i);
    pop.addEventListener('pointerdown', e => e.stopPropagation());
    ui.teams[i].zone.append(pop);
    popTimer = setTimeout(closePopover, 4000);
  }
  document.addEventListener('pointerdown', e => { if (pop && !pop.contains(e.target) && !e.target.closest('.qz-score')) closePopover(); });

  // ---------------------------------------------------------------- timer loop
  const loop = IFPD.loop(dt => {
    const q = S.q;
    if (!q || q.phase !== 'open' || S.screen !== 'game' || IFPD.overlay.visible) return;
    const before = Math.ceil(q.time);
    q.time -= dt;
    const after = Math.ceil(q.time);
    if (after !== before) {
      if (after <= 5 && after > 0) sfx('tick', { volume: 4, pitch: 0.6 });
      if (after % 2 === 0) saveProgress();
    }
    if (q.time <= 0) { q.time = 0; reveal('timeout'); }
  }, () => updateRing(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop.resume(); });

  // ---------------------------------------------------------------- editor
  function blankSet() {
    return { name: 'My quiz', categories: Array.from({ length: 5 }, (_, i) => ({ name: `Category ${i + 1}`, questions: Array.from({ length: 5 }, () => ({ q: '', a: '' })) })) };
  }

  function openEditor(id) {
    IFPD.overlay.hide();
    const src = id ? findSet(id) : null;
    S.editing = src
      ? { id: src.id, custom: !isBuiltin(src.id), basedOn: isBuiltin(src.id) ? src.id : src.basedOn || null, data: clone({ name: src.name, categories: src.categories }) }
      : { id: null, custom: false, basedOn: null, data: blankSet() };
    drawEditor();
  }

  function drawEditor() {
    const E = S.editing, d = E.data;
    const scr = h('div', { class: 'qz-screen qz-scroll qz-editor', 'data-keyboard-menu': '' });
    const head = h('div', { class: 'qz-ed-head' },
      h('button', { class: 'ifpd-btn', text: '← Back', onclick: () => { sfx('click'); S.editing = null; if (S.set && !S.finished && ui) { setScreen(ui.scr, 'game'); sizeBuzzers(); refresh(); } else showSetup(); } }),
      h('input', { class: 'qz-input', value: d.name, maxLength: 60, placeholder: 'Set name', oninput: e => { d.name = e.target.value; } }),
      h('button', { class: 'ifpd-btn good', text: '💾 Save', onclick: saveEditor }),
      h('button', { class: 'ifpd-btn', text: '⤓ Export JSON', onclick: exportEditor }),
      h('button', { class: 'ifpd-btn', text: '⤒ Import JSON', onclick: () => importFile() }),
      h('button', { class: 'ifpd-btn', text: '↺ Reset to built-in', disabled: !E.basedOn || !isBuiltin(E.basedOn), onclick: resetEditor }),
      E.custom ? h('button', { class: 'ifpd-btn bad', text: '🗑 Delete', onclick: deleteEditor }) : null);
    scr.append(head);
    scr.append(h('p', {
      class: 'qz-ed-note',
      text: E.custom ? 'Custom set — Save keeps your changes on this panel.'
        : E.id ? 'Built-in set — Save stores your edited version as a new custom set (the original stays available).'
          : 'New set — fill in all 5 categories with 5 questions each (easiest at 100, hardest at 500).',
    }));
    const grid = h('div', { class: 'qz-ed-grid' });
    d.categories.forEach((c, ci) => {
      const box = h('div', { class: 'qz-panel qz-ed-cat' });
      box.append(h('input', { class: 'qz-input', value: c.name, maxLength: 40, placeholder: `Category ${ci + 1}`, oninput: e => { c.name = e.target.value; e.target.classList.remove('qz-bad'); } }));
      c.questions.forEach((q, qi) => {
        box.append(h('div', { class: 'qz-ed-q' },
          h('div', { class: 'val', text: String(VALUES[qi]) }),
          h('textarea', { rows: 2, value: q.q, placeholder: 'Question', oninput: e => { q.q = e.target.value; e.target.classList.remove('qz-bad'); } }),
          h('textarea', { rows: 2, value: q.a, placeholder: 'Answer', oninput: e => { q.a = e.target.value; e.target.classList.remove('qz-bad'); } })));
      });
      grid.append(box);
    });
    scr.append(grid);
    setScreen(scr, 'editor');
  }

  function saveEditor() {
    const E = S.editing, d = E.data;
    const scr = app.querySelector('.qz-editor');
    let bad = 0;
    scr.querySelectorAll('.qz-ed-cat input, .qz-ed-cat textarea, .qz-ed-head input').forEach(el => {
      const empty = !el.value.trim();
      el.classList.toggle('qz-bad', empty);
      if (empty) bad++;
    });
    if (bad) { sfx('wrong'); IFPD.toast(`Please fill in ${bad} empty box${bad > 1 ? 'es' : ''}`, 2500); return; }
    const clean = {
      name: d.name.trim(),
      categories: d.categories.map(c => ({ name: c.name.trim(), questions: c.questions.map(q => ({ q: q.q.trim(), a: q.a.trim() })) })),
    };
    const list = load(LS.custom, []).filter(validSet);
    if (E.custom) {
      const k = list.findIndex(s => s.id === E.id);
      const rec = Object.assign({ id: E.id, basedOn: E.basedOn }, clean);
      if (k >= 0) list[k] = rec; else list.push(rec);
    } else {
      E.id = 'custom-' + Date.now().toString(36);
      E.custom = true;
      if (E.basedOn && BUILTIN.some(b => b.name === clean.name)) clean.name += ' (my copy)';
      d.name = clean.name;
      list.push(Object.assign({ id: E.id, basedOn: E.basedOn }, clean));
    }
    store(LS.custom, list);
    S.setId = E.id;
    store(LS.set, E.id);
    sfx('correct');
    IFPD.toast('Saved ✓ — this set is now selected');
    drawEditor();
  }

  function exportEditor() {
    const d = S.editing.data;
    const json = JSON.stringify({ format: 'cosmiq-quiz-show', version: 1, name: d.name, categories: d.categories }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: (d.name || 'quiz').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.json' });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    sfx('tap');
    IFPD.toast('Exported to Downloads');
  }

  function importFile() {
    const input = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      f.text().then(txt => importText(txt)).catch(() => IFPD.toast('Could not read that file'));
    });
    document.body.append(input);
    input.click();
  }

  function importText(txt) {
    let set;
    try { set = normalizeImport(JSON.parse(txt)); } catch (err) {
      sfx('wrong');
      IFPD.overlay.show({ title: 'Import failed', text: 'That file is not a valid question set: ' + (err.message || err), buttons: [{ label: 'OK', kind: 'primary' }] });
      return false;
    }
    const list = load(LS.custom, []).filter(validSet);
    const id = 'custom-' + Date.now().toString(36);
    list.push(Object.assign({ id, basedOn: null }, set));
    store(LS.custom, list);
    S.setId = id;
    store(LS.set, id);
    sfx('correct');
    IFPD.toast(`Imported “${set.name}”`);
    openEditor(id);
    return true;
  }

  function resetEditor() {
    const E = S.editing, b = BUILTIN.find(s => s.id === E.basedOn);
    if (!b) return;
    IFPD.overlay.show({
      title: 'Reset to built-in?',
      text: `Replace everything in this editor with the original “${b.name}” questions?\n(Tap Save afterwards to keep it.)`,
      buttons: [
        { label: '↺ Reset', kind: 'bad', onClick: () => { E.data = clone({ name: E.custom ? E.data.name : b.name, categories: b.categories }); sfx('flip'); drawEditor(); IFPD.toast('Built-in questions restored'); } },
        { label: 'Cancel', kind: 'plain' },
      ],
    });
  }

  function deleteEditor() {
    const E = S.editing;
    IFPD.overlay.show({
      title: 'Delete this set?',
      text: `“${E.data.name}” will be removed from this panel.`,
      buttons: [
        { label: '🗑 Delete', kind: 'bad', onClick: () => {
          store(LS.custom, load(LS.custom, []).filter(s => s.id !== E.id));
          if (S.setId === E.id) { S.setId = 'general'; store(LS.set, 'general'); }
          S.editing = null;
          sfx('pop');
          showSetup();
        } },
        { label: 'Cancel', kind: 'plain' },
      ],
    });
  }

  // ---------------------------------------------------------------- keyboard
  // Board: arrows move a highlight, Enter opens. Question: team N buzzes with key N (same timestamp
  // rule as the touch buzzers); teacher: C correct, X wrong, R reveal, B / Esc back to board.
  const kb = { c: 0, r: 0, shown: false, help: '' };
  function kbMode() { return !!window.CosmiqInput && CosmiqInput.mode === 'keyboard'; }

  function keyHelp() {
    if (!window.CosmiqInput) return;
    const q = S.q, n = S.teams.length;
    const buzz = [n > 2 ? `1 – ${n}` : '1 2', 'Team buzzers (team 1 = key 1 …)'];
    let id, rows;
    if (S.screen !== 'game') {
      id = 'menu';
      rows = [['Tab', 'Next button / box'], ['← → ↑ ↓', 'Move between buttons'], ['Enter', 'Press']];
    } else if (!q) {
      id = 'board' + n;
      rows = [['← ↑ → ↓', 'Choose a question'], ['Enter', 'Open it'], buzz];
    } else if (q.phase === 'answering') {
      id = 'answering' + n;
      rows = [['C', 'Correct'], ['X', 'Wrong'], buzz];
    } else if (q.phase === 'revealed') {
      id = 'revealed';
      rows = [['B Esc', 'Back to the board']];
    } else {
      id = 'open' + n;
      rows = [buzz, ['R', 'Reveal the answer']];
    }
    if (id === kb.help) return;
    kb.help = id;
    CosmiqInput.keys.help('Quiz Show', rows);
  }

  // Enter on a button the player tabbed to presses that button; focus left by a mouse click doesn't count.
  function keyForButton(e) {
    const b = e.target && e.target.closest && e.target.closest('button, a[href]');
    if (!b || b.classList.contains('qz-tile')) return false;
    if (b.matches(':focus-visible')) return true;
    b.blur();
    return false;
  }

  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (window.CosmiqInput) {
    CosmiqInput.onChange(() => { kb.help = ''; if (kbMode()) kb.shown = true; refresh(); keyHelp(); focusStart(); });
    CosmiqInput.keys.on(e => {
      if (S.screen !== 'game' || !ui || IFPD.overlay.visible) return;
      const q = S.q;
      const team = /^(Digit|Numpad)[1-4]$/.test(e.code) ? Number(e.code.slice(-1)) - 1 : -1;
      if (team >= 0 && team < S.teams.length) {
        e.preventDefault();
        const bz = ui.teams[team].buzzer;
        if (e.type === 'keyup') { bz.classList.remove('down'); return; }
        if (e.repeat) return;
        bz.classList.add('down');
        pressBuzzer(team, e.timeStamp);
        return;
      }
      if (e.type !== 'keydown') return;
      if (!q) {
        if (ARROWS[e.key]) {
          e.preventDefault();
          if (kb.shown) {
            kb.c = Math.max(0, Math.min(4, kb.c + ARROWS[e.key][0]));
            kb.r = Math.max(0, Math.min(4, kb.r + ARROWS[e.key][1]));
            sfx('tick', { volume: 0.4, pitch: 1.6 });
          }
          kb.shown = true;
          refresh();
        } else if (e.key === 'Enter' && !keyForButton(e)) {
          e.preventDefault();
          if (e.repeat) return;
          if (!kb.shown) { kb.shown = true; refresh(); return; }
          if (S.used[kb.c * 5 + kb.r]) { sfx('click', { volume: 0.6, pitch: 0.8 }); IFPD.toast('Already played — pick another tile'); return; }
          openTile(kb.c, kb.r);
        }
        return;
      }
      if (e.repeat) return;
      const k = e.code;
      if (k === 'KeyC' && q.phase === 'answering') { e.preventDefault(); judge(true); }
      else if (k === 'KeyX' && q.phase === 'answering') { e.preventDefault(); judge(false); }
      else if (k === 'KeyR' && q.phase === 'open') { e.preventDefault(); reveal('skip'); }
      else if ((k === 'KeyB' || e.key === 'Escape') && q.phase === 'revealed') { e.preventDefault(); backToBoard(); }
      else if (e.key === 'Enter' && q.phase === 'revealed' && !keyForButton(e)) { e.preventDefault(); backToBoard(); }
    });
    window.addEventListener('blur', () => { if (ui) ui.teams.forEach(T => T.buzzer.classList.remove('down')); });
  }

  // ---------------------------------------------------------------- boot
  showSetup();
  keyHelp();

  window.__game = {
    S, VALUES, QUESTION_TIME, BUILTIN,
    openTile, judge, reveal, backToBoard, pressBuzzer, startGame, showSetup, openEditor, importText, normalizeImport,
    savedProgress, endGame, ui: () => ui,
  };
})();
