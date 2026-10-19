// Player profiles (Phase 7). A saved roster in this browser so regulars are one click to
// seat, keep their icon, and keep one identity in the Hall of Fame even if a name is
// typed differently next time. Profile: { id, name, iconUrl, createdAt, lastPlayed, timesPlayed }.
import { newPlayer } from './state.js';

export const PROFILES_KEY = 'gwf_profiles';
const norm = (name) => String(name || '').trim().toLowerCase();
const safeParse = (raw) => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; } };
const valid = (p) => p && typeof p === 'object' && typeof p.id === 'string' && norm(p.name);

export function loadProfiles(storage = globalThis.localStorage) {
  return safeParse(storage.getItem(PROFILES_KEY)).filter(valid).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.name.localeCompare(b.name));
}
export function saveProfiles(list, storage = globalThis.localStorage) { storage.setItem(PROFILES_KEY, JSON.stringify(list)); return list; }
export const findProfileByName = (list, name) => list.find(p => norm(p.name) === norm(name)) || null;

// Create, or return the existing profile with that name (a new icon replaces the old one).
export function saveProfile({ name, iconUrl = '' }, storage = globalThis.localStorage, now = Date.now()) {
  const clean = String(name || '').trim();
  if (!clean) return { error: true, text: 'A profile needs a name.' };
  const list = loadProfiles(storage);
  const existing = findProfileByName(list, clean);
  if (existing) {
    if (iconUrl) existing.iconUrl = iconUrl;
    saveProfiles(list, storage);
    return { profile: existing, created: false, text: `${existing.name} is already saved.` };
  }
  const profile = { id: 'pr' + now.toString(36) + Math.floor(Math.random() * 1e6).toString(36), name: clean, iconUrl, createdAt: now, lastPlayed: 0, timesPlayed: 0 };
  list.push(profile); saveProfiles(list, storage);
  return { profile, created: true, text: `${clean} saved to the roster.` };
}

export function updateProfile(id, patch, storage = globalThis.localStorage) {
  const list = loadProfiles(storage); const p = list.find(x => x.id === id);
  if (!p) return { error: true, text: 'No such profile.' };
  if (patch.name != null) {
    const clean = String(patch.name).trim();
    if (!clean) return { error: true, text: 'A profile needs a name.' };
    const clash = findProfileByName(list, clean);
    if (clash && clash.id !== id) return { error: true, text: `There is already a ${clash.name}.` };
    p.name = clean;
  }
  if (patch.iconUrl != null) p.iconUrl = patch.iconUrl;
  saveProfiles(list, storage);
  return { profile: p, text: `${p.name} updated.` };
}

export function deleteProfile(id, storage = globalThis.localStorage) {
  const list = loadProfiles(storage); const next = list.filter(p => p.id !== id);
  if (next.length === list.length) return { error: true, text: 'No such profile.' };
  saveProfiles(next, storage);
  return { text: 'Profile removed. Past sessions stay in the Hall of Fame.' };
}

// A seat at the table for a saved profile.
export function playerFromProfile(profile, startPos, startingBank, now = Date.now()) {
  const p = newPlayer('p' + now + Math.floor(Math.random() * 999), profile.name, profile.iconUrl || '', startPos, startingBank);
  p.profileId = profile.id;
  restoreProgress(p, profile);
  return p;
}
export const isSeated = (state, profile) => state.players.some(p => p.profileId === profile.id || norm(p.name) === norm(profile.name));

// Session start: stamp everyone at the table who has a profile.
export function touchProfiles(state, storage = globalThis.localStorage, now = Date.now()) {
  const list = loadProfiles(storage); let n = 0;
  for (const pl of state.players) {
    const pr = list.find(x => x.id === pl.profileId); if (!pr) continue;
    pr.lastPlayed = now; pr.timesPlayed = (pr.timesPlayed || 0) + 1; n++;
  }
  if (n) saveProfiles(list, storage);
  return n;
}

// Sessions played under a bare name before the profile existed belong to the same person.
export function profileKeyMap(profiles) {
  const map = {};
  for (const p of profiles) map['name:' + norm(p.name)] = 'profile:' + p.id;
  return map;
}

export function mergeProfiles(incoming, storage = globalThis.localStorage) {
  const list = loadProfiles(storage); let added = 0;
  for (const p of (incoming || []).filter(valid)) {
    if (list.some(x => x.id === p.id) || findProfileByName(list, p.name)) continue;
    list.push({ id: p.id, name: String(p.name).trim(), iconUrl: p.iconUrl || '', createdAt: p.createdAt || Date.now(), lastPlayed: p.lastPlayed || 0, timesPlayed: p.timesPlayed || 0 }); added++;
  }
  if (added) saveProfiles(list, storage);
  return added;
}

// ── Side-game progress (pets + Power Level) travels with the profile ──
// Gold resets every session; pets and Power are the long game, so they are saved on the
// profile when a session ends and handed back the next time that player is seated.
export function restoreProgress(player, profile) {
  if (!profile) return player;
  if (Array.isArray(profile.pets)) { player.pets = structuredClone(profile.pets); for (const pet of player.pets) { pet.fainted = false; pet.hp = pet.hpMax; } }
  if (profile.activePetId) player.activePetId = profile.activePetId;
  if (Number.isFinite(profile.power)) player.power = profile.power;
  if (Number.isFinite(profile.powerEarned)) player.powerEarned = profile.powerEarned;
  if (profile.petItems && typeof profile.petItems === 'object') player.petItems = { ...profile.petItems };
  return player;
}
export function stashProgress(state, storage = globalThis.localStorage) {
  const list = loadProfiles(storage); let n = 0;
  for (const pl of state.players) {
    const pr = list.find(x => x.id === pl.profileId); if (!pr) continue;
    pr.pets = structuredClone(pl.pets || []); pr.activePetId = pl.activePetId || null; pr.power = Math.round(pl.power || 0); pr.powerEarned = Math.round(pl.powerEarned || 0); pr.petItems = { ...(pl.petItems || {}) }; n++;
  }
  if (n) saveProfiles(list, storage);
  return n;
}
