// Silly Cam's own made-up creatures, as costume filters. They're all original: our own names, colours
// and mixes of parts (ears, horns, crests, shells, wings...), so the app can be shared one day.
// CREATURES.md lists every creature's name and design (and who made it), for your own records.
// The part builders below turn each short description into 3D pieces with the same helpers as the
// other filters (canonical face coordinates in cm: nose tip ≈ (0,-0.5,7.6), forehead ≈ (0,8.3,4.5),
// eyes ≈ (±3.3,2.9,3.6), chin ≈ (0,-9.4,4.3); the top of the head is around y 13).
// Open your mouth to use the creature's type move: sparks, fire, bubbles, leaves, smoke...
import * as F3 from './filters3d.js';

const { mat, mesh, ball, capsule, cone, at, fur, gloss, gold, beadHorn, Wobble, emit, glow, parts, canvasTexture, earGeometry, animalNose, catNose, realWhiskers, tongueGeometry, tongueMat } = F3;
const T = () => F3.THREE; // three.js loads lazily, so read it at build time

export const TYPES = {
  normal: { emoji: '⭐', fx: 0xffe8a3 }, fire: { emoji: '🔥', fx: 0xff7b00 }, water: { emoji: '💧', fx: 0x4dabf7 },
  grass: { emoji: '🌿', fx: 0x69db7c }, electric: { emoji: '⚡', fx: 0xffe066 }, ice: { emoji: '❄️', fx: 0xc5f6fa },
  fighting: { emoji: '👊', fx: 0xff8787 }, poison: { emoji: '☠️', fx: 0xb197fc }, ground: { emoji: '⛰️', fx: 0xd9a066 },
  flying: { emoji: '🪶', fx: 0xe7f5ff }, psychic: { emoji: '🔮', fx: 0xf783ac }, bug: { emoji: '🐛', fx: 0xc0eb75 },
  rock: { emoji: '🪨', fx: 0xbfa77a }, ghost: { emoji: '👻', fx: 0x845ef7 }, dragon: { emoji: '🐉', fx: 0x7950f2 },
  fairy: { emoji: '🧚', fx: 0xfcc2d7 },
};

// ---------------------------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------------------------
const glowSprite = (color, additive = true, opacity = 1) => {
  const THREE = T();
  return new THREE.SpriteMaterial({ map: glow(), color, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, transparent: true, depthWrite: false, opacity });
};
function starGeometry(r = 1, depth = 0.4, inner = 0.45) {
  const THREE = T(), s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? r * inner : r;
    i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: r * 0.06, bevelSegments: 2 });
  g.center();
  return g;
}
// Wings that sit behind your head: 'bat' (pointed scallops), 'bird' (feathery), 'bug' (round, see-through).
function wingGeometry(style, size) {
  const THREE = T(), s = new THREE.Shape(), k = size;
  if (style === 'bat') {
    s.moveTo(0, 0); s.quadraticCurveTo(k * 0.5, k * 0.55, k, k * 0.45); s.quadraticCurveTo(k * 0.82, k * 0.15, k * 0.78, -k * 0.05);
    s.quadraticCurveTo(k * 0.62, k * 0.1, k * 0.5, -k * 0.12); s.quadraticCurveTo(k * 0.35, k * 0.02, k * 0.22, -k * 0.15); s.lineTo(0, 0);
  } else if (style === 'bird') {
    s.moveTo(0, 0); s.quadraticCurveTo(k * 0.3, k * 0.7, k, k * 0.55);
    for (let i = 0; i < 5; i++) { const x = k * (1 - i * 0.18), y = k * (0.5 - i * 0.12); s.lineTo(x - k * 0.05, y - k * 0.12); s.lineTo(x - k * 0.18, y - k * 0.04); }
    s.lineTo(0, 0);
  } else { s.moveTo(0, 0); s.bezierCurveTo(k * 0.2, k * 0.9, k * 1.05, k * 0.75, k * 0.95, k * 0.2); s.bezierCurveTo(k * 0.9, -k * 0.2, k * 0.4, -k * 0.35, 0, 0); }
  return new THREE.ShapeGeometry(s, 20);
}
function spotTexture(base, spot, n = 14, big = 18) {
  return canvasTexture(256, 128, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h); c.fillStyle = spot;
    for (let i = 0; i < n; i++) { c.beginPath(); c.ellipse(((i * 97) % w) + 6, ((i * 53) % h) + 4, big * (0.5 + ((i * 7) % 5) / 6), big * 0.45 * (0.6 + ((i * 3) % 4) / 5), i, 0, 7); c.fill(); }
  });
}
let flameTex = null;
function flameTexture() {
  return (flameTex ||= canvasTexture(64, 128, (c, w, h) => {
    const img = c.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = 1 - y / h, u = (x / w - 0.5) * 2; // v: 0 at the base .. 1 at the tip
      const half = 0.95 * Math.pow(1 - v, 0.65) * (0.75 + 0.25 * Math.sin(v * 9)); // tapering with gentle waves
      const edge = Math.max(0, 1 - Math.abs(u) / Math.max(half, 0.001));
      const a = Math.pow(edge, 1.4) * Math.min(1, (1 - v) * 3) * Math.min(1, v * 6 + 0.3);
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(255 * a);
    }
    c.putImageData(img, 0, 0);
  }));
}
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const TOP = 13.2; // just above your hair

// ---------------------------------------------------------------------------------------------
// Realism helpers. Real creature parts, not costume pieces: horns that taper and curve with soft growth
// rings and darker roots, wet noses, layered feathers, see-through membranes, cut gems.
// Detail comes from shape and soft colour gradients only (fine high-contrast texture shimmers like grain).
// ---------------------------------------------------------------------------------------------
const tint = (c, k, to = 0x000000) => new (T().Color)(c).lerp(new (T().Color)(to), k);
// A tube along `curve` that tapers from r0 to r1, coloured from `base` to `tip` (vertex colours).
// `rings` adds soft growth ridges near the root, like real horn.
function taperedTube(curve, r0, r1, base, tip, { seg = 40, radial = 16, rings = 0 } = {}) {
  const THREE = T();
  const geo = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = geo.attributes.position, n = radial + 1, col = new Float32Array(pos.count * 3);
  const a = new THREE.Color(base), b = new THREE.Color(tip), c = new THREE.Color(), p = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, centre = curve.getPointAt(t);
    let r = r0 + (r1 - r0) * Math.pow(t, 0.85);
    if (rings) r *= 1 + 0.04 * Math.max(0, Math.sin(t * rings * Math.PI * 2)) * (1 - t);
    c.copy(a).lerp(b, Math.pow(t, 1.2));
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      p.fromBufferAttribute(pos, k).sub(centre).multiplyScalar(r).add(centre);
      pos.setXYZ(k, p.x, p.y, p.z); col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}
