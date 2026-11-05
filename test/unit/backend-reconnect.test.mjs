// The reconnect hooks of the two network backends, against stub sockets/clients. room.js back-fills on onReconnect
// and packages/ui/client.js shows a banner on onDisconnect, so both must fire exactly as the comments promise:
// not on the first connection, once per drop, and again on each successful re-open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWsBackend } from '../../packages/shared/backend/ws.js';
import { createSupabaseBackend } from '../../packages/shared/backend/supabase.js';

// A WebSocket stand-in the test opens and closes by hand.
let sockets = [];
class FakeWS { constructor(url) { this.url = url; this.sent = []; sockets.push(this); } send(s) { this.sent.push(JSON.parse(s)); } close() { this.onclose?.(); } }

test('ws backend: onDisconnect once per drop, onReconnect on every re-open after the first', async () => {
  sockets = [];
  const be = createWsBackend({ url: 'ws://x', WebSocketImpl: FakeWS });
  const drops = [], backs = [];
  be.onDisconnect(() => drops.push(Date.now())); be.onReconnect(() => backs.push(Date.now()));
  sockets[0].onopen();
  assert.deepEqual([drops.length, backs.length], [0, 0], 'the first open is not a reconnect');
  sockets[0].onclose();                       // the open socket drops
  assert.equal(drops.length, 1, 'one disconnect');
  await new Promise(r => setTimeout(r, 350)); // back-off 300 ms → a new socket
  assert.equal(sockets.length, 2, 'a retry socket was made');
  sockets[1].onerror(); sockets[1].onclose(); // the retry fails: no second disconnect notice
  assert.equal(drops.length, 1, 'a failed retry is not another drop');
  await new Promise(r => setTimeout(r, 650));
  assert.ok(sockets.length >= 3); sockets.at(-1).onopen();
  assert.equal(backs.length, 1, 'the re-open is a reconnect');
  sockets.at(-1).onclose(); assert.equal(drops.length, 2, 'the next drop counts again');
  be.close();
});

test('supabase backend: a second SUBSCRIBED is a reconnect, CHANNEL_ERROR / TIMED_OUT after joining is a disconnect', () => {
  let cb = null;
  const ch = { on() { return ch; }, subscribe(fn) { cb = fn; return ch; } };
  const client = { channel: () => ch, removeChannel() {} };
  const be = createSupabaseBackend({ client });
  const drops = [], backs = [];
  be.onDisconnect(() => drops.push(1)); be.onReconnect(() => backs.push(1));
  be.subscribe('r1', () => {});
  cb('CHANNEL_ERROR'); assert.equal(drops.length, 0, 'an error before the first join is not a drop (nothing to lose yet)');
  cb('SUBSCRIBED'); assert.deepEqual([drops.length, backs.length], [0, 0]);
  cb('TIMED_OUT'); assert.equal(drops.length, 1);
  cb('SUBSCRIBED'); assert.equal(backs.length, 1);
  cb('CLOSED'); cb('SUBSCRIBED'); assert.deepEqual([drops.length, backs.length], [2, 2]);
});
