// OrangeSwim UI controller. Plain DOM, no framework.
// User supplied text is only ever inserted with textContent / text nodes (never innerHTML).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createDb } from './db.js';
import * as L from './logic.js';

const db = createDb({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
const VIEWS = ['leaderboard', 'add', 'feed', 'me'];
const USER_KEY = `orangeswim.user.${db.mode}.v1`;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  user: loadUser(),
  view: null,
  month: L.monthOf(new Date()),
  photoFile: null,
  photoUrl: null,
  swimmersForSignin: [],
  loadSeq: { leaderboard: 0, feed: 0, me: 0 },
  addDay: null, // the day the Add form date was last defaulted to today
};

/* ======================================================================== */
/* Small helpers                                                             */
/* ======================================================================== */

/** Create an element. Children that are not nodes become text nodes (safe). */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function loadUser() {
  try {
    const u = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    if (u && typeof u.id === 'string' && typeof u.name === 'string' && /^[0-9]{4}$/.test(u.pin)) return u;
  } catch {
    /* storage unavailable or corrupt */
  }
  return null;
}

function saveUser(user) {
  state.user = user;
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* still signed in for this visit */
  }
}

function clearUser() {
  state.user = null;
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

const errorText = (e) => L.friendlyError(e, { online: navigator.onLine !== false });

let toastTimer = null;
function toast(message, kind = 'info') {
  const t = $('#toast');
  t.textContent = message;
  t.className = `toast show toast-${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.className = 'toast';
  }, kind === 'error' ? 5500 : 3200);
}

function setStatus(container, kind, message, onRetry) {
  container.replaceChildren();
  if (!kind) return;
  container.className = `status status-${kind}`;
  if (kind === 'loading') {
    container.append(el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', { text: message || 'Loading...' }));
    return;
  }
  container.append(el('p', { text: message }));
  if (onRetry) container.append(el('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: onRetry, text: 'Try again' }));
}

function confirmDialog({ title, text, okLabel = 'Delete' }) {
  const dlg = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okLabel;
  if (typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(`${title}\n${text}`));
  return new Promise((resolve) => {
    dlg.returnValue = 'cancel';
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
  });
}

function openLightbox(url, caption) {
  const dlg = $('#lightbox');
  const img = $('#lightbox-img');
  img.src = url;
  img.alt = caption;
  $('#lightbox-caption').textContent = caption;
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else window.open(url, '_blank', 'noopener');
}

/* ======================================================================== */
/* Routing                                                                   */
/* ======================================================================== */

function showSection(name) {
  for (const sec of $$('main > .view')) sec.hidden = sec.id !== `view-${name}`;
  const signedIn = name !== 'welcome';
  $('#bottom-nav').hidden = !signedIn;
  document.body.classList.toggle('has-nav', signedIn);
  const hu = $('#header-user');
  hu.hidden = !signedIn || !state.user;
  hu.textContent = state.user ? state.user.name : '';
  for (const a of $$('#bottom-nav a')) {
    if (a.dataset.view === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function route() {
  $('#boot-status').hidden = true;
  if (!state.user) {
    state.view = 'welcome';
    showSection('welcome');
    loadSigninNames();
    return;
  }
  let view = location.hash.replace(/^#/, '');
  if (!VIEWS.includes(view)) view = 'leaderboard';
  const changed = state.view !== view;
  state.view = view;
  showSection(view);
  if (changed) window.scrollTo(0, 0);
  if (view === 'leaderboard') loadLeaderboard();
  else if (view === 'feed') loadFeed();
  else if (view === 'me') loadMe();
  else if (view === 'add') openAdd();
}

function go(view) {
  if (location.hash === `#${view}`) route();
  else location.hash = `#${view}`;
}

/* ======================================================================== */
/* Welcome: join / sign in                                                   */
/* ======================================================================== */

function selectTab(which) {
  const join = which === 'join';
  $('#tab-join').setAttribute('aria-selected', String(join));
  $('#tab-signin').setAttribute('aria-selected', String(!join));
  $('#tab-join').tabIndex = join ? 0 : -1;
  $('#tab-signin').tabIndex = join ? -1 : 0;
  $('#form-join').hidden = !join;
  $('#form-signin').hidden = join;
}

async function loadSigninNames() {
  const box = $('#signin-names');
  const list = $('#swimmer-names');
  try {
    const swimmers = await db.listSwimmers();
    state.swimmersForSignin = swimmers;
    list.replaceChildren(...swimmers.map((s) => el('option', { value: s.name })));
    if (!swimmers.length) {
      box.replaceChildren(el('p', { class: 'hint', text: 'Nobody has joined yet. Use the Join tab to be the first!' }));
      return;
    }
    box.replaceChildren(
      ...swimmers.map((s) =>
        el('button', {
          type: 'button',
          class: 'chip',
          onclick: (ev) => {
            $('#signin-name').value = s.name;
            setFieldError('signin-error', '');
            for (const c of $$('.chip', box)) c.setAttribute('aria-pressed', String(c === ev.currentTarget));
            $('#signin-pin').focus();
          },
          'aria-pressed': 'false',
          text: s.name,
        }),
      ),
    );
  } catch (e) {
    box.replaceChildren(el('p', { class: 'hint', text: `Could not load the list of swimmers. ${errorText(e)}` }));
  }
}

function setFieldError(id, message) {
  const p = document.getElementById(id);
  if (p) p.textContent = message || '';
}

async function onJoin(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const name = L.validateName($('#join-name').value);
  const pin = L.validatePin($('#join-pin').value);
  setFieldError('join-name-error', name.error);
  let pinError = pin.error;
  if (!pinError && $('#join-pin').value !== $('#join-pin2').value) pinError = 'The two PINs do not match.';
  setFieldError('join-pin-error', pinError);
  if (!name.ok) return $('#join-name').focus();
  if (pinError) return $('#join-pin').focus();

  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const swimmer = await db.register(name.value, pin.value);
    saveUser({ id: swimmer.id, name: swimmer.name, pin: pin.value });
    form.reset();
    toast(`Welcome to the pool, ${swimmer.name}!`, 'success');
    go(state.photoFile ? 'add' : 'leaderboard'); // a shared photo is waiting
  } catch (e) {
    setFieldError('join-name-error', errorText(e));
    $('#join-name').focus(); // announces the error via aria-describedby
  } finally {
    btn.disabled = false;
  }
}