// keratin: horn and claw. Satin, with a gentle clear coat.
const keratin = () => new (T().MeshPhysicalMaterial)({ vertexColors: true, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.45 });
// a real horn growing along points [[x,y,z]...] (local to g), in colour c: dark root, pale worn tip
function realHorn(points, r0, c, { rings = 6, tipR = 0.06 } = {}) {
  const THREE = T();
  const curve = new THREE.CatmullRomCurve3(points.map((q) => new THREE.Vector3(...q)));
  return new THREE.Mesh(taperedTube(curve, r0, tipR, tint(c, 0.45), tint(c, 0.4, 0xf3e9d2), { rings }), keratin());
}
// A feather: a soft leaf shape, darker towards the tip.
function featherGeometry(len, wid, base, tip) {
  const THREE = T(), s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(wid * 0.75, len * 0.3, wid * 0.5, len * 0.82);
  s.quadraticCurveTo(wid * 0.15, len * 1.02, -wid * 0.12, len * 0.92);
  s.quadraticCurveTo(-wid * 0.55, len * 0.4, 0, 0);
  const geo = new THREE.ShapeGeometry(s, 12);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const a = new THREE.Color(base), b = new THREE.Color(tip), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { c.copy(a).lerp(b, Math.min(1, Math.max(0, pos.getY(i) / len)) ** 1.4); col.set([c.r, c.g, c.b], i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
const featherMat = () => new (T().MeshPhysicalMaterial)({ vertexColors: true, roughness: 0.72, sheen: 0.5, sheenRoughness: 0.5, side: T().DoubleSide });
// A bird wing of overlapping feathers (long flight feathers under shorter coverts), pointing out along +x.
function featherWing(size, c) {
  const THREE = T(), w = new THREE.Group(), m = featherMat();
  const rows = [ // [count, length, width, colour from, colour to, z]
    [9, 0.62, 0.16, tint(c, 0.05), tint(c, 0.45), 0],
    [7, 0.38, 0.14, tint(c, 0.15, 0xffffff), tint(c, 0.15), 0.12],
    [6, 0.2, 0.12, tint(c, 0.3, 0xffffff), tint(c, 0.05), 0.24],
  ];
  for (const [n, L, W, from, to, z] of rows) {
    const geo = featherGeometry(size * L, size * W, from, to);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      const f = new THREE.Mesh(geo, m);
      f.position.set(size * 0.55 * t, size * 0.42 * t * (1 - L * 0.4), z);
      f.rotation.z = -1.3 + t * 1.05; // fanned out, the outer ones sweeping up
      w.add(f);
    }
  }
  return w;
}
// a tuft of real fur along points (tapering), with plush fur shells from the engine
function furTuft(points, r0, r1, color) {
  const THREE = T();
  const curve = new THREE.CatmullRomCurve3(points.map((q) => new THREE.Vector3(...q)));
  return new THREE.Mesh(taperedTube(curve, r0, r1, color, color, { seg: 18, radial: 10 }), fur(color));
}
// wet look for noses
function wet(group) {
  const THREE = T();
  group.traverse((o) => { if (o.isMesh && o.material?.color) o.material = new THREE.MeshPhysicalMaterial({ color: o.material.color.clone(), roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.12 }); });
  return group;
}

// ---------------------------------------------------------------------------------------------
// Part builders. Each is (g, kit, P, o) => optional update(st). P = the creature, o = options.
// ---------------------------------------------------------------------------------------------
const EAR_DEFAULTS = {
  pointy: { x: 5, y: 10.4, z: -1.6, len: 5.5, wid: 4.6, tilt: 0.3 },
  long: { x: 4.4, y: 11, z: -1.4, len: 10, wid: 3.6, tilt: 0.38 },
  round: { x: 6.6, y: 9.6, z: -2.4, r: 2.8 },
  floppy: { x: 6.6, y: 8.8, z: -2.4, len: 8, wid: 5 },
  fin: { x: 7.4, y: 2.4, z: -3, len: 6, wid: 4.4 },
  wing: { x: 7.4, y: 4, z: -3, len: 5, wid: 3.6 },
  spiky: { x: 4.6, y: 10.6, z: -1.6, len: 6, wid: 3 },
};
const B = {
  // A soft fleece costume hood in the creature's colours that frames your face (like a kid's
  // animal onesie hood). The ears and horns poke out of it. (Not to be confused with `hood`,
  // the hard pointy cocoon further down.)
  costumeHood(g, kit, P, o) {
    const THREE = T();
    const R = 11.4, sx = 0.98, sy = 1.08, bottom = 2.45; // reaches down beside your jaw
    const col = new THREE.Color(o.c ?? P.c), light = col.clone().lerp(new THREE.Color(0xffffff), 0.12);
    const h = at(0, 2.4, -3.2);
    // the back half of a soft dome: from the front you see its inside all round your face.
    // Turned inside out (normals pointing at you) so its plush fur grows towards you, like a real
    // fleece costume hood, and so it's lit from the inside the way you see it.
    const dome = new THREE.SphereGeometry(R, 48, 24, Math.PI, Math.PI, 0, bottom);
    const nrm = dome.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
    const idx = dome.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    h.add(mesh(dome, mat(col.getHex(), { r: 0.9, furry: true, double: true }), [0, 0, 0], [0, 0, 0], [sx, sy, 1]));
    // a fluffy trim round the opening
    const pts = [];
    for (let i = 0; i <= 24; i++) { const th = bottom - (i / 24) * bottom; pts.push(new THREE.Vector3(Math.sin(th) * R * sx, Math.cos(th) * R * sy, 0.6)); }
    for (let i = 1; i <= 24; i++) { const th = (i / 24) * bottom; pts.push(new THREE.Vector3(-Math.sin(th) * R * sx, Math.cos(th) * R * sy, 0.6)); }
    h.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 140, 1.15, 10), fur(light.getHex())));
    g.add(h);
  },
  ears(g, kit, P, o) {
    const THREE = T();
    const kind = o.kind || 'pointy', d = { ...EAR_DEFAULTS[kind], ...o };
    const col = o.c ?? P.c, inner = o.inner === undefined ? 0xffc9d9 : o.inner;
    const furM = fur(col);
    const list = [-1, 1].map((s) => {
      const e = at(s * d.x, d.y, d.z);
      if (kind === 'round') {
        // a real round furry ear, cupped like a bear's or mouse's (no flat coloured disc stuck on the front)
        e.add(mesh(earGeometry(d.r * 1.8, d.r * 2.2, { pointy: false, cup: 0.6, thick: 0.55 }), furM, [0, -d.r * 0.85, 0], [-0.15, 0, -s * 0.2]));
      } else if (kind === 'fin' || kind === 'wing') {
        const geo = earGeometry(d.len, d.wid, { cup: 0.15, thick: 0.25 });
        e.add(mesh(geo, kind === 'wing' ? mat(col, { r: 0.55 }) : mat(col, { r: 0.3, cc: 0.8, op: 0.82, double: true }), [0, 0, 0], [0, s * 0.7, -s * (Math.PI / 2 - 0.45)]));
      } else if (kind === 'spiky') {
        for (let i = 0; i < 3; i++) e.add(mesh(cone(d.wid * 0.35, d.len * (1 - i * 0.2), 12), furM, [s * i * 0.9, -i * 0.6, -i * 0.5], [0, 0, -s * (0.25 + i * 0.35)], [1, 1, 0.5]));
      } else {
        const pointy = kind !== 'floppy';
        const ear = mesh(earGeometry(d.len, d.wid, { pointy, cup: 0.45, thick: 0.4 }), furM);
        if (kind === 'floppy') ear.rotation.set(0, s * 0.35, Math.PI);
        e.add(ear);
        if (inner !== null && kind !== 'floppy') e.add(mesh(earGeometry(d.len * 0.72, d.wid * 0.62, { pointy, cup: 0.45, thick: 0.2 }), mat(inner, { r: 0.6 }), [0, d.len * 0.08, 0.5]));
        if (o.tip != null) e.add(mesh(earGeometry(d.len * 0.38, d.wid * 0.45, { pointy: true, cup: 0.45, thick: 0.45 }), fur(o.tip), [0, d.len * 0.64, 0.08]));
        if (o.curl != null) e.add(mesh(new THREE.TorusGeometry(d.len * 0.13, d.len * 0.05, 8, 20, Math.PI * 1.5), fur(o.curl), [0, d.len * 1.05, 0], [0, 0, s * 0.6]));
        e.rotation.set(-0.15, 0, -s * (d.tilt ?? 0.3));
      }
      g.add(e);
      const mid = at(0, (kind === 'floppy' ? -1 : 1) * (d.len ?? d.r ?? 4) * 0.5, 0); e.add(mid);
      const w = new Wobble(kind === 'long' ? 60 : 100, 5, 0.0004);
      kit.zone(mid, Math.max(2.5, (d.wid ?? d.r ?? 3) * 0.6), { wobble: w });
      const base = e.rotation.clone();
      return (st) => { w.step(st); e.rotation.set(base.x + w.y * 0.4, base.y, base.z + w.x * 0.7); };
    });
    return (st) => list.forEach((f) => f(st));
  },
  horn(g, kit, P, o) {
    const len = o.len ?? 5, h = at(o.x ?? 0, o.y ?? 11.4, o.z ?? 2.5);
    h.rotation.set(o.tilt ?? 0.35, 0, o.rz ?? 0);
    h.add(realHorn([[0, -0.4, 0], [0, len * 0.5, -len * 0.08], [0, len, -len * 0.22]], o.r ?? 1.1, o.c ?? 0xf1f3f5));
    g.add(h);
    kit.zone(h, 2.6, { squish: true, burst: TYPES[P.type].fx });
  },
  horns(g, kit, P, o) {
    const sp = o.spread ?? 1, up = o.up ?? 1;
    for (const s of [-1, 1]) {
      g.add(realHorn([[s * 3.3, 9.6, 0.4], [s * 3.6, 10.4, 0], [s * (4.4 + sp), 12.6 * up, -1], [s * (5 + sp * 2.4), 14.8 * up, -2.6]], o.r ?? 1.1, o.c ?? 0xf1f3f5));
      const spot = at(s * (4.4 + sp), 12.6 * up, -1); g.add(spot);
      kit.zone(spot, 2.4, { burst: TYPES[P.type].fx });
    }
  },
  noseHorn(g, kit, P, o) {
    const h = at(0, 0.4, 8.4); h.rotation.x = 0.55;
    const L = o.len ?? 4;
    h.add(realHorn([[0, -0.3, 0], [0, L * 0.5, 0.1], [0, L, L * 0.25]], o.r ?? 1, o.c ?? 0xe9ecef, { rings: 4 }));
    g.add(h); kit.zone(h, 2, { squish: true, burst: 0xffffff });
  },
  cheeks(g, kit, P, o) {
    const THREE = T();
    // soft round blush that fades out at the edges, like real rosy cheeks (not shiny buttons)
    const blush = canvasTexture(128, 128, (c, w, h) => {
      const gr = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.fillRect(0, 0, w, h); // smooth only: specks shimmer like grain
    });
    const m = mat(o.c ?? 0xe8402d, { r: 0.6, map: blush, op: 0.45, dw: false, e: o.spark ? (o.c ?? 0xe8402d) : 0x000000, ei: o.spark ? 0.25 : 1 });
    const spots = [-1, 1].map((s) => { const c = mesh(new THREE.CircleGeometry(2.4, 32), m, [s * 4.5, -1.7, 4.7], [0, s * 0.62, 0]); c.renderOrder = 2; g.add(c); kit.zone(c, 2.2, { squish: true, burst: TYPES[P.type].fx }); return c; });
    if (!o.spark) return;
    let t0 = 0, flash = 0;
    const sparkM = glowSprite(0xffe066);
    const zap = new THREE.PointLight(0x9fd8ff, 0, 18, 2); // each crackle briefly lights up your face
    g.add(zap);
    return (st) => { // little crackles from the cheeks
      t0 -= st.dt;
      flash = Math.max(0, flash - st.dt * 9);
      zap.intensity = 90 * flash;
      if (t0 > 0 || parts.length > 80) return;
      t0 = 0.25 + Math.random() * 0.6;
      const c = spots[(Math.random() * 2) | 0];
      const cp = c.parent && c.parent !== g ? c.parent.position : c.position; // the touch wrapper holds the cheek's place
      zap.position.set(cp.x * 1.1, cp.y, cp.z + 2); flash = 1;
      const s = new THREE.Sprite(sparkM.clone());
      s.position.copy(c.getWorldPosition(new THREE.Vector3()));
      emit(st.world, s, new THREE.Vector3((Math.random() - 0.5) * 20, (Math.random() - 0.3) * 20, (Math.random() - 0.5) * 10), 0.3, 'spark', { ownMat: true, size: 1.2 });
    };
  },
  nose(g, kit, P, o) {
    const THREE = T(), kind = o.kind || 'cat', col = o.c ?? 0x2b2b2b;
    let n;
    if (kind === 'cat') n = wet(catNose(col, o.size ?? 1.6));
    else if (kind === 'dog') n = wet(animalNose(col, o.size ?? 2.4));
    else if (kind === 'beak') {
      n = new THREE.Group();
      n.add(mesh(cone(1.25 * (o.size ?? 1), 3.4 * (o.len ?? 1), 18), gloss(col, { r: 0.35 }), [0, 0, 1.4 * (o.len ?? 1)], [Math.PI / 2, 0, 0], [1, 0.7, 1]));
      n.add(mesh(cone(0.9 * (o.size ?? 1), 2.2 * (o.len ?? 1), 16), gloss(col, { r: 0.35 }), [0, -0.9, 0.9 * (o.len ?? 1)], [Math.PI / 2, 0, 0], [1, 0.5, 1]));
    } else if (kind === 'pig') {
      n = new THREE.Group();
      n.add(mesh(new THREE.CylinderGeometry(1.7, 1.8, 1.4, 32), mat(col, { r: 0.4, cc: 1 }), [0, 0, 0], [Math.PI / 2, 0, 0], [1, 0.8, 1]));
      for (const s of [-1, 1]) n.add(mesh(ball(0.38, 10), gloss(0x5c2a35), [s * 0.6, 0, 0.62], [0, 0, 0], [0.8, 1.3, 0.5]));
    } else if (kind === 'trunk') {
      n = new THREE.Group();
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1.5, 3.5), new THREE.Vector3(0, -5, 3));
      n.add(mesh(new THREE.TubeGeometry(curve, 20, 1, 12), fur(col)));
    } else if (kind === 'bill') { // a flat duck bill over your mouth
      n = new THREE.Group();
      n.add(mesh(ball(1, 28), gloss(col, { r: 0.3 }), [0, 0, 0], [0.15, 0, 0], [2.6 * (o.size ?? 1), 0.55, 1.9]));
      n.add(mesh(ball(1, 24), gloss(col, { r: 0.3 }), [0, -0.75, -0.2], [0.1, 0, 0], [2.3 * (o.size ?? 1), 0.4, 1.6]));
      for (const sd of [-1, 1]) n.add(mesh(ball(0.18, 8), gloss(0x5c3a21), [sd * 0.7, 0.45, 1.4]));
    } else n = mesh(ball(o.size ?? 1.2, 20), gloss(col, { r: 0.25 }), [0, 0, 0], [0, 0, 0], [1.3, 1, 1]);
    n.position.set(0, kind === 'beak' ? -1.2 : kind === 'bill' ? -3 : -0.5, kind === 'beak' ? 7.8 : kind === 'bill' ? 7.6 : 8.2);
    g.add(n);
    kit.zone(n, 1.8, { squish: true, burst: TYPES[P.type].fx });
  },
  whiskers(g, kit, P, o) { realWhiskers(g, o.c ?? 0x222222); },
  barbels(g, kit, P, o) { // fishy whiskers that droop from the upper lip
    const THREE = T(), m = gloss(o.c ?? 0xffd43b, { r: 0.4 });
    for (const s of [-1, 1]) {
      const c = new THREE.CatmullRomCurve3([[s * 1.6, -3.4, 7], [s * 4.5, -3, 8], [s * 7, -5, 7], [s * 8, -8, 5]].map((p) => new THREE.Vector3(...p)));
      g.add(mesh(new THREE.TubeGeometry(c, 30, 0.28, 8), m));
    }
  },
  // ---------- on top of your head ----------
  bulb(g, kit, P, o) {
    const b = at(0, TOP + 1.6, -4);
    b.add(mesh(ball(4.8, 32), mat(0xffffff, { map: spotTexture(hex(o.c ?? 0x51b26a), hex(o.c2 ?? 0x2b8a3e), 16, 20), r: 0.5 }), [0, 0, 0], [0, 0, 0], [1.05, 0.85, 1.05]));
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; b.add(mesh(cone(1.2, 2.4, 10), fur(o.c2 ?? 0x2b8a3e), [Math.sin(a) * 1.4, 4, Math.cos(a) * 1.4], [Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4])); }
    g.add(b); kit.zone(b, 5, { squish: true, grab: true, burst: 0x69db7c });
  },
  bud(g, kit, P, o) {
    const b = at(0, TOP + 1, -3.5);
    b.add(mesh(ball(2.8, 24), mat(o.c ?? 0xf783ac, { r: 0.4 }), [0, 2.4, 0], [0, 0, 0], [1, 1.3, 1]));
    const leaf = mat(0x2f9e44, { r: 0.45, double: true });
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; b.add(mesh(ball(1, 16), leaf, [Math.sin(a) * 3.6, 0.6, Math.cos(a) * 3.6], [0, a, 0.3], [2.4, 0.3, 1.2])); }
    g.add(b); kit.zone(b, 4.5, { squish: true, grab: true, burst: 0xf783ac });
  },
  flower(g, kit, P, o) {
    const f = at(0, TOP + 1.2, -3.5);
    const petal = mat(o.c ?? 0xf06595, { r: 0.45 }), leaf = mat(0x2f9e44, { r: 0.45 });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; f.add(mesh(ball(1, 16), leaf, [Math.sin(a) * 6.5, -0.6, Math.cos(a) * 6.5], [0, a, 0], [1.2, 0.25, 3.4])); }
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.3; f.add(mesh(ball(1, 18), o.spots ? mat(0xffffff, { map: spotTexture(hex(o.c ?? 0xe03131), '#fff5f5', 10, 14), r: 0.45 }) : petal, [Math.sin(a) * 3.6, 0.4, Math.cos(a) * 3.6], [0.25, a, 0], [2.4, 0.5, 3.4])); }
    f.add(mesh(ball(1.6, 18), mat(o.center ?? 0xffd43b, { r: 0.6 }), [0, 0.8, 0]));
    g.add(f); kit.zone(f, 6, { spin: true, grab: true, burst: o.c ?? 0xf06595 });
  },
  leaves(g, kit, P, o) {
    const l = at(0, TOP - 0.4, -2.6), m = mat(o.c ?? 0x2f9e44, { r: 0.45, double: true }), n = o.n ?? 5;
    const all = [];
    for (let i = 0; i < n; i++) {
      const a = ((i / (n - 1)) - 0.5) * 1.6, piv = at(0, 0, 0);
      piv.rotation.set(-0.15, 0, a);
      piv.add(mesh(ball(1, 16), m, [0, 4.2, 0], [0, 0, 0], [1.6, 4.6, 0.35]));
      l.add(piv); all.push(piv);
    }
    g.add(l);
    const w = new Wobble(40, 3, 0.0008);
    kit.zone(l, 5, { wobble: w, burst: 0x69db7c });
    return (st) => { w.step(st); all.forEach((p, i) => (p.rotation.x = -0.15 + w.y * 0.5 + Math.sin(st.t * 2 + i) * 0.04)); l.rotation.z = w.x * 0.4; };
  },
  flame(g, kit, P, o) { // a real-looking flickering flame on top (or behind your head) that lights up the costume
    const THREE = T(), f = at(o.x ?? 0, o.y ?? TOP + 2, o.z ?? (o.back ? -6 : -2.5));
    const tex = flameTexture();
    const mk = (color, opacity) => new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity });
    const licks = [];
    const n = o.n ?? 7, size = o.size ?? 4;
    for (let i = 0; i < n; i++) { // outer orange tongues, then a yellow-white core in front
      const core = i >= n - 2;
      const s = new THREE.Sprite(mk(core ? 0xfff3bf : i % 2 ? 0xff8c1a : 0xff5a00, core ? 0.9 : 0.75));
      s.center.set(0.5, 0.1); // grow upwards from the base, like real flames
      s.position.set(core ? 0 : ((i % 3) - 1) * (o.wide ?? 1.2), core ? 0.2 : (i % 2) * 0.6, core ? 0.6 : Math.sin(i) * 0.6);
      f.add(s); licks.push({ s, base: s.position.clone(), k: Math.random() * 6, core, w: size * (core ? 0.8 : 1.05 + Math.random() * 0.4), h: (o.tall ?? 5) * (core ? 0.85 : 1.2 + Math.random() * 0.6) });
    }
    const warm = new THREE.PointLight(0xff8a30, 0, 26, 2); // firelight on your hood and ears
    warm.position.set(0, 1.5, 1.5); f.add(warm);
    g.add(f); kit.zone(f, 4, { burst: 0xff922b });
    return (st) => {
      let sum = 0;
      for (const p of licks) {
        const fl = 0.75 + Math.sin(st.t * 11 + p.k) * 0.15 + Math.sin(st.t * 23 + p.k * 2) * 0.1;
        p.s.scale.set(p.w * (1.1 - fl * 0.2), p.h * fl, 1);
        p.s.position.x = p.base.x + Math.sin(st.t * 7 + p.k) * 0.25;
        sum += fl;
      }
      warm.intensity = 140 * (sum / licks.length);
    };
  },
  mushrooms(g, kit, P, o) {
    const THREE = T();
    const cap = mat(0xffffff, { map: spotTexture('#e8590c', '#fff4e6', 9, 16), r: 0.45 }), stem = mat(0xfff4e6, { r: 0.7 });
    const big = o.big;
    for (const s of big ? [0] : [-1, 1]) {
      const m = at(s * 3.2, big ? TOP - 1 : TOP, big ? -3.4 : -1);
      if (!big) m.add(mesh(new THREE.CylinderGeometry(0.8, 1, 2, 12), stem, [0, 1, 0]));
      m.add(mesh(new THREE.SphereGeometry(big ? 10.5 : 2.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), cap, [0, big ? 0 : 1.8, 0], [0, 0, 0], [1, big ? 0.7 : 0.8, 1]));
      g.add(m); kit.zone(m, big ? 9 : 3, { squish: true, grab: big, burst: 0xff922b });
    }
  },
  bell(g, kit, P, o) {
    const THREE = T();
    const pts = [[0, 9], [1.2, 8.6], [2.8, 6.4], [3.4, 2.8], [4.6, 0.4], [5.2, 0]].map(([x, y]) => new THREE.Vector2(x * 1.2, y));
    const b = at(0, TOP - 2.4, -3);
    b.add(mesh(new THREE.LatheGeometry(pts, 32), mat(o.c ?? 0xfcc419, { r: 0.4, double: true })));
    for (const s of [-1, 1]) b.add(mesh(ball(1, 16), mat(0x37b24d, { r: 0.45 }), [s * 6, 1.5, 0], [0, 0, s * 0.5], [2.6, 0.35, 1.4]));
    g.add(b); kit.zone(b, 6, { squish: true, grab: true, burst: 0x69db7c });
  },
  vine(g, kit, P, o) {
    const m = fur(o.c ?? 0x2f9e44);
    g.add(beadHorn([[0, TOP - 1, -3], [1.5, TOP + 3, -4], [4, TOP + 5.5, -4], [5.5, TOP + 3.5, -3.5], [4, TOP + 2.2, -3]], 0.7, 0.3, m, 22));
  },
  eggs(g, kit, P, o) {
    const e = at(0, TOP, -3), m = mat(o.c ?? 0xffc9c9, { r: 0.4 });
    [[0, 1.8, 0], [-2.6, 0.4, 0.6], [2.6, 0.4, 0.6], [-1.4, 0.2, -2.4], [1.4, 0.2, -2.4], [0, 0.4, 2.4]].forEach((p) => e.add(mesh(ball(1.7, 18), m, p, [0, 0, 0], [1, 1.25, 1])));
    g.add(e); kit.zone(e, 4.5, { squish: true, grab: true, burst: 0xffc9c9 });
  },
  palm(g, kit, P, o) {
    const p = at(0, TOP, -3), leaf = mat(0x2f9e44, { r: 0.5, double: true }), nut = mat(0xa0522d, { r: 0.55 });
    const fronds = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, piv = at(0, 1, 0);
      piv.rotation.set(0, a, 0);
      const arm = at(0, 0, 0); arm.rotation.x = 0.9;
      arm.add(mesh(ball(1, 16), leaf, [0, 4.5, 0], [0, 0, 0], [1.4, 5, 0.25]));
      piv.add(arm); p.add(piv); fronds.push(arm);
    }
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; p.add(mesh(ball(1.3, 16), nut, [Math.sin(a) * 1.4, 0, Math.cos(a) * 1.4])); }
    g.add(p); kit.zone(p, 5, { spin: true, grab: true, burst: 0x69db7c });
    return (st) => fronds.forEach((f, i) => (f.rotation.x = 0.9 + Math.sin(st.t * 1.5 + i) * 0.06));
  },
  spiral(g, kit, P, o) { // a curly snail/ammonite shell
    const s = at(0, TOP + 0.4, -4.5), m = mat(o.c ?? 0xc8b88a, { r: 0.4 });
    const pts = [];
    for (let i = 0; i <= 40; i++) { const k = i / 40, a = k * Math.PI * 3.4, r = 1 + k * 6.5; pts.push([Math.sin(a) * r * 0.25, Math.cos(a) * r, -Math.sin(a) * r]); }
    s.add(beadHorn(pts, 0.6, 3.4, m, 40));
    if (o.spikes) for (let i = 0; i < 6; i++) { const a = 0.4 + i * 0.45; s.add(mesh(cone(0.8, 2.6, 10), m, [0, Math.cos(a) * 9.5, -Math.sin(a) * 9.5], [-a, 0, 0])); }
    s.rotation.y = Math.PI / 2;
    g.add(s); kit.zone(s, 7, { squish: true, grab: true, burst: 0x4dabf7 });
  },
  dome(g, kit, P, o) { // a shell helmet (or a skull helmet)
    const THREE = T();
    const d = at(0, 6.2, -3.6);
    const tex = o.ball ? canvasTexture(64, 64, (c, w, h) => { c.fillStyle = hex(o.c); c.fillRect(0, 0, w, h * 0.78); c.fillStyle = '#111'; c.fillRect(0, h * 0.78, w, h * 0.22); }) : null;
    if (tex) d.add(mesh(new THREE.SphereGeometry(9.8, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xffffff, { r: 0.3, map: tex }), [0, 0, 0], [0, 0, 0], [1, 0.95, 1.08]));
    else { // a real shell: glossy carapace (or matte bone) with a soft seam down the middle and a darker rim
      const geo = new THREE.SphereGeometry(9.8, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2), pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
      const base = new THREE.Color(o.c ?? 0x8b5a2b), c = new THREE.Color(), rim = tint(base.getHex(), 0.45), crown = tint(base.getHex(), 0.25, 0xffffff);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), k = y / 9.8;
        if (!o.skull) { const seam = Math.exp(-(x * x) / 0.35) * 0.18; pos.setXYZ(i, x * (1 - seam * 0.02), y - seam, pos.getZ(i)); }
        c.copy(rim).lerp(base, Math.min(1, k * 2.2)).lerp(crown, Math.max(0, k - 0.6) * 1.2);
        col.set([c.r, c.g, c.b], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
      const shellM = o.skull ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.7, sheen: 0.3 })
        : new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.12, iridescence: 0.15 });
      d.add(mesh(geo, shellM, [0, 0, 0], [0, 0, 0], [1, 0.95, 1.08]));
    }
    if (o.ball) d.add(mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.6, 24), gloss(0xffffff, { r: 0.2 }), [0, 1.2, 10.4], [Math.PI / 2, 0, 0]));
    if (o.skull) for (const s of [-1, 1]) { d.add(mesh(cone(0.9, 3.4, 12), mat(0xf8f0e3, { r: 0.6 }), [s * 8.4, 3, 2], [0, 0, -s * 1.1])); d.add(mesh(ball(1.4, 14), mat(0x111111, { r: 0.9 }), [s * 3.2, 1.2, 9.6], [0, 0, 0], [1, 0.9, 0.3])); }
    if (o.eyes) for (const s of [-1, 1]) d.add(mesh(ball(1.1, 14), mat(0x111111, { r: 0.3 }), [s * 3, 3, 9.2], [0, 0, 0], [1, 1, 0.4]));
    g.add(d); kit.zone(d, 9, { squish: true, grab: true, burst: TYPES[P.type].fx });
  },
  backShell(g, kit, P, o) { // a big clam shell behind your head
    const THREE = T(), s = at(0, 3, -9.5), m = mat(o.c ?? 0x7950f2, { r: 0.35, double: true }); // seen from the inside, so both sides
    s.add(mesh(new THREE.SphereGeometry(13, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2.4), m, [0, 0, 0], [-Math.PI / 2, 0, 0], [1, 1, 0.45]));
    if (o.spikes) for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; s.add(mesh(cone(1.2, 5, 10), mat(0xadb5bd, { r: 0.4 }), [Math.cos(a) * 12, Math.sin(a) * 12, -1], [0, 0, a - Math.PI / 2])); }
    g.add(s);
  },
  sludge(g, kit, P, o) { // glossy, see-through slime oozing over your head, with drips
    const THREE = T(), d = at(0, TOP - 1, -3), c = o.c ?? 0x9775fa;
    const m = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04, transparent: true, opacity: 0.86, iridescence: 0.1 });
    d.add(mesh(ball(8.6, 40), m, [0, 0, 0], [0, 0, 0], [1, 0.42, 1]));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.2, L = 2.2 + (i % 3) * 1.7, x = Math.sin(a) * 8, z = Math.cos(a) * 8;
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, -0.5, z), new THREE.Vector3(x * 1.01, -1 - L * 0.5, z * 1.01), new THREE.Vector3(x * 1.02, -1.2 - L, z * 1.02)]);
      d.add(new THREE.Mesh(taperedTube(curve, 1.1, 0.55, c, c, { seg: 12, radial: 12 }), m), mesh(ball(0.75, 16), m, [x * 1.02, -1.4 - L, z * 1.02], [0, 0, 0], [1, 1.25, 1]));
    }
    g.add(d); kit.zone(d, 8, { squish: true, grab: true, burst: 0xb197fc });
  },
  crest(g, kit, P, o) { // a feather plume from the forehead, curving back
    const THREE = T(), fm = featherMat();
    const c = at(0, 10.6, 2), n = o.n ?? 4, len = o.len ?? 5;
    for (let i = 0; i < n; i++) {
      const col = i % 2 ? (o.c2 ?? o.c ?? P.c) : (o.c ?? P.c), L = len * (1.2 + i * 0.25);
      const piv = at(0, 0, -i * 0.6); piv.rotation.set(-0.5 - i * 0.28, Math.PI / 2, ((i % 2) - 0.5) * 0.12);
      piv.add(new THREE.Mesh(featherGeometry(L, 1.6, tint(col, 0.2, 0xffffff), tint(col, 0.35)), fm));
      c.add(piv);
    }
    g.add(c);
    const w = new Wobble(40, 3, 0.0008);
    kit.zone(c, 4, { wobble: w, burst: TYPES[P.type].fx });
    return (st) => { w.step(st); c.rotation.set(w.y * 0.4, 0, w.x * 0.5); };
  },
  spikes(g, kit, P, o) { // a row of spikes from your forehead over the top of your head
    const n = o.n ?? 5, k = o.size ?? 1, c = o.c ?? P.c2 ?? P.c;
    for (let i = 0; i < n; i++) {
      const a = 0.25 + (i / n) * 1.4, y = 2.5 + Math.cos(a) * 11.5, z = -4 + Math.sin(a) * 9.5;
      const sp = at(0, y, z); sp.rotation.x = a - 0.2;
      sp.add(realHorn([[0, -0.6, 0], [0, 1.7 * k, -0.25 * k], [0, 3.4 * k, -0.9 * k]], 1.1 * k, c, { rings: 3 }));
      g.add(sp);
    }
  },
  gem(g, kit, P, o) { // a jewel or coin on your forehead
    const THREE = T(), x = at(0, 7, 5.8);
    if (o.kind === 'coin') x.add(mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.35, 28), gold(), [0, 0, 0], [Math.PI / 2, 0, 0]));
    else if (o.kind === 'star') x.add(mesh(starGeometry(1.5, 0.4), gloss(o.c ?? 0xe03131, { r: 0.2 })));
    else x.add(mesh(new THREE.OctahedronGeometry(1.2, 1), new THREE.MeshPhysicalMaterial({ color: o.c ?? 0xe03131, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.25, flatShading: true }), [0, 0, 0], [0, 0, 0], [1, 1.25, 0.55]));
    g.add(x); kit.zone(x, 1.8, { spin: true, axis: 'z', burst: o.c ?? 0xffd43b });
  },
  star(g, kit, P, o) { // a star frame around your head with a jewel
    const s = at(0, 1.5, -4.5), m = gloss(o.c ?? 0xc8a165, { r: 0.35 });
    s.add(mesh(starGeometry(14, 1.2, 0.5), m));
    if (o.double) { const s2 = mesh(starGeometry(13, 1, 0.5), gloss(o.c2 ?? 0x7048e8, { r: 0.35 }), [0, 0, -1.2], [0, 0, Math.PI / 5]); s.add(s2); }
    g.add(s);
    B.gem(g, kit, P, { c: 0xe03131 });
    return (st) => { s.rotation.z = Math.sin(st.t * 0.8) * 0.08; };
  },
  swirl(g, kit, P, o) { // a swirl on your forehead
    const THREE = T(), pts = [];
    for (let i = 0; i <= 60; i++) { const k = i / 60, a = k * Math.PI * 4.5, r = 0.2 + k * 2.6; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)); }
    const sw = at(0, 6.4, 5.7);
    sw.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.28, 6), mat(0x111111, { r: 0.6 })));
    g.add(sw); kit.zone(sw, 2.5, { spin: true, axis: 'z', burst: 0x4dabf7 });
  },
  antennae(g, kit, P, o) {
    const THREE = T(), stalk = gloss(o.c ?? 0x222222, { r: 0.3 }), knob = gloss(o.knob ?? o.c ?? 0x222222, { r: 0.3 });
    const list = [-1, 1].map((s) => {
      const piv = at(s * 2.6, 9.6, 1);
      const len = o.len ?? 7;
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.4, len * 0.55, 0.4), new THREE.Vector3(s * len * 0.35, len, 1));
      piv.add(new THREE.Mesh(taperedTube(curve, 0.3, 0.13, tint(o.c ?? 0x222222, 0.4), o.c ?? 0x222222, { seg: 30, radial: 10, rings: 7 }), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 })));
      const k = mesh(ball(o.knobR ?? 0.7, 14), knob, [s * len * 0.35, len + 0.2, 1]);
      piv.add(k); g.add(piv);
      const w = new Wobble(30, 2.2, 0.0012);
      kit.zone(k, 1.6, { wobble: w, burst: TYPES[P.type].fx });
      return (st) => { w.step(st); piv.rotation.set(w.y * 0.7, 0, w.x * 0.9); };
    });
    return (st) => list.forEach((f) => f(st));
  },
  forkAntenna(g, kit, P, o) {
    const m = gloss(o.c ?? 0xe03131, { r: 0.35 }), a = at(0, TOP - 1.4, 0);
    a.add(mesh(capsule(0.5, 2.6), m, [0, 1.3, 0]));
    for (const s of [-1, 1]) a.add(mesh(capsule(0.45, 2.4), m, [s * 1, 3.4, 0], [0, 0, -s * 0.6]));
    g.add(a);
    const w = new Wobble(30, 2.2, 0.0012);
    kit.zone(a, 2.5, { wobble: w, burst: 0xe03131 });
    return (st) => { w.step(st); a.rotation.set(w.y * 0.5, 0, w.x * 0.7); };
  },
  hood(g, kit, P, o) { // a hard pointy cocoon hood
    const THREE = T();
    const pts = [[0, 17], [2.5, 15], [6, 10.5], [8.6, 5], [9.6, 0]].map(([x, y]) => new THREE.Vector2(x, y));
    const h = at(0, 3.8, -3.6);
    h.add(mesh(new THREE.LatheGeometry(pts, 36, Math.PI * 0.7, Math.PI * 1.6), mat(o.c ?? P.c, { r: 0.35, double: true }), [0, 0, 0], [0, 0, 0], [1, 1, 1.05]));
    g.add(h); kit.zone(h, 9, { squish: true, grab: true, burst: TYPES[P.type].fx });
  },
  cobra(g, kit, P, o) { // a snake hood behind your head
    const THREE = T();
    const tex = canvasTexture(128, 128, (c, w, h) => { c.fillStyle = hex(o.c ?? P.c); c.fillRect(0, 0, w, h); c.fillStyle = '#e8590c'; c.beginPath(); c.ellipse(w / 2, h * 0.45, w * 0.28, h * 0.2, 0, 0, 7); c.fill(); c.fillStyle = '#ffd43b'; c.beginPath(); c.ellipse(w / 2, h * 0.45, w * 0.16, h * 0.1, 0, 0, 7); c.fill(); c.fillStyle = '#111'; c.beginPath(); c.ellipse(w * 0.3, h * 0.75, 8, 5, 0, 0, 7); c.ellipse(w * 0.7, h * 0.75, 8, 5, 0, 0, 7); c.fill(); });
    const hd = mesh(new THREE.CircleGeometry(15, 40), mat(0xffffff, { map: tex, r: 0.45, double: true }), [0, 0, -9.5], [0, 0, 0], [1, 1.15, 1]);
    g.add(hd);
  },
  wings(g, kit, P, o) {
    const THREE = T(), style = o.style ?? 'bird', size = o.size ?? 11, c = o.c ?? P.c;
    // insect wings: thin, clear and rainbow-sheened; bat wings: soft skin you can almost see light through, on finger bones
    const m = style === 'bug' ? mat(o.c ?? 0xffffff, { r: 0.12, op: 0.42, double: true, dw: false, ir: 1 })
      : style === 'bat' ? new THREE.MeshPhysicalMaterial({ color: tint(c, 0.15), roughness: 0.6, sheen: 0.5, sheenColor: tint(c, 0.4, 0xffffff), transparent: true, opacity: 0.9, side: THREE.DoubleSide }) : null;
    const list = [-1, 1].map((s) => {
      const w = at(s * 5, o.y ?? 2, -8);
      const inner = new THREE.Group(); inner.scale.set(s, 1, 1);
      if (style === 'bird') inner.add(featherWing(size, c));
      else {
        inner.add(mesh(wingGeometry(style, size), m));
        if (style === 'bat') for (const [x, y] of [[1, 0.45], [0.78, -0.05], [0.5, -0.12], [0.22, -0.15]]) {
          const bone = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0.05), new THREE.Vector3(size * x * 0.5, size * (y * 0.5 + 0.08), 0.05), new THREE.Vector3(size * x, size * y, 0.05));
          inner.add(new THREE.Mesh(taperedTube(bone, 0.28, 0.06, tint(c, 0.35), tint(c, 0.2), { seg: 16, radial: 8 }), keratin()));
        }
      }
      w.add(inner); g.add(w);
      return { w, s };
    });
    return (st) => { for (const k of list) k.w.rotation.y = k.s * (0.5 + Math.sin(st.t * (o.speed ?? 6)) * 0.35); };
  },
  magnets(g, kit, P, o) {
    const THREE = T(), metal = mat(0xadb5bd, { m: 0.9, r: 0.3 });
    for (const s of [-1, 1]) {
      const m = at(s * 9.4, 1, -3);
      m.add(mesh(new THREE.TorusGeometry(2.2, 0.8, 10, 24, Math.PI), metal, [0, 0, 0], [0, 0, s * Math.PI / 2]));
      m.add(mesh(new THREE.BoxGeometry(1.7, 1.6, 1.6), gloss(0xe03131), [s * 0.1, 2.6, 0]), mesh(new THREE.BoxGeometry(1.7, 1.6, 1.6), gloss(0x1c7ed6), [s * 0.1, -2.6, 0]));
      g.add(m); kit.zone(m, 3, { squish: true, burst: 0xffe066 });
    }
    for (const x of [-3, 3]) { const sc = at(x, TOP, -2); sc.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 2, 8), metal, [0, 1, 0]), mesh(new THREE.CylinderGeometry(1, 1, 0.5, 6), metal, [0, 2.1, 0])); g.add(sc); }
  },
  cannons(g, kit, P, o) {
    const THREE = T(), metal = mat(0xadb5bd, { m: 0.85, r: 0.35 });
    for (const s of [-1, 1]) {
      const c = at(s * 8.6, -2, -5); c.rotation.set(-0.5, 0, s * 0.15);
      c.add(mesh(new THREE.CylinderGeometry(1.4, 1.6, 9, 20), metal, [0, 4.5, 0]));
      c.add(mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.5, 20, 1, true), mat(0x111111, { double: true }), [0, 9, 0]));
      g.add(c); kit.zone(c, 3, { squish: true, burst: 0x4dabf7 });
    }
  },
  claws(g, kit, P, o) {
    const m = gloss(o.c ?? 0xe8590c, { r: 0.35 }), m2 = gloss(0xfff4e6, { r: 0.35 });
    for (const s of o.one ? [1] : [-1, 1]) {
      const big = o.one ? 1.6 : 1;
      const c = at(s * 11, -3, 0);
      c.add(mesh(ball(2.6 * big, 20), m, [0, 0, 0], [0, 0, 0], [1, 1.2, 0.9]));
      c.add(mesh(cone(1.4 * big, 4 * big, 14), m, [0, 3.6 * big, 0.6], [0.2, 0, s * -0.3]), mesh(cone(1.1 * big, 3.2 * big, 14), m2, [s * 1.6 * big, 3 * big, 0.6], [0.2, 0, s * -0.9]));
      g.add(c);
      const w = new Wobble(50, 4, 0.0008);
      kit.zone(c, 4 * big, { squish: true, wobble: w, burst: 0xff922b });
    }
  },
  gloves(g, kit, P, o) { // real leather boxing gloves, held up by your cheeks
    const THREE = T(), c = o.c ?? 0xe03131;
    const leather = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.35, sheen: 0.2 });
    const cuff = new THREE.MeshPhysicalMaterial({ color: 0xf1f3f5, roughness: 0.6, sheen: 0.4 });
    for (const s of [-1, 1]) {
      const gl = at(s * 10.5, -4, 3); gl.rotation.set(0.2, -s * 0.5, -s * 0.25);
      gl.add(mesh(ball(2.8, 32), leather, [0, 0.4, 0], [0, 0, 0], [1, 1.12, 1.05]));
      gl.add(mesh(ball(1.1, 20), leather, [-s * 2.2, -0.6, 1], [0, 0, 0], [1, 1.5, 1]));
      gl.add(mesh(new THREE.CylinderGeometry(2.1, 2.2, 2.4, 32), cuff, [0, -3, 0]));
      g.add(gl); kit.zone(gl, 3.5, { squish: true, burst: 0xff6b6b });
    }
  },
  spoons(g, kit, P, o) {
    const metal = mat(0xced4da, { m: 0.9, r: 0.2 });
    for (const s of o.one ? [1] : [-1, 1]) {
      const sp = at(s * 10.5, -3, 3); sp.rotation.z = -s * 0.25;
      sp.add(mesh(capsule(0.3, 7), metal, [0, 0, 0]), mesh(ball(1.3, 18), metal, [0, 4.6, 0], [0, 0, 0], [1, 1.4, 0.35]));
      g.add(sp); kit.zone(sp, 3, { spin: true, burst: 0xf783ac });
    }
  },
  pendulum(g, kit, P, o) {
    const THREE = T(), p = at(9.5, 8, 4);
    const coin = mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.3, 28), gold(), [0, -8, 0], [Math.PI / 2, 0, 0]);
    p.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 8, 4), mat(0xffffff), [0, -4, 0]), coin);
    g.add(p); kit.zone(coin, 2, { burst: 0xffd43b });
    return (st) => { p.rotation.z = Math.sin(st.t * 2.4) * 0.45; };
  },
  stick(g, kit, P, o) { // a leek or a bone, held over your shoulder
    const THREE = T(), s = at(9, -6, -2); s.rotation.set(0, 0, -0.55);
    if (o.kind === 'bone') {
      const m = mat(0xf8f0e3, { r: 0.6 });
      s.add(mesh(capsule(0.7, 13), m, [0, 6.5, 0]));
      for (const y of [0, 13]) for (const x of [-0.9, 0.9]) s.add(mesh(ball(1.2, 14), m, [x, y, 0]));
    } else {
      s.add(mesh(new THREE.CylinderGeometry(0.9, 1, 9, 14), mat(0xf8f9fa, { r: 0.5 }), [0, 4.5, 0]));
      for (let i = 0; i < 3; i++) s.add(mesh(ball(1, 14), mat(0x37b24d, { r: 0.5 }), [((i % 3) - 1) * 0.9, 12, 0], [0, 0, ((i % 3) - 1) * 0.3], [0.9, 4, 0.4]));
    }
    g.add(s); kit.zone(s, 3, { squish: true, grab: true, burst: 0xffffff });
  },
  mane(g, kit, P, o) { // a full mane of real fur all round your face
    const a1 = o.c ?? 0xfff4e6, a2 = o.c2 ?? tint(a1, 0.18).getHex();
    const m = at(0, 0.6, -3.2);
    for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 24; i++) {
      const a = ((i + ring * 0.5) / 24) * Math.PI * 2, ex = Math.cos(a), ey = Math.sin(a), rx = 8.6 + ring * 1.2, ry = 11 + ring * 1.2, L = 5 + ring * 1.6 + (i % 3);
      m.add(furTuft([[ex * rx, ey * ry, -ring * 1.4], [ex * (rx + L * 0.5), ey * (ry + L * 0.4) - 0.8, -ring * 1.4 - 1.2], [ex * (rx + L), ey * (ry + L * 0.7) - 2.4, -ring * 1.4 - 3]], 2, 0.3, (i + ring) % 2 ? a1 : a2));
    }
    g.add(m); kit.zone(m, 3, { squish: true, burst: 0xffd43b });
  },
  collar(g, kit, P, o) { // a ruff of real fur round your neck (longer, pointed locks if spiky)
    const c = o.c ?? 0xfff4e6, n = 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, x = Math.sin(a), z = Math.cos(a), L = (o.spiky ? 6 : 4.2) * (0.8 + ((i * 7) % 5) / 10);
      g.add(furTuft([[x * 5.4, -10.5, -3.8 + z * 5.4], [x * (6.4 + L * 0.4), -11.4, -3.8 + z * (6.4 + L * 0.4)], [x * (6.4 + L), -13 - L * 0.3, -3.8 + z * (6.4 + L)]], o.spiky ? 1.4 : 1.9, o.spiky ? 0.08 : 0.35, i % 3 ? c : tint(c, 0.12).getHex()));
    }
  },
  shellCollar(g, kit, P, o) {
    const THREE = T();
    g.add(mesh(new THREE.TorusGeometry(10.5, 2, 14, 40), mat(o.c ?? 0xa0522d, { r: 0.4 }), [0, -11.5, -2.5], [Math.PI / 2, 0, 0]));
    g.add(mesh(new THREE.TorusGeometry(10.8, 0.8, 10, 40), mat(0xfff4e6, { r: 0.5 }), [0, -10, -2.5], [Math.PI / 2, 0, 0]));
  },
  vines(g, kit, P, o) { // a tangle of vines
    const THREE = T(), m = fur(o.c ?? 0x3b5bdb);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2, b = 0.3 + ((i * 7) % 10) / 14;
      const p0 = new THREE.Vector3(Math.cos(a) * 9 * Math.cos(b), 3 + Math.sin(b) * 10, -4 + Math.sin(a) * 9 * Math.cos(b));
      const p1 = p0.clone().add(new THREE.Vector3(Math.sin(i) * 4, 3 + Math.cos(i * 2) * 3, Math.cos(i) * 3));
      const p2 = p0.clone().add(new THREE.Vector3(Math.cos(i) * 5, -2, Math.sin(i * 3) * 4));
      g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([p0, p1, p2]), 16, 0.45, 6), m));
    }
  },
  orbs(g, kit, P, o) { // glossy round beads, like wet eggs or bubbles
    const THREE = T(), m = new THREE.MeshPhysicalMaterial({ color: o.c ?? 0xe03131, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.2 });
    const spots = o.many ? [[-3.4, TOP - 1.6, 1], [3.4, TOP - 1.6, 1], [0, TOP, -1.5], [-5.8, TOP - 3, -2], [5.8, TOP - 3, -2]] : [[-3.4, TOP - 1, 0.5], [3.4, TOP - 1, 0.5]];
    for (const p of spots) { const b = mesh(ball(1.9, 32), m, p); g.add(b); kit.zone(b, 2.2, { squish: true, burst: 0xff6b6b }); }
  },
  rocks(g, kit, P, o) {
    // natural stones: lumpy, worn round, with soft colour variation (no speckle)
    const THREE = T(), m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.88, sheen: 0.15 });
    const base = new THREE.Color(o.c ?? 0x868e96);
    const stone = (r, seed) => {
      const geo = new THREE.IcosahedronGeometry(r, 3), pos = geo.attributes.position, col = new Float32Array(pos.count * 3), v = new THREE.Vector3(), c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).normalize();
        const bump = 0.16 * Math.sin(v.x * 2.3 + seed) * Math.cos(v.y * 1.9 - seed * 0.7) + 0.08 * Math.sin(v.z * 3.1 + seed * 1.3) - 0.12 * Math.max(0, v.y - 0.7);
        v.multiplyScalar(r * (1 + bump)); v.y *= 0.78; pos.setXYZ(i, v.x, v.y, v.z);
        c.copy(base).multiplyScalar(0.82 + bump * 1.2 + 0.1 * Math.sin(v.x * 0.9 + seed)); col.set([c.r, c.g, c.b], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
      return geo;
    };
    const spots = o.ring ? Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return [Math.cos(a) * 10.5, 1 + Math.sin(a) * 12, -3.5]; }) : [[-10, -2, 0], [10, -2, 0], [-7, 8, -3], [7, 8, -3]];
    spots.forEach((p, i) => { const r = mesh(stone(o.ring ? 2.6 : 3, i * 1.7), m, p, [i, i * 2, i * 3]); g.add(r); kit.zone(r, 3, { squish: true, burst: 0xbfa77a }); });
  },
  tube(g, kit, P, o) { // a tube from the back of the head
    const THREE = T(), c = new THREE.CatmullRomCurve3([[0, 6, -10], [0, 2, -13], [0, -6, -12], [0, -12, -8]].map((p) => new THREE.Vector3(...p)));
    g.add(mesh(new THREE.TubeGeometry(c, 30, 1.3, 12), mat(o.c ?? 0xb197fc, { r: 0.4 })));
  },
  moustache(g, kit, P, o) { // a real fur moustache that tapers to the ends
    const THREE = T(), c = o.c ?? 0x8b5a2b;
    for (const s of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([[s * 0.4, -2.6, 7.8], [s * 3, -2.8, 7.4], [s * 5, -5, 6], [s * 5.6, -9 * (o.long ? 1.4 : 1), 4]].map((p) => new THREE.Vector3(...p)));
      g.add(new THREE.Mesh(taperedTube(curve, 0.85, 0.12, c, c, { seg: 30, radial: 10 }), fur(c)));
    }
  },
  heads(g, kit, P, o) { // extra little bird heads on long necks
    const m = fur(P.c), beak = gloss(0xffd8a8, { r: 0.4 });
    const spots = o.n === 2 ? [[1]] : [[-1], [1]];
    for (const [s] of spots) {
      const h = at(s * 11, 6, -2);
      h.add(mesh(capsule(1, 6), m, [0, -3, 0]), mesh(ball(2.6, 20), m, [0, 1, 0]), mesh(cone(0.9, 2.6, 12), beak, [0, 0.8, 2.6], [Math.PI / 2, 0, 0]));
      for (const e of [-1, 1]) h.add(mesh(ball(0.35, 8), gloss(0x111111), [e * 1, 1.7, 2.1]));
      g.add(h);
      const w = new Wobble(30, 2.4, 0.0012);
      kit.zone(h, 3, { wobble: w, burst: 0xffd8a8 });
    }
  },
  zzz(g, kit, P, o) { // sleepy Z's floating up
    const THREE = T();
    const tex = canvasTexture(64, 64, (c) => { c.fillStyle = '#fff'; c.font = 'bold 54px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('Z', 32, 34); });
    const zm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    let t0 = 0;
    return (st) => {
      t0 -= st.dt;
      if (t0 > 0 || parts.length > 80) return;
      t0 = 0.8;
      const s = new THREE.Sprite(zm);
      s.position.copy(st.toWorld(6, TOP - 2, 0));
      emit(st.world, s, st.up().multiplyScalar(5).add(new THREE.Vector3(2, 0, 0)), 2, 'float', { size: 2.5 });
    };
  },
  gas(g, kit, P, o) { // a cloud of gas swirling around your head
    const THREE = T(), sm = glowSprite(o.c ?? 0x845ef7, false, 0.55);
    const puffs = [];
    for (let i = 0; i < 14; i++) { const s = new THREE.Sprite(sm); g.add(s); puffs.push({ s, a: (i / 14) * Math.PI * 2, r: 10 + (i % 3) * 2, y: (i % 4) * 4 - 4, k: i }); }
    return (st) => { for (const p of puffs) { const a = p.a + st.t * 0.6; p.s.position.set(Math.cos(a) * p.r, p.y + Math.sin(st.t + p.k) * 1.5, -3 + Math.sin(a) * p.r); p.s.scale.setScalar(6 + Math.sin(st.t * 2 + p.k) * 1.5); } };
  },
  tails(g, kit, P, o) { // a fan of real furry tails behind your head, each with a coloured tip
    const c = o.c ?? 0xfff3bf, tip = o.tip ?? 0xffa94d, n = o.n ?? 9;
    const t = at(0, 0, -11);
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? 0 : Math.PI * (0.1 + 0.8 * (i / (n - 1))), piv = at(0, -4, 0);
      piv.rotation.z = a - Math.PI / 2;
      piv.add(furTuft([[0, 0, 0], [0.6, 5, -0.5], [-0.4, 10, -1], [0.8, 13.2, -1.2]], 2, 1.3, c));
      piv.add(furTuft([[0.8, 13, -1.2], [1.4, 15.4, -1.3], [0.8, 17.4, -1]], 1.35, 0.15, tip));
      t.add(piv);
    }
    g.add(t);
    return (st) => t.children.forEach((p, i) => (p.rotation.y = Math.sin(st.t * 1.6 + i) * 0.15));
  },
  bigTongue(g, kit, P, o) { // a huge tongue when you stick yours out
    const tongue = at(0, -4.6, 6.2);
    tongue.add(mesh(tongueGeometry(11, 4.6, 1.2), tongueMat()));
    g.add(tongue);
    return (st) => {
      const out = Math.max(st.tongue ?? 0, 0);
      tongue.visible = out > 0.02;
      tongue.scale.set(1, Math.max(0.02, out), 1);
      tongue.rotation.set(-0.5 - out * 0.4, 0, Math.sin(st.t * 4) * 0.15 * out);
    };
  },
  fin(g, kit, P, o) { // a fin along the top of your head
    const THREE = T(), f = at(0, TOP - 1.5, -1);
    const geo = earGeometry(o.len ?? 7, o.wid ?? 8, { cup: 0, thick: 0.3 });
    f.add(mesh(geo, mat(o.c ?? P.c2 ?? P.c, { r: 0.3, cc: 0.8, op: 0.82, double: true }), [0, 0, 0], [0, Math.PI / 2, -0.35]));
    g.add(f);
    const w = new Wobble(40, 3, 0.0008);
    kit.zone(f, 4, { wobble: w, burst: TYPES[P.type].fx });
    return (st) => { w.step(st); f.rotation.set(0, 0, w.x * 0.5); };
  },
  curl(g, kit, P, o) { // a curling lock of real fur on your forehead
    const THREE = T(), c = at(0, 9.2, 4.2), col = o.c ?? P.c, pts = [];
    for (let i = 0; i <= 24; i++) { const k = i / 24, a = -0.4 + k * Math.PI * 1.7, r = 2.2 * (1 - k * 0.55); pts.push(new THREE.Vector3(Math.sin(a) * r * 0.8, 1.6 + Math.cos(a) * r - (1 - k) * 1.2, k * 0.6)); }
    c.add(new THREE.Mesh(taperedTube(new THREE.CatmullRomCurve3(pts), 0.75, 0.12, col, col, { seg: 40, radial: 10 }), fur(col)));
    g.add(c); kit.zone(c, 2.2, { squish: true, burst: 0xfcc2d7 });
  },
  hair3(g, kit, P, o) { // three little hairs sticking up
    const m = mat(0x222222, { r: 0.7 }), h = at(0, TOP - 0.5, 0);
    for (const a of [-0.4, 0, 0.4]) h.add(mesh(capsule(0.16, 3), m, [Math.sin(a) * 1.5, 1.5, 0], [0, 0, a]));
    g.add(h);
    const w = new Wobble(25, 1.8, 0.0014);
    kit.zone(h, 2, { wobble: w });
    return (st) => { w.step(st); h.rotation.set(w.y * 0.6, 0, w.x); };
  },
  fluff(g, kit, P, o) { // tufts of real fur: on top of your head, or as cheek ruffs over your ears
    const c = o.c ?? 0xfff4e6, list = [];
    if (o.sides) for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
      const y = 7 - i * 1.6, L = 4 + (i % 3);
      list.push(furTuft([[s * 7.2, y, -2.5], [s * (8.4 + L * 0.5), y - 0.6, -2.8], [s * (8.6 + L), y - 1.8, -3.4]], 1.6, 0.25, c));
    }
    else for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, x = Math.sin(a) * 2.2, z = -1.5 + Math.cos(a) * 2.2, L = 3.5 + (i % 3);
      list.push(furTuft([[x, TOP - 1.5, z], [x * 1.3, TOP + L * 0.6, z - 0.6], [x * 1.8, TOP + L, z - 2]], 1.5, 0.2, i % 2 ? c : tint(c, 0.1, 0xffffff).getHex()));
    }
    for (const t of list) g.add(t);
    const spot = at(0, o.sides ? 5 : TOP + 2, -1.5); g.add(spot); kit.zone(spot, 3, { squish: true, burst: c });
  },
  stripes(g, kit, P, o) {
    const m = fur(o.c ?? 0x111111);
    for (const [x, y, rz, len] of [[0, 7.6, 0, 2.4], [-1.8, 6.9, 0.3, 1.8], [1.8, 6.9, -0.3, 1.8]]) g.add(mesh(capsule(0.3, len), m, [x, y, 5.3], [0, 0, rz]));
  },
  brows(g, kit, P, o) { // bushy brows of real fur, frowning a little
    const c = o.c ?? 0x343a40;
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
      const x0 = s * (1.8 + k * 1.3), y0 = 5.2 + k * 0.35 - (k === 2 ? 0.2 : 0);
      g.add(furTuft([[x0, y0 - 0.2, 6.3 - k * 0.35], [x0 + s * 1.1, y0 + 0.5, 6.2 - k * 0.4], [x0 + s * 2.1, y0 + 0.9, 5.7 - k * 0.5]], 0.6, 0.12, c));
    }
  },
  ridges(g, kit, P, o) { // three bony ridges
    const m = mat(o.c ?? P.c, { r: 0.5 });
    for (const x of [-2.4, 0, 2.4]) g.add(mesh(ball(1, 16), m, [x, TOP - 1, -2], [0, 0, x * 0.1], [0.7, 2.6, 3.6]));
  },
  ghostHands(g, kit, P, o) { // floating ghost hands
    const m = gloss(o.c ?? 0x7048e8, { r: 0.35 });
    const hands = [-1, 1].map((s) => { const h = at(s * 12, 0, 2); h.add(mesh(ball(2.2, 16), m, [0, 0, 0], [0, 0, 0], [1, 1.2, 0.6])); for (let i = 0; i < 3; i++) h.add(mesh(capsule(0.5, 1.6), m, [(i - 1) * 1.1, 2.4, 0])); g.add(h); kit.zone(h, 3, { squish: true, burst: 0x845ef7 }); return { h, s }; });
    return (st) => { for (const k of hands) k.h.position.set(k.s * 12 + Math.sin(st.t * 1.4 + k.s) * 1.2, Math.sin(st.t * 1.8 + k.s) * 2, 2); };
  },
  orbNeck(g, kit, P, o) { // a crystal orb at the neck
    const b = mesh(ball(1.6, 22), gloss(0x74c0fc, { r: 0.02, ir: 1 }), [0, -11.5, 3.5]);
    g.add(b); kit.zone(b, 2, { squish: true, burst: 0x74c0fc });
  },
  hairLong(g, kit, P, o) { // long flowing hair
    const m = fur(o.c ?? 0xffd43b), h = at(0, 4, -3.5);
    h.add(mesh(new (T().SphereGeometry)(9.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), m, [0, 2, 0], [0, 0, 0], [1, 1, 1.08]));
    for (let i = 0; i < 10; i++) { const a = Math.PI * (0.05 + 0.9 * (i / 9)); h.add(mesh(capsule(1.8, 16), m, [-Math.cos(a) * 9.4, -7, -Math.sin(a) * 4 - 1])); }
    g.add(h);
  },
};

