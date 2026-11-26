const test = require('node:test');
const assert = require('node:assert/strict');
const { PandoraApi, PandoraError } = require('../src/main/pandora');

// Replaces fetch with a queue of canned Pandora replies and records what was sent.
function mockFetch(replies) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: new URL(url), body: init.body });
    const next = replies.shift();
    if (!next) throw new Error('unexpected request');
    return { ok: next.ok ?? true, status: next.status ?? 200, json: async () => next.json };
  };
  return calls;
}

const ok = (result) => ({ json: { stat: 'ok', result } });
const fail = (code, message = 'nope') => ({ json: { stat: 'fail', code, message } });

// A logged-in client with encryption keys set up, for tests that don't care about the handshake.
async function ready() {
  const api = new PandoraApi();
  const { Blowfish } = await import('egoroof-blowfish');
  api.enc = new Blowfish('6#26FRL$ZWD', Blowfish.MODE.ECB, Blowfish.PADDING.NULL);
  api.dec = new Blowfish('R=U!LH$O2B#', Blowfish.MODE.ECB, Blowfish.PADDING.NULL);
  Object.assign(api, { partnerId: 'p1', partnerToken: 'pt', userId: 'u1', userToken: 'ut', saved: { username: 'a', password: 'b' } });
  return api;
}

test('request bodies are Blowfish-ECB hex with a fixed, known encoding', async () => {
  const api = await ready();
  const hex = Buffer.from(api.enc.encode('{"a":1}')).toString('hex');
  // Pinned from the reference implementation so an accidental change to key, mode or padding fails loudly.
  assert.equal(hex, 'de01075121019795');
});

test('a Pandora failure becomes an error with a readable message and its code', async () => {
  const api = await ready();
  mockFetch([fail(1002)]);
  await assert.rejects(api.call('user.getStationList'), (e) => e instanceof PandoraError && e.code === 1002 && /password/i.test(e.message));
});

test('an expired token logs in again once and retries the call', async () => {
  const api = await ready();
  let logins = 0;
  api.login = async () => { logins++; };
  mockFetch([fail(1001), ok({ stations: [] })]);
  const r = await api.authed('user.getStationList', {});
  assert.deepEqual(r, { stations: [] });
  assert.equal(logins, 1);
});

test('without saved credentials an expired token is reported, not retried', async () => {
  const api = await ready();
  api.saved = null;
  mockFetch([fail(1001)]);
  await assert.rejects(api.authed('user.getStationList', {}), { code: 1001 });
});

test('network failures and HTTP errors surface as friendly errors', async () => {
  const api = await ready();
  global.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  await assert.rejects(api.call('x'), /reach Pandora.*ENOTFOUND/);
  mockFetch([{ ok: false, status: 503, json: {} }]);
  await assert.rejects(api.call('x'), /HTTP 503/);
});

test('stations are mapped and Thumbprint is recognised by name or flag', async () => {
  const api = await ready();
  mockFetch([ok({ stations: [
    { stationToken: '1', stationName: 'Quick Mix', isQuickMix: true },
    { stationToken: '2', stationName: 'Thumbprint Radio' },
    { stationToken: '3', stationName: 'Jazz', artUrl: 'http://x/y.jpg' },
  ] })]);
  const list = await api.getStations();
  assert.deepEqual(list.map((s) => [s.token, s.isQuickMix, s.isThumbprint]), [['1', true, false], ['2', false, true], ['3', false, false]]);
  assert.equal(list[2].artUrl, 'http://x/y.jpg');
});

test('the playlist skips ads, honours the quality setting and falls back to what exists', async () => {
  const api = await ready();
  const item = (id, map) => ({ trackToken: id, songName: id, artistName: 'A', albumName: 'B', audioUrlMap: map, albumArtUrl: 'http://art/x_130W_130H.jpg' });
  const reply = () => ok({ items: [
    item('t1', { highQuality: { audioUrl: 'hi' }, lowQuality: { audioUrl: 'lo' } }),
    item('t2', { lowQuality: { audioUrl: 'only-lo' } }),
    { adToken: 'ad' }, // no audio: an advert
    item('t3', {}),
  ] });
  mockFetch([reply(), reply()]);
  const high = await api.getPlaylist('s', 'high');
  assert.deepEqual(high.map((t) => [t.id, t.audioUrl]), [['t1', 'hi'], ['t2', 'only-lo']]);
  const low = await api.getPlaylist('s', 'low');
  assert.equal(low[0].audioUrl, 'lo');
  assert.equal(high[0].artUrls[0], 'http://art/x_500W_500H.jpg'); // upgraded to the large size, original kept as fallback
  assert.equal(high[0].artUrls[1], 'http://art/x_130W_130H.jpg');
});

test('station detail tags seeds by kind and lists newest thumbs first', async () => {
  const api = await ready();
  mockFetch([ok({
    music: { artists: [{ seedId: 'a', artistName: 'Artist' }], songs: [{ seedId: 's', songName: 'Song', artistName: 'Artist' }], genres: [{ seedId: 'g', genreName: 'Rock' }] },
    feedback: { thumbsUp: [{ feedbackId: 'old', songName: 'Old', dateCreated: { time: 1 } }, { feedbackId: 'new', songName: 'New', dateCreated: { time: 9 } }], thumbsDown: [] },
  })]);
  const d = await api.getStationDetail('tok');
  assert.deepEqual(d.seeds.map((s) => [s.kind, s.name]), [['artist', 'Artist'], ['song', 'Song'], ['genre', 'Rock']]);
  assert.deepEqual(d.up.map((f) => f.id), ['new', 'old']);
});

test('search groups artists, songs and genres and drops hits without a token', async () => {
  const api = await ready();
  mockFetch([ok({
    artists: [{ musicToken: 'm1', artistName: 'Miles' }, { artistName: 'No token' }],
    songs: [{ musicToken: 'm2', songName: 'So What', artistName: 'Miles' }],
    genreStations: [{ musicToken: 'm3', stationName: 'Jazz' }],
  })]);
  const r = await api.search('miles');
  assert.deepEqual([r.artists.length, r.songs.length, r.genres.length], [1, 1, 1]);
  assert.equal(r.songs[0].subtitle, 'Miles');
});