async function onSignin(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const name = $('#signin-name').value.trim();
  const pin = $('#signin-pin').value;
  if (!name) {
    setFieldError('signin-error', 'Enter or tap your name.');
    return $('#signin-name').focus();
  }
  if (!L.validatePin(pin).ok) {
    setFieldError('signin-error', 'PIN must be exactly 4 digits.');
    return $('#signin-pin').focus();
  }
  setFieldError('signin-error', '');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const swimmer = await db.login(name, pin);
    saveUser({ id: swimmer.id, name: swimmer.name, pin });
    form.reset();
    toast(`Welcome back, ${swimmer.name}!`, 'success');
    go(state.photoFile ? 'add' : 'leaderboard');
  } catch (e) {
    setFieldError('signin-error', errorText(e));
    $('#signin-pin').select();
  } finally {
    btn.disabled = false;
  }
}

/* ======================================================================== */
/* Month selector (shared by Leaderboard and Feed)                           */
/* ======================================================================== */

function renderMonthNav() {
  const current = L.monthOf(new Date());
  if (L.compareMonths(state.month, current) > 0) state.month = current;
  const label = L.formatMonthLabel(state.month);
  for (const h of $$('.month-label')) h.textContent = label;
  const atCurrent = L.compareMonths(state.month, current) >= 0;
  for (const b of $$('.month-next')) b.disabled = atCurrent;
}

function changeMonth(delta) {
  const next = L.shiftMonth(state.month, delta);
  if (L.compareMonths(next, L.monthOf(new Date())) > 0) return;
  state.month = next;
  if (state.view === 'feed') loadFeed();
  else loadLeaderboard();
}

/* ======================================================================== */
/* Leaderboard                                                               */
/* ======================================================================== */

async function loadLeaderboard() {
  renderMonthNav();
  const seq = ++state.loadSeq.leaderboard;
  const list = $('#lb-list');
  const status = $('#lb-status');
  if (!list.children.length) setStatus(status, 'loading', 'Loading the leaderboard...');
  const { start, end } = L.monthRange(state.month.year, state.month.month);
  try {
    const [swimmers, sessions] = await Promise.all([db.listSwimmers(), db.listSessions({ start, end })]);
    if (seq !== state.loadSeq.leaderboard) return;
    if (!swimmers.some((s) => s.id === state.user.id)) {
      clearUser();
      toast('Your profile was not found. Please join or sign in again.', 'error');
      route();
      return;
    }
    setStatus(status, null);
    renderLeaderboard(swimmers, sessions);
  } catch (e) {
    if (seq !== state.loadSeq.leaderboard) return;
    list.replaceChildren();
    $('#lb-team').hidden = true;
    setStatus(status, 'error', errorText(e), loadLeaderboard);
  }
}

