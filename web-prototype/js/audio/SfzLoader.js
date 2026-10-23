/*
 * SfzLoader — loads a real multi-sampled piano described by an SFZ file
 * (e.g. the free Salamander Grand Piano) from a folder the user picks.
 *
 * Supported SFZ subset: <control> default_path, <global>/<master>/<group>/<region> inheritance,
 * #define, sample, key, lokey, hikey, pitch_keycenter, lovel, hivel, tune, transpose,
 * volume, amp_veltrack, trigger=attack|release. CC-triggered regions (pedal noises) are skipped.
 *
 * To keep RAM sane in a browser, velocity layers can be reduced and samples trimmed.
 */
(function (P) {
  'use strict';

  function listSfzFiles(fileList) {
    return Array.from(fileList)
      .filter(f => /\.sfz$/i.test(f.name))
      .sort((a, b) => relPath(a).localeCompare(relPath(b)));
  }

  async function load(ctx, fileList, sfzFile, opts, onProgress) {
    const maxLayers = opts.maxLayers || 4;
    const maxSeconds = opts.maxSeconds || 8;

    const byPath = new Map();
    for (const f of fileList) byPath.set(relPath(f).toLowerCase(), f);

    const text = await sfzFile.text();
    const { regions, control } = parseSfz(text);
    const baseDir = dirname(relPath(sfzFile));

    let attack = [], release = [];
    for (const r of regions) {
      if (!r.sample) continue;
      if (Object.keys(r).some(k => /^(on_lo|on_hi)cc/.test(k))) continue;
      const path = normalize(joinPath(baseDir, (control.default_path || '') + r.sample));
      const z = toZone(r, path);
      (r.trigger === 'release' ? release : attack).push(z);
    }
    if (!attack.length) throw new Error('No playable regions found in ' + sfzFile.name);

    attack = reduceLayers(attack, maxLayers);
    release = reduceLayers(release, 1);

    const needed = [...new Set([...attack, ...release].map(z => z.path))];
    const missing = needed.filter(p => !byPath.has(p.toLowerCase()));
    if (missing.length === needed.length) {
      throw new Error('Sample files not found next to the SFZ. First expected: ' + missing[0]);
    }

    const buffers = new Map();
    let done = 0;
    const queue = needed.filter(p => byPath.has(p.toLowerCase()));
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift();
        const file = byPath.get(p.toLowerCase());
        try {
          const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
          buffers.set(p, trim(ctx, decoded, maxSeconds));
        } catch (e) {
          console.warn('Could not decode', p, e);
        }
        done++;
        if (onProgress) onProgress(done / needed.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    const attach = zs => zs.filter(z => buffers.has(z.path)).map(z => ({ ...z, buffer: buffers.get(z.path) }));
    return {
      name: sfzFile.name.replace(/\.sfz$/i, ''),
      zones: attach(attack),
      releaseZones: attach(release),
      panSpread: 0, // multi-mic piano samples already carry their stereo image
      missingCount: missing.length,
    };
  }

  // --- parsing -------------------------------------------------------------

  function parseSfz(text) {
    const defines = {};
    text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    text = text.replace(/^\s*#define\s+(\$\w+)\s+(\S+).*$/gm, (_, k, v) => { defines[k] = v; return ''; });
    text = text.replace(/^\s*#.*$/gm, ''); // other directives (#include) unsupported
    for (const k of Object.keys(defines).sort((a, b) => b.length - a.length)) text = text.split(k).join(defines[k]);

    const control = {};
    let global = {}, master = {}, group = {}, current = {};
    const regions = [];
    for (const part of text.split(/(<[a-z_]+>)/i)) {
      const header = part.match(/^<([a-z_]+)>$/i);
      if (header) {
        switch (header[1].toLowerCase()) {
          case 'control': current = control; break;
          case 'global': global = {}; master = {}; group = {}; current = global; break;
          case 'master': master = {}; group = {}; current = master; break;
          case 'group': group = {}; current = group; break;
          case 'region': current = Object.assign({}, global, master, group); regions.push(current); break;
          default: current = {}; // <curve>, <effect>, <midi> ... ignored
        }
        continue;
      }
      parseOpcodes(part, current);
    }
    return { regions, control };
  }

  // Values may contain spaces (sample paths), so a value runs until the next "opcode=".
  function parseOpcodes(str, target) {
    const re = /([A-Za-z0-9_]+)=/g;
    const hits = [];
    let m;
    while ((m = re.exec(str))) hits.push({ key: m[1].toLowerCase(), start: m.index, valueStart: re.lastIndex });
    for (let i = 0; i < hits.length; i++) {
      const end = i + 1 < hits.length ? hits[i + 1].start : str.length;
      target[hits[i].key] = str.slice(hits[i].valueStart, end).trim();
    }
  }

  function toZone(r, path) {
    let lokey = parseKey(r.lokey, 0), hikey = parseKey(r.hikey, 127);
    let root = parseKey(r.pitch_keycenter, 60);
    if (r.key != null) { lokey = hikey = root = parseKey(r.key, 60); }
    return {
      path,
      root,
      lokey, hikey,
      lovel: num(r.lovel, 1), hivel: num(r.hivel, 127),
      tune: num(r.tune, 0),
      transpose: num(r.transpose, 0),
      gain: Math.pow(10, num(r.volume, 0) / 20),
      velTrack: num(r.amp_veltrack, 100) / 100,
    };
  }

  // Keep at most `maxLayers` velocity layers, evenly spread, and widen them to cover 1..127.
  function reduceLayers(zones, maxLayers) {
    const ranges = [...new Set(zones.map(z => z.lovel + '-' + z.hivel))]
      .map(s => s.split('-').map(Number))
      .sort((a, b) => a[1] - b[1]);
    if (ranges.length <= maxLayers) return zones.map(applyTranspose);
    const keep = [];
    for (let i = 0; i < maxLayers; i++) {
      const r = ranges[Math.round(i * (ranges.length - 1) / Math.max(1, maxLayers - 1))];
      if (!keep.includes(r)) keep.push(r);
    }
    const remap = new Map();
    keep.forEach((r, i) => remap.set(r.join('-'), [i === 0 ? 1 : keep[i - 1][1] + 1, i === keep.length - 1 ? 127 : r[1]]));
    return zones
      .filter(z => remap.has(z.lovel + '-' + z.hivel))
      .map(z => {
        const [lovel, hivel] = remap.get(z.lovel + '-' + z.hivel);
        return applyTranspose({ ...z, lovel, hivel });
      });
  }

  // SFZ transpose plays the sample N semitones higher, i.e. its effective root is N lower.
  function applyTranspose(z) {
    return { ...z, root: z.root - (z.transpose || 0) };
  }

  function trim(ctx, buf, maxSeconds) {
    const maxLen = Math.floor(maxSeconds * buf.sampleRate);
    if (buf.length <= maxLen) return buf;
    const out = ctx.createBuffer(buf.numberOfChannels, maxLen, buf.sampleRate);
    const fade = Math.floor(0.3 * buf.sampleRate);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const src = buf.getChannelData(ch).subarray(0, maxLen);
      const dst = out.getChannelData(ch);
      dst.set(src);
      for (let i = maxLen - fade; i < maxLen; i++) dst[i] *= (maxLen - i) / fade;
    }
    return out;
  }

  // --- helpers -------------------------------------------------------------

  const PITCH = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  function parseKey(v, dflt) {
    if (v == null || v === '') return dflt;
    if (/^-?\d+$/.test(v)) return parseInt(v, 10);
    const m = /^([a-g])(#|b)?(-?\d+)$/i.exec(v.trim());
    if (!m) return dflt;
    const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    return 12 * (parseInt(m[3], 10) + 1) + PITCH[m[1].toLowerCase()] + acc; // c4 = 60
  }

  function num(v, dflt) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : dflt;
  }

  function relPath(f) { return (f.webkitRelativePath || f.name).replace(/\\/g, '/'); }
  function dirname(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function joinPath(dir, p) { p = p.replace(/\\/g, '/'); return p.startsWith('/') || !dir ? p : dir + '/' + p; }
  function normalize(p) {
    const out = [];
    for (const seg of p.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') out.pop(); else out.push(seg);
    }
    return out.join('/');
  }

  P.SfzLoader = { listSfzFiles, load, parseSfz, relPath };
})(window.Piano = window.Piano || {});
