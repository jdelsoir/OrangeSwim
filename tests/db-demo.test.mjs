import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DemoAdapter, SupabaseAdapter, createDb, uuid } from '../db.js';
import { localDateStr, monthRange, monthOf } from '../logic.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

describe('createDb', () => {
  test('uses demo mode when keys are missing', () => {
    assert.equal(createDb({ url: '', anonKey: '', storage: new MemoryStorage() }).mode, 'demo');
    assert.equal(createDb({ url: 'https://x.supabase.co', anonKey: '', storage: new MemoryStorage() }).mode, 'demo');
  });
  test('uses Supabase when both are set', () => {
    const db = createDb({ url: 'https://x.supabase.co/', anonKey: 'k' });
    assert.ok(db instanceof SupabaseAdapter);
    assert.equal(db.url, 'https://x.supabase.co');
  });
});

test('uuid returns a v4 uuid', () => {
  assert.match(uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

describe('DemoAdapter', () => {
  let db;
  const today = localDateStr();
  beforeEach(() => { db = new DemoAdapter(new MemoryStorage()); });

  test('register, login and duplicate names (case-insensitive)', async () => {
    const alice = await db.register('  Alice ', '1234');
    assert.equal(alice.name, 'Alice');
    assert.deepEqual(await db.login('alice', '1234'), alice);
    await assert.rejects(db.login('alice', '9999'), /Wrong name or PIN/);
    await assert.rejects(db.register('ALICE', '0000'), /already taken/);
    await assert.rejects(db.register('A', '0000'), /at least 2/);
    await assert.rejects(db.register('Bob', '12'), /4 digits/);
    assert.deepEqual((await db.listSwimmers()).map((s) => s.name), ['Alice']);
  });

  test('swimmer list never exposes the PIN', async () => {
    await db.register('Alice', '1234');
    const [s] = await db.listSwimmers();
    assert.deepEqual(Object.keys(s).sort(), ['id', 'name']);
  });

  test('add, list (enriched, filtered by month) and delete sessions', async () => {
    const a = await db.register('Alice', '1234');
    const b = await db.register('Bob', '5678');
    await db.addSession({ swimmerId: a.id, pin: '1234', date: today, meters: 1000, pool: ' Neptune ' });
    await db.addSession({ swimmerId: b.id, pin: '5678', date: today, meters: '2500' });
    await db.addSession({ swimmerId: a.id, pin: '1234', date: '2020-01-15', meters: 400, pool: 'neptune' });

    const { year, month } = monthOf(today);
    const range = monthRange(year, month);
    const thisMonth = await db.listSessions(range);
    assert.equal(thisMonth.length, 2);
    assert.ok(thisMonth.every((s) => s.date >= range.start && s.date < range.end));
    const bobs = thisMonth.find((s) => s.swimmerId === b.id);
    assert.equal(bobs.swimmerName, 'Bob');
    assert.equal(bobs.meters, 2500);
    assert.equal(bobs.photoUrl, null);
    assert.equal(thisMonth.find((s) => s.swimmerId === a.id).pool, 'Neptune');

    const mine = await db.listSessions({ swimmerId: a.id });
    assert.equal(mine.length, 2);
    assert.deepEqual(await db.listPools(), ['Neptune']);

    await assert.rejects(db.deleteSession({ sessionId: bobs.id, swimmerId: a.id, pin: '1234' }), /not yours/);
    await assert.rejects(db.deleteSession({ sessionId: bobs.id, swimmerId: b.id, pin: '0000' }), /Wrong name or PIN/);
    await db.deleteSession({ sessionId: bobs.id, swimmerId: b.id, pin: '5678' });
    assert.equal((await db.listSessions(range)).length, 1);
  });

  test('addSession checks PIN and validates like the server', async () => {
    const a = await db.register('Alice', '1234');
    await assert.rejects(db.addSession({ swimmerId: a.id, pin: '0000', date: today, meters: 100 }), /Wrong name or PIN/);
    await assert.rejects(db.addSession({ swimmerId: a.id, pin: '1234', date: '2999-01-01', meters: 100 }), /future/);
    await assert.rejects(db.addSession({ swimmerId: a.id, pin: '1234', date: today, meters: 0 }), /between 1 and/);
    await assert.rejects(db.addSession({ swimmerId: a.id, pin: '1234', date: today, meters: 100, pool: 'x'.repeat(81) }), /too long/);
  });

  test('data persists across adapter instances sharing storage', async () => {
    const storage = new MemoryStorage();
    const one = new DemoAdapter(storage);
    await one.register('Alice', '1234');
    const two = new DemoAdapter(storage);
    assert.equal((await two.listSwimmers()).length, 1);
  });

  test('works without storage (in-memory fallback) and on corrupt data', async () => {
    const noStorage = new DemoAdapter(null);
    await noStorage.register('Alice', '1234');
    assert.equal((await noStorage.listSwimmers()).length, 1);

    const storage = new MemoryStorage();
    storage.setItem('orangeswim.demo.v1', '{not json');
    const corrupt = new DemoAdapter(storage);
    assert.deepEqual(await corrupt.listSwimmers(), []);
  });

  test('quota errors become a friendly message', async () => {
    const full = new MemoryStorage();
    full.setItem = () => { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; };
    const d = new DemoAdapter(full);
    await assert.rejects(d.register('Alice', '1234'), /ran out of storage/);
  });
});

describe('SupabaseAdapter (with a fake client)', () => {
  function fakeLibrary(log, { failRpc = false } = {}) {
    const storageApi = {
      upload: async (path) => { log.push(['upload', path]); return { data: { path }, error: null }; },
      remove: async (paths) => { log.push(['remove', paths]); return { data: [], error: null }; },
      getPublicUrl: (path) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/photos/${path}` } }),
    };
    const client = {
      rpc: async (fn, args) => {
        log.push(['rpc', fn, args]);
        if (failRpc) return { data: null, error: { message: 'Wrong name or PIN.', code: 'P0001' }, status: 400 };
        if (fn === 'delete_session') return { data: 'sw1/photo.jpg', error: null, status: 200 };
        return { data: 'new-id', error: null, status: 200 };
      },
      storage: { from: () => storageApi },
    };
    return async () => ({ createClient: () => client });
  }

  const blob = { size: 10, type: 'image/jpeg' };
  const today = localDateStr();

  test('addSession uploads the photo under swimmerId/ then calls add_session', async () => {
    const log = [];
    const db = new SupabaseAdapter('https://x.supabase.co', 'k', fakeLibrary(log));
    const id = await db.addSession({ swimmerId: 'sw1', pin: '1234', date: today, meters: '900', pool: ' Lido ', photoBlob: blob });
    assert.equal(id, 'new-id');
    assert.equal(log[0][0], 'upload');
    assert.match(log[0][1], /^sw1\/[0-9a-f-]{36}\.jpg$/);
    assert.equal(log[1][1], 'add_session');
    assert.deepEqual({ ...log[1][2], p_photo_path: undefined }, {
      p_swimmer_id: 'sw1', p_pin: '1234', p_date: today, p_meters: 900, p_pool: 'Lido', p_photo_path: undefined,
    });
    assert.equal(log[1][2].p_photo_path, log[0][1]);
  });

  test('a rejected add_session removes the uploaded photo', async () => {
    const log = [];
    const db = new SupabaseAdapter('https://x.supabase.co', 'k', fakeLibrary(log, { failRpc: true }));
    await assert.rejects(
      db.addSession({ swimmerId: 'sw1', pin: '0000', date: today, meters: 100, photoBlob: blob }),
      (e) => e.code === 'P0001' && /Wrong name or PIN/.test(e.message),
    );
    assert.deepEqual(log.map((l) => l[0]), ['upload', 'rpc', 'remove']);
    assert.deepEqual(log[2][1], [log[0][1]]);
  });

  test('deleteSession removes the returned photo path', async () => {
    const log = [];
    const db = new SupabaseAdapter('https://x.supabase.co', 'k', fakeLibrary(log));
    await db.deleteSession({ sessionId: 's1', swimmerId: 'sw1', pin: '1234' });
    assert.deepEqual(log[1], ['remove', ['sw1/photo.jpg']]);
  });

  test('a failed library load can be retried', async () => {
    let calls = 0;
    const db = new SupabaseAdapter('https://x.supabase.co', 'k', async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch dynamically imported module');
      return { createClient: () => ({ ok: true }) };
    });
    await assert.rejects(db.client());
    assert.deepEqual(await db.client(), { ok: true });
  });
});