function renderLeaderboard(swimmers, sessions) {
  const rows = L.buildLeaderboard(swimmers, sessions);
  const totals = L.teamTotals(sessions);
  const team = $('#lb-team');
  team.hidden = false;
  team.replaceChildren(
    el('div', { class: 'team-main' },
      el('span', { class: 'team-label', text: 'Team total' }),
      el('span', { class: 'team-value', text: L.formatMeters(totals.meters) }),
    ),
    el('div', { class: 'team-meta' },
      el('span', { text: L.formatKm(totals.meters) }),
      el('span', { text: `${totals.count} ${totals.count === 1 ? 'swim' : 'swims'}` }),
      el('span', { text: `${totals.swimmers} of ${swimmers.length} active` }),
    ),
  );

  const max = rows.length ? rows[0].meters : 0;
  const list = $('#lb-list');
  list.replaceChildren(
    ...rows.map((r) => {
      const me = r.swimmer.id === state.user.id;
      const medal = r.meters > 0 && r.rank <= 3 ? ` medal-${r.rank}` : '';
      const pct = max > 0 ? Math.max(2, Math.round((r.meters / max) * 100)) : 0;
      return el('li', { class: `lb-row${medal}${me ? ' is-me' : ''}${r.meters === 0 ? ' is-zero' : ''}` },
        el('span', { class: 'rank' }, el('span', { class: 'visually-hidden', text: 'Rank ' }), String(r.rank)),
        el('div', { class: 'lb-main' },
          el('div', { class: 'lb-name' },
            el('span', { class: 'name', text: r.swimmer.name }),
            me ? el('span', { class: 'you-tag', text: 'You' }) : null,
          ),
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('span', { style: `width:${pct}%` })),
          el('span', { class: 'lb-sub', text: `${r.count} ${r.count === 1 ? 'swim' : 'swims'}` }),
        ),
        el('span', { class: 'lb-meters', text: L.formatMeters(r.meters) }),
      );
    }),
  );

  if (totals.count === 0) {
    const isCurrent = L.compareMonths(state.month, L.monthOf(new Date())) === 0;
    const status = $('#lb-status');
    status.className = 'status status-empty';
    // replaceChildren() turns null into a "null" text node, so only pass real nodes.
    status.replaceChildren(
      el('p', { text: isCurrent ? 'No swims yet this month. Be the first to make a splash!' : 'No swims recorded that month.' }),
      ...(isCurrent ? [el('a', { href: '#add', class: 'btn btn-primary btn-small', text: 'Log a swim' })] : []),
    );
  }
}

/* ======================================================================== */
/* Feed                                                                      */
/* ======================================================================== */

async function loadFeed() {
  renderMonthNav();
  const seq = ++state.loadSeq.feed;
  const list = $('#feed-list');
  const status = $('#feed-status');
  if (!list.children.length) setStatus(status, 'loading', 'Loading swims...');
  const { start, end } = L.monthRange(state.month.year, state.month.month);
  try {
    const sessions = await db.listSessions({ start, end });
    if (seq !== state.loadSeq.feed) return;
    renderFeed(sessions);
  } catch (e) {
    if (seq !== state.loadSeq.feed) return;
    list.replaceChildren();
    setStatus(status, 'error', errorText(e), loadFeed);
  }
}

