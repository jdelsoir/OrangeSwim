// Data layer. Two adapters share one interface:
//   SupabaseAdapter: the real shared backend (Postgres + Storage on Supabase).
//   DemoAdapter: localStorage only, used when config.js has no Supabase keys.
//
// Interface (all methods async):
//   register(name, pin)              -> {id, name}
//   login(name, pin)                 -> {id, name}
//   listSwimmers()                   -> [{id, name}]
//   listSessions({start, end, swimmerId}) -> [{id, swimmerId, swimmerName, date, meters,
//                                         pool, photoPath, photoUrl, createdAt}] newest first
//   addSession({swimmerId, pin, date, meters, pool, photoBlob}) -> id
//   deleteSession({sessionId, swimmerId, pin}) -> void
//   listPools()                      -> [string]

import {
  UserError,
  validateName,
  validatePin,
  validateSession,
  normalizePool,
  distinctPools,
  sortSessionsNewestFirst,
  localDateStr,
  MAX_POOL_LENGTH,
} from './logic.js';

export const SUPABASE_ESM_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const PHOTO_BUCKET = 'photos';

/** RFC 4122 v4 UUID. Falls back to getRandomValues where randomUUID is missing (plain http on a LAN). */
export function uuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new UserError('Could not read the photo.'));
    reader.readAsDataURL(blob);
  });
}

function checkPool(pool) {
  const value = normalizePool(pool);
  if (value && value.length > MAX_POOL_LENGTH) {
    throw new UserError(`Pool name is too long (${MAX_POOL_LENGTH} characters max).`);
  }
  return value;
}

/* ======================================================================== */
/* Demo adapter: everything in this browser's localStorage.                  */
/* ======================================================================== */

function safeLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null; // access can throw when site data is blocked
  }
}

export class DemoAdapter {
  constructor(storage = safeLocalStorage(), key = 'orangeswim.demo.v1') {
    this.mode = 'demo';
    this.storage = storage;
    this.key = key;
    this.memory = null; // fallback when storage is unavailable (private mode, blocked)
  }

