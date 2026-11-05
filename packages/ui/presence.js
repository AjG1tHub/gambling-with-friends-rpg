// Presence readings shared by the consoles (pure).
// A pill beside the Table screen link, in every phase: whether a TV page is pinging. Before the run starts the TV
// warning box below stays quiet, so this is the only place a GM sees "no TV yet" in the lobby.
export function tvStatus(presenceTv, now = Date.now(), staleMs = 45000) {
  if (!presenceTv) return { cls: 'bad', text: 'No TV' };
  const age = now - presenceTv;
  return age > staleMs ? { cls: 'bad', text: `TV dropped ${Math.round(age / 1000)}s ago` } : { cls: 'ok', text: 'TV live' };
}