function renderFeed(sessions) {
  const list = $('#feed-list');
  const status = $('#feed-status');
  const year = new Date().getFullYear();
  list.replaceChildren(
    ...sessions.map((s) => {
      const me = state.user && s.swimmerId === state.user.id;
      const dateLabel = L.formatDateLabel(s.date, year);
      const caption = `${s.swimmerName}, ${dateLabel}, ${L.formatMeters(s.meters)}${s.pool ? `, ${s.pool}` : ''}`;
      return el('li', { class: `feed-item card${me ? ' is-me' : ''}` },
        el('div', { class: 'feed-head' },
          el('span', { class: 'avatar', 'aria-hidden': 'true', text: L.initialOf(s.swimmerName) }),
          el('div', { class: 'feed-who' },
            el('span', { class: 'name', text: s.swimmerName }),
            el('time', { datetime: s.date, class: 'muted', text: dateLabel }),
          ),
          el('span', { class: 'feed-meters', text: L.formatMeters(s.meters) }),
        ),
        s.pool ? el('p', { class: 'feed-pool' }, el('span', { 'aria-hidden': 'true', class: 'pin-icon' }), s.pool) : null,
        s.photoUrl
          ? el('button', { type: 'button', class: 'thumb', 'aria-label': `View photo: ${caption}`, onclick: () => openLightbox(s.photoUrl, caption) },
              el('img', { src: s.photoUrl, alt: '', loading: 'lazy', decoding: 'async' }))
          : null,
      );
    }),
  );
  if (sessions.length) setStatus(status, null);
  else {
    status.className = 'status status-empty';
    status.replaceChildren(el('p', { text: 'No swims in this month yet.' }));
  }
}

/* ======================================================================== */
/* Me                                                                        */
/* ======================================================================== */

async function loadMe() {
  const seq = ++state.loadSeq.me;
  const list = $('#me-list');
  const status = $('#me-status');
  $('#me-title').textContent = state.user.name;
  if (!list.children.length) setStatus(status, 'loading', 'Loading your swims...');
  try {
    const sessions = await db.listSessions({ swimmerId: state.user.id });
    if (seq !== state.loadSeq.me) return;
    const now = L.monthOf(new Date());
    const stats = L.summarizeSwimmer(sessions, state.user.id, L.monthRange(now.year, now.month));
    $('#stat-month').textContent = L.formatMeters(stats.monthMeters);
    $('#stat-total').textContent = L.formatMeters(stats.totalMeters);
    $('#stat-count').textContent = L.formatNumber(stats.count);
    renderMySessions(sessions);
  } catch (e) {
    if (seq !== state.loadSeq.me) return;
    list.replaceChildren();
    setStatus(status, 'error', errorText(e), loadMe);
  }
}

function renderMySessions(sessions) {
  const list = $('#me-list');
  const status = $('#me-status');
  const year = new Date().getFullYear();
  list.replaceChildren(
    ...sessions.map((s) => {
      const dateLabel = L.formatDateLabel(s.date, year);
      return el('li', { class: 'my-session' },
        s.photoUrl
          ? el('button', { type: 'button', class: 'mini-thumb', 'aria-label': `View photo from ${dateLabel}`, onclick: () => openLightbox(s.photoUrl, `${dateLabel}, ${L.formatMeters(s.meters)}`) },
              el('img', { src: s.photoUrl, alt: '', loading: 'lazy', decoding: 'async' }))
          : el('span', { class: 'mini-thumb placeholder', 'aria-hidden': 'true' }),
        el('div', { class: 'my-main' },
          el('span', { class: 'my-meters', text: L.formatMeters(s.meters) }),
          el('span', { class: 'muted', text: s.pool ? `${dateLabel}, ${s.pool}` : dateLabel }),
        ),
        el('button', {
          type: 'button',
          class: 'icon-btn danger',
          'aria-label': `Delete swim of ${dateLabel}, ${L.formatMeters(s.meters)}`,
          onclick: (ev) => onDeleteSession(s, ev.currentTarget),
        }, trashIcon()),
      );
    }),
  );
  if (sessions.length) setStatus(status, null);
  else {
    status.className = 'status status-empty';
    status.replaceChildren(el('p', { text: 'You have not logged any swims yet.' }), el('a', { href: '#add', class: 'btn btn-primary btn-small', text: 'Log your first swim' }));
  }
}

function trashIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3');
  svg.append(path);
  return svg;
}

async function onDeleteSession(session, button) {
  const ok = await confirmDialog({
    title: 'Delete this swim?',
    text: `${L.formatMeters(session.meters)} on ${L.formatDateLabel(session.date, new Date().getFullYear())}${session.photoUrl ? ' and its photo' : ''} will be removed for everyone.`,
  });
  if (!ok) return;
  button.disabled = true;
  try {
    await db.deleteSession({ sessionId: session.id, swimmerId: state.user.id, pin: state.user.pin });
    toast('Swim deleted.', 'success');
    loadMe();
  } catch (e) {
    button.disabled = false;
    toast(errorText(e), 'error');
  }
}

/* ======================================================================== */
/* Add a session                                                             */
/* ======================================================================== */

