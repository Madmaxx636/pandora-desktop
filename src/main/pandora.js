// Client for Pandora's unofficial JSON v5 API (http://6xq.net/playground/pandora-apidoc/json/).
const HOST = 'tuner.pandora.com';
const INVALID_AUTH_TOKEN = 1001;

// Public "android" partner credentials, as documented in the API write-up above.
const PARTNER_USER = 'android';
const PARTNER_PASS = 'AC7IBG09A3DTSYM4R41UJWL07VLN8JI7';
const DEVICE_MODEL = 'android-generic';
const ENCRYPT_KEY = '6#26FRL$ZWD';
const DECRYPT_KEY = 'R=U!LH$O2B#';

// Pandora's own messages are often just "An unexpected error occurred".
const FRIENDLY = {
  1: 'Pandora is down for maintenance.',
  12: 'Pandora isn’t available in your region.',
  1002: 'Incorrect email or password. Accounts that sign in with Google, Apple or Facebook need a Pandora password set first.',
  1003: 'Your Pandora account has no subscription for this action.',
  1005: 'You have no stations on this account yet.',
  1007: 'That station no longer exists.',
  1009: 'This device isn’t authorised for your account.',
  1010: 'Pandora is restricting access right now. Try again later.',
  1018: 'Your Pandora account is temporarily locked or was flagged. Try again later.',
  1023: 'Skip limit reached for now.',
  1039: 'Skip limit reached for now.',
};

class PandoraError extends Error {
  constructor(message, code = -1) {
    super(message);
    this.code = code;
  }
}

let blowfish;
async function loadBlowfish() {
  if (!blowfish) blowfish = await import('egoroof-blowfish');
  return blowfish.Blowfish;
}

const toHex = (bytes) => Buffer.from(bytes).toString('hex');
const fromHex = (hex) => Uint8Array.from(Buffer.from(hex, 'hex'));

class PandoraApi {
  constructor() {
    this.reset();
  }

  reset() {
    this.partnerId = null;
    this.partnerToken = null;
    this.userId = null;
    this.userToken = null;
    this.timeOffset = 0;
  }

  async login(username, password) {
    this.saved = { username, password };
    this.reset();
    const Blowfish = await loadBlowfish();
    this.enc = new Blowfish(ENCRYPT_KEY, Blowfish.MODE.ECB, Blowfish.PADDING.NULL);
    this.dec = new Blowfish(DECRYPT_KEY, Blowfish.MODE.ECB, Blowfish.PADDING.NULL);

    const partner = await this.call(
      'auth.partnerLogin',
      { username: PARTNER_USER, password: PARTNER_PASS, deviceModel: DEVICE_MODEL, version: '5' },
      false,
    );
    this.partnerId = partner.partnerId;
    this.partnerToken = partner.partnerAuthToken;

    // The decrypted sync time is a few bytes of garbage followed by 10 digits of unix time. Decode to
    // raw bytes (the garbage isn't valid UTF-8) and pick the digits out by pattern.
    const plain = Buffer.from(this.dec.decode(fromHex(partner.syncTime), Blowfish.TYPE.UINT8_ARRAY)).toString('latin1');
    const digits = plain.match(/\d{10}/);
    if (!digits) throw new PandoraError('Could not read Pandora server time');
    this.timeOffset = parseInt(digits[0], 10) - Math.floor(Date.now() / 1000);

    const user = await this.call('auth.userLogin', {
      loginType: 'user',
      username,
      password,
      returnIsSubscriber: true,
    });
    this.userId = user.userId;
    this.userToken = user.userAuthToken;
    return { subscriber: !!user.isSubscriber };
  }

  async getStations() {
    const r = await this.authed('user.getStationList', { includeStationArtUrl: true });
    return r.stations.map((s) => ({
      token: s.stationToken,
      name: s.stationName,
      isQuickMix: !!s.isQuickMix,
      isThumbprint: !!s.isThumbprint || s.stationName === 'Thumbprint Radio',
      artUrl: s.artUrl || null,
    }));
  }

  // quality is 'high' | 'medium' | 'low'; the other streams are fallbacks if that one is missing.
  async getPlaylist(stationToken, quality = 'high') {
    const r = await this.authed('station.getPlaylist', { stationToken });
    const order = {
      high: ['highQuality', 'mediumQuality', 'lowQuality'],
      medium: ['mediumQuality', 'lowQuality', 'highQuality'],
      low: ['lowQuality', 'mediumQuality', 'highQuality'],
    }[quality] || ['highQuality', 'mediumQuality', 'lowQuality'];
    return (r.items || [])
      .filter((o) => o.audioUrlMap)
      .map((o) => {
        const audioUrl = order.map((q) => o.audioUrlMap[q]?.audioUrl).find(Boolean);
        if (!audioUrl) return null;
        const art = artCandidates(o);
        return {
          id: o.trackToken,
          title: o.songName || '',
          artist: o.artistName || '',
          album: o.albumName || '',
          artUrls: art,
          audioUrl,
          stationToken,
          rating: o.songRating || 0,
        };
      })
      .filter(Boolean);
  }