// The type move: what comes out when you open your mouth.
function typeMove(type) {
  const THREE = T(), col = TYPES[type].fx;
  const fireMat = glowSprite(0xffb703), sparkMat = glowSprite(col);
  const smokeMat = glowSprite(col, false, 0.7), bubbleGeo = ball(1, 18), bubbleMat = mat(0xffffff, { r: 0, ir: 1, op: 0.35, dw: false });
  const leafGeo = new THREE.CircleGeometry(0.9, 10); leafGeo.scale(1, 0.5, 1);
  const leafMat = mat(type === 'bug' ? 0xc0eb75 : 0x51cf66, { r: 0.5, double: true });
  let carry = 0, ambient = 0;
  const rnd = (a) => (Math.random() - 0.5) * a;
  const AMBIENT = { electric: 2.5, fire: 4, water: 2, grass: 1.5, bug: 1, ghost: 2, poison: 1.5, psychic: 3, fairy: 3, ice: 3, dragon: 2 };
  const emberMat = glowSprite(type === 'dragon' ? 0x9775fa : 0xff922b), snowMat = glowSprite(0xffffff), sparkleMat = glowSprite(col);
  return (st) => {
    // a little type magic around you all the time
    ambient += st.dt * (AMBIENT[type] || 0);
    while (ambient >= 1) {
      ambient--;
      if (parts.length > 70) { ambient = 0; break; }
      const a = Math.random() * Math.PI * 2, r = 9 + Math.random() * 5;
      const at3 = st.toWorld(Math.cos(a) * r, -4 + Math.random() * 18, -3 + Math.sin(a) * r * 0.6), up = st.up();
      if (type === 'fire' || type === 'dragon') { const s = new THREE.Sprite(emberMat.clone()); s.position.copy(at3); emit(st.world, s, up.multiplyScalar(6 + Math.random() * 5).add(new THREE.Vector3(rnd(2), 0, rnd(2))), 1.4, 'spark', { ownMat: true, size: 0.7 + Math.random() * 0.6 }); }
      else if (type === 'water') { const b = new THREE.Mesh(bubbleGeo, bubbleMat); b.position.copy(at3); emit(st.world, b, up.multiplyScalar(4), 2.5, 'bubble', { size: 0.4 + Math.random() * 0.5, seed: Math.random() * 6 }); }
      else if (type === 'grass' || type === 'bug') { const l = new THREE.Mesh(leafGeo, leafMat); l.position.copy(st.toWorld(Math.cos(a) * r, 16 + Math.random() * 4, -3 + Math.sin(a) * r * 0.6)); l.rotation.set(Math.random() * 3, Math.random() * 3, 0); emit(st.world, l, up.multiplyScalar(-5).add(new THREE.Vector3(rnd(3), 0, rnd(3))), 3.5, 'float', { size: 0.9 }); }
      else if (type === 'ghost' || type === 'poison') { const s = new THREE.Sprite(smokeMat); s.position.copy(at3); emit(st.world, s, up.multiplyScalar(3), 2.2, 'float', { size: 2.5 + Math.random() * 2 }); }
      else if (type === 'ice') { const s = new THREE.Sprite(snowMat.clone()); s.position.copy(st.toWorld(Math.cos(a) * r, 18, -3 + Math.sin(a) * r * 0.6)); emit(st.world, s, up.multiplyScalar(-6), 3, 'spark', { ownMat: true, size: 0.5 + Math.random() * 0.4 }); }
      else { const s = new THREE.Sprite(sparkleMat.clone()); s.position.copy(at3); emit(st.world, s, new THREE.Vector3(rnd(6), rnd(6), rnd(6)), type === 'electric' ? 0.35 : 0.9, 'spark', { ownMat: true, size: type === 'electric' ? 1.3 : 0.8 }); }
    }
    if (st.jaw < 0.3) return;
    carry += st.dt * (type === 'fire' || type === 'dragon' ? 35 : 16) * st.jaw;
    const origin = st.toWorld(0, -4.6, 7), dir = st.forward(), up = st.up();
    while (carry >= 1) {
      carry--;
      if (parts.length > 90) { carry = 0; break; }
      const v = dir.clone().multiplyScalar(26 + Math.random() * 20).add(new THREE.Vector3(rnd(10), rnd(10), rnd(10)));
      if (type === 'fire' || type === 'dragon') {
        const s = new THREE.Sprite(fireMat.clone()); s.position.copy(origin);
        emit(st.world, s, v.multiplyScalar(1.8), 0.8, 'fire', { ownMat: true });
      } else if (type === 'water' || type === 'ice') {
        const b = new THREE.Mesh(bubbleGeo, bubbleMat); b.position.copy(origin);
        emit(st.world, b, v.multiplyScalar(0.7), 2.4, 'bubble', { size: 0.6 + Math.random() * 0.9, seed: Math.random() * 6 });
      } else if (type === 'grass' || type === 'bug') {
        const l = new THREE.Mesh(leafGeo, leafMat); l.position.copy(origin); l.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        emit(st.world, l, v.add(up.clone().multiplyScalar(4)), 1.6, 'float', { size: 1.2 });
      } else if (type === 'ghost' || type === 'poison') {
        const s = new THREE.Sprite(smokeMat); s.position.copy(origin);
        emit(st.world, s, v.multiplyScalar(0.5).add(up.clone().multiplyScalar(5)), 1.5, 'float', { size: 3 + Math.random() * 2 });
      } else {
        const s = new THREE.Sprite(sparkMat.clone()); s.position.copy(origin);
        emit(st.world, s, v.multiplyScalar(type === 'electric' ? 2.2 : 1.4), 0.6, 'spark', { ownMat: true, size: 1.2 + Math.random() });
      }
    }
  };
}