function openAdd() {
  const today = L.localDateStr();
  const date = $('#add-date');
  date.max = today;
  // Reset to today on a new day too, so a form left open overnight does not log on an old date.
  if (!date.value || date.value > today || state.addDay !== today) {
    date.value = today;
    state.addDay = today;
  }
  db.listPools()
    .then((pools) => $('#pool-list').replaceChildren(...pools.map((p) => el('option', { value: p }))))
    .catch(() => {});
}

function bumpMeters(amount) {
  const input = $('#add-meters');
  const current = parseInt(input.value.replace(/\D/g, ''), 10) || 0;
  input.value = String(Math.min(L.MAX_METERS, current + amount));
  setFieldError('add-meters-error', '');
}

function setPhoto(file) {
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photoFile = file || null;
  state.photoUrl = file ? URL.createObjectURL(file) : null;
  const preview = $('#photo-preview');
  preview.hidden = !file;
  $('#photo-preview-img').src = state.photoUrl || '';
  $('#photo-pick span').textContent = file ? 'Change photo' : 'Add a photo';
  if (!file) $('#add-photo').value = '';
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new L.UserError('Could not read this photo. Try a JPEG or PNG image.'));
    };
    img.src = url;
  });
}

/** Downscale to max 1600px on the longest side and re-encode as JPEG (about 0.8 quality). */
async function downscaleImage(file, maxSide = 1600, quality = 0.8) {
  let decoded;
  try {
    // imageOrientation 'from-image' applies the EXIF rotation from phone cameras.
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    decoded = { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close && bmp.close() };
  } catch {
    decoded = await loadImageElement(file); // browsers auto orient <img> from EXIF
  }
  try {
    const { width, height } = L.fitWithin(decoded.width, decoded.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // transparent PNGs become white instead of black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(decoded.source, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new L.UserError('Could not process this photo.');
    return blob;
  } finally {
    decoded.done();
  }
}

async function onAddSubmit(ev) {
  ev.preventDefault();
  const today = L.localDateStr();
  const v = L.validateSession({ date: $('#add-date').value, meters: $('#add-meters').value, today });
  setFieldError('add-date-error', v.errors.date);
  setFieldError('add-meters-error', v.errors.meters);
  if (!v.ok) {
    (v.errors.date ? $('#add-date') : $('#add-meters')).focus();
    return;
  }
  const btn = $('#add-submit');
  btn.disabled = true;
  btn.textContent = state.photoFile ? 'Uploading...' : 'Saving...';
  try {
    const photoBlob = state.photoFile ? await downscaleImage(state.photoFile) : null;
    await db.addSession({
      swimmerId: state.user.id,
      pin: state.user.pin,
      date: v.value.date,
      meters: v.value.meters,
      pool: L.normalizePool($('#add-pool').value),
      photoBlob,
    });
    toast(`Nice swim! ${L.formatMeters(v.value.meters)} logged.`, 'success');
    $('#form-add').reset();
    setPhoto(null);
    $('#add-date').value = '';
    state.month = L.monthOf(v.value.date);
    go('leaderboard');
  } catch (e) {
    const msg = errorText(e);
    toast(/wrong name or pin/i.test(msg) ? 'Your saved PIN was rejected. Log out and sign in again.' : msg, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save swim';
  }
}

/* ======================================================================== */
/* Install hints and service worker                                          */
/* ======================================================================== */

// The beforeinstallprompt event is captured early by install.js (window.__installPrompt).
// Browsers without it (iOS, Firefox, some Android browsers) get manual steps instead.
function installSteps() {
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) return 'Tap the Share button (square with an arrow), then Add to Home Screen.';
  if (/android/i.test(ua)) return 'Open the browser menu (⋮), then Install app or Add to Home screen.';
  return 'Use the install icon in the address bar, or the browser menu, then Install OrangeSwim.';
}

function setupInstall() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return;
  const box = $('#install-box');
  const text = $('#install-text');
  box.hidden = false;
  text.textContent = 'Add OrangeSwim to your home screen for one tap access.';
  $('#install-btn').addEventListener('click', async () => {
    const prompt = window.__installPrompt;
    if (!prompt) {
      text.textContent = installSteps();
      return;
    }
    window.__installPrompt = null;
    prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    if (!choice || choice.outcome !== 'accepted') text.textContent = installSteps();
  });
  window.addEventListener('appinstalled', () => {
    box.hidden = true;
  });
}

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let userAskedUpdate = false;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload when the user tapped Reload, not when the first install takes control.
    if (!userAskedUpdate || refreshing) return;
    refreshing = true;
    location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        const offer = (worker) => {
          if (!worker || !navigator.serviceWorker.controller) return;
          $('#update-banner').hidden = false;
          $('#update-reload').onclick = () => {
            userAskedUpdate = true;
            worker.postMessage('SKIP_WAITING');
          };
        };
        if (reg.waiting) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed') offer(reg.waiting || sw);
          });
        });
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch((e) => console.warn('Service worker registration failed', e));
  });
}