  async search(searchText) {
    const r = await this.authed('music.search', {
      searchText,
      includeNearMatches: false,
      includeGenreStations: true,
    });
    const hit = (token, title, subtitle, kind) => ({ token, title, subtitle, kind });
    const keep = (h) => h.token;
    return {
      artists: (r.artists || []).map((a) => hit(a.musicToken, a.artistName, 'Artist', 'artist')).filter(keep),
      songs: (r.songs || []).map((s) => hit(s.musicToken, s.songName, s.artistName, 'song')).filter(keep),
      genres: (r.genreStations || []).map((g) => hit(g.musicToken, g.stationName, 'Genre station', 'genre')).filter(keep),
    };
  }

  // Everything the tune screen shows: the seeds the station is built from and its thumbs, newest first.
  async getStationDetail(stationToken) {
    const r = await this.authed('station.getStation', { stationToken, includeExtendedAttributes: true });
    const music = r.music || {};
    const art = (o) => o.artUrl || null;
    const seeds = [
      ...(music.artists || []).map((a) => ({ id: a.seedId, kind: 'artist', name: a.artistName, subtitle: 'Artist', artUrl: art(a) })),
      ...(music.songs || []).map((x) => ({ id: x.seedId, kind: 'song', name: x.songName, subtitle: x.artistName, artUrl: art(x) })),
      ...(music.genres || []).map((g) => ({ id: g.seedId, kind: 'genre', name: g.genreName, subtitle: 'Genre', artUrl: null })),
    ].filter((x) => x.id && x.name);
    const thumbs = (list) =>
      (list || [])
        .slice()
        .sort((a, b) => (b.dateCreated?.time || 0) - (a.dateCreated?.time || 0))
        .map((f) => ({
          id: f.feedbackId,
          title: f.songName || '',
          artist: f.artistName || '',
          album: f.albumName || '',
          artUrls: f.albumArtUrl ? [f.albumArtUrl] : [],
        }))
        .filter((f) => f.id);
    return {
      seeds,
      up: thumbs(r.feedback?.thumbsUp),
      down: thumbs(r.feedback?.thumbsDown),
      created: r.dateCreated?.time || null,
    };
  }

  addSeed(stationToken, musicToken) {
    return this.authed('station.addMusic', { stationToken, musicToken });
  }

  removeSeed(seedId) {
    return this.authed('station.deleteMusic', { seedId });
  }

  renameStation(stationToken, stationName) {
    return this.authed('station.renameStation', { stationToken, stationName });
  }

  removeRating(feedbackId) {
    return this.authed('station.deleteFeedback', { feedbackId });
  }

  createStation(musicToken) {
    return this.authed('station.createStation', { musicToken });
  }

  deleteStation(stationToken) {
    return this.authed('station.deleteStation', { stationToken });
  }

  async rate(stationToken, trackToken, isPositive) {
    const r = await this.authed('station.addFeedback', { stationToken, trackToken, isPositive });
    return r.feedbackId || null;
  }

  async authed(method, args) {
    try {
      return await this.call(method, { ...args });
    } catch (e) {
      if (e.code !== INVALID_AUTH_TOKEN || !this.saved) throw e;
      await this.login(this.saved.username, this.saved.password);
      return this.call(method, { ...args });
    }
  }

  async call(method, args = {}, encrypted = true) {
    const query = new URLSearchParams();
    if (this.partnerId) query.set('partner_id', this.partnerId);
    if (this.userId) query.set('user_id', this.userId);
    const token = this.userToken || this.partnerToken;
    if (token) query.set('auth_token', token);
    query.set('method', method);

    if (this.partnerId) args.syncTime = Math.floor(Date.now() / 1000) + this.timeOffset;
    if (this.userToken) args.userAuthToken = this.userToken;
    else if (this.partnerToken) args.partnerAuthToken = this.partnerToken;

    const json = JSON.stringify(args);
    const body = encrypted ? toHex(this.enc.encode(json)) : json;

    const res = await fetch(`https://${HOST}/services/json/?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
    });
    if (!res.ok) throw new PandoraError(`HTTP ${res.status}`);
    const tree = await res.json();
    if (tree.stat === 'fail') {
      throw new PandoraError(FRIENDLY[tree.code] || tree.message || 'Pandora error', tree.code);
    }
    return tree.result || {};
  }
}

// Pandora's art fields are inconsistent; collect every candidate so the UI can fall through on a 404.
function artCandidates(item) {
  const urls = (item.albumArt || [])
    .slice()
    .sort((a, b) => (b.size || 0) - (a.size || 0))
    .map((e) => e.url)
    .filter(Boolean);
  if (item.albumArtUrl) {
    urls.push(item.albumArtUrl.replace(/_\d+W_\d+H/, '_500W_500H'), item.albumArtUrl);
  }
  return [...new Set(urls)];
}

module.exports = { PandoraApi, PandoraError };