  _load() {
    try {
      const raw = this.storage && this.storage.getItem(this.key);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.swimmers) && Array.isArray(data.sessions)) return data;
      }
    } catch {
      /* fall through */
    }
    return this.memory ? structuredClone(this.memory) : { swimmers: [], sessions: [] };
  }

  _save(data) {
    try {
      if (this.storage) this.storage.setItem(this.key, JSON.stringify(data));
    } catch (e) {
      if (e && /quota/i.test(`${e.name} ${e.message}`)) {
        // Nothing was saved, so do not keep the change in memory either.
        throw new UserError('This device ran out of storage space for demo data. Try a smaller photo or delete old sessions.');
      }
      /* storage blocked: keep the in-memory copy for this visit */
    }
    this.memory = structuredClone(data);
  }

  _checkPin(data, swimmerId, pin) {
    const s = data.swimmers.find((x) => x.id === swimmerId);
    if (!s || s.pin !== String(pin)) throw new UserError('Wrong name or PIN.');
    return s;
  }

  async register(name, pin) {
    const n = validateName(name);
    if (!n.ok) throw new UserError(n.error);
    const p = validatePin(pin);
    if (!p.ok) throw new UserError(p.error);
    const data = this._load();
    if (data.swimmers.some((s) => s.name.toLowerCase() === n.value.toLowerCase())) {
      throw new UserError('That name is already taken. Pick another one, or sign in instead.');
    }
    const swimmer = { id: uuid(), name: n.value, pin: p.value, createdAt: new Date().toISOString() };
    data.swimmers.push(swimmer);
    this._save(data);
    return { id: swimmer.id, name: swimmer.name };
  }

  async login(name, pin) {
    const data = this._load();
    const wanted = validateName(name).value.toLowerCase(); // same trim and space collapsing as SQL
    const s = data.swimmers.find((x) => x.name.toLowerCase() === wanted && x.pin === String(pin));
    if (!s) throw new UserError('Wrong name or PIN.');
    return { id: s.id, name: s.name };
  }

  async listSwimmers() {
    return this._load()
      .swimmers.map((s) => ({ id: s.id, name: s.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }

  async listSessions({ start, end, swimmerId } = {}) {
    const data = this._load();
    const names = new Map(data.swimmers.map((s) => [s.id, s.name]));
    const rows = data.sessions
      .filter((s) => (!start || s.date >= start) && (!end || s.date < end) && (!swimmerId || s.swimmerId === swimmerId))
      .map((s) => ({
        id: s.id,
        swimmerId: s.swimmerId,
        swimmerName: names.get(s.swimmerId) || 'Unknown swimmer',
        date: s.date,
        meters: s.meters,
        pool: s.pool || null,
        photoPath: s.photo ? `demo/${s.id}.jpg` : null,
        photoUrl: s.photo || null,
        createdAt: s.createdAt,
      }));
    return sortSessionsNewestFirst(rows);
  }

  async addSession({ swimmerId, pin, date, meters, pool, photoBlob } = {}) {
    const data = this._load();
    this._checkPin(data, swimmerId, pin);
    const v = validateSession({ date, meters, today: localDateStr() });
    if (!v.ok) throw new UserError(Object.values(v.errors)[0]);
    const poolValue = checkPool(pool);
    const photo = photoBlob ? await blobToDataURL(photoBlob) : null;
    const session = {
      id: uuid(),
      swimmerId,
      date: v.value.date,
      meters: v.value.meters,
      pool: poolValue,
      photo,
      createdAt: new Date().toISOString(),
    };
    data.sessions.push(session);
    this._save(data);
    return session.id;
  }

  async deleteSession({ sessionId, swimmerId, pin } = {}) {
    const data = this._load();
    this._checkPin(data, swimmerId, pin);
    const idx = data.sessions.findIndex((s) => s.id === sessionId && s.swimmerId === swimmerId);
    if (idx === -1) throw new UserError('Session not found, or it is not yours.');
    data.sessions.splice(idx, 1);
    this._save(data);
  }

  async listPools() {
    const sessions = sortSessionsNewestFirst(this._load().sessions);
    return distinctPools(sessions.map((s) => s.pool));
  }
}

/* ======================================================================== */
/* Supabase adapter: shared data for the whole group.                         */
/* ======================================================================== */

export class SupabaseAdapter {
  constructor(url, anonKey, loadLibrary = () => import(SUPABASE_ESM_URL)) {
    this.mode = 'supabase';
    this.url = url;
    this.anonKey = anonKey;
    this.loadLibrary = loadLibrary;
    this._clientPromise = null;
  }

  // The library is loaded lazily so the UI renders even when the CDN is unreachable.
  async client() {
    if (!this._clientPromise) {
      this._clientPromise = this.loadLibrary()
        .then(({ createClient }) =>
          createClient(this.url, this.anonKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          }),
        )
        .catch((e) => {
          this._clientPromise = null; // allow a retry later
          throw e;
        });
    }
    return this._clientPromise;
  }

  static _raise(error, status) {
    const e = new Error(error.message || 'Request failed');
    e.code = error.code;
    e.status = status ?? error.status;
    e.details = error.details;
    throw e;
  }

  async _rpc(fn, args) {
    const sb = await this.client();
    const { data, error, status } = await sb.rpc(fn, args);
    if (error) SupabaseAdapter._raise(error, status);
    return data;
  }

  _photoUrl(sb, path) {
    if (!path) return null;
    return sb.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async register(name, pin) {
    const n = validateName(name);
    if (!n.ok) throw new UserError(n.error);
    const p = validatePin(pin);
    if (!p.ok) throw new UserError(p.error);
    const rows = await this._rpc('register_swimmer', { p_name: n.value, p_pin: p.value });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error('Registration failed');
    return { id: row.id, name: row.name };
  }

  async login(name, pin) {
    const rows = await this._rpc('login_swimmer', { p_name: String(name ?? '').trim(), p_pin: String(pin ?? '') });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new UserError('Wrong name or PIN.');
    return { id: row.id, name: row.name };
  }

  async listSwimmers() {
    const sb = await this.client();
    // Explicit columns: pin_hash is not readable by the anon role.
    const { data, error, status } = await sb.from('swimmers').select('id, name').order('name');
    if (error) SupabaseAdapter._raise(error, status);
    return data.map((s) => ({ id: s.id, name: s.name }));
  }

  async listSessions({ start, end, swimmerId } = {}) {
    const sb = await this.client();
    let q = sb.from('sessions').select('id, swimmer_id, swim_date, meters, pool, photo_path, created_at');
    if (start) q = q.gte('swim_date', start);
    if (end) q = q.lt('swim_date', end);
    if (swimmerId) q = q.eq('swimmer_id', swimmerId);
    q = q.order('swim_date', { ascending: false }).order('created_at', { ascending: false }).limit(1000);
    const [{ data, error, status }, swimmers] = await Promise.all([q, this.listSwimmers()]);
    if (error) SupabaseAdapter._raise(error, status);
    const names = new Map(swimmers.map((s) => [s.id, s.name]));
    return sortSessionsNewestFirst(
      data.map((r) => ({
        id: r.id,
        swimmerId: r.swimmer_id,
        swimmerName: names.get(r.swimmer_id) || 'Unknown swimmer',
        date: r.swim_date,
        meters: r.meters,
        pool: r.pool,
        photoPath: r.photo_path,
        photoUrl: this._photoUrl(sb, r.photo_path),
        createdAt: r.created_at,
      })),
    );
  }

  async addSession({ swimmerId, pin, date, meters, pool, photoBlob } = {}) {
    const v = validateSession({ date, meters, today: localDateStr() });
    if (!v.ok) throw new UserError(Object.values(v.errors)[0]);
    const poolValue = checkPool(pool);
    const sb = await this.client();

    let photoPath = null;
    if (photoBlob) {
      photoPath = `${swimmerId}/${uuid()}.jpg`;
      const { error } = await sb.storage
        .from(PHOTO_BUCKET)
        .upload(photoPath, photoBlob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
      if (error) {
        const e = new Error(`Photo upload failed: ${error.message || 'unknown error'}`);
        e.status = error.statusCode ? Number(error.statusCode) : undefined;
        throw e;
      }
    }

    try {
      return await this._rpc('add_session', {
        p_swimmer_id: swimmerId,
        p_pin: String(pin ?? ''),
        p_date: v.value.date,
        p_meters: v.value.meters,
        p_pool: poolValue,
        p_photo_path: photoPath,
      });
    } catch (e) {
      // Do not leave an orphan photo behind when the session itself was rejected.
      if (photoPath) {
        try {
          await sb.storage.from(PHOTO_BUCKET).remove([photoPath]);
        } catch {
          /* best effort */
        }
      }
      throw e;
    }
  }

  async deleteSession({ sessionId, swimmerId, pin } = {}) {
    const photoPath = await this._rpc('delete_session', {
      p_session_id: sessionId,
      p_swimmer_id: swimmerId,
      p_pin: String(pin ?? ''),
    });
    if (photoPath) {
      try {
        const sb = await this.client();
        await sb.storage.from(PHOTO_BUCKET).remove([photoPath]);
      } catch {
        /* the session is gone already; a leftover photo is harmless */
      }
    }
  }

  async listPools() {
    const sb = await this.client();
    const { data, error, status } = await sb
      .from('sessions')
      .select('pool')
      .not('pool', 'is', null)
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) SupabaseAdapter._raise(error, status);
    return distinctPools(data.map((r) => r.pool));
  }
}

/** Pick the adapter from config: Supabase when both values are set, demo otherwise. */
export function createDb({ url, anonKey, storage } = {}) {
  if (url && anonKey) return new SupabaseAdapter(url.replace(/\/+$/, ''), anonKey);
  return new DemoAdapter(storage === undefined ? safeLocalStorage() : storage);
}