// ---------------------------------------------------------------------------------------------
// The creatures. [name, type, main colour, second colour, look, parts...]
// A part is [builder, options]. Every creature here is our own: made-up name, own colours and mix.
// ---------------------------------------------------------------------------------------------
const E = (o) => ['ears', o], N = (kind, c, o = {}) => ['nose', { kind, c, ...o }];
const LIST = [
  // normal
  ['Bumblepup', 'normal', 0xf4c27a, 0x7b4a2a, null, E({ kind: 'floppy', c: 0x7b4a2a, len: 7, wid: 4.6 }), N('dog', 0x3b2416, { size: 1.6 }), ['collar', { c: 0x4dabf7 }]],
  ['Snoozle', 'normal', 0xb7a6e8, 0xfff3bf, null, E({ kind: 'round', c: 0xb7a6e8, inner: null, r: 2.4 }), ['zzz', {}], ['fluff', { c: 0xfff3bf }]],
  ['Fluffernut', 'normal', 0xd4a373, 0xfff4e6, null, E({ kind: 'floppy', c: 0xd4a373, inner: 0xfff4e6, len: 6, wid: 5 }), ['curl', { c: 0x8b5a2b }], ['cheeks', { c: 0xff8fab }]],
  ['Cocoapuff', 'normal', 0x6f4e37, 0xffe8cc, null, E({ kind: 'round', c: 0x6f4e37, inner: 0xffe8cc, r: 2.6 }), N('pig', 0xffc9c9, { size: 1.2 }), ['fluff', { c: 0xffe8cc }]],
  ['Marshmallow Moo', 'normal', 0xfff0f6, 0xffa8c5, null, ['horns', { c: 0xfff3bf, r: 0.7, spread: 1.4, up: 0.9 }], E({ kind: 'pointy', c: 0xfff0f6, inner: 0xffa8c5, len: 3.2, wid: 3, x: 6.5, y: 8, tilt: 0.9 }), N('pig', 0xffa8c5, { size: 1.6 })],
  // fire
  ['Emberkit', 'fire', 0xffa94d, 0xfff3bf, 'saturate(1.1)', E({ kind: 'pointy', c: 0xffa94d, inner: 0xfff3bf, len: 5, wid: 4.2 }), ['whiskers', { c: 0xfff3bf }], ['flame', { size: 2.5 }]],
  ['Cinderhorn', 'fire', 0x495057, 0xff6b00, 'saturate(1.15)', ['horns', { c: 0x212529, r: 1, spread: 1.2, up: 1 }], ['ridges', { c: 0xff6b00 }], ['flame', { size: 3.5, back: true }]],
  ['Blazebeak', 'fire', 0xc92a2a, 0x7048e8, 'saturate(1.1)', ['crest', { c: 0xff922b, c2: 0xc92a2a, n: 4, len: 5 }], ['wings', { style: 'bird', c: 0x7048e8, size: 12 }], N('beak', 0xffd43b)],
  ['Toastyfox', 'fire', 0xd9480f, 0xffe066, null, E({ kind: 'pointy', c: 0xd9480f, inner: 0x343a40, len: 6, wid: 4.6, x: 5.6 }), ['tails', { c: 0xd9480f, n: 2, tip: 0xffe066 }], N('cat', 0x212529, { size: 1.2 })],
  ['Lavaloo', 'fire', 0x862e9c, 0xff922b, 'saturate(1.2)', ['sludge', { c: 0xff8787 }], ['flame', { size: 3, n: 5 }]],
  // water
  ['Splashfin', 'water', 0x20c997, 0xff8787, null, ['fin', { c: 0xff8787, len: 5, wid: 6 }], E({ kind: 'fin', c: 0x20c997, len: 5, wid: 4 }), ['barbels', { c: 0xff8787 }]],
  ['Bubblebop', 'water', 0x99e9f2, 0x1c7ed6, null, ['antennae', { c: 0x1c7ed6, len: 5, knobR: 0.9, knob: 0xe7f5ff }], ['orbs', { c: 0x74c0fc, many: true }], ['curl', { c: 0x1c7ed6 }]],
  ['Shellby', 'water', 0x66d9e8, 0xffa8c5, null, ['backShell', { c: 0xffa8c5 }], ['whiskers', { c: 0xe3fafc }]],
  ['Puddlepaw', 'water', 0x4dabf7, 0xe7f5ff, null, E({ kind: 'round', c: 0x4dabf7, inner: 0xe7f5ff, r: 2.2 }), N('dog', 0x1864ab, { size: 1.4 }), ['whiskers', { c: 0xe7f5ff }]],
  ['Squidgy', 'water', 0xf783ac, 0xfff0f6, null, ['tails', { c: 0xf783ac, n: 6, tip: 0xfff0f6 }], ['orbs', { c: 0xfff0f6 }], ['cheeks', { c: 0xffa8c5 }]],
  ['Tidewyrm', 'water', 0x0ca678, 0xffd43b, null, ['crest', { c: 0xffd43b, n: 5, len: 4 }], ['barbels', { c: 0xffd43b }], E({ kind: 'wing', c: 0x0ca678 })],
  // grass
  ['Sproutle', 'grass', 0x94d82d, 0xfff3bf, null, ['leaves', { c: 0x5c940d, n: 2 }], E({ kind: 'round', c: 0x94d82d, inner: 0xfff3bf, r: 2.2 })],
  ['Mossbun', 'grass', 0x74b816, 0xffc9c9, null, E({ kind: 'long', c: 0x74b816, inner: 0xffc9c9 }), ['flower', { c: 0xff8fab, center: 0xffe066 }], N('cat', 0xff8fab, { size: 1 })],
  ['Thornback', 'grass', 0x2b8a3e, 0xe9fac8, null, ['spikes', { c: 0x2b8a3e, n: 6, size: 1.2 }], ['vine', { c: 0x5c940d }], ['brows', { c: 0x1b4332 }]],
  ['Fernfawn', 'grass', 0xc49a6c, 0x69db7c, null, E({ kind: 'pointy', c: 0xc49a6c, inner: 0xfff4e6, len: 5, wid: 3.6, tilt: 0.6 }), ['horns', { c: 0x69db7c, r: 0.6, spread: 0.8, up: 1.2 }], N('dog', 0x3b2416, { size: 1.2 })],
  ['Cactoot', 'grass', 0x40c057, 0xff8fab, null, ['spikes', { c: 0x2f9e44, n: 7, size: 0.8 }], ['flower', { c: 0xff8fab, center: 0xffe066 }], ['cheeks', { c: 0xff8fab }]],
  // electric
  ['Voltbug', 'electric', 0x3b5bdb, 0xffe066, null, ['antennae', { c: 0xffe066, len: 6, knobR: 0.8 }], ['wings', { style: 'bug', c: 0xffe066, size: 11, speed: 12 }], ['stripes', { c: 0xffe066 }]],
  ['Boltpup', 'electric', 0x364fc7, 0xffd43b, null, E({ kind: 'floppy', c: 0x364fc7, inner: 0xffd43b, len: 7, wid: 4.6 }), ['collar', { c: 0xffd43b, spiky: true }], N('dog', 0x111111, { size: 1.5 })],
  ['Fizzlewhisk', 'electric', 0x9775fa, 0xffe066, null, E({ kind: 'round', c: 0x9775fa, inner: 0xffe066, r: 2.4 }), ['whiskers', { c: 0xffe066 }], ['antennae', { c: 0xffe066, len: 4, knobR: 0.6 }]],
  ['Ziggyzag', 'electric', 0xc0eb75, 0x212529, null, ['spikes', { c: 0x212529, n: 5, size: 1 }], ['stripes', { c: 0x212529 }], ['brows', { c: 0x212529 }]],
  ['Buzzbolt', 'electric', 0xffa94d, 0x343a40, null, ['wings', { style: 'bug', c: 0xfff3bf, size: 10, speed: 18 }], ['antennae', { c: 0x343a40, len: 4 }], ['stripes', { c: 0x343a40 }]],
  // ice
  ['Frostling', 'ice', 0xe7f5ff, 0x74c0fc, 'saturate(.85) brightness(1.05)', ['crest', { c: 0xa5d8ff, n: 3, len: 4 }], ['fluff', { c: 0xffffff, sides: true }], ['horn', { c: 0xd0ebff, len: 2.5 }]],
  ['Snowmoo', 'ice', 0xf8f9fa, 0x4dabf7, 'saturate(.9)', ['horns', { c: 0xa5d8ff, r: 0.8, spread: 1.6, up: 0.8 }], E({ kind: 'round', c: 0xf8f9fa, inner: 0xd0ebff, r: 2 }), N('pig', 0xd0ebff, { size: 1.4 })],
  ['Chillpip', 'ice', 0xa5d8ff, 0xffffff, 'saturate(.9)', E({ kind: 'pointy', c: 0xa5d8ff, inner: 0xffffff, len: 4, wid: 3.2 }), ['spikes', { c: 0xffffff, n: 5, size: 0.9 }], ['cheeks', { c: 0x74c0fc }]],
  ['Frostfeather', 'ice', 0xd0ebff, 0x5f3dc4, 'saturate(.9)', ['wings', { style: 'bird', c: 0xd0ebff, size: 12 }], N('beak', 0x5f3dc4), ['crest', { c: 0x5f3dc4, n: 3, len: 3 }]],
  ['Yetiboo', 'ice', 0xf1f3f5, 0x748ffc, 'saturate(.9)', ['fluff', { c: 0xf1f3f5, sides: true }], ['horns', { c: 0x748ffc, r: 0.7, spread: 1.2, up: 1 }], ['brows', { c: 0xdee2e6 }]],
  // fighting
  ['Punchkin', 'fighting', 0xffa94d, 0x1c7ed6, null, ['gloves', { c: 0x1c7ed6 }], E({ kind: 'pointy', c: 0xffa94d, inner: null, len: 3.6, wid: 3.2 }), ['stripes', { c: 0xe8590c }]],
  ['Kickaroo', 'fighting', 0xc49a6c, 0xe03131, null, E({ kind: 'long', c: 0xc49a6c, inner: 0xfff4e6, len: 8 }), ['gloves', { c: 0xe03131 }], ['collar', { c: 0xfff4e6 }]],
  ['Grumbleox', 'fighting', 0x5c3a21, 0xced4da, null, ['horns', { c: 0xced4da, r: 1.1, spread: 2, up: 0.7 }], ['brows', { c: 0x2b1a0e }], ['mane', { c: 0x3b2416 }]],
  ['Rumblebrow', 'fighting', 0x868e96, 0xff6b6b, null, ['ridges', { c: 0xff6b6b }], ['brows', { c: 0x212529 }], ['moustache', { c: 0x495057 }]],
  // poison
  ['Oozel', 'poison', 0xa9e34b, 0x7048e8, null, ['sludge', { c: 0xa9e34b }], ['antennae', { c: 0x7048e8, len: 4, knobR: 0.7 }]],
  ['Stinkcap', 'poison', 0x8b5a2b, 0x94d82d, null, ['mushrooms', {}], ['gas', { c: 0x94d82d }]],
  ['Toxitail', 'poison', 0x7048e8, 0xa9e34b, null, ['tails', { c: 0x7048e8, n: 4, tip: 0xa9e34b }], ['spikes', { c: 0xa9e34b, n: 4 }], ['forkAntenna', { c: 0xa9e34b }]],
  ['Gloopsnout', 'poison', 0xe599f7, 0x37b24d, null, N('trunk', 0xe599f7), ['orbs', { c: 0x37b24d, many: true }], E({ kind: 'round', c: 0xe599f7, inner: 0x37b24d, r: 2 })],
  // ground
  ['Burrowbun', 'ground', 0xd8a878, 0x5c3a21, null, E({ kind: 'long', c: 0xd8a878, inner: 0xffc9c9, len: 9 }), ['whiskers', { c: 0x5c3a21 }], N('cat', 0xff8fab, { size: 1 })],
  ['Dusthorn', 'ground', 0xbfa77a, 0x6f4e37, null, ['noseHorn', { c: 0xfff4e6, len: 3 }], ['rocks', { c: 0x6f4e37 }], E({ kind: 'round', c: 0xbfa77a, inner: null, r: 1.8 })],
  ['Clayclop', 'ground', 0xa0522d, 0xffd8a8, null, ['dome', { c: 0xa0522d }], ['brows', { c: 0x5c3a21 }]],
  ['Mudmole', 'ground', 0x6f4e37, 0xffc9c9, null, N('pig', 0xffa8c5, { size: 1.4 }), ['claws', { c: 0xfff4e6 }], ['whiskers', { c: 0xfff4e6 }]],
  ['Pebblepig', 'ground', 0xadb5bd, 0xffc9c9, null, N('pig', 0xffc9c9, { size: 1.8 }), E({ kind: 'pointy', c: 0xadb5bd, inner: 0xffc9c9, len: 3, wid: 3, tilt: 0.8 }), ['rocks', { c: 0x868e96 }]],
  // flying
  ['Skyfluff', 'flying', 0xf8f9fa, 0x74c0fc, null, ['wings', { style: 'bird', c: 0xffffff, size: 12 }], ['fluff', { c: 0xe7f5ff }], N('beak', 0xffa94d)],
  ['Hootwhirl', 'flying', 0x8b5a2b, 0xffe066, null, E({ kind: 'pointy', c: 0x8b5a2b, inner: null, len: 3, wid: 2.6, tilt: 0.1 }), ['brows', { c: 0xfff4e6 }], N('beak', 0xffe066), ['wings', { style: 'bird', c: 0x6f4e37, size: 10 }]],
  ['Gustwing', 'flying', 0xf783ac, 0xffd43b, null, ['wings', { style: 'bat', c: 0xf783ac, size: 12 }], E({ kind: 'pointy', c: 0xf783ac, inner: 0xffd43b, len: 5, wid: 4 })],
  ['Breezebunny', 'flying', 0xe7f5ff, 0x4dabf7, null, E({ kind: 'long', c: 0xe7f5ff, inner: 0x74c0fc }), ['wings', { style: 'bird', c: 0xe7f5ff, size: 9 }]],
  ['Cloudcub', 'flying', 0xf1f3f5, 0xa5d8ff, null, E({ kind: 'round', c: 0xf1f3f5, inner: 0xa5d8ff, r: 2.4 }), ['gas', { c: 0xffffff }], ['cheeks', { c: 0xa5d8ff }]],
  // psychic
  ['Mystipaw', 'psychic', 0xd0bfff, 0xf783ac, null, E({ kind: 'pointy', c: 0xd0bfff, inner: 0xf783ac, len: 5.5, wid: 4.6 }), ['gem', { c: 0xf783ac }], ['tails', { c: 0xd0bfff, n: 3, tip: 0xf783ac }]],
  ['Dreamoth', 'psychic', 0xb197fc, 0xfff3bf, null, ['wings', { style: 'bug', c: 0xfff3bf, size: 12, speed: 5 }], ['antennae', { c: 0xb197fc, len: 5 }], ['orbs', { c: 0xe599f7 }]],
  ['Swirlywhirl', 'psychic', 0xfcc2d7, 0x5f3dc4, null, ['swirl', {}], ['gem', { kind: 'coin', c: 0xffd43b }], ['curl', { c: 0x5f3dc4 }]],
  ['Brainbloom', 'psychic', 0xf783ac, 0x9775fa, null, ['flower', { c: 0x9775fa, center: 0xf783ac }], ['orbs', { c: 0xf783ac }]],
  ['Mothmuffin', 'psychic', 0xc5a880, 0xfff0f6, null, ['wings', { style: 'bug', c: 0xfff0f6, size: 10 }], ['fluff', { c: 0xfff0f6, sides: true }], ['antennae', { c: 0xc5a880, len: 4, knobR: 0.4 }]],
  // bug
  ['Beetlebop', 'bug', 0x2b8a3e, 0xffd43b, null, ['dome', { c: 0x2b8a3e }], ['horns', { c: 0x212529, r: 0.9, spread: 0.3, up: 1.2 }], ['antennae', { c: 0x212529, len: 4, knobR: 0.4 }]],
  ['Leafhopper', 'bug', 0x82c91e, 0xfff3bf, null, ['antennae', { c: 0x5c940d, len: 6 }], ['leaves', { c: 0x82c91e }], ['wings', { style: 'bug', c: 0xd8f5a2, size: 10, speed: 15 }]],
  ['Glowbug', 'bug', 0x343a40, 0xffe066, null, ['antennae', { c: 0x343a40, len: 5, knob: 0xffe066, knobR: 0.9 }], ['orbs', { c: 0xffe066, many: true }], ['wings', { style: 'bug', c: 0xfff9db, size: 9 }]],
  ['Sparkle Snail', 'bug', 0xffc9c9, 0x9775fa, null, ['spiral', { c: 0x9775fa }], ['antennae', { c: 0xffc9c9, len: 3.5, knobR: 0.6 }]],
  // rock
  ['Pebblet', 'rock', 0x868e96, 0xced4da, null, ['rocks', { ring: true, c: 0x868e96 }], ['brows', { c: 0x343a40 }]],
  ['Cragtusk', 'rock', 0x6c757d, 0xfff4e6, null, ['horns', { c: 0xfff4e6, r: 1, spread: 1.8, up: 0.6 }], ['ridges', { c: 0x495057 }], ['rocks', { c: 0x6c757d }]],
  ['Gemshell', 'rock', 0x5f3dc4, 0x63e6be, null, ['dome', { c: 0x5f3dc4 }], ['gem', { c: 0x63e6be }], ['spikes', { c: 0x63e6be, n: 4 }]],
  ['Rocky Roo', 'rock', 0xa0522d, 0xadb5bd, null, E({ kind: 'long', c: 0xa0522d, inner: 0xadb5bd, len: 7 }), ['rocks', { c: 0xadb5bd }], ['gloves', { c: 0x495057 }]],
  // ghost
  ['Wispurr', 'ghost', 0x5f3dc4, 0xb197fc, 'brightness(.9)', E({ kind: 'pointy', c: 0x5f3dc4, inner: 0xb197fc, len: 5, wid: 4.4 }), ['whiskers', { c: 0xe5dbff }], ['gas', { c: 0xb197fc }]],
  ['Shadeling', 'ghost', 0x343a40, 0x63e6be, 'brightness(.88)', ['ghostHands', { c: 0x343a40 }], ['curl', { c: 0x63e6be }]],
  ['Phantomoth', 'ghost', 0x9775fa, 0xf8f9fa, 'brightness(.9)', ['wings', { style: 'bug', c: 0xf8f9fa, size: 12, speed: 4 }], ['gas', { c: 0x9775fa }]],
  ['Boobly', 'ghost', 0xf8f9fa, 0x343a40, 'brightness(.92)', ['hood', { c: 0xf8f9fa }], ['cheeks', { c: 0xffa8c5 }]],
  ['Grimgrin', 'ghost', 0x212529, 0xff6b6b, 'brightness(.88)', ['spikes', { c: 0x212529, n: 4 }], ['gem', { c: 0xff6b6b }], ['tails', { c: 0x212529, n: 2, tip: 0xff6b6b }]],
  // dragon
  ['Drakelet', 'dragon', 0x40c057, 0xffd43b, null, ['horns', { c: 0xffd43b, r: 0.6, spread: 1, up: 1 }], ['wings', { style: 'bat', c: 0x2f9e44, size: 10 }], ['spikes', { c: 0xffd43b, n: 4, size: 0.8 }]],
  ['Wyrmwhisk', 'dragon', 0xe03131, 0xffd43b, null, ['barbels', { c: 0xffd43b }], ['horns', { c: 0xffd43b, r: 0.6, spread: 0.9, up: 1.2 }], ['mane', { c: 0xffd43b }]],
  ['Scalewing', 'dragon', 0x1098ad, 0xe599f7, null, ['crest', { c: 0xe599f7, n: 5, len: 4 }], ['wings', { style: 'bat', c: 0x1098ad, size: 12 }], ['ridges', { c: 0xe599f7 }]],
  // fairy
  ['Twinklepuff', 'fairy', 0xc3fae8, 0xf783ac, null, ['wings', { style: 'bug', c: 0xffdeeb, size: 10 }], ['gem', { kind: 'star', c: 0xffe066 }], ['cheeks', { c: 0xffa8c5 }]],
  ['Petalpup', 'fairy', 0xfcc2d7, 0xffffff, null, ['flower', { c: 0xffffff, center: 0xffe066 }], E({ kind: 'floppy', c: 0xfcc2d7, len: 6, wid: 4 }), N('dog', 0xf06595, { size: 1.3 })],
  ['Moonbun', 'fairy', 0xe5dbff, 0xffe066, null, E({ kind: 'long', c: 0xe5dbff, inner: 0xffe066 }), ['gem', { kind: 'coin', c: 0xffe066 }], ['fluff', { c: 0xffffff }]],
  ['Pixiepip', 'fairy', 0xffc9de, 0x63e6be, null, E({ kind: 'pointy', c: 0xffc9de, inner: 0x63e6be, len: 4.5, wid: 2.6, tilt: 0.7 }), ['wings', { style: 'bug', c: 0xc3fae8, size: 8, speed: 16 }], ['cheeks', { c: 0xff8fab }]],
  ['Sugarwing', 'fairy', 0xfff0f6, 0xf06595, null, ['wings', { style: 'bird', c: 0xfff0f6, size: 10 }], ['curl', { c: 0xf06595 }], ['gem', { kind: 'star', c: 0xf06595 }]],
];

// The other half of the creatures lives in creatures-more.js (same format). It's optional, so the
// app still works if that file isn't there.
const MORE = await import('./creatures-more.js').then((m) => m.CREATURES_MORE || []).catch(() => []);

export const CREATURES = [...LIST, ...MORE].map(([name, type, c, c2, look, ...given], i) => {
  const n = i + 1;
  const P = { n, name, type, c, c2 };
  const partList = given; // no costume hood: real-looking creature parts straight on your head
  return {
    n, name, type, c, c2, look: look || undefined, icon: TYPES[type].emoji,
    sparkle: type === 'psychic' || type === 'fairy', snow: type === 'ice',
    build(g, kit) {
      const ups = partList.map(([part, o]) => B[part](g, kit, P, o || {})).filter(Boolean);
      ups.push(typeMove(type));
      return (st) => { for (const u of ups) u(st); };
    },
  };
});
