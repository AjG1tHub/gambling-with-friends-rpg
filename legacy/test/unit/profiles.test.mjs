import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkGame } from './_helpers.mjs';
const PR = await import('../../site/js/profiles.js');
const HI = await import('../../site/js/history.js');

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('saving a profile stores name + icon and gives it an id', () => {
  const st = mem(); const r = PR.saveProfile({ name: '  Aj ', iconUrl: 'data:x' }, st, 1000);
  assert.equal(r.created, true); assert.equal(r.profile.name, 'Aj'); assert.match(r.profile.id, /^pr/);
  assert.deepEqual(PR.loadProfiles(st).map(p => [p.name, p.iconUrl, p.timesPlayed]), [['Aj', 'data:x', 0]]);
});

test('the same name (any case) is one profile; a new icon replaces the old, a blank one does not', () => {
  const st = mem(); const a = PR.saveProfile({ name: 'Aj', iconUrl: 'one' }, st).profile;
  const b = PR.saveProfile({ name: 'AJ' }, st);
  assert.equal(b.created, false); assert.equal(b.profile.id, a.id); assert.equal(PR.loadProfiles(st)[0].iconUrl, 'one');
  PR.saveProfile({ name: 'aj', iconUrl: 'two' }, st);
  assert.equal(PR.loadProfiles(st).length, 1); assert.equal(PR.loadProfiles(st)[0].iconUrl, 'two');
});

test('a profile needs a name', () => {
  const st = mem(); assert.equal(PR.saveProfile({ name: '   ' }, st).error, true); assert.equal(PR.loadProfiles(st).length, 0);
});

test('rename checks for blanks and clashes; icon can be changed', () => {
  const st = mem(); const a = PR.saveProfile({ name: 'Aj' }, st, 1).profile; PR.saveProfile({ name: 'Nick' }, st, 2);
  assert.equal(PR.updateProfile(a.id, { name: 'nick' }, st).error, true);
  assert.equal(PR.updateProfile(a.id, { name: ' ' }, st).error, true);
  assert.equal(PR.updateProfile('nope', { name: 'X' }, st).error, true);
  assert.equal(PR.updateProfile(a.id, { name: 'Anthony', iconUrl: 'pic' }, st).profile.name, 'Anthony');
  assert.equal(PR.updateProfile(a.id, { name: 'ANTHONY' }, st).error, undefined);     // re-casing yourself is fine
  assert.deepEqual(PR.loadProfiles(st).map(p => p.name).sort(), ['ANTHONY', 'Nick']);
});

test('delete removes only that profile', () => {
  const st = mem(); const a = PR.saveProfile({ name: 'Aj' }, st, 1).profile; PR.saveProfile({ name: 'Nick' }, st, 2);
  assert.equal(PR.deleteProfile(a.id, st).error, undefined); assert.equal(PR.deleteProfile(a.id, st).error, true);
  assert.deepEqual(PR.loadProfiles(st).map(p => p.name), ['Nick']);
});

test('corrupt storage loads as an empty roster', () => {
  const st = mem();
  for (const junk of ['nope', '{}', '[{"name":"no id"}]', '[{"id":"x","name":"  "}]']) { st.setItem(PR.PROFILES_KEY, junk); assert.deepEqual(PR.loadProfiles(st), []); }
});

test('a seat from a profile carries the name, icon, starting bank and profile id', () => {
  const p = PR.playerFromProfile({ id: 'pr1', name: 'Aj', iconUrl: 'pic' }, 7, 500);
  assert.deepEqual([p.name, p.iconUrl, p.pos, p.balances.Gold, p.profileId, p.jailTier], ['Aj', 'pic', 7, 500, 'pr1', 0]);
  assert.deepEqual(p.loans, []);
});

test('isSeated matches by profile id or by name', () => {
  const c = mkGame(['Aj', 'Nick']); c.players[1].profileId = 'pr2';
  assert.equal(PR.isSeated(c.state, { id: 'pr9', name: 'AJ' }), true);
  assert.equal(PR.isSeated(c.state, { id: 'pr2', name: 'Nicholas' }), true);
  assert.equal(PR.isSeated(c.state, { id: 'pr3', name: 'Sam' }), false);
});

test('starting a session stamps the profiles at the table and sorts recent players first', () => {
  const st = mem(); const a = PR.saveProfile({ name: 'Aj' }, st, 1).profile; const n = PR.saveProfile({ name: 'Nick' }, st, 2).profile; PR.saveProfile({ name: 'Sam' }, st, 3);
  const c = mkGame(['Nick', 'Guest']); c.players[0].profileId = n.id;
  assert.equal(PR.touchProfiles(c.state, st, 9000), 1);
  const list = PR.loadProfiles(st);
  assert.deepEqual(list.map(p => p.name), ['Nick', 'Aj', 'Sam']); assert.deepEqual([list[0].timesPlayed, list[0].lastPlayed], [1, 9000]);
  assert.equal(list.find(p => p.id === a.id).timesPlayed, 0);
});

test('Hall of Fame folds sessions played under a bare name into the profile', () => {
  const profiles = [{ id: 'pr1', name: 'Aj' }];
  const hist = [
    { id: 'a', endedAt: 1, players: [{ key: 'name:aj', name: 'aj', rank: 1, net: 100 }, { key: 'name:nick', name: 'Nick', rank: 2, net: -100 }], awards: [{ key: 'jailbird', playerKey: 'name:aj' }] },
    { id: 'b', endedAt: 2, players: [{ key: 'profile:pr1', name: 'Aj', rank: 1, net: 300 }, { key: 'name:nick', name: 'Nick', rank: 2, net: -300 }], awards: [] },
  ];
  const split = HI.hallOfFame(hist); assert.equal(split.length, 3);                  // without the map: two "Aj"s
  const hof = HI.hallOfFame(hist, PR.profileKeyMap(profiles));
  assert.equal(hof.length, 2);
  assert.deepEqual([hof[0].key, hof[0].name, hof[0].sessions, hof[0].titles, hof[0].totalNet, hof[0].bestStreak, hof[0].awards], ['profile:pr1', 'Aj', 2, 2, 400, 2, 1]);
});

test('summaries key profiled players by profile, so a rename keeps their history', () => {
  const c = mkGame(['Aj', 'Nick']); c.p.profileId = 'pr1';
  const s = HI.summarizeSession(c.config, c.state, 1);
  assert.deepEqual(s.players.map(p => p.key).sort(), ['name:nick', 'profile:pr1']);
});

test('export carries the roster; import merges it without duplicating names or ids', () => {
  const a = mem(), b = mem();
  const aj = PR.saveProfile({ name: 'Aj', iconUrl: 'pic' }, a, 1).profile; PR.saveProfile({ name: 'Nick' }, a, 2);
  const c = mkGame(['Aj', 'Nick']); c.p.profileId = aj.id; HI.archiveSession(c.config, c.state, a, 10);
  const file = HI.exportHistory(a);
  PR.saveProfile({ name: 'nick' }, b, 5);                                             // already known on the other computer
  const r = HI.importHistory(file, b);
  assert.deepEqual([r.added, r.profilesAdded], [1, 1]);
  assert.deepEqual(PR.loadProfiles(b).map(p => p.name).sort(), ['Aj', 'nick']);
  assert.equal(HI.importHistory(file, b).profilesAdded, 0);
});

test('a roster-only file still imports', () => {
  const st = mem(); const r = HI.importHistory(JSON.stringify({ sessions: [], profiles: [{ id: 'pr1', name: 'Aj' }] }), st);
  assert.equal(r.error, undefined); assert.equal(r.profilesAdded, 1);
});