/* ======================================================================== */
/* Boot                                                                      */
/* ======================================================================== */

function wireEvents() {
  $('#tab-join').addEventListener('click', () => selectTab('join'));
  $('#tab-signin').addEventListener('click', () => selectTab('signin'));
  $('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const toSignin = $('#tab-join').getAttribute('aria-selected') === 'true';
    selectTab(toSignin ? 'signin' : 'join');
    (toSignin ? $('#tab-signin') : $('#tab-join')).focus();
  });
  $('#form-join').addEventListener('submit', onJoin);
  $('#form-signin').addEventListener('submit', onSignin);

  for (const b of $$('.month-prev')) b.addEventListener('click', () => changeMonth(-1));
  for (const b of $$('.month-next')) b.addEventListener('click', () => changeMonth(1));

  $('#form-add').addEventListener('submit', onAddSubmit);
  for (const chip of $$('[data-add-meters]')) chip.addEventListener('click', () => bumpMeters(Number(chip.dataset.addMeters)));
  $('[data-clear-meters]').addEventListener('click', () => {
    $('#add-meters').value = '';
    $('#add-meters').focus();
  });
  $('#add-meters').addEventListener('input', (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 5);
    if (digits !== e.target.value) e.target.value = digits;
  });
  $('#add-photo').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file && !/^image\//.test(file.type) && file.type !== '') {
      toast('Please choose an image file.', 'error');
      setPhoto(null);
      return;
    }
    setPhoto(file || null);
  });
  $('#photo-remove').addEventListener('click', () => setPhoto(null));

  $('#logout-btn').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Log out?',
      text: 'You can sign in again any time with your name and PIN.',
      okLabel: 'Log out',
    });
    if (!ok) return;
    clearUser();
    // Ignore any load still in flight and wipe what the previous user left behind.
    for (const key of Object.keys(state.loadSeq)) state.loadSeq[key]++;
    for (const id of ['#lb-list', '#feed-list', '#me-list']) $(id).replaceChildren();
    $('#lb-team').hidden = true;
    $('#stat-month').textContent = '0 m';
    $('#stat-total').textContent = '0 m';
    $('#stat-count').textContent = '0';
    $('#form-add').reset();
    setPhoto(null);
    $('#add-date').value = '';
    history.replaceState(null, '', location.pathname + location.search);
    selectTab('signin');
    route();
  });

  $('#lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox') e.currentTarget.close();
  });
  $('#lightbox').addEventListener('close', () => {
    $('#lightbox-img').removeAttribute('src');
  });

  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => {
    if (state.view && state.view !== 'add' && state.view !== 'welcome') route();
  });
}

function boot() {
  if (db.mode === 'demo') $('#demo-banner').hidden = false;
  $('#mode-info').textContent =
    db.mode === 'demo'
      ? 'Demo mode: data is stored in this browser only. Add Supabase keys in config.js to share with colleagues.'
      : 'Data is shared with everyone in the contest.';
  wireEvents();
  setupInstall();
  setupServiceWorker();
  takeSharedPhoto();
  route();
}

// An image shared from another app (Android share sheet) is parked by sw.js,
// which then opens ./?shared=1#add. Attach it to the Add form as the photo.
async function takeSharedPhoto() {
  if (!new URLSearchParams(location.search).has('shared')) return;
  history.replaceState(null, '', location.pathname + location.hash);
  try {
    const cache = await caches.open('share-inbox');
    const res = await cache.match('shared-photo');
    if (!res) throw new Error('empty inbox');
    await cache.delete('shared-photo');
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('X-Filename') || 'shared.jpg');
    setPhoto(new File([blob], name, { type: blob.type || 'image/jpeg' }));
    toast(state.user ? 'Photo added. Now enter your distance.' : 'Sign in to log a swim with this photo.');
  } catch {
    toast('Could not receive the shared image. Add it from the form instead.', 'error');
  }
}

boot();
