// More 3D filters for Silly Cam: a Halloween set plus animals, hats and fun extras.
// Same rules as filters3d.js: build(group, kit) places things in MediaPipe's canonical face
// coordinates (centimetres; nose tip ≈ (0,-0.5,7.6), forehead ≈ (0,8.3,4.5), chin ≈ (0,-9.4,4.3),
// eyes ≈ (±3.3,2.9,3.6), face edges ≈ (±7.7,0.7,-2.4), top of the head ≈ y 12) and may return
// update(st) for animation. kit.zone(obj, radiusCm, { wobble, spin, squish, burst }) makes it touchable.
import * as F3 from './filters3d.js';
import { FACE_POSITIONS } from './facemesh.js';

const { mat, mesh, ball, capsule, cone, at, fur, gloss, gold, beadHorn, Wobble, emit, glow, parts, canvasTexture, heartGeometry, clamp, lerp,
  earGeometry, animalNose, catNose, realWhiskers, catTongue } = F3;
const whiskers = (g, color) => realWhiskers(g, color); // fine, curved, tapering whiskers
const T = () => F3.THREE; // three.js is loaded lazily, so always read it at build time

// Face points (MediaPipe face mesh) for make-up painted onto the face.
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];

// ---------- face paint (2D, drawn point by point onto your real face) ----------
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }; // the same "random" every frame: no flicker
const soft = (c, px) => { if ('filter' in c) c.filter = px > 0 ? `blur(${px.toFixed(1)}px)` : 'none'; };
const polyPath = (c, P, ids) => { c.beginPath(); ids.forEach((i, k) => { const p = P(i); k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); c.closePath(); };
function softPatch(c, x, y, rx, ry, rot, color) { c.save(); c.translate(x, y); c.rotate(rot); c.scale(1, ry / rx); c.fillStyle = color; c.beginPath(); c.arc(0, 0, rx, 0, 7); c.fill(); c.restore(); }
// Fur strands rooted along a line of face points, leaning out away from `centre` (and a little down).
function furStrands(c, f, ids, { count = 300, len = [0.025, 0.05], width = [0.005, 0.009], inward = 0.14, droop = 0.7, colour = () => 'rgba(80,60,45,.45)', seed = 0, centre = 1 } = {}) {
  // rooted inside the edge of the face and lying down along it, soft: fur, not bristles
  const P = f.P, W = f.w, cen = typeof centre === 'number' ? P(centre) : centre;
  c.lineCap = 'round'; soft(c, W * 0.004);
  for (let i = 0; i < count; i++) {
    const r = (k) => rnd(seed + i * 7 + k);
    const t = r(0) * (ids.length - 1), j = Math.floor(t), u = t - j, A = P(ids[j]), B = P(ids[j + 1]);
    const x0 = A.x + (B.x - A.x) * u, y0 = A.y + (B.y - A.y) * u;
    let dx = x0 - cen.x, dy = y0 - cen.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const sx = x0 - dx * W * inward * r(1), sy = y0 - dy * W * inward * r(1), L = W * (len[0] + (len[1] - len[0]) * r(2));
    const ex = sx + (dx + (r(3) - 0.5) * 0.3) * L, ey = sy + (dy + droop) * L;
    c.strokeStyle = colour(r(4)); c.lineWidth = W * (width[0] + (width[1] - width[0]) * r(5));
    c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo((sx + ex) / 2 + dx * L * 0.15, (sy + ey) / 2, ex, ey); c.stroke();
  }
}
const EYE_L = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
const EYE_R = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];
const centreOf = (P, ids) => { let x = 0, y = 0; for (const i of ids) { x += P(i).x; y += P(i).y; } return { x: x / ids.length, y: y / ids.length }; };
// Cut your real eyes back out of whatever was painted, so they always show through.
function keepEyes(c, P) { c.save(); c.globalCompositeOperation = 'destination-out'; soft(c, 0); for (const ids of [EYE_L, EYE_R]) { polyPath(c, P, ids); c.fill(); } c.restore(); }

// ---------- shared pieces ----------
// How far forward your face is at a point (x, y), from MediaPipe's face model, in centimetres.
// Sampled once into a small grid; between grid points it blends smoothly.
let faceHeightFn = null;
function faceHeights() {
  if (faceHeightFn) return faceHeightFn;
  const P = FACE_POSITIONS, n = P.length / 3, step = 0.5, x0 = -8.5, y0 = -10.5, nx = 35, ny = 43, grid = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, y = y0 + j * step;
    let wz = 0, ws = 0, best = Infinity, bestZ = 0;
    for (let k = 0; k < n; k++) {
      const d2 = (P[k * 3] - x) ** 2 + (P[k * 3 + 1] - y) ** 2;
      if (d2 < best) { best = d2; bestZ = P[k * 3 + 2]; }
      if (d2 < 1.6) { const wgt = 1 / (d2 + 0.05); wz += wgt * P[k * 3 + 2]; ws += wgt; }
    }
    grid[j * nx + i] = ws ? wz / ws : bestZ;
  }
  return (faceHeightFn = (x, y) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / step)), fy = Math.min(ny - 1.001, Math.max(0, (y - y0) / step));
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, g = (a, b) => grid[b * nx + a];
    return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;
  });
}

// Real animal ears: fur on the back; inside, dusky skin (any colour given is toned down toward real
// skin) with fine pale ear hairs fanning up from the inner edge.
const realInner = (hex) => { const c = new (T().Color)(hex); return c.lerp(new (T().Color)(0x5a4a4c), 0.55).getHex(); };
function earHairs(e, h, w, color = 0xd8d2cc) {
  const THREE = T(), m = mat(color, { r: 0.7, op: 0.75, dw: false });
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1, k = (i >> 1) / 7, x0 = side * w * (0.12 + k * 0.18), y0 = h * (0.08 + k * 0.25);
    const end = new THREE.Vector3(x0 * 0.5 + side * w * 0.05, y0 + h * (0.35 + Math.random() * 0.25), 0.9);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x0, y0, 0.45), new THREE.Vector3(x0, (y0 + end.y) / 2, 0.95), end);
    e.add(mesh(new THREE.TubeGeometry(curve, 8, 0.035, 4), m));
  }
}
function pointyEars(g, kit, { color, inner, x = 5.2, y = 11, z = -1.8, r = 3, h = 5.5, tilt = 0.32, fluffy = false, tip = null }) {
  const outer = fur(color), inn = fluffy ? fur(inner) : mat(realInner(inner), { r: 0.75 }); // fluffy: furry inside (foxes, wolves)
  const outerGeo = earGeometry(h, r * 1.7, { pointy: true, cup: 0.5, thick: 0.28 }), innerGeo = earGeometry(h * 0.78, r * 1.2, { pointy: true, cup: 0.5, thick: 0.14 });
  return [-1, 1].map((s) => {
    const e = at(s * x, y - h * 0.45, z);
    e.rotation.set(-0.15, 0, -s * tilt);
    e.add(mesh(outerGeo, outer), mesh(innerGeo, inn, [0, h * 0.06, 0.42]));
    if (tip != null) e.add(mesh(earGeometry(h * 0.34, r * 0.75, { pointy: true, cup: 0.5, thick: 0.3 }), fur(tip), [0, h * 0.66, 0.06])); // dark ear tips
    earHairs(e, h, r * 1.2);
    const mid = at(0, h * 0.5, 0); e.add(mid);
    g.add(e);
    const w = new Wobble(110, 6, 0.0003);
    kit.zone(mid, r, { wobble: w });
    return (st) => { w.step(st); e.rotation.set(-0.1 + w.y * 0.4, 0, -s * tilt + w.x * 0.7); };
  });
}
function roundEars(g, kit, { color, inner, x = 6.6, y = 9.4, z = -2.4, r = 3, fringe = null }) {
  // one cupped 3D ear of fur (no flat-looking inner disc: from the front that read as a coloured ring)
  const outer = fur(color), geo = earGeometry(r * 1.8, r * 2.2, { pointy: false, cup: 0.6, thick: 0.55 });
  for (const s of [-1, 1]) {
    const e = at(s * x, y - r * 0.85, z);
    e.rotation.set(-0.1, s * 0.25, -s * 0.18);
    e.add(mesh(geo, outer));
    g.add(e);
    kit.zone(e, r + 0.3, { squish: true });
  }
}
function nose(g, kit, color, { size = 1.3, pos = [0, -0.45, 8.4], scale = [1.4, 0.95, 1], burst = 0xffffff, glowy = false, shape = 'dog' } = {}) {
  let n;
  if (glowy || shape === 'ball') n = mesh(ball(size), glowy ? mat(color, { e: color, ei: 0.9, r: 0.2 }) : mat(color, { r: 0.22 }), pos, [0, 0, 0], scale);
  else { n = shape === 'cat' ? catNose(color, size * 1.7) : animalNose(color, size * 2.1); n.position.set(pos[0], pos[1] - 0.1, pos[2] - 0.2); }
  g.add(n);
  kit.zone(n, size + 0.4, { squish: true, burst });
  return n;
}
// Puffs of "fur" or "hair" along the jaw (beards) — 0 = left ear, 1 = right ear.
function jawPuffs(g, color, { r = 2.2, n = 13, low = 1 } = {}) {
  const m = fur(color);
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (0.08 + 0.84 * (i / (n - 1))); // around the bottom of the face
    const x = -Math.cos(a) * 7.2, y = -2 - Math.sin(a) * 8 * low, z = 1.5 + Math.sin(a) * 3.2;
    g.add(mesh(ball(r * (0.85 + Math.sin(a) * 0.3), 14), m, [x, y, z]));
  }
}
function moustache(g, color) {
  const m = fur(color);
  for (const s of [-1, 1]) g.add(mesh(capsule(0.9, 3.4), m, [s * 1.9, -2.9, 7.6], [0, 0, Math.PI / 2 - s * 0.3]));
}
function starGeometry(r = 1, depth = 0.4) {
  const THREE = T(), s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.1, bevelSegments: 2 });
  g.center();
  return g;
}
function batWing(side) {
  const THREE = T(), s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(1.5 * side, 1.4, 3.2 * side, 0.9);
  s.quadraticCurveTo(2.6 * side, 0.3, 2.4 * side, -0.2);
  s.quadraticCurveTo(1.9 * side, 0.2, 1.5 * side, -0.4);
  s.quadraticCurveTo(1.0 * side, 0, 0.6 * side, -0.5);
  s.lineTo(0, 0);
  return new THREE.ShapeGeometry(s);
}
// Things that fly in circles around your head (ghosts, bats, bees, flies).
function orbiters(g, kit, n, make, { radius = 12, height = 8, speed = 0.8, bob = 1.5, burst } = {}) {
  const list = Array.from({ length: n }, (_, i) => {
    const o = make(i);
    g.add(o);
    kit.zone(o, 2.4, { squish: true, burst });
    return { o, phase: (i / n) * Math.PI * 2, h: height + (i % 2 ? 1.5 : -1) };
  });
  return (st, each) => {
    for (const it of list) {
      const a = st.t * speed + it.phase;
      it.o.position.set(Math.sin(a) * radius, it.h + Math.sin(st.t * 2.2 + it.phase) * bob, -3 + Math.cos(a) * radius * 0.9);
      it.o.rotation.y = a + Math.PI / 2;
      each?.(it.o, st, it);
    }
  };
}
function bubbleMaker() {
  const THREE = T();
  const geo = ball(1, 20), m = mat(0xffffff, { r: 0, ir: 1, op: 0.35, dw: false });
  return (st, at3) => {
    if (parts.length > 40) return;
    const b = new THREE.Mesh(geo, m);
    b.position.copy(at3);
    emit(st.world, b, new THREE.Vector3((Math.random() - 0.5) * 3, 6 + Math.random() * 4, 0), 2.5, 'bubble', { size: 0.5 + Math.random() * 0.7, seed: Math.random() * 6 });
  };
}
function sparkle(st, at3, color, n = 1, spread = 2) {
  const THREE = T();
  for (let i = 0; i < n && parts.length < 120; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    s.position.copy(at3).add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread));
    emit(st.world, s, new THREE.Vector3((Math.random() - 0.5) * 4, 3 + Math.random() * 4, (Math.random() - 0.5) * 4), 0.8, 'float', { ownMat: true, size: 0.8 + Math.random() * 0.8 });
  }
}

// A band that arches over the top of your head (headphones, robot ears). It follows the head's oval
// instead of a circle, so it rides just outside the invisible skull and never gets hidden inside it.
function overHead(material, { rx = 9.2, y = 1.2, ry = 13.4, z = -3.6, thick = 0.75 } = {}) {
  const THREE = T();
  const pts = [];
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI; pts.push(new THREE.Vector3(Math.cos(a) * rx, y + Math.sin(a) * ry, z)); }
  return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, thick, 12), material);
}

// =====================================================================================
// 🎃 HALLOWEEN
// =====================================================================================
export const HALLOWEEN_3D = [
  {
    icon: '🎃', name: 'Pumpkin', look: 'sepia(.25) saturate(1.3)',
    build(g, kit) {
      const THREE = T();
      // A real pumpkin: ten lobes with deep grooves, squashed top and bottom, dipping in at the stem.
      const LOBES = 10;
      const geo = ball(1, 96);
      const v = new THREE.Vector3(), pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const phi = Math.atan2(v.z, -v.x), lat = Math.asin(clamp(v.y, -1, 1)), side = Math.cos(lat);
        const groove = Math.pow((1 + Math.cos(LOBES * phi)) / 2, 6); // 1 right in a groove
        const r = 1 - 0.075 * groove * side - 0.02 * Math.pow(Math.sin(LOBES * phi * 0.5), 2) * side;
        const dip = Math.pow(Math.max(0, Math.abs(v.y) - 0.72) / 0.28, 2) * 0.3; // dimples at the stem and base
        v.set(v.x * r, v.y * 0.78 - Math.sign(v.y) * dip * 0.5, v.z * r);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      // Skin: lighter on the bulges, darker in the grooves, soft streaks (no specks: they shimmer like grain), green near the stem.
      // The carved face is cut into the same skin: glowing inside, pale pumpkin flesh around each cut.
      const W = 1024, H = 512, fu = 0.25 * W, fv = 0.47 * H; // the front of the pumpkin in the texture
      const faceShapes = (c, grow = 0) => {
        c.save(); c.translate(fu, fv); c.scale(1.35, 1.35); c.translate(-fu, -fv); // a big carved face
        c.beginPath();
        for (const s2 of [-1, 1]) { // eyes: triangles
          const ex = fu + s2 * 46, ey = fv - 38;
          c.moveTo(ex - 30 - grow, ey + 22 + grow); c.lineTo(ex + 30 + grow, ey + 22 + grow); c.lineTo(ex + s2 * 6, ey - 26 - grow * 1.4); c.closePath();
        }
        c.moveTo(fu, fv + 4 - grow); c.lineTo(fu + 14 + grow, fv + 26 + grow); c.lineTo(fu - 14 - grow, fv + 26 + grow); c.closePath(); // nose
        // a toothy grin
        c.moveTo(fu - 92 - grow, fv + 40);
        c.quadraticCurveTo(fu, fv + 120 + grow * 1.5, fu + 92 + grow, fv + 40);
        c.lineTo(fu + 60, fv + 62 - grow); c.lineTo(fu + 44, fv + 48 - grow); c.lineTo(fu + 22, fv + 72 - grow);
        c.lineTo(fu - 6, fv + 58 - grow); c.lineTo(fu - 30, fv + 74 - grow); c.lineTo(fu - 50, fv + 52 - grow); c.lineTo(fu - 66, fv + 64 - grow);
        c.closePath();
        c.restore();
      };
      const skin = canvasTexture(W, H, (c) => {
        const base = c.createLinearGradient(0, 0, 0, H);
        base.addColorStop(0, '#b8501a'); base.addColorStop(0.18, '#e0701f'); base.addColorStop(0.5, '#f48a2a'); base.addColorStop(0.82, '#de6c1c'); base.addColorStop(1, '#a8461a');
        c.fillStyle = base; c.fillRect(0, 0, W, H);
        for (let k = 0; k <= LOBES; k++) { // grooves darker, lobe middles lighter
          const x = (k / LOBES) * W;
          const gr = c.createLinearGradient(x - W / LOBES / 2, 0, x + W / LOBES / 2, 0);
          gr.addColorStop(0, 'rgba(255,190,90,.22)'); gr.addColorStop(0.42, 'rgba(120,40,0,0)'); gr.addColorStop(0.5, 'rgba(110,35,5,.55)'); gr.addColorStop(0.58, 'rgba(120,40,0,0)'); gr.addColorStop(1, 'rgba(255,190,90,.22)');
          c.fillStyle = gr; c.fillRect(x - W / LOBES / 2, 0, W / LOBES, H);
        }
        if ('filter' in c) c.filter = 'blur(2px)';
        for (let i = 0; i < 900; i++) { // soft streaks running top to bottom
          const x = Math.random() * W, y = Math.random() * H, L = 20 + Math.random() * 70;
          c.strokeStyle = Math.random() < 0.5 ? 'rgba(255,200,120,.10)' : 'rgba(120,45,5,.10)'; c.lineWidth = 1 + Math.random() * 2;
          c.beginPath(); c.moveTo(x, y); c.lineTo(x + (Math.random() - 0.5) * 6, y + L); c.stroke();
        }
        c.filter = 'none';
        const top = c.createLinearGradient(0, 0, 0, H * 0.14); top.addColorStop(0, 'rgba(80,95,30,.75)'); top.addColorStop(1, 'rgba(80,95,30,0)');
        c.fillStyle = top; c.fillRect(0, 0, W, H * 0.14);
        // the carving: pale cut flesh around each hole, then the dark inside wall
        c.fillStyle = '#e3a253'; faceShapes(c, 4); c.fill();
        c.fillStyle = '#3a1a06'; faceShapes(c, 0); c.fill();
      });
      const glowTex = canvasTexture(W, H, (c) => { // only the holes glow, brightest in the middle like a candle
        c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
        const gr = c.createRadialGradient(fu, fv + 25, 10, fu, fv + 25, 190);
        gr.addColorStop(0, '#ffcf6a'); gr.addColorStop(0.45, '#ff9312'); gr.addColorStop(1, '#d94a06'); // warm candle orange (too bright washes out to white)
        c.fillStyle = gr; faceShapes(c, -3); c.fill();
        c.fillStyle = 'rgba(230,120,30,.35)'; faceShapes(c, 4); c.fill(); // the cut flesh glows a little too
        // the inside walls of each cut are in shadow, so the holes look deep
        c.save(); faceShapes(c, -3); c.clip(); c.strokeStyle = 'rgba(70,20,0,.85)'; c.lineWidth = 16; faceShapes(c, -3); c.stroke(); c.restore();
      });
      const skinMat = mat(0xffffff, { map: skin, r: 0.5 });
      skinMat.emissive = new THREE.Color(0xffffff); skinMat.emissiveMap = glowTex; skinMat.emissiveIntensity = 1.5;
      // Sits on top of the head: its bottom stays just above the invisible skull, so no bite gets cut out of it.
      const p = at(0, 18.3, -3.4);
      p.add(mesh(geo, skinMat, [0, 0, 0], [0, 0, 0], [6.7, 6.2, 6.4]));
      // the stem: woody, ridged, a little twisted and bent, flaring where it meets the pumpkin
      const stemGeo = new THREE.CylinderGeometry(0.42, 0.75, 2.8, 16, 12);
      const sp = stemGeo.attributes.position;
      for (let i = 0; i < sp.count; i++) {
        v.fromBufferAttribute(sp, i);
        const k = (v.y + 1.4) / 2.8, a = Math.atan2(v.z, v.x) + k * 0.9; // twist
        const r = Math.hypot(v.x, v.z) * (1 + 0.12 * Math.cos(6 * a)) * (1 + 0.6 * Math.pow(1 - k, 4)); // ridges + flare
        v.set(Math.cos(a) * r + k * k * 0.9, v.y, Math.sin(a) * r);
        sp.setXYZ(i, v.x, v.y, v.z);
      }
      stemGeo.computeVertexNormals();
      const stemTex = canvasTexture(64, 128, (c, w, h) => {
        const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#8a7a4a'); gr.addColorStop(0.5, '#5f6b2c'); gr.addColorStop(1, '#3f5a1c');
        c.fillStyle = gr; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 60; i++) { c.strokeStyle = `rgba(${Math.random() < 0.5 ? '220,210,160' : '30,30,10'},.25)`; c.lineWidth = 1; const x = Math.random() * w; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + (Math.random() - 0.5) * 8, h); c.stroke(); }
      });
      p.add(mesh(stemGeo, mat(0xffffff, { map: stemTex, r: 0.85 }), [0, 5.3, 0], [0, 0, 0.12]));
      g.add(p);
      kit.zone(p, 6.5, { grab: true, squish: true, burst: 0xff922b });
      // the candle inside flickers
      return (st) => { skinMat.emissiveIntensity = 1.5 + Math.sin(st.t * 13) * 0.2 + Math.sin(st.t * 7.3) * 0.15 + Math.sin(st.t * 23.7) * 0.07; };
    },
  },
  {
    icon: '🧛', name: 'Vampire', look: 'saturate(.55) brightness(1.08) contrast(1.12)',
    build(g, kit) {
      const THREE = T();
      // Fangs hide in your mouth and slide down when you open it. Shaped like real canine teeth:
      // a thick root that narrows to a sharp, slightly curved point.
      const toothGeo = new THREE.LatheGeometry([[0, 0.05], [0.44, 0], [0.47, -0.35], [0.38, -0.95], [0.2, -1.45], [0.03, -1.8], [0, -1.82]].map(([x, y]) => new THREE.Vector2(x, y)), 20);
      toothGeo.scale(1, 1, 0.75);
      const enamel = mat(0xfffaf0, { r: 0.2 });
      const fangs = at(0, -4.35, 5.75);
      const teeth = [-1, 1].map((s) => { const t = mesh(toothGeo, enamel, [s * 1.05, 0, 0], [0.12, 0, s * 0.1]); fangs.add(t); return t; });
      g.add(fangs);
      kit.zone(fangs, 1.6, { squish: true, burst: 0xe03131 });
      // Dracula's stand-up collar: stiff fabric held up by boning, so it stands in pleats that flare out
      // toward the top and end in points. Black wool outside, deep crimson satin inside, piped edges.
      const collar = at(0, -4, -5);
      const N = 7, H = 18, start = Math.PI / 2 - 0.55, wrap = Math.PI + 1.1, SEG = 140, ROWS = 24;
      const shape = (u, v, off) => { // u: around (0..1), v: up (0..1)
        const a = start + u * wrap;
        const pleat = Math.sin(u * N * Math.PI * 2);
        const tipUp = Math.pow(Math.abs(Math.sin(u * N * Math.PI)), 1.5) * 2.4; // points along the top edge
        const top = H - 1.2 + tipUp;
        const y = -H / 2 + v * top;
        const k = (y + H / 2) / H;
        const r = lerp(8.4, 16.8, Math.pow(k, 1.25)) + pleat * 0.45 * k + off;
        return [Math.sin(a) * r, y, Math.cos(a) * r]; // same way round as a three.js cylinder: open at the front
      };
      const sheet = (off) => {
        const pos = [], uv = [], idx = [];
        for (let j = 0; j <= ROWS; j++) for (let i = 0; i <= SEG; i++) { pos.push(...shape(i / SEG, j / ROWS, off)); uv.push(i / SEG, j / ROWS); }
        for (let j = 0; j < ROWS; j++) for (let i = 0; i < SEG; i++) { const a0 = j * (SEG + 1) + i, b0 = a0 + SEG + 1; idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1); }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx); geo.computeVertexNormals();
        return geo;
      };
      // satin: a soft shine running along each pleat, darker down in the folds
      const satinTex = canvasTexture(512, 64, (c, w, h) => {
        for (let x = 0; x < w; x++) { const f = Math.sin((x / w) * N * Math.PI * 2); const l = 0.55 + 0.45 * f; c.fillStyle = `rgb(${62 + l * 92 | 0},${l * 8 | 0},${12 + l * 16 | 0})`; c.fillRect(x, 0, 1, h); } // deep crimson
        const fade = c.createLinearGradient(0, 0, 0, h); fade.addColorStop(0, 'rgba(0,0,0,.45)'); fade.addColorStop(0.4, 'rgba(0,0,0,0)'); c.fillStyle = fade; c.fillRect(0, 0, w, h);
      });
      const satin = new THREE.MeshPhysicalMaterial({ map: satinTex, roughness: 0.32, sheen: 1, sheenRoughness: 0.35, sheenColor: new THREE.Color(0xc8304a), clearcoat: 0.25, clearcoatRoughness: 0.3, side: THREE.DoubleSide });
      const wool = mat(0x121014, { r: 0.85, double: true });
      collar.add(mesh(sheet(0), satin), mesh(sheet(0.35), wool));
      // piping along the pointed top edge
      const edge = []; for (let i = 0; i <= SEG; i++) edge.push(new THREE.Vector3(...shape(i / SEG, 1, 0.18)));
      collar.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge), 280, 0.32, 8), mat(0x0a0a0c, { r: 0.4 })));
      g.add(collar);
      return (st) => {
        const out = clamp((st.jaw - 0.12) / 0.45, 0, 1); // open your mouth: the fangs come down
        fangs.visible = out > 0.03;
        for (const t of teeth) t.scale.set(1, 0.2 + 0.8 * out, 1);
        fangs.position.y = -out * 0.25; // (the touch wrapper already holds the fangs' place in your mouth)
      };
    },
  },
  {
    icon: '🧟', name: 'Zombie', look: 'saturate(.7) contrast(1.1) brightness(.97)',
    // Zombie make-up is painted right onto your face, point by point, so it moves with your real face:
    // dead grey-green skin, bruised sunken eyes, veins at the temples, dark lips, and a stitched wound.
    face(c, f) {
      const P = f.P, W = f.w;
      const path = (ids) => { c.beginPath(); ids.forEach((i, k) => { const p = P(i); k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); c.closePath(); };
      c.save();
      if ('filter' in c) c.filter = `blur(${(W * 0.035).toFixed(1)}px)`; // soft edges, like make-up
      path(FACE_OVAL); c.fillStyle = 'rgba(92,122,82,.34)'; c.fill(); // dead skin
      for (const [inner, outer, brow] of [[133, 33, 105], [362, 263, 334]]) { // sunken, bruised eye sockets
        const a = P(inner), b = P(outer), u = P(brow), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 + (u.y - (a.y + b.y) / 2) * 0.15;
        const r = Math.hypot(a.x - b.x, a.y - b.y) * 1.05;
        const gr = c.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
        gr.addColorStop(0, 'rgba(50,22,40,.62)'); gr.addColorStop(0.55, 'rgba(70,40,60,.38)'); gr.addColorStop(1, 'rgba(70,40,60,0)');
        c.fillStyle = gr; c.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      for (const [x0, x1] of [[61, 205], [291, 425]]) { // hollow cheeks
        const a = P(x0), b = P(x1), cx = (a.x * 0.3 + b.x * 0.7), cy = (a.y * 0.3 + b.y * 0.7), r = W * 0.12;
        const gr = c.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, 'rgba(45,35,40,.28)'); gr.addColorStop(1, 'rgba(45,35,40,0)');
        c.fillStyle = gr; c.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      path(LIPS); c.fillStyle = 'rgba(55,35,50,.5)'; c.fill(); // cold, dark lips
      if ('filter' in c) c.filter = `blur(${(W * 0.004).toFixed(1)}px)`;
      c.strokeStyle = 'rgba(70,40,90,.45)'; c.lineCap = 'round';
      for (const [from, to] of [[54, 21], [284, 251]]) { // branching veins at the temples
        const a = P(from), b = P(to), dx = b.x - a.x, dy = b.y - a.y;
        for (let k = 0; k < 3; k++) {
          c.lineWidth = W * (0.007 - k * 0.0015);
          c.beginPath(); c.moveTo(a.x + dx * 0.1, a.y + dy * 0.1);
          c.quadraticCurveTo(a.x + dx * 0.5 + dy * (0.15 - k * 0.15), a.y + dy * 0.5 - dx * (0.15 - k * 0.15), a.x + dx * (0.95 - k * 0.12) + dy * (k - 1) * 0.25, a.y + dy * (0.95 - k * 0.12) - dx * (k - 1) * 0.25);
          c.stroke();
        }
      }
      // a stitched wound across the forehead: swollen pink edges, a dark cut, black thread
      const mix = (p, q, k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
      const A = mix(P(105), P(67), 0.6), B = mix(P(334), P(297), 0.35); // slanting across the middle of the forehead
      const nx = -(B.y - A.y), ny = B.x - A.x, nl = Math.hypot(nx, ny) || 1;
      const pt = (k) => { // a slightly wobbly cut, not a ruler line
        const off = (Math.sin(k * 9.1) * 0.012 + Math.sin(k * 23.7) * 0.006 + Math.sin(k * Math.PI) * 0.03) * nl;
        return { x: A.x + (B.x - A.x) * k + nx / nl * off, y: A.y + (B.y - A.y) * k + ny / nl * off };
      };
      const line = (w, col, from = 0.15, to = 0.85) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); for (let k = from; k <= to + 1e-6; k += 0.02) { const q = pt(k); k === from ? c.moveTo(q.x, q.y) : c.lineTo(q.x, q.y); } c.stroke(); };
      if ('filter' in c) c.filter = `blur(${(W * 0.006).toFixed(1)}px)`;
      line(W * 0.05, 'rgba(165,70,70,.45)', 0.05, 0.95); // swollen edges
      if ('filter' in c) c.filter = 'none';
      line(W * 0.014, 'rgba(90,20,22,.85)', 0.08, 0.92); line(W * 0.006, 'rgba(40,5,8,.9)', 0.1, 0.9); // the cut, darkest down the middle
      c.strokeStyle = 'rgba(20,18,20,.9)'; c.lineWidth = W * 0.007;
      for (let k = 0.14; k <= 0.86; k += 0.09) { // stitches cross the cut, each a little different
        const q = pt(k), q2 = pt(k + 0.01), sx = -(q2.y - q.y), sy = q2.x - q.x, l = Math.hypot(sx, sy) || 1, L = W * (0.036 + Math.sin(k * 40) * 0.006), t = Math.sin(k * 31) * 0.8;
        c.beginPath(); c.moveTo(q.x - sx / l * L - (q2.x - q.x) * t, q.y - sy / l * L - (q2.y - q.y) * t); c.lineTo(q.x + sx / l * L + (q2.x - q.x) * t, q.y + sy / l * L + (q2.y - q.y) * t); c.stroke();
      }
      c.restore();
    },
    build(g, kit) {
      const THREE = T();
      // houseflies: grey striped thorax, dark shiny belly, big red eyes, see-through veined wings
      const thorax = mat(0x4a4a46, { r: 0.6 }), belly = gloss(0x1c1d1a, { r: 0.3 }), eye = gloss(0x7a1410, { r: 0.25 }), leg = mat(0x111111, { r: 0.7 });
      const wingTex = canvasTexture(64, 128, (c, w, h) => {
        c.fillStyle = 'rgba(220,225,230,.38)'; c.beginPath(); c.ellipse(w / 2, h / 2, w * 0.45, h * 0.48, 0, 0, 7); c.fill();
        c.strokeStyle = 'rgba(40,40,40,.55)'; c.lineWidth = 1.2;
        for (const dx of [-14, -5, 4, 13]) { c.beginPath(); c.moveTo(w / 2, h * 0.08); c.quadraticCurveTo(w / 2 + dx, h / 2, w / 2 + dx * 1.2, h * 0.92); c.stroke(); }
      });
      const wing = new THREE.MeshBasicMaterial({ map: wingTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const flies = orbiters(g, kit, 4, () => {
        const f = new THREE.Group();
        f.add(mesh(ball(0.32, 14), thorax, [0, 0, 0.15], [0, 0, 0], [1, 0.85, 1.1]));
        f.add(mesh(ball(0.34, 14), belly, [0, -0.04, -0.4], [0, 0, 0], [0.95, 0.75, 1.3]));
        for (const s2 of [-1, 1]) {
          f.add(mesh(ball(0.17, 12), eye, [s2 * 0.2, 0.05, 0.48]));
          const w2 = mesh(new THREE.PlaneGeometry(0.55, 1.05), wing, [s2 * 0.3, 0.26, -0.3], [-Math.PI / 2 + 0.15, s2 * 0.35, 0]);
          w2.userData.side = s2; f.add(w2);
          for (const lz of [0.25, 0.05, -0.15]) f.add(mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.5, 4), leg, [s2 * 0.28, -0.22, lz], [0, 0, s2 * 0.9]));
        }
        return f;
      }, { radius: 11, height: 4, speed: 2.4, bob: 3, burst: 0x8ce99a });
      return (st) => flies(st, (o, s2, it) => {
        o.position.x += Math.sin(s2.t * 17 + it.phase) * 0.4; o.position.y += Math.sin(s2.t * 23 + it.phase) * 0.4;
        for (const ch of o.children) if (ch.userData.side) ch.rotation.z = ch.userData.side * (0.3 + Math.sin(s2.t * 90 + it.phase) * 0.35); // wings buzz
      });
    },
  },
  {
    icon: '🧙‍♀️', name: 'Witch',
    build(g, kit) {
      const THREE = T();
      // soft charcoal felt: gentle blotches, never speckly
      const felt = canvasTexture(256, 256, (c, w, h) => {
        c.fillStyle = '#1d1a20'; c.fillRect(0, 0, w, h);
        if ('filter' in c) c.filter = 'blur(10px)';
        for (let i = 0; i < 40; i++) { const v = 18 + Math.random() * 22 | 0; c.fillStyle = `rgba(${v + 4},${v},${v + 8},.6)`; c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 10 + Math.random() * 30, 0, 7); c.fill(); }
      });
      felt.wrapS = felt.wrapT = THREE.RepeatWrapping;
      const black = mat(0xffffff, { r: 0.85, map: felt, double: true }); // the brim: both sides show
      const crownFelt = mat(0xffffff, { r: 0.85, map: felt }); // the crown: only the outside (your head is inside)
      // The crown: one piece swept along a bent spine, wide enough to fit over the head, tapering
      // to a point that slumps over, with soft creases where it bends.
      const spine = new THREE.CatmullRomCurve3([[0, 0, 0], [0, 4.5, 0.2], [0.2, 9, -0.2], [1.6, 12.8, -0.8], [4.6, 14.6, -1.6]].map((q) => new THREE.Vector3(...q)));
      const SEG = 80, RAD = 40, frames = spine.computeFrenetFrames(SEG, false);
      const sweep = (t0, t1, grow = 1) => {
        const pos = [], uv = [], idx = [], rows = Math.max(2, Math.round((t1 - t0) * SEG));
        for (let j = 0; j <= rows; j++) {
          const t = t0 + (t1 - t0) * (j / rows), fi = Math.min(SEG, Math.round(t * SEG));
          const P = spine.getPointAt(t), N = frames.normals[fi], B = frames.binormals[fi];
          const r = (1 - Math.pow(t, 0.85) * 0.97) * grow;
          const crease = 1 - 0.06 * Math.exp(-Math.pow((t - 0.62) / 0.035, 2)) - 0.04 * Math.exp(-Math.pow((t - 0.78) / 0.03, 2));
          for (let i = 0; i <= RAD; i++) {
            const a = (i / RAD) * Math.PI * 2, lump = 1 + 0.025 * Math.sin(5 * a + t * 9) * t;
            const ex = 8.4 * r * crease * lump, ez = 9.8 * r * crease * lump * (1 - 0.15 * t); // oval like a head at the bottom
            const x = P.x + N.x * Math.cos(a) * ex + B.x * Math.sin(a) * ez, y = P.y + N.y * Math.cos(a) * ex + B.y * Math.sin(a) * ez, z = P.z + N.z * Math.cos(a) * ex + B.z * Math.sin(a) * ez;
            pos.push(x, y, z); uv.push(i / RAD * 3, t * 4);
          }
        }
        for (let j = 0; j < rows; j++) for (let i = 0; i < RAD; i++) { const a = j * (RAD + 1) + i, b = a + RAD + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx); geo.computeVertexNormals(); return geo;
      };
      const hat = at(0, 9.3, -3.6);
      hat.rotation.x = -0.12;
      hat.add(mesh(sweep(0, 1), crownFelt));
      // a wide brim that droops and ripples at the edge, with a rolled edge you can see
      const brim = new THREE.RingGeometry(7.8, 16, 96, 8), bp = brim.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < bp.count; i++) {
        v.fromBufferAttribute(bp, i);
        const r = Math.hypot(v.x, v.y), a = Math.atan2(v.y, v.x), k = Math.max(0, (r - 8) / 8);
        const sx = 1, sy = 1.12; // oval like the crown
        bp.setXYZ(i, v.x * sx, -1.4 * k * k + 0.5 * Math.sin(a * 5 + 0.7) * k * k, v.y * sy);
      }
      brim.computeVertexNormals();
      hat.add(mesh(brim, black, [0, 0.3, 0]));
      const rim = []; for (let i = 0; i <= 160; i++) { const a = (i / 160) * Math.PI * 2; rim.push(new THREE.Vector3(Math.cos(a) * 16, 0.3 - 1.4 + 0.5 * Math.sin(a * 5 + 0.7), Math.sin(a) * 16 * 1.12)); }
      hat.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim, true), 320, 0.16, 8, true), black));
      // purple satin band with an old silver buckle
      hat.add(mesh(sweep(0.035, 0.2, 1.03), new THREE.MeshPhysicalMaterial({ color: 0x4b2a7a, roughness: 0.38, sheen: 1, sheenColor: new THREE.Color(0x9a7ad8), sheenRoughness: 0.4 })));
      const silver = mat(0x8a877f, { m: 1, r: 0.45 }), buckle = at(0, 1.75, 9.85);
      buckle.rotation.x = -0.18; // lies against the sloping crown
      for (const [x, y, w, h] of [[0, 0.78, 2.2, 0.26], [0, -0.78, 2.2, 0.26], [-0.97, 0, 0.26, 1.82], [0.97, 0, 0.26, 1.82]]) buckle.add(mesh(new THREE.BoxGeometry(w, h, 0.16), silver, [x, y, 0]));
      buckle.add(mesh(new THREE.BoxGeometry(0.14, 1.4, 0.12), silver, [0.1, 0, 0.09], [0, 0, 0.12])); // the prong
      hat.add(buckle);
      g.add(hat);
      kit.zone(hat, 9, { grab: true, spin: true, burst: 0x8ce99a });
    },
  },
  {
    icon: '👻', name: 'Ghosts', look: 'saturate(.6) contrast(1.05) brightness(.97)',
    build(g, kit) {
      const THREE = T();
      // A ghost: a draped sheet with a round head and shoulders that trails off into a wispy tail.
      // See-through and glowing, brightest at its edges, fading out toward the tail; the hem ripples as it floats.
      const prof = [[0, 2.3], [0.9, 2.15], [1.55, 1.7], [1.9, 1.0], [1.95, 0.2], [2.05, -0.8], [2.2, -1.8], [2.05, -2.8], [1.5, -3.8], [0.8, -4.8], [0.15, -5.8]];
      const ghostMat = () => new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(0xdfe8ff) } },
        vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
          void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = position.y; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying float vY;
          void main() {
            float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.8);
            float body = smoothstep(-5.8, -1.2, vY);           // the tail fades away
            float a = (0.22 + rim * 0.6) * body;
            gl_FragColor = vec4(mix(uColor * 0.9, vec3(1.0), rim * 0.7), a);
          }`,
        transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.4, // (opacity < 0.6: casts no shadow)
      });
      const holes = canvasTexture(128, 128, (c, w, h) => { // soft, hollow eye sockets and an open mouth
        const hole = (x, y, rx, ry, a) => { const gr = c.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry)); gr.addColorStop(0, `rgba(12,14,24,${a})`); gr.addColorStop(0.6, `rgba(12,14,24,${a * 0.8})`); gr.addColorStop(1, 'rgba(12,14,24,0)');
          c.save(); c.translate(x, y); c.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); c.translate(-x, -y); c.fillStyle = gr; c.beginPath(); c.arc(x, y, Math.max(rx, ry), 0, 7); c.fill(); c.restore(); };
        hole(38, 44, 19, 25, 0.95); hole(90, 44, 19, 25, 0.95); hole(64, 98, 16, 22, 0.85);
      });
      const faceMat = new THREE.MeshBasicMaterial({ map: holes, transparent: true, depthWrite: false, opacity: 0.9 });
      const all = [];
      const ghosts = orbiters(g, kit, 3, (i) => {
        const o = new THREE.Group(); o.scale.setScalar(1.35);
        const geo = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 48);
        const base = geo.attributes.position.array.slice();
        const body = mesh(geo, ghostMat()); o.add(body);
        const f = mesh(new THREE.PlaneGeometry(2.6, 2.6), faceMat, [0, 1.15, 1.96], [-0.08, 0, 0]); o.add(f);
        all.push({ geo, base, seed: i * 1.7 });
        return o;
      }, { radius: 13, height: 6, speed: 0.7, bob: 2, burst: 0xdbe4ff });
      return (st) => {
        for (const gh of all) { // the hem ripples and the tail sways behind
          const p = gh.geo.attributes.position.array, b = gh.base;
          for (let i = 0; i < p.length; i += 3) {
            const y = b[i + 1], d = Math.max(0, (0.5 - y) / 6.3), ang = Math.atan2(b[i + 2], b[i]);
            const ripple = 1 + Math.sin(ang * 5 + st.t * 3.1 + y * 0.9 + gh.seed) * 0.09 * d;
            p[i] = b[i] * ripple + Math.sin(st.t * 1.6 + y * 0.55 + gh.seed) * 0.55 * d * d;
            p[i + 2] = b[i + 2] * ripple - d * d * 1.2; // the tail trails behind
          }
          gh.geo.attributes.position.needsUpdate = true; gh.geo.computeVertexNormals();
        }
        ghosts(st, (o, s2, it) => { o.rotation.y = Math.sin(s2.t * 0.7 + it.phase) * 0.6; }); // mostly turned toward you as they drift past
      };
    },
  },
  {
    icon: '🦇', name: 'Bats', look: 'brightness(.9) contrast(1.12) saturate(1.1)',
    build(g, kit) {
      const THREE = T();
      // Real bats: furry bodies, big ears, a little snout, tiny dark eyes, and wings that are thin skin
      // stretched between long finger bones, with a scalloped trailing edge.
      const furry = fur(0x2b221d), skin = mat(0x2e2420, { r: 0.75 }), eyeMat = gloss(0x050505, { r: 0.15 });
      const membrane = new THREE.MeshStandardMaterial({ color: 0x3b2c27, roughness: 0.75, side: THREE.DoubleSide, transparent: true, opacity: 0.94 });
      // finger tips of one wing (x outward, y up), then the membrane along them
      const tips = [[0.95, 0.35], [3.3, 1.15], [3.75, 0.25], [3.1, -0.75], [2.0, -1.35]];
      const wrist = [1.55, 0.55];
      const wingGeo = (() => {
        const sh = new THREE.Shape(); sh.moveTo(0, 0.25);
        sh.lineTo(wrist[0], wrist[1]); sh.lineTo(tips[1][0], tips[1][1]);
        for (let i = 1; i < tips.length - 1; i++) { // scalloped edge curving in between fingers
          const [ax, ay] = tips[i], [bx, by] = tips[i + 1], mx = (ax + bx) / 2, my = (ay + by) / 2, nx = mx - wrist[0], ny = my - wrist[1], l = Math.hypot(nx, ny);
          sh.quadraticCurveTo(mx - nx / l * 0.55, my - ny / l * 0.55, bx, by);
        }
        sh.quadraticCurveTo(1.1, -1.25, 0, -0.6); sh.lineTo(0, 0.25);
        return new THREE.ShapeGeometry(sh, 10);
      })();
      const bone = (from, to, r) => { const a = new THREE.Vector3(from[0], from[1], 0.02), b = new THREE.Vector3(to[0], to[1], 0.02), d = b.clone().sub(a);
        const m = mesh(new THREE.CylinderGeometry(r * 0.7, r, d.length(), 6), skin); m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return m; };
      const wings = [];
      const bats = orbiters(g, kit, 4, () => {
        const b = new THREE.Group();
        b.add(mesh(ball(0.62, 16), furry, [0, -0.1, 0], [0, 0, 0], [0.85, 1.25, 0.8])); // body
        const head = at(0, 0.95, 0.05); b.add(head);
        head.add(mesh(ball(0.42, 16), furry, [0, 0, 0], [0, 0, 0], [1, 0.95, 1]));
        head.add(mesh(ball(0.2, 12), skin, [0, -0.12, 0.36], [0, 0, 0], [1, 0.8, 1.1])); // snout
        for (const s of [-1, 1]) {
          head.add(mesh(ball(0.06, 8), eyeMat, [s * 0.17, 0.06, 0.36]));
          const ear = at(s * 0.24, 0.35, 0); ear.rotation.set(-0.15, 0, -s * 0.35);
          ear.add(mesh(cone(0.2, 0.62, 10), skin, [0, 0.28, 0], [0, 0, 0], [1, 1, 0.45])); head.add(ear);
          const w = at(s * 0.35, 0.25, 0); // the shoulder
          const wingBody = new THREE.Group(); wingBody.scale.x = s;
          wingBody.add(mesh(wingGeo, membrane));
          wingBody.add(bone([0, 0.3], wrist, 0.07));
          for (const tip of tips.slice(1)) wingBody.add(bone(wrist, tip, 0.04));
          wingBody.add(bone(wrist, tips[0], 0.05)); // the thumb
          w.add(wingBody); b.add(w);
          wings.push({ w, s, seed: Math.random() * 6 });
        }
        b.scale.setScalar(1.25);
        return b;
      }, { radius: 12, height: 9, speed: 1.3, bob: 2.5, burst: 0x9775fa });
      return (st) => {
        bats(st);
        for (const k of wings) {
          const ph = Math.sin(st.t * 15 + k.seed);
          k.w.rotation.y = k.s * ph * 0.85;          // flap
          k.w.scale.x = 0.82 + 0.18 * (ph * 0.5 + 0.5); // the wing folds a little on the upstroke
        }
      };
    },
  },
  {
    icon: '💀', name: 'Skelly', look: 'grayscale(1) contrast(1.25) brightness(1.08)',
    // Skull face paint, painted point by point onto your real face: white base, deep black eye sockets,
    // a nose cavity, hollow cheeks, and teeth drawn right across your lips out onto your cheeks.
    face(c, f) {
      const P = f.P, W = f.w;
      const path = (ids) => { c.beginPath(); ids.forEach((i, k) => { const p = P(i); k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); c.closePath(); };
      const soft = (px) => { if ('filter' in c) c.filter = px ? `blur(${(W * px).toFixed(1)}px)` : 'none'; };
      c.save();
      soft(0.03); path(FACE_OVAL); c.fillStyle = 'rgba(245,245,245,.5)'; c.fill(); // white base
      for (const [cx0, cx1] of [[61, 205], [291, 425]]) { // hollow cheeks
        const a = P(cx0), b = P(cx1), x = a.x * 0.25 + b.x * 0.75, y = a.y * 0.25 + b.y * 0.75, r = W * 0.13;
        const gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(40,40,40,.5)'); gr.addColorStop(1, 'rgba(40,40,40,0)'); c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2);
      }
      soft(0.008);
      c.fillStyle = 'rgba(8,8,8,.93)';
      for (const ids of [[33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7], [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]]) {
        // the socket: the eye shape grown outward, up to the brow and down onto the cheekbone
        let cx = 0, cy = 0; for (const i of ids) { cx += P(i).x; cy += P(i).y; } cx /= ids.length; cy /= ids.length;
        c.beginPath(); ids.forEach((i, k) => { const p = P(i), dx = p.x - cx, dy = p.y - cy; const x = cx + dx * 2.15, y = cy + dy * (dy < 0 ? 4.2 : 3.0); k ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); c.fill();
      }
      { // the nose cavity: an upside-down heart over the tip of the nose
        const tip = P(4), l = P(98), r = P(327), b = P(2), w = Math.hypot(r.x - l.x, r.y - l.y) * 0.62;
        c.beginPath(); c.moveTo(b.x, b.y + w * 0.1);
        c.bezierCurveTo(l.x - w * 0.15, b.y, l.x, tip.y - w * 0.2, (l.x + tip.x) / 2, tip.y - w * 0.15);
        c.quadraticCurveTo(tip.x, tip.y + w * 0.05, (r.x + tip.x) / 2, tip.y - w * 0.15);
        c.bezierCurveTo(r.x, tip.y - w * 0.2, r.x + w * 0.15, b.y, b.x, b.y + w * 0.1); c.fill();
      }
      // teeth: white lips, a dark line where they meet, and tooth lines across both lips, out onto the cheeks
      soft(0.004);
      path(LIPS); c.fillStyle = 'rgba(240,240,240,.75)'; c.fill();
      const UP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291], LO = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];
      const along = (ids, k) => { const t = k * (ids.length - 1), i = Math.min(ids.length - 2, Math.floor(t)), u = t - i, a = P(ids[i]), b = P(ids[i + 1]); return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }; };
      const L = P(61), R = P(291), ext = W * 0.12, dx = (R.x - L.x), dy = (R.y - L.y), dl = Math.hypot(dx, dy) || 1;
      c.strokeStyle = 'rgba(10,10,10,.9)'; c.lineCap = 'round';
      c.lineWidth = W * 0.01; c.beginPath(); c.moveTo(L.x - dx / dl * ext, L.y - dy / dl * ext); // where the lips meet, carried out to the cheeks
      for (let k = 0; k <= 1.0001; k += 0.1) { const u = along(UP, k), d = along(LO, k); c.lineTo((u.x + d.x) / 2, (u.y + d.y) / 2); }
      c.lineTo(R.x + dx / dl * ext, R.y + dy / dl * ext); c.stroke();
      c.lineWidth = W * 0.006;
      for (let k = 0.08; k <= 0.93; k += 0.085) { const u = along(UP, k), d = along(LO, k); c.beginPath(); c.moveTo(u.x, u.y - W * 0.01); c.lineTo(d.x, d.y + W * 0.01); c.stroke(); }
      for (const s of [-1, 1]) for (let j = 1; j <= 3; j++) { // painted teeth carry on past the corners of the mouth
        const base = s < 0 ? L : R, x = base.x + s * dx / dl * ext * (j / 3.2), y = base.y + s * dy / dl * ext * (j / 3.2), h = W * (0.04 - j * 0.008);
        c.beginPath(); c.moveTo(x, y - h); c.lineTo(x, y + h); c.stroke();
      }
      c.restore();
    },
    build(g, kit) {
      const n = at(0, -1.4, 7.7); g.add(n); // (the painted nose is still touchable)
      kit.zone(n, 1.4, { squish: true, burst: 0xffffff });
    },
  },
  {
    icon: '🕷️', name: 'Spider',
    build(g, kit) {
      const THREE = T();
      // A real spider hanging head-down on its silk: a fuzzy two-part body (faint chevrons on the
      // abdomen), eight tiny shiny eyes, fangs and palps, and eight jointed legs with their knees up.
      const chitin = mat(0x1d1612, { r: 0.4 }), eyeMat = gloss(0x050505, { r: 0.08 });
      const marks = canvasTexture(128, 128, (c, w, h) => {
        c.fillStyle = '#9a928a'; c.fillRect(0, 0, w, h); // (multiplied by the dark body colour)
        if ('filter' in c) c.filter = 'blur(3px)';
        c.strokeStyle = 'rgba(255,235,205,.75)'; c.lineWidth = 5;
        for (let i = 0; i < 4; i++) { const y = 30 + i * 20; c.beginPath(); c.moveTo(w * 0.32, y); c.lineTo(w * 0.5, y + 10); c.lineTo(w * 0.68, y); c.stroke(); }
      });
      const spider = at(4.5, 11, 6), body = new THREE.Group(); spider.add(body);
      body.add(mesh(ball(1.05, 24), mat(0x3a2c22, { r: 0.9, furry: true, map: marks }), [0, 1.15, 0], [0.2, 0, 0], [1, 1.25, 0.95])); // abdomen
      body.add(mesh(ball(0.12, 8), chitin, [0, 0.22, 0.05])); // the thin waist
      body.add(mesh(ball(0.68, 20), fur(0x241a14), [0, -0.45, 0.12], [0, 0, 0], [1, 1.15, 0.78])); // head & thorax
      for (const [x, y, r] of [[-0.14, -1.0, 0.07], [0.14, -1.0, 0.07], [-0.3, -0.92, 0.055], [0.3, -0.92, 0.055], [-0.1, -0.86, 0.045], [0.1, -0.86, 0.045], [-0.38, -0.8, 0.04], [0.38, -0.8, 0.04]])
        body.add(mesh(ball(r, 10), eyeMat, [x, y, 0.6])); // eight eyes
      for (const s2 of [-1, 1]) {
        body.add(mesh(cone(0.11, 0.42, 8), chitin, [s2 * 0.13, -1.18, 0.5], [Math.PI + 0.3, 0, 0])); // fangs
        body.add(mesh(capsule(0.06, 0.45), chitin, [s2 * 0.32, -1.15, 0.45], [0.5, 0, s2 * 0.4])); // palps
      }
      // legs: three tapering segments with joints, knees arched up toward you
      const seg = (a, b, r0, r1) => { const d = b.clone().sub(a), m = mesh(new THREE.CylinderGeometry(r1, r0, d.length(), 7), chitin); m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return m; };
      const legs = [];
      for (const s2 of [-1, 1]) for (let i = 0; i < 4; i++) {
        const leg = at(s2 * 0.45, -0.55 + (i - 1.5) * 0.18, 0.1); body.add(leg);
        const th = (i - 1.5) * 0.55 + (i < 2 ? -0.15 : 0.15), dir = new THREE.Vector3(s2 * Math.cos(th), -Math.sin(th), 0), z = new THREE.Vector3(0, 0, 1);
        const len = i === 0 || i === 3 ? 1.15 : 1;
        const p0 = new THREE.Vector3(), p1 = dir.clone().multiplyScalar(0.95 * len).addScaledVector(z, 0.75), p2 = p1.clone().addScaledVector(dir, 1.25 * len).addScaledVector(z, 0.15), p3 = p2.clone().addScaledVector(dir, 1.05 * len).addScaledVector(z, -0.65);
        leg.add(seg(p0, p1, 0.11, 0.09), seg(p1, p2, 0.09, 0.065), seg(p2, p3, 0.065, 0.025), mesh(ball(0.1, 8), chitin, p1.toArray()), mesh(ball(0.075, 8), chitin, p2.toArray()));
        legs.push({ leg, s: s2, i });
      }
      g.add(spider);
      // It crawls around your face: a loop over your forehead, cheeks and chin, flat on your skin.
      // The face's shape comes from MediaPipe's face model, sampled once into a small height map.
      const zAt = faceHeights();
      const normalAt = (x, y) => new THREE.Vector3(zAt(x - 0.3, y) - zAt(x + 0.3, y), zAt(x, y - 0.3) - zAt(x, y + 0.3), 0.6).normalize();
      const loop = (a) => [6 * Math.sin(a), 0.6 + 7.4 * Math.cos(a)]; // the walking route
      const w = new Wobble(18, 1.5, 0);
      kit.zone(spider, 2.2, { wobble: w, burst: 0xffffff });
      let a = Math.PI * 0.3, dir = 1, pause = 0, nextStop = 2 + Math.random() * 3, scurry = 0, stride = 0;
      const m4 = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), F = new THREE.Vector3();
      return (st) => {
        const dt = Math.min(st.dt, 1 / 20);
        w.step(st);
        // touch it and it scurries off, the way your finger pushed it
        if (Math.abs(w.vx) > 3 && scurry <= 0) { scurry = 1.4; dir = Math.sign(w.vx) || dir; pause = 0; }
        scurry -= dt;
        // now and then it stops for a moment (and sometimes turns round)
        nextStop -= dt;
        if (nextStop <= 0 && scurry <= 0) { pause = 0.5 + Math.random() * 1.1; nextStop = pause + 2 + Math.random() * 4; if (Math.random() < 0.3) dir = -dir; }
        pause -= dt;
        const moving = pause > 0 ? 0 : scurry > 0 ? 3 : 1;
        a += dir * 0.6 * moving * dt;
        // place it on the skin, facing the way it walks
        const [x, y] = loop(a), [x2, y2] = loop(a + dir * 0.05);
        const N = normalAt(x, y);
        spider.position.set(x, y, zAt(x, y)).addScaledVector(N, 0.6);
        F.set(x2 - x, y2 - y, zAt(x2, y2) - zAt(x, y)).addScaledVector(N, -F.dot(N)).normalize();
        Y.copy(F).negate(); // the body's head points down its own -y
        X.crossVectors(Y, N);
        spider.quaternion.setFromRotationMatrix(m4.makeBasis(X, Y, N));
        body.position.z = Math.abs(Math.sin(stride)) * 0.06 * Math.min(1, moving); // a little bob as it walks
        // legs walk in two alternating sets of four (like real spiders); when it stops they just twitch
        stride += dt * 12 * moving;
        for (const l of legs) {
          const off = ((l.i % 2) ^ (l.s > 0 ? 1 : 0)) ? Math.PI : 0;
          if (moving) {
            const swing = Math.sin(stride + off) * 0.3, lift = Math.max(0, Math.cos(stride + off)) * 0.3;
            l.leg.rotation.set(0, -l.s * lift, swing);
          } else l.leg.rotation.set(Math.sin(st.t * 7 + l.i * 1.7 + l.s) * 0.05, 0, 0);
        }
      };
    },
  },
  {
    icon: '🐈‍⬛', name: 'Black Cat', look: 'brightness(.95) saturate(1.15)',
    build(g, kit) {
      const ears = pointyEars(g, kit, { color: 0x1c1c1c, inner: 0x6b5358 }); // a black cat's ears are dusky grey inside
      nose(g, kit, 0x3b3135, { size: 0.9, pos: [0, -0.45, 8.3], burst: 0xffd43b, shape: 'cat' }); // dark grey, leathery
      whiskers(g, 0xffffff);
      const lick = catTongue(g);
      return (st) => { ears.forEach((f) => f(st)); lick(st); };
    },
  },
  {
    icon: '😈', name: 'Devil', look: 'sepia(.3) hue-rotate(-30deg) saturate(1.6)',
    build(g, kit) {
      const THREE = T();
      // Horns of real keratin: oxblood-brown at the root, charring to black at the tip, with growth
      // ridges that fade toward the point, slightly oval, curling up and out of the forehead.
      const tex = canvasTexture(64, 256, (c, w, h) => {
        const gr = c.createLinearGradient(0, h, 0, 0);
        gr.addColorStop(0, '#4a1510'); gr.addColorStop(0.45, '#7d1d14'); gr.addColorStop(0.8, '#3a120d'); gr.addColorStop(1, '#120807');
        c.fillStyle = gr; c.fillRect(0, 0, w, h);
        if ('filter' in c) c.filter = 'blur(1.5px)';
        for (let i = 0; i < 26; i++) { const y = h - (i / 26) * h * 0.85; c.fillStyle = `rgba(20,6,4,${0.35 * (1 - i / 26)})`; c.fillRect(0, y, w, 2.5); } // ridges
        for (let i = 0; i < 30; i++) { c.strokeStyle = 'rgba(160,70,50,.12)'; c.lineWidth = 2; const x = Math.random() * w; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + (Math.random() - 0.5) * 6, h); c.stroke(); }
      });
      const horn = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4 });
      const hornGeo = (pts, r0) => {
        const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)));
        const SEG = 60, RAD = 18, frames = curve.computeFrenetFrames(SEG, false), pos = [], uv = [], idx = [];
        for (let j = 0; j <= SEG; j++) {
          const t = j / SEG, P = curve.getPointAt(t), N = frames.normals[j], B = frames.binormals[j];
          const r = r0 * Math.pow(1 - t, 0.85) * (1 + 0.045 * Math.sin(t * 70) * (1 - t)) + 0.01; // growth ridges, fading out
          for (let i = 0; i <= RAD; i++) { const a = (i / RAD) * Math.PI * 2, rx = r * 1.12, ry = r * 0.9;
            pos.push(P.x + N.x * Math.cos(a) * rx + B.x * Math.sin(a) * ry, P.y + N.y * Math.cos(a) * rx + B.y * Math.sin(a) * ry, P.z + N.z * Math.cos(a) * rx + B.z * Math.sin(a) * ry); uv.push(i / RAD, 1 - t); }
        }
        for (let j = 0; j < SEG; j++) for (let i = 0; i < RAD; i++) { const a = j * (RAD + 1) + i, b = a + RAD + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
        return geo;
      };
      for (const s of [-1, 1]) {
        // rooted just under the forehead's surface (outside the invisible skull, so none of it gets cut off)
        g.add(mesh(hornGeo([[s * 3.3, 8.7, 3.5], [s * 3.9, 10.8, 3.4], [s * 4.9, 12.4, 2.6], [s * 6.1, 13.3, 1.6], [s * 7.1, 13.4, 0.9]], 1.3), horn));
        const spot = at(s * 4.5, 11.6, 1); g.add(spot);
        kit.zone(spot, 2.2, { burst: 0xff6b6b });
      }
    },
  },
  {
    icon: '🍬', name: 'Candy Corn',
    build(g, kit) {
      const THREE = T();
      // Real candy corn: puffy rounded triangles, white tip, orange middle, yellow base, waxy sugar
      // finish, standing on an orange satin headband.
      const kernel = (() => {
        const sh = new THREE.Shape(), w = 1.15, h = 2.9, r = 0.35;
        sh.moveTo(-w + r, 0); sh.lineTo(w - r, 0); sh.quadraticCurveTo(w, 0, w - r * 0.4, r * 0.9);
        sh.lineTo(r * 0.35, h - r); sh.quadraticCurveTo(0, h + r * 0.1, -r * 0.35, h - r);
        sh.lineTo(-w + r * 0.4, r * 0.9); sh.quadraticCurveTo(-w, 0, -w + r, 0);
        const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.55, bevelEnabled: true, bevelThickness: 0.38, bevelSize: 0.32, bevelSegments: 6, curveSegments: 12 });
        geo.translate(0, 0, -0.275);
        const pos = geo.attributes.position, col = [], c = new THREE.Color(), white = new THREE.Color(0xfbf4e3), orange = new THREE.Color(0xf47a12), yellow = new THREE.Color(0xf8b81c);
        for (let i = 0; i < pos.count; i++) { // bands with slightly soft borders
          const k = pos.getY(i) / h, sm = (a, b) => Math.min(1, Math.max(0, (k - a) / (b - a)));
          c.copy(yellow).lerp(orange, sm(0.3, 0.36)).lerp(white, sm(0.66, 0.71));
          col.push(c.r, c.g, c.b);
        }
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geo.computeVertexNormals();
        return geo;
      })();
      const wax = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.6, sheen: 0.4, sheenColor: new THREE.Color(0xffe0b0) });
      // a satin headband arching over the top of the head from ear to ear, candy corn standing along it
      const crown = at(0, 13.4, -2.4);
      const RX = 9.2, RY = 13.4, Y0 = 1.2 - 13.4;
      const satin = new THREE.MeshPhysicalMaterial({ color: 0xd2560e, roughness: 0.35, sheen: 1, sheenColor: new THREE.Color(0xffb070), sheenRoughness: 0.4 });
      const archPts = []; for (let i = 0; i <= 40; i++) { const a = Math.PI * (0.13 + 0.74 * (i / 40)); archPts.push(new THREE.Vector3(Math.cos(a) * RX, Y0 + Math.sin(a) * RY, 0)); } // ends tuck into the hair
      crown.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archPts), 80, 0.5, 10), satin));
      for (let i = 0; i < 11; i++) {
        const a = Math.PI * (0.2 + 0.6 * (i / 10)); // along the top of the arch
        const x = Math.cos(a) * RX, y = Y0 + Math.sin(a) * RY, nx = Math.cos(a) / RX, ny = Math.sin(a) / RY; // outward from the band
        crown.add(mesh(kernel, wax, [x + nx / Math.hypot(nx, ny) * 0.35, y + ny / Math.hypot(nx, ny) * 0.35, 0], [-0.35, 0, Math.atan2(ny, nx) - Math.PI / 2 + (i % 2 ? 0.06 : -0.06)])); // tipped toward you a little
      }
      g.add(crown);
      kit.zone(crown, 7, { grab: true, spin: true, burst: 0xff922b });
      // wrapped hard candies: glossy candy in crinkly clear cellophane, twisted and ruffled at both ends
      const wrapper = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, roughness: 0.04, clearcoat: 1, iridescence: 0.35, side: THREE.DoubleSide, depthWrite: false });
      const twist = (() => { // a crinkled, flaring twist of cellophane
        const geo = new THREE.LatheGeometry([[0.95, 0], [0.45, 0.35], [0.28, 0.6], [0.55, 0.95], [1.05, 1.45], [1.2, 1.6]].map(([x, y]) => new THREE.Vector2(x, y)), 28, 0, Math.PI * 2);
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)), y = p.getY(i), k = 1 + 0.18 * Math.sin(a * 9 + y * 6) * (y / 1.6); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); p.setY(i, y + Math.sin(a * 11) * 0.12 * (y / 1.6)); }
        geo.computeVertexNormals(); return geo;
      })();
      const wrapCols = [0xd61f3c, 0x7a3fd0, 0x2f9e44];
      const sweets = orbiters(g, kit, 3, (i) => {
        const o = new THREE.Group();
        o.add(mesh(ball(1, 24), new THREE.MeshPhysicalMaterial({ color: wrapCols[i], roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.3 }), [0, 0, 0], [0, 0, 0], [1.25, 0.95, 0.95]));
        o.add(mesh(ball(1.08, 24), wrapper, [0, 0, 0], [0, 0, 0], [1.3, 1.05, 1.05]));
        for (const s2 of [-1, 1]) o.add(mesh(twist, wrapper, [s2 * 1.15, 0, 0], [0, 0, -s2 * Math.PI / 2]));
        return o;
      }, { radius: 12, height: 7, speed: 0.9, burst: 0xffa8d8 });
      return (st) => sweets(st, (o, s2) => { o.rotation.x = s2.t * 2; });
    },
  },
  {
    icon: '🐺', name: 'Werewolf', look: 'saturate(.75) contrast(1.12) brightness(.92)',
    // Werewolf make-up painted onto your face: fur flowing out along your cheeks, jaw, temples and
    // hairline, heavy bushy brows, dark sunken eyes, and amber wolf eyes over your own irises.
    face(c, f) {
      const P = f.P, W = f.w;
      const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }; // same "random" every frame: no flicker
      c.save();
      if ('filter' in c) c.filter = `blur(${(W * 0.03).toFixed(1)}px)`;
      for (const [inner, outer, brow] of [[133, 33, 105], [362, 263, 334]]) { // dark, sunken eyes
        const a = P(inner), b = P(outer), u = P(brow), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 + (u.y - (a.y + b.y) / 2) * 0.25, r = Math.hypot(a.x - b.x, a.y - b.y) * 1.1;
        const gr = c.createRadialGradient(cx, cy, r * 0.2, cx, cy, r); gr.addColorStop(0, 'rgba(30,20,15,.5)'); gr.addColorStop(1, 'rgba(30,20,15,0)'); c.fillStyle = gr; c.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      { const a = P(168), b = P(4), r = W * 0.09; const gr = c.createLinearGradient(a.x, a.y, b.x, b.y); gr.addColorStop(0, 'rgba(40,30,25,.35)'); gr.addColorStop(1, 'rgba(40,30,25,0)'); // a darker, longer muzzle line
        c.strokeStyle = gr; c.lineWidth = r; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
      if ('filter' in c) c.filter = `blur(${(W * 0.0025).toFixed(1)}px)`;
      c.lineCap = 'round';
      // fur over the cheeks, jaw and temples (not the forehead): first a soft mass of it, then strands
      const edge = FACE_OVAL.slice(5, 32), cen = P(1); // from the right temple, round the jaw, to the left temple
      if ('filter' in c) c.filter = `blur(${(W * 0.035).toFixed(1)}px)`;
      c.strokeStyle = 'rgba(62,50,42,.55)'; c.lineWidth = W * 0.14; c.lineJoin = 'round';
      c.beginPath(); edge.forEach((i, k) => { const p = P(i), dx = p.x - cen.x, dy = p.y - cen.y, l = Math.hypot(dx, dy) || 1, x = p.x - dx / l * W * 0.04, y = p.y - dy / l * W * 0.04; k ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
      if ('filter' in c) c.filter = `blur(${(W * 0.0025).toFixed(1)}px)`;
      for (let i = 0; i < 900; i++) {
        const t = rnd(i) * (edge.length - 1), j = Math.floor(t), u = t - j, A = P(edge[j]), B = P(edge[j + 1]);
        const x0 = A.x + (B.x - A.x) * u, y0 = A.y + (B.y - A.y) * u;
        const top = false;
        let dx = x0 - cen.x, dy = y0 - cen.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const inward = W * (0.0 + rnd(i + 7) * 0.12), len = W * (0.05 + rnd(i + 3) * 0.07);
        const sx = x0 - dx * inward, sy = y0 - dy * inward, ex = sx + (dx * 0.8 + 0.1 * (rnd(i + 5) - 0.5)) * len, ey = sy + (dy * 0.8 + 0.45) * len;
        const v = 40 + rnd(i + 9) * 70 | 0;
        c.strokeStyle = `rgba(${v + 20},${v + 8},${v - 5},${0.45 + rnd(i + 11) * 0.35})`; c.lineWidth = W * (0.006 + rnd(i + 13) * 0.006);
        c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo((sx + ex) / 2 + dx * len * 0.2, (sy + ey) / 2, ex, ey); c.stroke();
      }
      // heavy, bushy brows that nearly meet
      for (const ids of [[46, 53, 52, 65, 55, 8], [276, 283, 282, 295, 285, 8]]) for (let i = 0; i < 70; i++) {
        const t = rnd(i + 900) * (ids.length - 1), j = Math.floor(t), u = t - j, A = P(ids[j]), B = P(ids[j + 1]);
        const x = A.x + (B.x - A.x) * u + (rnd(i + 950) - 0.5) * W * 0.02, y = A.y + (B.y - A.y) * u + (rnd(i + 970) - 0.5) * W * 0.02;
        const ang = Math.atan2(B.y - A.y, B.x - A.x) - 0.5 + rnd(i + 990) * 0.4, L = W * (0.025 + rnd(i + 1010) * 0.025);
        c.strokeStyle = `rgba(35,26,20,${0.5 + rnd(i + 1030) * 0.3})`; c.lineWidth = W * 0.005;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(ang) * L, y + Math.sin(ang) * L - L * 0.3); c.stroke();
      }
      // amber wolf eyes (tinting your irises)
      if ('filter' in c) c.filter = `blur(${(W * 0.004).toFixed(1)}px)`;
      for (const [cI, e1, e2] of [[468, 469, 471], [473, 474, 476]]) {
        try { const cc = P(cI), r = Math.hypot(P(e1).x - P(e2).x, P(e1).y - P(e2).y) * 0.5; if (!(r > 0)) continue;
          const gr = c.createRadialGradient(cc.x, cc.y, r * 0.35, cc.x, cc.y, r); gr.addColorStop(0, 'rgba(255,170,30,.55)'); gr.addColorStop(0.8, 'rgba(220,130,20,.5)'); gr.addColorStop(1, 'rgba(120,60,10,0)');
          c.fillStyle = gr; c.beginPath(); c.arc(cc.x, cc.y, r, 0, 7); c.fill();
          c.fillStyle = 'rgba(5,5,5,.75)'; c.beginPath(); c.arc(cc.x, cc.y, r * 0.38, 0, 7); c.fill(); } catch {}
      }
      c.restore();
    },
    build(g, kit) {
      const THREE = T();
      const ears = pointyEars(g, kit, { color: 0x5b5048, inner: 0x6a5a55, x: 5.8, y: 12, h: 7.6, r: 3.2, tilt: 0.22 });
      nose(g, kit, 0x161214, { size: 1.6, pos: [0, -0.6, 8.4], scale: [1.35, 1, 1.05], burst: 0xdbe4ff }); // wet, leathery
      return (st) => ears.forEach((f) => f(st));
    },
  },
  {
    icon: '🧌', name: 'Monster', look: 'saturate(.8) contrast(1.08)',
    // Frankenstein's monster make-up, painted onto your face: grey-green pallor, deep hollows under the
    // cheekbones, heavy-lidded shadowed eyes, dark lips, and a seam across the forehead held with staples.
    face(c, f) {
      const P = f.P, W = f.w;
      const path = (ids) => { c.beginPath(); ids.forEach((i, k) => { const p = P(i); k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); c.closePath(); };
      const soft = (k) => { if ('filter' in c) c.filter = k ? `blur(${(W * k).toFixed(1)}px)` : 'none'; };
      c.save();
      soft(0.035); path(FACE_OVAL); c.fillStyle = 'rgba(105,135,100,.42)'; c.fill();
      for (const [x0, x1] of [[61, 205], [291, 425]]) { const a = P(x0), b = P(x1), x = a.x * 0.2 + b.x * 0.8, y = a.y * 0.2 + b.y * 0.8 + W * 0.03, r = W * 0.15;
        const gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(30,40,30,.45)'); gr.addColorStop(1, 'rgba(30,40,30,0)'); c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2); }
      for (const [inner, outer, brow] of [[133, 33, 105], [362, 263, 334]]) { const a = P(inner), b = P(outer), u = P(brow), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 + (u.y - (a.y + b.y) / 2) * 0.45, r = Math.hypot(a.x - b.x, a.y - b.y) * 1.0;
        const gr = c.createRadialGradient(cx, cy, r * 0.1, cx, cy, r); gr.addColorStop(0, 'rgba(35,40,35,.55)'); gr.addColorStop(1, 'rgba(35,40,35,0)'); c.fillStyle = gr; c.fillRect(cx - r, cy - r, r * 2, r * 2); }
      soft(0.005); path(LIPS); c.fillStyle = 'rgba(45,45,50,.55)'; c.fill();
      // the forehead seam with staples
      const mix = (p, q, k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
      const A = mix(P(105), P(67), 0.55), B = mix(P(334), P(297), 0.75), nx = -(B.y - A.y), ny = B.x - A.x, nl = Math.hypot(nx, ny) || 1;
      const pt = (k) => { const o = Math.sin(k * 7.3) * 0.015 * nl; return { x: A.x + (B.x - A.x) * k + nx / nl * o, y: A.y + (B.y - A.y) * k + ny / nl * o }; };
      const line = (w, col) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); for (let k = 0.05; k <= 0.95; k += 0.02) { const q = pt(k); k < 0.06 ? c.moveTo(q.x, q.y) : c.lineTo(q.x, q.y); } c.stroke(); };
      soft(0.006); line(W * 0.04, 'rgba(110,70,70,.4)'); soft(0); line(W * 0.01, 'rgba(50,25,25,.85)');
      for (let k = 0.12; k <= 0.88; k += 0.11) { // metal staples: a light top edge over a dark shadow
        const q = pt(k), q2 = pt(k + 0.01), sx = -(q2.y - q.y), sy = q2.x - q.x, l = Math.hypot(sx, sy) || 1, L = W * 0.028;
        for (const [col, off, w] of [['rgba(20,20,20,.6)', W * 0.004, W * 0.009], ['rgba(200,200,205,.95)', 0, W * 0.006]]) {
          c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(q.x - sx / l * L + off, q.y - sy / l * L + off); c.lineTo(q.x + sx / l * L + off, q.y + sy / l * L + off); c.stroke();
        }
      }
      c.restore();
    },
    build(g, kit) {
      const THREE = T();
      // the flat-topped hair: short, slick and black, flat on top, a ragged fringe over the forehead
      const hairMat = fur(0x2a221d); // very dark brown-black, so the strands still show
      const plan = new THREE.Shape(), hw = 8.6, hd = 8.2, rr = 3.2; // seen from above: a rounded rectangle around the head
      plan.moveTo(-hw + rr, -hd); plan.lineTo(hw - rr, -hd); plan.quadraticCurveTo(hw, -hd, hw, -hd + rr); plan.lineTo(hw, hd - rr); plan.quadraticCurveTo(hw, hd, hw - rr, hd);
      plan.lineTo(-hw + rr, hd); plan.quadraticCurveTo(-hw, hd, -hw, hd - rr); plan.lineTo(-hw, -hd + rr); plan.quadraticCurveTo(-hw, -hd, -hw + rr, -hd);
      const top = new THREE.ExtrudeGeometry(plan, { depth: 5.8, bevelEnabled: true, bevelThickness: 0.9, bevelSize: 0.8, bevelSegments: 5, curveSegments: 14 });
      top.rotateX(-Math.PI / 2);
      g.add(mesh(top, hairMat, [0, 8.7, -3.4])); // down to the hairline, outside the head all round
      const fringe = new THREE.Group(); fringe.position.set(0, 9.6, 5.3); g.add(fringe);
      for (let i = 0; i < 30; i++) { // a ragged, combed-forward fringe
        const x = -7.8 + i * 0.54, len = 1.6 + ((i * 37) % 9) * 0.28;
        fringe.add(mesh(cone(0.42, len, 6), hairMat, [x, -len / 2 + 0.3, 0.12 * Math.sin(i * 1.7)], [Math.PI - 0.12, 0, (((i * 13) % 5) - 2) * 0.05], [1, 1, 0.45]));
      }
      // neck bolts: threaded steel rods with a hex nut and washer, a little oxidised
      const steel = mat(0x7d7a74, { m: 0.9, r: 0.45 }), rust = mat(0x6b4a33, { m: 0.4, r: 0.75 });
      const thread = (() => { const geo = new THREE.CylinderGeometry(0.5, 0.5, 3.4, 20, 34), p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) { const k = 1 + 0.07 * Math.sin(p.getY(i) * 22); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } geo.computeVertexNormals(); return geo; })();
      for (const s of [-1, 1]) {
        const bolt = at(s * 6.2, -8.6, -3.6);
        bolt.add(mesh(thread, steel, [s * 1.4, 0, 0], [0, 0, Math.PI / 2]));
        bolt.add(mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.18, 24), rust, [s * 0.3, 0, 0], [0, 0, Math.PI / 2])); // washer against the skin
        bolt.add(mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.8, 6), steel, [s * 2.9, 0, 0], [0, 0, Math.PI / 2])); // hex nut
        bolt.add(mesh(new THREE.CylinderGeometry(0.5, 0.42, 0.5, 20), steel, [s * 3.45, 0, 0], [0, 0, Math.PI / 2])); // bolt end
        g.add(bolt);
        kit.zone(bolt, 2.6, { squish: true, burst: 0xffe066 }); // zap!
      }
    },
  },
  {
    icon: '🔮', name: 'Spooky Eyes', look: 'brightness(.7) contrast(1.3) saturate(.55)',
    // Possessed eyes, painted inside your real eye shape (so your eyelids still cover them when you blink):
    // the whites turn black, the irises glow green with a hot centre, a soft glow spills around them,
    // and the sockets darken.
    face(c, f, t = 0) {
      const P = f.P, W = f.w, pulse = 0.85 + Math.sin(t * 5) * 0.1 + Math.sin(t * 13) * 0.05;
      const EYES = [[[33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7], 468, 469, 471], [[263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249], 473, 474, 476]];
      c.save();
      for (const [ring, ci, e1, e2] of EYES) {
        let cx = 0, cy = 0; for (const i of ring) { cx += P(i).x; cy += P(i).y; } cx /= ring.length; cy /= ring.length;
        const ew = Math.hypot(P(ring[0]).x - P(ring[8]).x, P(ring[0]).y - P(ring[8]).y);
        if ('filter' in c) c.filter = `blur(${(W * 0.03).toFixed(1)}px)`;
        let gr = c.createRadialGradient(cx, cy, ew * 0.3, cx, cy, ew * 1.3); gr.addColorStop(0, 'rgba(15,20,15,.55)'); gr.addColorStop(1, 'rgba(15,20,15,0)'); // dark socket
        c.fillStyle = gr; c.fillRect(cx - ew * 1.3, cy - ew * 1.3, ew * 2.6, ew * 2.6);
        gr = c.createRadialGradient(cx, cy, ew * 0.1, cx, cy, ew * 0.8); gr.addColorStop(0, `rgba(120,255,140,${0.25 * pulse})`); gr.addColorStop(1, 'rgba(120,255,140,0)'); // glow spill
        c.fillStyle = gr; c.fillRect(cx - ew * 0.8, cy - ew * 0.8, ew * 1.6, ew * 1.6);
        if ('filter' in c) c.filter = `blur(${(W * 0.0025).toFixed(1)}px)`;
        c.save(); c.beginPath(); ring.forEach((i, k) => { const p = P(i); k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); c.closePath(); c.clip();
        c.fillStyle = 'rgba(6,8,6,.92)'; c.fillRect(cx - ew, cy - ew, ew * 2, ew * 2); // black where the whites were
        let ix = cx, iy = cy, ir = ew * 0.22;
        try { const pc = P(ci), r = Math.hypot(P(e1).x - P(e2).x, P(e1).y - P(e2).y) * 0.5; if (r > 0) { ix = pc.x; iy = pc.y; ir = r; } } catch {}
        gr = c.createRadialGradient(ix, iy, 0, ix, iy, ir * 1.15);
        gr.addColorStop(0, `rgba(235,255,235,${pulse})`); gr.addColorStop(0.35, `rgba(120,255,140,${pulse})`); gr.addColorStop(0.8, 'rgba(40,190,70,.9)'); gr.addColorStop(1, 'rgba(20,90,30,0)');
        c.fillStyle = gr; c.beginPath(); c.arc(ix, iy, ir * 1.15, 0, 7); c.fill();
        c.restore();
      }
      c.restore();
    },
    build(g, kit) {
      for (const s of [-1, 1]) { const e = at(s * 3.3, 2.9, 4.9); g.add(e); kit.zone(e, 1.8, { squish: true, burst: 0x69db7c }); } // the eyes are still touchable
    },
  },
];

// =====================================================================================
// 🐾 ANIMALS, 🎩 HATS and ✨ FUN EXTRAS
// =====================================================================================
export const MORE_3D = [
  // ----- animals -----
  {
    icon: '🦊', name: 'Fox',
    build(g, kit) {
      const ears = pointyEars(g, kit, { color: 0xc4561c, inner: 0xf2ece4, x: 5.6, y: 11.2, h: 6.6, r: 3.2, tilt: 0.36, fluffy: true, tip: 0x1c1512 });
      nose(g, kit, 0x141113, { size: 1, pos: [0, -0.5, 8.4], burst: 0xffa94d });
      whiskers(g, 0x1c1714);
      return (st) => ears.forEach((f) => f(st));
    },
  },
  {
    icon: '🐼', name: 'Panda',
    build(g, kit) {
      roundEars(g, kit, { color: 0x151414, inner: 0x2a2626 });
      nose(g, kit, 0x121112, { size: 1.1, burst: 0xffffff });
    },
  },
  {
    icon: '🐨', name: 'Koala',
    build(g, kit) {
      const THREE = T();
      roundEars(g, kit, { color: 0x8c8f94, inner: 0xe9e6e1, x: 8, y: 7.4, z: -2.4, r: 3.8, fringe: 0xf2efe9 });
      // the big koala nose: tall, rounded, smooth and leathery
      const n = at(0, -0.4, 8.2);
      n.add(mesh(ball(1, 32), mat(0x2b2a2c, { r: 0.38, cc: 0.25 }), [0, 0, 0], [0, 0, 0], [1.3, 1.9, 0.95]));
      for (const s2 of [-1, 1]) n.add(mesh(ball(1, 12), mat(0x080808, { r: 0.9 }), [s2 * 0.55, -1.25, 0.55], [0, 0, s2 * 0.5], [0.32, 0.16, 0.2]));
      g.add(n); kit.zone(n, 2, { squish: true, burst: 0xdee2e6 });
    },
  },
  {
    icon: '🐷', name: 'Piggy',
    build(g, kit) {
      const THREE = T();
      const veins = canvasTexture(128, 128, (c, w, h) => {
        c.fillStyle = '#f2a6ae'; c.fillRect(0, 0, w, h);
        if ('filter' in c) c.filter = 'blur(1.2px)';
        c.strokeStyle = 'rgba(200,80,100,.45)'; c.lineWidth = 2;
        for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(w / 2, h); let x = w / 2, y = h; for (let k = 0; k < 5; k++) { x += (i - 2.5) * 5 + (Math.random() - 0.5) * 8; y -= h / 6; c.lineTo(x, y); } c.stroke(); }
      });
      const earMat = mat(0xffffff, { r: 0.6, map: veins, double: true });
      const earGeo = F3.earGeometry(7.2, 5.2, { pointy: true, cup: 0.25, thick: 0.18 });
      for (const s2 of [-1, 1]) { // big, thin and floppy: they tip forward over the forehead
        const e = at(s2 * 5.4, 9.6, -0.6); e.rotation.set(0.95, s2 * 0.35, -s2 * 0.55);
        e.add(mesh(earGeo, earMat)); g.add(e);
      }
      // the snout: a moist, slightly wrinkled disc with deep oval nostrils and a darker rim
      const flesh = new THREE.MeshPhysicalMaterial({ color: 0xec8f9c, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.35, sheen: 0.4, sheenColor: new THREE.Color(0xffc0c8) });
      const snout = at(0, -0.9, 8.0);
      const disc = new THREE.CylinderGeometry(1.95, 2.05, 1.5, 40, 3); const dp = disc.attributes.position;
      for (let i = 0; i < dp.count; i++) { const a = Math.atan2(dp.getZ(i), dp.getX(i)), k = 1 + 0.025 * Math.sin(a * 9); dp.setX(i, dp.getX(i) * k); dp.setZ(i, dp.getZ(i) * k); }
      disc.computeVertexNormals();
      snout.add(mesh(disc, flesh, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 0.82]));
      snout.add(mesh(new THREE.TorusGeometry(1.92, 0.16, 10, 40), mat(0xd16a7a, { r: 0.4 }), [0, 0, 0.6]));
      for (const s2 of [-1, 1]) snout.add(mesh(ball(1, 16), mat(0x5a1e2c, { r: 0.85 }), [s2 * 0.66, 0.05, 0.56], [0, 0, s2 * 0.15], [0.36, 0.55, 0.3]));
      g.add(snout);
      kit.zone(snout, 2.2, { squish: true, burst: 0xffc9d9 }); // oink!
    },
  },
  {
    icon: '🐭', name: 'Mouse',
    build(g, kit) {
      const THREE = T();
      const skin = canvasTexture(128, 128, (c, w, h) => {
        const gr = c.createRadialGradient(w / 2, h * 0.6, 5, w / 2, h * 0.6, w * 0.6); gr.addColorStop(0, '#f0b9bf'); gr.addColorStop(1, '#c9a7a6');
        c.fillStyle = gr; c.fillRect(0, 0, w, h);
        if ('filter' in c) c.filter = 'blur(1px)';
        c.strokeStyle = 'rgba(190,80,95,.4)'; c.lineWidth = 1.6;
        for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(w / 2, h); c.quadraticCurveTo(w / 2 + (i - 2) * 18, h * 0.5, w / 2 + (i - 2) * 26, h * 0.12); c.stroke(); }
      });
      const earMat = new THREE.MeshPhysicalMaterial({ map: skin, roughness: 0.55, transmission: 0, transparent: true, opacity: 0.93, side: THREE.DoubleSide, sheen: 0.5, sheenColor: new THREE.Color(0xffd0d6) });
      const earGeo = F3.earGeometry(7, 7.4, { cup: 0.45, thick: 0.12 });
      for (const s2 of [-1, 1]) {
        const e = at(s2 * 6.6, 7.8, -2.8); e.rotation.set(-0.1, s2 * 0.3, -s2 * 0.2);
        e.add(mesh(earGeo, earMat)); g.add(e); kit.zone(e, 3.9, { squish: true });
      }
      nose(g, kit, 0xe39aa6, { size: 0.75, pos: [0, -0.4, 8.3], burst: 0xffc9d9, shape: 'cat' });
      whiskers(g, 0x2f2a26);
    },
  },
  {
    icon: '🦁', name: 'Lion',
    build(g, kit) {
      const THREE = T();
      // the mane: one thick, shaggy ring of real fur round the face (lumpy, so it reads as tufts and
      // locks), darker toward the back, with soft rounded tufts falling from its outer edge
      const ring = new THREE.TorusGeometry(12.2, 4.6, 40, 140), rp = ring.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < rp.count; i++) {
        v.fromBufferAttribute(rp, i); const a = Math.atan2(v.y, v.x), r = Math.hypot(v.x, v.y);
        const lump = 1 + 0.12 * Math.sin(a * 23) * Math.sin(a * 7 + 1) + 0.07 * Math.sin(a * 41 + r);
        const k = (r - 12.2) * lump; // push the outside edge out in shaggy lumps
        rp.setXYZ(i, Math.cos(a) * (12.2 + k * (k > 0 ? 1.25 : 0.8)), Math.sin(a) * (12.2 + k * (k > 0 ? 1.25 : 0.8)) * 1.12, v.z * 0.8);
      }
      ring.computeVertexNormals();
      const mane = at(0, 0.6, -5.2);
      mane.add(mesh(ring, fur(0x9a6a36)));
      const tuft = ball(1, 14);
      for (let i = 0; i < 46; i++) { // soft tufts at the outer edge, falling outward and down
        const a = (i / 46) * Math.PI * 2, rr = 17.4 + ((i * 37) % 5) * 0.4;
        const t = mesh(tuft, fur([0x8a5a2b, 0xa9763f, 0x6b4423][i % 3]), [Math.cos(a) * rr, Math.sin(a) * rr * 1.12 - 0.8, -1.2], [0, 0, a - Math.PI / 2], [1.6, 3.4 + ((i * 13) % 4) * 0.5, 1.2]);
        mane.add(t);
      }
      g.add(mane);
      kit.zone(mane, 3, { squish: true, burst: 0xffd43b }); // pat the mane
      roundEars(g, kit, { color: 0xa06b35, inner: 0xd9b78a, x: 6, y: 11.4, r: 2.2 });
      nose(g, kit, 0x9a5c4c, { size: 1.15, burst: 0xffd43b });
      whiskers(g, 0xe9e2d6);
    },
  },
  {
    icon: '🐯', name: 'Tiger', look: 'saturate(1.1)',
    build(g, kit) {
      roundEars(g, kit, { color: 0x2a211c, inner: 0xf3efe8, x: 6.3, y: 10.4, r: 2.6, fringe: 0xf5f1ea }); // dark backs, white fluffy insides
      nose(g, kit, 0xc9848a, { size: 0.95, burst: 0xffa94d, shape: 'cat' });
      whiskers(g, 0xf2eee8);
    },
  },
  {
    icon: '🦌', name: 'Reindeer',
    build(g, kit) {
      const THREE = T();
      // real antlers: rough grey-brown bone, a main beam with tines branching off, thinning to points
      const boneTex = canvasTexture(64, 256, (c, w, h) => {
        const gr = c.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, '#6e5a44'); gr.addColorStop(0.6, '#9c8a72'); gr.addColorStop(1, '#d9cdb8');
        c.fillStyle = gr; c.fillRect(0, 0, w, h);
        if ('filter' in c) c.filter = 'blur(1.5px)';
        for (let i = 0; i < 40; i++) { c.strokeStyle = `rgba(${Math.random() < 0.5 ? '60,45,30' : '220,210,190'},.25)`; c.lineWidth = 2; const x = Math.random() * w; c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + 4, h / 3, x - 4, h * 2 / 3, x + (Math.random() - 0.5) * 6, h); c.stroke(); }
      });
      const bone = mat(0xffffff, { r: 0.8, map: boneTex });
      const branch = (pts, r0, r1) => { const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)));
        const geo = new THREE.TubeGeometry(curve, 40, 1, 10), p = geo.attributes.position, cpt = new THREE.Vector3();
        for (let i = 0; i < p.count; i++) { const t = Math.floor(i / 11) / 40; curve.getPointAt(Math.min(1, t), cpt); const r = lerp(r0, r1, t) * (1 + 0.06 * Math.sin(t * 40));
          p.setXYZ(i, cpt.x + (p.getX(i) - cpt.x) * r, cpt.y + (p.getY(i) - cpt.y) * r, cpt.z + (p.getZ(i) - cpt.z) * r); }
        geo.computeVertexNormals(); return mesh(geo, bone); };
      for (const s of [-1, 1]) {
        const beam = [[s * 3.6, 10.2, -0.6], [s * 4.8, 13.6, -1.4], [s * 6.6, 16.6, -2.4], [s * 7.4, 19.4, -3.0], [s * 6.9, 21.6, -3.1]];
        g.add(branch(beam, 0.75, 0.14));
        g.add(branch([[s * 4.9, 13.9, -1.4], [s * 6.6, 14.6, -0.9], [s * 8.3, 15.9, -0.6]], 0.42, 0.1)); // brow tine
        g.add(branch([[s * 6.7, 16.8, -2.4], [s * 8.8, 17.6, -2.4], [s * 10, 19.2, -2.2]], 0.38, 0.09));
        g.add(branch([[s * 7.3, 19.2, -3.0], [s * 8.6, 20.6, -3.2], [s * 9.0, 22.2, -3.2]], 0.3, 0.08));
        g.add(branch([[s * 7.0, 20.4, -3.0], [s * 5.6, 22.0, -3.0]], 0.26, 0.07));
        // furry, leaf-shaped ears pointing out to the side
        const ear = at(s * 7.9, 7.6, -2.2); ear.rotation.set(0, 0, -s * 1.15);
        ear.add(mesh(F3.earGeometry(3.6, 2.2, { cup: 0.4, thick: 0.25 }), fur(0x6e5039)), mesh(F3.earGeometry(2.6, 1.4, { cup: 0.4, thick: 0.12 }), fur(0xb59a80), [0, 0.3, 0.25]));
        g.add(ear);
      }
      // Rudolph's nose: a real animal nose, glowing red
      const n = F3.animalNose(0xd61e1e, 2.9); n.position.set(0, -0.6, 8.3);
      n.traverse((o) => { if (o.isMesh && o.material.color?.getHex() === 0xd61e1e) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xff2a1a); o.material.emissiveIntensity = 0.85; } });
      g.add(n); kit.zone(n, 1.9, { squish: true, burst: 0xff6b6b });
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0xff3020, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55 }));
      halo.position.set(0, -0.6, 9.2); halo.scale.setScalar(6.5); g.add(halo);
      return (st) => { halo.material.opacity = 0.45 + Math.sin(st.t * 3) * 0.1; };
    },
  },
  {
    icon: '🐝', name: 'Bee', look: 'saturate(1.2) sepia(.1)',
    build(g, kit) {
      const THREE = T();
      // real insect antennae: thin, dark, elbowed, made of little segments
      const cuticle = mat(0x2a2018, { r: 0.45 });
      const ants = [-1, 1].map((s) => {
        const pivot = at(s * 2.2, 8.9, 0.6);
        const pts = [[0, 0, 0], [s * 0.3, 3.2, 0.4], [s * 0.45, 4.4, 0.6], [s * 1.9, 5.6, 1.1], [s * 3.0, 6.2, 1.3]].map((q) => new THREE.Vector3(...q));
        const curve = new THREE.CatmullRomCurve3(pts);
        for (let i = 0; i < 16; i++) { const t0 = i / 16, a = curve.getPointAt(t0), b = curve.getPointAt(t0 + 1 / 16 * 0.85), d = b.clone().sub(a);
          const seg = mesh(new THREE.CylinderGeometry(0.11 + (i > 9 ? 0.03 : 0), 0.13, d.length(), 7), cuticle); seg.position.copy(a).add(b).multiplyScalar(0.5); seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); pivot.add(seg); }
        const tip = at(s * 3.0, 6.2, 1.3); pivot.add(tip); g.add(pivot);
        const w = new Wobble(30, 2.2, 0.0012);
        kit.zone(tip, 1.6, { wobble: w, burst: 0xffd43b });
        return { pivot, w };
      });
      // honeybees: fuzzy golden thorax, banded abdomen, big dark eyes, see-through veined wings, legs
      const bands = canvasTexture(128, 32, (c, w, h) => { for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? '#2b1d10' : '#c8891e'; c.fillRect(i * w / 6, 0, w / 6 + 1, h); } if ('filter' in c) c.filter = 'blur(2px)'; c.drawImage(c.canvas, 0, 0); });
      const wingTex = canvasTexture(64, 128, (c, w, h) => { c.fillStyle = 'rgba(225,230,235,.35)'; c.beginPath(); c.ellipse(w / 2, h / 2, w * 0.45, h * 0.48, 0, 0, 7); c.fill();
        c.strokeStyle = 'rgba(60,45,30,.6)'; c.lineWidth = 1.3; for (const dx of [-12, -3, 6, 14]) { c.beginPath(); c.moveTo(w / 2, h * 0.06); c.quadraticCurveTo(w / 2 + dx, h / 2, w / 2 + dx * 1.15, h * 0.94); c.stroke(); }
        c.beginPath(); c.moveTo(w * 0.2, h * 0.45); c.lineTo(w * 0.8, h * 0.55); c.stroke(); });
      const wingM = new THREE.MeshBasicMaterial({ map: wingTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const eyeM = gloss(0x1a120c, { r: 0.2 }), legM = mat(0x241a12, { r: 0.6 });
      const wings = [];
      const bees = orbiters(g, kit, 3, () => {
        const b = new THREE.Group();
        b.add(mesh(ball(0.55, 18), fur(0xb07a2a), [0.15, 0, 0], [0, 0, 0], [1, 0.95, 0.95])); // thorax
        b.add(mesh(ball(0.62, 20), mat(0xffffff, { r: 0.5, map: bands }), [-0.85, -0.08, 0], [0, 0, Math.PI / 2], [0.85, 1.35, 0.85])); // abdomen
        b.add(mesh(ball(0.4, 16), cuticle, [0.85, -0.05, 0])); // head
        for (const s2 of [-1, 1]) {
          b.add(mesh(ball(0.2, 12), eyeM, [0.98, 0.05, s2 * 0.24], [0, 0, 0], [0.8, 1.3, 0.8]));
          const w2 = mesh(new THREE.PlaneGeometry(0.75, 1.4), wingM, [0.0, 0.5, s2 * 0.55], [Math.PI / 2 + s2 * 0.3, 0, 0.2]); b.add(w2); wings.push({ w: w2, s: s2 });
          for (const lx of [0.35, 0.1, -0.15]) b.add(mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.8, 4), legM, [lx, -0.45, s2 * 0.25], [s2 * 0.6, 0, 0]));
        }
        b.scale.setScalar(1.15);
        return b;
      }, { radius: 11, height: 5, speed: 1.6, bob: 2, burst: 0xffd43b });
      return (st) => {
        for (const a of ants) { a.w.step(st); a.pivot.rotation.set(a.w.y * 0.7, 0, a.w.x * 0.9); }
        bees(st);
        for (const k of wings) k.w.rotation.x = Math.PI / 2 + k.s * (0.3 + Math.sin(st.t * 60) * 0.45);
      };
    },
  },
  {
    icon: '🦋', name: 'Butterflies',
    build(g, kit) {
      const THREE = T();
      // Three real species, wings painted from life: a Monarch, a Blue Morpho and a Tiger Swallowtail.
      const W2 = 256;
      const foreShape = (c) => { c.beginPath(); c.moveTo(4, 128); c.bezierCurveTo(30, 40, 150, 6, 248, 18); c.bezierCurveTo(232, 70, 200, 112, 150, 130); c.closePath(); };
      const hindShape = (c) => { c.beginPath(); c.moveTo(4, 128); c.bezierCurveTo(60, 140, 180, 150, 210, 200); c.bezierCurveTo(200, 248, 110, 250, 40, 210); c.closePath(); };
      const painters = [
        (c) => { // Monarch: orange, thick black veins, a black border with white dots
          for (const shape of [foreShape, hindShape]) { shape(c); c.fillStyle = '#e8781a'; c.fill(); c.save(); c.clip();
            c.strokeStyle = '#141010'; c.lineWidth = 6; for (let k = 0; k < 7; k++) { c.beginPath(); c.moveTo(6, 128); c.quadraticCurveTo(110, 128 + (k - 3) * 25, 260, 30 + k * 34); c.stroke(); }
            c.lineWidth = 18; shape(c); c.stroke(); c.fillStyle = '#f4f0e8'; for (let k = 0; k < 26; k++) { const a = k / 26; c.beginPath(); c.arc(20 + a * 220, shape === foreShape ? 22 + Math.sin(a * 3) * 6 : 220 - Math.sin(a * 3) * 12, 3, 0, 7); c.fill(); } c.restore(); }
        },
        (c) => { // Blue Morpho: brilliant blue with black edges and small white marks
          for (const shape of [foreShape, hindShape]) { shape(c); const gr = c.createLinearGradient(0, 128, 256, 128); gr.addColorStop(0, '#0b3c9e'); gr.addColorStop(0.6, '#2a8cf0'); gr.addColorStop(1, '#0a2a70'); c.fillStyle = gr; c.fill();
            c.save(); c.clip(); c.strokeStyle = '#0a0a12'; c.lineWidth = 26; shape(c); c.stroke(); c.fillStyle = '#e8eef8'; for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(190 + k * 12, shape === foreShape ? 34 + k * 6 : 205, 4, 0, 7); c.fill(); } c.restore(); }
        },
        (c) => { // Tiger Swallowtail: yellow with black bands, a blue and orange spot by the tail
          for (const shape of [foreShape, hindShape]) { shape(c); c.fillStyle = '#f2cf36'; c.fill(); c.save(); c.clip();
            c.fillStyle = '#16120c'; for (let k = 0; k < 4; k++) c.fillRect(30 + k * 45, 0, 14 + k * 3, 256); c.lineWidth = 16; c.strokeStyle = '#16120c'; shape(c); c.stroke();
            if (shape === hindShape) { c.fillStyle = '#3b6fd0'; c.beginPath(); c.arc(150, 218, 7, 0, 7); c.fill(); c.fillStyle = '#e8782a'; c.beginPath(); c.arc(80, 222, 7, 0, 7); c.fill(); } c.restore(); }
        },
      ];
      const spots = [[-4.5, 12.4, -0.5, 0.3], [0.8, 13.6, -2.2, -0.1], [5.2, 12, 0.2, -0.4]];
      const all = spots.map(([x, y, z, rz], n) => {
        const tex = canvasTexture(W2, W2, (c) => { painters[n](c); });
        const wm = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: n === 1 ? 0.25 : 0.6, metalness: n === 1 ? 0.3 : 0 });
        const b = at(x, y, z); b.rotation.set(-0.3, 0, rz);
        const wings = [-1, 1].map((s) => { const w = new THREE.Group(); w.add(mesh(new THREE.PlaneGeometry(3.6, 3.6), wm, [s * 1.8, -0.2, 0], [0, s < 0 ? Math.PI : 0, 0], [1, 1, 1])); b.add(w); return { w, s }; });
        b.add(mesh(capsule(0.16, 1.9), fur(0x1c1814), [0, -0.1, 0])); // fuzzy body
        for (const s of [-1, 1]) { const ant = new THREE.CatmullRomCurve3([[0, 1, 0], [s * 0.3, 2.0, 0.2], [s * 0.6, 2.8, 0.2]].map((q) => new THREE.Vector3(...q)));
          b.add(mesh(new THREE.TubeGeometry(ant, 10, 0.03, 4), mat(0x161210)), mesh(ball(0.08, 8), mat(0x161210), [s * 0.6, 2.85, 0.2])); }
        g.add(b);
        kit.zone(b, 2.4, { squish: true, burst: [0xe8781a, 0x2a8cf0, 0xf2cf36][n] });
        return { wings, n, b };
      });
      return (st) => {
        for (const a of all) {
          const flap = Math.sin(st.t * (3 + a.n) + a.n) * 0.5 + 0.6 + Math.max(0, st.jaw) * 0.6;
          for (const w of a.wings) w.w.rotation.y = w.s * flap;
        }
      };
    },
  },
  {
    icon: '🐵', name: 'Monkey',
    build(g, kit) {
      const THREE = T();
      const skin = mat(0xb48a72, { r: 0.6 });
      for (const s of [-1, 1]) { // big, bare, skin-coloured ears
        const e = at(s * 8.6, 1.4, -3.2); e.rotation.set(0, s * 0.6, -s * 0.15);
        e.add(mesh(F3.earGeometry(5.6, 4.6, { cup: 0.6, thick: 0.3 }), skin), mesh(F3.earGeometry(3.6, 2.8, { cup: 0.6, thick: 0.15 }), mat(0x9c705c, { r: 0.65 }), [0, 0.6, 0.3]));
        g.add(e); kit.zone(e, 3.2, { squish: true });
      }
      nose(g, kit, 0x5c3a2b, { size: 0.8, burst: 0xffd43b });
    },
  },
  {
    icon: '🦉', name: 'Owl',
    build(g, kit) {
      const THREE = T();
      // feathers: a soft vane with a central shaft, barbs angling out, the tip a little ragged
      const featherTex = canvasTexture(64, 256, (c, w, h) => {
        c.beginPath(); c.moveTo(w / 2, 4); c.bezierCurveTo(w * 0.95, h * 0.2, w * 0.9, h * 0.75, w / 2, h - 6); c.bezierCurveTo(w * 0.1, h * 0.75, w * 0.05, h * 0.2, w / 2, 4);
        const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#3a2a1c'); gr.addColorStop(0.5, '#7d5d3e'); gr.addColorStop(1, '#a88a66'); c.fillStyle = gr; c.fill();
        c.save(); c.clip(); c.strokeStyle = 'rgba(30,20,12,.35)'; c.lineWidth = 1.2; for (let y = 10; y < h; y += 7) { c.beginPath(); c.moveTo(w / 2, y); c.lineTo(0, y - 18); c.moveTo(w / 2, y); c.lineTo(w, y - 18); c.stroke(); }
        c.fillStyle = 'rgba(40,28,18,.5)'; for (let y = 30; y < h; y += 46) c.fillRect(0, y, w, 8); c.restore();
        c.strokeStyle = '#cdb89a'; c.lineWidth = 2; c.beginPath(); c.moveTo(w / 2, 8); c.lineTo(w / 2, h - 4); c.stroke();
      });
      const featherMat = new THREE.MeshStandardMaterial({ map: featherTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85 });
      const featherGeo = new THREE.PlaneGeometry(1, 4); featherGeo.translate(0, 2, 0);
      for (const s of [-1, 1]) {
        const tuft = at(s * 4.4, 10.2, 0.2); g.add(tuft);
        for (let i = 0; i < 7; i++) { const fth = mesh(featherGeo, featherMat, [s * i * 0.25, 0, -i * 0.1], [-0.2, 0, -s * (0.25 + i * 0.07)], [1.1 - i * 0.05, 1.15 - Math.abs(i - 2) * 0.08, 1]); tuft.add(fth); }
        kit.zone(tuft, 2.6, { squish: true, burst: 0xffd43b });
      }
      // a hooked beak of grey horn, over the bridge of the nose
      const beakCurve = new THREE.CatmullRomCurve3([[0, 1.3, 7.4], [0, 0.4, 8.6], [0, -0.8, 9.0], [0, -1.6, 8.5]].map((q) => new THREE.Vector3(...q)));
      const beak = new THREE.TubeGeometry(beakCurve, 30, 1, 12), bp = beak.attributes.position, cp = new THREE.Vector3();
      for (let i = 0; i < bp.count; i++) { const t = Math.floor(i / 13) / 30; beakCurve.getPointAt(Math.min(1, t), cp); const r = 0.75 * Math.pow(1 - t, 0.8) + 0.03; bp.setXYZ(i, cp.x + (bp.getX(i) - cp.x) * r * 0.8, cp.y + (bp.getY(i) - cp.y) * r, cp.z + (bp.getZ(i) - cp.z) * r); }
      beak.computeVertexNormals();
      g.add(mesh(beak, new THREE.MeshPhysicalMaterial({ color: 0x3e3a36, roughness: 0.35, clearcoat: 0.5 })));
    },
  },

  // ----- hats -----
  {
    icon: '🤠', name: 'Cowboy',
    build(g, kit) {
      const THREE = T();
      // A brown felt cattleman hat: the crown has a crease down the middle and pinches at the front,
      // the brim curls up at the sides and dips front and back, with a bound edge, a leather band and
      // a little silver concho. (Centred on your head, crown wide enough to go over it: keep this size.)
      const feltTex = canvasTexture(256, 256, (c, w, h) => { c.fillStyle = '#7a5232'; c.fillRect(0, 0, w, h); if ('filter' in c) c.filter = 'blur(12px)';
        for (let i = 0; i < 30; i++) { const v = Math.random() < 0.5 ? 'rgba(150,110,70,.35)' : 'rgba(60,38,22,.35)'; c.fillStyle = v; c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 15 + Math.random() * 35, 0, 7); c.fill(); } });
      const felt = mat(0xffffff, { r: 0.85, map: feltTex, double: true });
      const hat = at(0, 10.8, -4);
      hat.rotation.x = -0.06;
      const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
      const crown = new THREE.LatheGeometry([[6.6, 0], [6.5, 2], [6.25, 4.5], [5.95, 6.1], [5.3, 6.9], [3.6, 7.25], [0.01, 7.3]].map(([x, y]) => new THREE.Vector2(x, y)), 72);
      const cp = crown.attributes.position;
      for (let i = 0; i < cp.count; i++) {
        let x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i) * 1.1; // a little oval, like a head
        y -= 1.4 * Math.exp(-Math.pow(x / 1.7, 2)) * smooth(5.2, 7.3, y); // the crease down the middle
        x *= 1 - 0.16 * smooth(3.8, 7, y) * Math.max(0, z / 7.3); // pinched at the front
        cp.setXYZ(i, x, y, z);
      }
      crown.computeVertexNormals();
      hat.add(mesh(crown, felt, [0, 0.35, 0]));
      const brim = new THREE.RingGeometry(6.5, 13.2, 120, 10), bp = brim.attributes.position;
      const brimY = (x, z) => 2.8 * Math.pow(Math.min(1, Math.abs(x) / 13.2), 2.6) - 0.5 * Math.pow(z / 14.5, 2);
      for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), z = bp.getY(i) * 1.1; bp.setXYZ(i, x, brimY(x, z), z); }
      brim.computeVertexNormals();
      hat.add(mesh(brim, felt, [0, 0.35, 0]));
      const edge = []; for (let i = 0; i <= 200; i++) { const a = (i / 200) * Math.PI * 2, x = Math.cos(a) * 13.2, z = Math.sin(a) * 13.2 * 1.1; edge.push(new THREE.Vector3(x, 0.35 + brimY(x, z), z)); }
      hat.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge, true), 400, 0.13, 6, true), mat(0x4a301c, { r: 0.6 }))); // bound edge
      const band = new THREE.CylinderGeometry(6.62, 6.66, 1.1, 72, 1, true); band.scale(1, 1, 1.1);
      hat.add(mesh(band, mat(0x3a2414, { r: 0.55, double: true }), [0, 1.0, 0]));
      const concho = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.15, 24), mat(0xc9c6bf, { m: 1, r: 0.3 }), [6.75, 1.0, 1.2], [0, 0, Math.PI / 2]); concho.rotation.y = -0.18; hat.add(concho);
      g.add(hat);
      kit.zone(hat, 8, { grab: true, spin: true, burst: 0xffd43b });
    },
  },
  {
    icon: '🎩', name: 'Top Hat',
    build(g, kit) {
      const THREE = T();
      // Black silk plush (that lustrous sheen), a slightly waisted crown flaring to the top, a curled
      // brim, and a black grosgrain ribbon with a bow at the side.
      const silk = new THREE.MeshPhysicalMaterial({ color: 0x0e0e10, roughness: 0.32, sheen: 1, sheenColor: new THREE.Color(0x5a5a64), sheenRoughness: 0.3, clearcoat: 0.35, clearcoatRoughness: 0.25, side: THREE.DoubleSide });
      const hat = at(0, 10.4, -3.4);
      const crown = new THREE.LatheGeometry([[5.45, 0], [5.25, 3], [5.15, 6], [5.3, 9.5], [5.55, 11.2], [5.45, 11.5], [0.01, 11.55]].map(([x, y]) => new THREE.Vector2(x, y)), 64);
      crown.scale(1, 1, 1.12);
      hat.add(mesh(crown, silk, [0, 0.4, 0]));
      const brim = new THREE.RingGeometry(5.3, 8.9, 96, 6), bp = brim.attributes.position;
      for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), z = bp.getY(i) * 1.12; bp.setXYZ(i, x, 1.4 * Math.pow(Math.min(1, Math.abs(x) / 8.9), 3) * Math.min(1, (Math.hypot(x, z / 1.12) - 5.3) / 3.6), z); }
      brim.computeVertexNormals();
      hat.add(mesh(brim, silk, [0, 0.4, 0]));
      const grosgrain = mat(0x101012, { r: 0.7, double: true });
      const band = new THREE.CylinderGeometry(5.33, 5.4, 1.7, 64, 1, true); band.scale(1, 1, 1.12);
      hat.add(mesh(band, grosgrain, [0, 1.35, 0]));
      const bow = at(5.45, 1.35, 1.3); bow.rotation.y = 0.45;
      for (const s of [-1, 1]) bow.add(mesh(ball(1, 12), grosgrain, [0, 0, s * 0.7], [0, 0, 0], [0.18, 0.75, 0.75]));
      bow.add(mesh(ball(0.35, 10), grosgrain, [0.1, 0, 0])); hat.add(bow);
      g.add(hat);
      kit.zone(hat, 7, { grab: true, squish: true, burst: 0xffffff }); // ta-da!
    },
  },
  {
    icon: '👷', name: 'Hard Hat',
    build(g, kit) {
      const THREE = T();
      // A molded hard-plastic safety helmet: a slightly glossy yellow shell, three raised ribs over the
      // top, a short front peak and a rim lip running all the way round.
      const abs = new THREE.MeshPhysicalMaterial({ color: 0xf2b705, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.35 });
      const hat = at(0, 6.4, -3.6);
      const shell = new THREE.SphereGeometry(9.3, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2), sp = shell.attributes.position;
      for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i), up = y / 9.3;
        const rib = 0.16 * (Math.exp(-Math.pow(x / 0.7, 2)) + 0.6 * Math.exp(-Math.pow((x - 2.4) / 0.6, 2)) + 0.6 * Math.exp(-Math.pow((x + 2.4) / 0.6, 2))) * Math.pow(up, 0.4) * Math.min(1, (1 - up) * 6 + 0.3); // low, smooth ribs
        const k = 1 + rib / 9.3; sp.setXYZ(i, x * k, y * k, z * k * 1.12); }
      shell.computeVertexNormals();
      hat.add(mesh(shell, abs));
      const lip = new THREE.TorusGeometry(9.35, 0.28, 10, 96); lip.rotateX(Math.PI / 2); lip.scale(1, 1, 1.12);
      hat.add(mesh(lip, abs, [0, 0.15, 0]));
      const peak = new THREE.RingGeometry(9.2, 12.4, 48, 4, -Math.PI * 0.32 + Math.PI / 2, Math.PI * 0.64), pp = peak.attributes.position; // the short front peak
      for (let i = 0; i < pp.count; i++) { const x = pp.getX(i), z = pp.getY(i) * 1.12, r = Math.hypot(x, pp.getY(i)); pp.setXYZ(i, x, -0.12 * (r - 9.2), z); }
      peak.computeVertexNormals();
      hat.add(mesh(peak, new THREE.MeshPhysicalMaterial({ color: 0xf2b705, roughness: 0.38, clearcoat: 0.4, side: THREE.DoubleSide }), [0, 0.2, 0]));
      g.add(hat);
      kit.zone(hat, 9, { grab: true, squish: true, burst: 0xfcc419 });
    },
  },
  {
    icon: '🧢', name: 'Cap',
    build(g, kit) {
      const THREE = T();
      // A real baseball cap: six stitched panels, a top button and eyelets, a curved brim with rows of
      // stitching, in navy cotton twill.
      const twill = canvasTexture(256, 256, (c, w, h) => { c.fillStyle = '#1d2b4a'; c.fillRect(0, 0, w, h); if ('filter' in c) c.filter = 'blur(6px)';
        for (let i = 0; i < 25; i++) { c.fillStyle = Math.random() < 0.5 ? 'rgba(60,80,120,.3)' : 'rgba(10,15,30,.3)'; c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 20 + Math.random() * 30, 0, 7); c.fill(); } });
      const cloth = mat(0xffffff, { r: 0.8, map: twill });
      const thread = mat(0x2c3c62, { r: 0.7 });
      const cap = at(0, 6.4, -3.4);
      const crown = new THREE.SphereGeometry(9.6, 72, 28, 0, Math.PI * 2, 0, Math.PI / 2); crown.scale(1, 0.92, 1.1);
      cap.add(mesh(crown, cloth));
      for (let k = 0; k < 6; k++) { // seams between the six panels, top button to rim
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6, pts = [];
        for (let j = 0; j <= 20; j++) { const th = (j / 20) * Math.PI / 2; pts.push(new THREE.Vector3(Math.sin(th) * Math.cos(a) * 9.64, Math.cos(th) * 9.64 * 0.92, Math.sin(th) * Math.sin(a) * 9.64 * 1.1)); }
        cap.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.07, 5), thread));
        const ea = a + Math.PI / 6, eth = 0.62; // an eyelet in each panel
        cap.add(mesh(new THREE.TorusGeometry(0.22, 0.07, 6, 16), thread, [Math.sin(eth) * Math.cos(ea) * 9.62, Math.cos(eth) * 9.62 * 0.92, Math.sin(eth) * Math.sin(ea) * 9.62 * 1.1], [eth, 0, -ea + Math.PI / 2]));
      }
      cap.add(mesh(ball(0.6, 14), cloth, [0, 8.85, 0], [0, 0, 0], [1, 0.5, 1])); // top button
      // the brim: curved down at the sides, stitched in rows
      const brim = new THREE.RingGeometry(0.01, 1, 64, 8, 0, Math.PI), bp = brim.attributes.position;
      for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), z = bp.getY(i); bp.setXYZ(i, x * 8.6, -1.6 * x * x - 0.4 * z, z * 7.4); }
      brim.computeVertexNormals();
      const visor = at(0, 0.6, 9.4); visor.rotation.x = -0.12; visor.add(mesh(brim, mat(0xffffff, { r: 0.8, map: twill, double: true })));
      for (let r2 = 0; r2 < 5; r2++) { const pts = []; for (let j = 0; j <= 40; j++) { const t = Math.PI * (j / 40), x = Math.cos(t) * (0.55 + r2 * 0.09), z = Math.sin(t) * (0.55 + r2 * 0.09); pts.push(new THREE.Vector3(x * 8.6, -1.6 * x * x - 0.4 * z + 0.03, z * 7.4)); }
        visor.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.035, 4), thread)); }
      cap.add(visor);
      g.add(cap);
      kit.zone(cap, 9, { grab: true, spin: true, burst: 0x74c0fc });
    },
  },
  {
    icon: '👸', name: 'Tiara',
    build(g, kit) {
      const THREE = T();
      // Silver filigree: thin wire scrolls rising into peaks, set with faceted crystals that catch the
      // light, a larger stone in the middle.
      const silver = mat(0xdcdcdc, { m: 1, r: 0.16 });
      const crystal = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0, iridescence: 0.6, iridescenceIOR: 1.8, envMapIntensity: 2.2, flatShading: true });
      const pink = new THREE.MeshPhysicalMaterial({ color: 0xf2a0c0, metalness: 0, roughness: 0.02, clearcoat: 1, iridescence: 0.4, envMapIntensity: 2.2, flatShading: true });
      const tiara = at(0, 9.6, -1.2);
      const R = 6.9, onBand = (a, y = 0, out = 0) => new THREE.Vector3(Math.cos(a) * (R + out), y, Math.sin(a) * (R + out));
      const wire = (pts, r = 0.09) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(12, pts.length * 8), r, 6), silver);
      const band = []; for (let i = 0; i <= 40; i++) band.push(onBand(Math.PI * (0.03 + 0.94 * i / 40)));
      tiara.add(wire(band, 0.22));
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * (0.1 + 0.8 * (i / 8)), mid = i === 4, h = mid ? 4.2 : 2.2 + Math.sin((i / 8) * Math.PI) * 0.9;
        for (const s of [-1, 1]) { // two scrolls meeting in a peak
          const pts = []; for (let j = 0; j <= 10; j++) { const t = j / 10; pts.push(onBand(a + s * (0.16 - 0.16 * t) + s * 0.05 * Math.sin(t * Math.PI * 2), h * t, 0.15 * Math.sin(t * Math.PI))); }
          tiara.add(wire(pts));
          const curl = []; for (let j = 0; j <= 12; j++) { const t = j / 12, ang = t * Math.PI * 1.6; curl.push(onBand(a + s * (0.1 + 0.05 * Math.cos(ang)), h * 0.35 + 0.45 * Math.sin(ang), 0.1)); }
          tiara.add(wire(curl, 0.07));
        }
        const gem = mesh(mid ? new THREE.OctahedronGeometry(1.0, 0) : new THREE.IcosahedronGeometry(0.42, 0), mid ? pink : crystal, onBand(a, h * (mid ? 0.55 : 0.75), 0.35).toArray(), [0, -a, 0], mid ? [0.85, 1.25, 0.6] : 1);
        tiara.add(gem);
        tiara.add(mesh(new THREE.IcosahedronGeometry(0.22, 0), crystal, onBand(a, h + 0.15, 0.1).toArray())); // a small stone at each tip
      }
      g.add(tiara);
      kit.zone(tiara, 7, { grab: true, squish: true, burst: 0xf783ac });
    },
  },
  {
    icon: '🎓', name: 'Graduate', confetti: true,
    build(g, kit) {
      const THREE = T();
      const black = mat(0x141414, { r: 0.8 }); // matte fabric over the board
      const cap = at(0, 10.8, -3.4);
      cap.add(mesh(new THREE.CylinderGeometry(6.8, 7.4, 3.2, 32), black, [0, 0.6, 0]));
      cap.add(mesh(new THREE.BoxGeometry(15, 0.5, 15), black, [0, 2.4, 0], [0, Math.PI / 4, 0]));
      cap.add(mesh(ball(0.5, 10), gold(), [0, 2.75, 0]));
      const tassel = at(5.3, 2.7, 5.3), threadM = mat(0xd9a72a, { r: 0.55 });
      tassel.add(mesh(capsule(0.08, 3), threadM, [0, -1.5, 0]), mesh(capsule(0.32, 0.5), threadM, [0, -3.1, 0])); // cord and knot
      for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2, r = 0.12 + (i % 3) * 0.08; tassel.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.2, 4), threadM, [Math.cos(a) * r, -4.4 - (i % 4) * 0.05, Math.sin(a) * r], [Math.sin(a) * 0.08, 0, Math.cos(a) * 0.08])); } // many fine threads
      cap.add(tassel);
      g.add(cap);
      const w = new Wobble(25, 1.8, 0.0012);
      kit.zone(tassel, 2.5, { wobble: w, burst: 0xffd43b });
      return (st) => { w.step(st); tassel.rotation.set(w.y * 0.8, 0, w.x); };
    },
  },
  {
    icon: '🧑‍🍳', name: 'Chef',
    build(g, kit) {
      const THREE = T();
      // A tall white cotton toque: a firm band, dozens of starched vertical pleats, and a soft puffed top.
      const cotton = mat(0xf6f4ef, { r: 0.85, double: true });
      const hat = at(0, 10.6, -3.4);
      hat.add(mesh(new THREE.CylinderGeometry(7.05, 7.05, 3.0, 72, 1, true), cotton, [0, 1.1, 0], [0, 0, 0], [1, 1, 1.1])); // band
      const pleats = new THREE.CylinderGeometry(8.4, 7.1, 7.5, 160, 12, true), pp = pleats.attributes.position;
      for (let i = 0; i < pp.count; i++) { const a = Math.atan2(pp.getZ(i), pp.getX(i)), k = 1 + 0.035 * Math.abs(Math.sin(a * 24)); pp.setX(i, pp.getX(i) * k); pp.setZ(i, pp.getZ(i) * k * 1.1); }
      pleats.computeVertexNormals();
      hat.add(mesh(pleats, cotton, [0, 6.3, 0]));
      const puff = new THREE.SphereGeometry(8.9, 72, 24, 0, Math.PI * 2, 0, Math.PI * 0.62), fp = puff.attributes.position;
      for (let i = 0; i < fp.count; i++) { const x = fp.getX(i), y = fp.getY(i), z = fp.getZ(i), a = Math.atan2(z, x), k = 1 + 0.05 * Math.sin(a * 7 + y * 0.4) * (1 - y / 8.9) + 0.03 * Math.sin(a * 13); fp.setXYZ(i, x * k, y * 0.55, z * k * 1.1); }
      puff.computeVertexNormals();
      hat.add(mesh(puff, cotton, [0, 8.6, 0]));
      g.add(hat);
      kit.zone(hat, 8, { grab: true, squish: true, burst: 0xffffff });
    },
  },
  {
    icon: '🎅', name: 'Santa', snow: true,
    // A full white beard painted onto your face: up the cheeks to the ears, round your mouth (your lips
    // still show), long strands falling down.
    face(c, f) {
      const P = f.P, W = f.w;
      const BEARD = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 447, 425, 410, 2, 186, 205, 227];
      c.save();
      soft(c, W * 0.03); polyPath(c, P, BEARD); c.fillStyle = 'rgba(246,244,240,.85)'; c.fill();
      furStrands(c, f, BEARD.slice(0, 21), { count: 520, len: [0.04, 0.09], inward: 0.12, droop: 1.1, colour: (r) => `rgba(${235 + r * 20 | 0},${232 + r * 20 | 0},${226 + r * 20 | 0},.55)`, seed: 120 });
      furStrands(c, f, [205, 186, 2, 410, 425], { count: 160, len: [0.03, 0.06], inward: 0.02, droop: 0.9, colour: (r) => `rgba(${240 + r * 15 | 0},${238 + r * 15 | 0},${233 + r * 15 | 0},.5)`, seed: 121, centre: { x: P(13).x, y: P(13).y - W * 0.3 } });
      c.save(); c.globalCompositeOperation = 'destination-out'; soft(c, W * 0.006); polyPath(c, P, LIPS); c.fill(); c.restore(); // your lips show through
      c.restore();
    },
    build(g, kit) {
      const THREE = T();
      // Red velvet hat with a thick faux-fur trim and pom-pom; a full, curly white beard of long fur that
      // hugs the jaw, and a moustache sweeping out from under the nose.
      const velvet = new THREE.MeshPhysicalMaterial({ color: 0xa3121c, roughness: 0.6, sheen: 1, sheenColor: new THREE.Color(0xff5a5a), sheenRoughness: 0.45, side: THREE.DoubleSide });
      const white = fur(0xf4f2ee);
      const hat = at(0, 10.4, -3.4);
      const trim = new THREE.TorusGeometry(7.0, 1.6, 16, 72), tp = trim.attributes.position; // lumpy, like real faux fur
      for (let i = 0; i < tp.count; i++) { const a = Math.atan2(tp.getY(i), tp.getX(i)), k = 1 + 0.04 * Math.sin(a * 17) + 0.03 * Math.sin(a * 31); tp.setX(i, tp.getX(i) * k); tp.setY(i, tp.getY(i) * k); }
      trim.computeVertexNormals();
      hat.add(mesh(trim, white, [0, 0.4, 0], [Math.PI / 2, 0, 0], [1, 1.1, 1]));
      const body = new THREE.CatmullRomCurve3([[0, 0.8, 0], [0, 4.5, -0.3], [-1.2, 8.0, -0.8], [-4.2, 9.6, -0.6], [-7.0, 8.2, 0.4]].map((q) => new THREE.Vector3(...q)));
      const bodyGeo = new THREE.TubeGeometry(body, 60, 1, 32), bg = bodyGeo.attributes.position, cp = new THREE.Vector3();
      for (let i = 0; i < bg.count; i++) { const t = Math.floor(i / 33) / 60; body.getPointAt(Math.min(1, t), cp); const r = 6.6 * Math.pow(1 - t, 0.9) + 0.4; bg.setXYZ(i, cp.x + (bg.getX(i) - cp.x) * r, cp.y + (bg.getY(i) - cp.y) * r, cp.z + (bg.getZ(i) - cp.z) * r * 1.08); }
      bodyGeo.computeVertexNormals();
      hat.add(mesh(bodyGeo, velvet));
      const pomAt = body.getPointAt(1), pom = mesh(ball(1.6, 20), white, pomAt.toArray());
      hat.add(pom);
      g.add(hat);
      const w = new Wobble(35, 2.5, 0.001);
      kit.zone(pom, 2, { wobble: w, burst: 0xffffff });
      // a fluffy bit of beard hanging below the chin (the rest is painted on, following your jaw)
      g.add(mesh(ball(1, 32), fur(0xfbfaf7), [0, -11.6, 3.4], [0.3, 0, 0], [5.2, 3.6, 2.6]));
      for (const s2 of [-1, 1]) { // moustache sweeping out and down
        const m = new THREE.CatmullRomCurve3([[s2 * 0.2, -2.6, 8.2], [s2 * 1.8, -2.9, 8.0], [s2 * 3.4, -3.5, 7.2], [s2 * 4.6, -4.4, 6.2]].map((q) => new THREE.Vector3(...q)));
        const mg = new THREE.TubeGeometry(m, 30, 1, 14), mp = mg.attributes.position;
        for (let i = 0; i < mp.count; i++) { const t = Math.floor(i / 15) / 30; m.getPointAt(Math.min(1, t), cp); const r = 1.05 * Math.sin(Math.PI * (0.15 + 0.85 * t)) * (1 - t * 0.5) + 0.12; mp.setXYZ(i, cp.x + (mp.getX(i) - cp.x) * r, cp.y + (mp.getY(i) - cp.y) * r * 0.75, cp.z + (mp.getZ(i) - cp.z) * r * 0.75); }
        mg.computeVertexNormals(); g.add(mesh(mg, white));
      }
      return (st) => { w.step(st); hat.rotation.set(w.y * 0.08, 0, w.x * 0.1); };
    },
  },
  {
    icon: '🧝', name: 'Elf',
    build(g, kit) {
      const THREE = T();
      // A felt elf hat whose long tip flops over, a scalloped red cuff, a brass jingle bell, and
      // prosthetic pointed ear tips (skin-coloured) on your own ears.
      const feltG = mat(0x1f6b34, { r: 0.85, double: true }), feltR = mat(0xa8141e, { r: 0.85, double: true });
      const hat = at(0, 10.4, -3.4);
      const cuff = new THREE.CylinderGeometry(6.7, 6.9, 2.2, 96, 2, true), cp = cuff.attributes.position; // zigzag points along the bottom
      for (let i = 0; i < cp.count; i++) { if (cp.getY(i) < 0) { const a = Math.atan2(cp.getZ(i), cp.getX(i)); cp.setY(i, cp.getY(i) - 1.0 * Math.abs(Math.sin(a * 6))); } }
      cuff.computeVertexNormals(); cuff.scale(1, 1, 1.1);
      hat.add(mesh(cuff, feltR, [0, 0.8, 0]));
      const spine = new THREE.CatmullRomCurve3([[0, 1.5, 0], [0, 6, -0.4], [0.8, 10, -1], [3.2, 12.4, -0.8], [6.2, 11.6, 0.3], [7.6, 9.6, 0.9]].map((q) => new THREE.Vector3(...q)));
      const body = new THREE.TubeGeometry(spine, 80, 1, 32), bp = body.attributes.position, pt = new THREE.Vector3();
      for (let i = 0; i < bp.count; i++) { const t = Math.floor(i / 33) / 80; spine.getPointAt(Math.min(1, t), pt); const r = 6.5 * Math.pow(1 - t, 1.1) + 0.25; bp.setXYZ(i, pt.x + (bp.getX(i) - pt.x) * r, pt.y + (bp.getY(i) - pt.y) * r, pt.z + (bp.getZ(i) - pt.z) * r * 1.08); }
      body.computeVertexNormals();
      const hatBody = at(0, 0, 0); hatBody.add(mesh(body, feltG)); hat.add(hatBody);
      const bell = at(7.6, 8.8, 0.9); // a brass jingle bell with its slot
      const brass = mat(0xc9a14a, { m: 1, r: 0.3 });
      bell.add(mesh(ball(0.85, 24), brass), mesh(new THREE.TorusGeometry(0.22, 0.06, 6, 12), brass, [0, 0.9, 0]), mesh(new THREE.BoxGeometry(1.2, 0.08, 0.3), mat(0x2a2010), [0, -0.2, 0.75]));
      hatBody.add(bell);
      g.add(hat);
      const w = new Wobble(30, 2, 0.0012);
      kit.zone(bell, 2, { wobble: w, burst: 0xffd43b }); // jingle
      const skin = new THREE.MeshPhysicalMaterial({ color: 0xd9a48a, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color(0xffb8a0) });
      for (const s2 of [-1, 1]) { // pointed ear tips, rising from your own ears
        const e = at(s2 * 7.9, 2.6, -2.6); e.rotation.set(-0.35, s2 * 1.25, -s2 * 0.45);
        e.add(mesh(F3.earGeometry(4.2, 2.4, { pointy: true, cup: 0.6, thick: 0.35 }), skin));
        g.add(e);
      }
      return (st) => { w.step(st); hatBody.rotation.set(w.y * 0.25, 0, w.x * 0.35); };
    },
  },
  {
    icon: '🤖', name: 'Robot', look: 'saturate(.6) contrast(1.1) brightness(1.03)',
    // Android make-up: a cool silvery sheen over your face with metal panel seams and rivets.
    face(c, f) {
      const P = f.P, W = f.w;
      c.save();
      soft(c, W * 0.04); polyPath(c, P, FACE_OVAL); c.fillStyle = 'rgba(185,192,204,.32)'; c.fill();
      soft(c, W * 0.002); c.strokeStyle = 'rgba(40,44,52,.55)'; c.lineWidth = W * 0.005; c.lineCap = 'round';
      const seam = (ids) => { c.beginPath(); ids.forEach((i, k) => { const p = P(i); k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); c.stroke(); };
      seam([103, 67, 109, 10, 338, 297, 332]); seam([127, 116, 117, 118, 101, 36]); seam([356, 345, 346, 347, 330, 266]); seam([58, 214, 207]); seam([288, 434, 427]);
      for (const i of [67, 297, 116, 345, 214, 434, 109, 338]) { const p = P(i); c.fillStyle = 'rgba(70,74,82,.75)'; c.beginPath(); c.arc(p.x, p.y, W * 0.007, 0, 7); c.fill(); c.fillStyle = 'rgba(230,234,240,.7)'; c.beginPath(); c.arc(p.x - W * 0.002, p.y - W * 0.002, W * 0.003, 0, 7); c.fill(); }
      keepEyes(c, P);
      c.restore();
    },
    build(g, kit) {
      const THREE = T();
      const brushed = canvasTexture(256, 32, (c, w, h) => { c.fillStyle = '#9aa1aa'; c.fillRect(0, 0, w, h); if ('filter' in c) c.filter = 'blur(1.5px)'; for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '40,40,50'},.12)`; c.fillRect(0, Math.random() * h, w, 1.5); } });
      const steel = mat(0xffffff, { m: 0.9, r: 0.38, map: brushed }), dark = mat(0x2b2f36, { m: 0.6, r: 0.5 });
      g.add(overHead(steel, { rx: 8.6, y: 1.4, ry: 13.2, thick: 0.9 }));
      for (const s of [-1, 1]) {
        const mod = at(s * 8.9, 1.4, -3.6); mod.rotation.z = s * Math.PI / 2;
        mod.add(mesh(new THREE.CylinderGeometry(3.4, 3.5, 2.2, 48), steel));
        for (let r = 0; r < 4; r++) mod.add(mesh(new THREE.TorusGeometry(0.6 + r * 0.6, 0.08, 6, 40), dark, [0, s * 1.12 * -1, 0], [Math.PI / 2, 0, 0])); // speaker grille rings
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; mod.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.25, 6), dark, [Math.cos(a) * 3.0, -s * 1.15, Math.sin(a) * 3.0])); } // bolts
        g.add(mod);
        kit.zone(mod, 3, { squish: true, burst: 0x74c0fc });
      }
      const pivot = at(0, 14.4, -3.6); // stands on top of the band
      pivot.add(mesh(new THREE.CylinderGeometry(0.28, 0.4, 5, 16), steel, [0, 2.5, 0]), mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.6, 24), dark, [0, 0.3, 0]));
      const ledM = mat(0xff3b30, { e: 0xff1a10, ei: 1 });
      pivot.add(mesh(ball(0.55, 16), ledM, [0, 5.2, 0]));
      const dome = mesh(ball(1.1, 32), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, transparent: true, opacity: 0.28, clearcoat: 1, depthWrite: false }), [0, 5.3, 0]);
      pivot.add(dome); g.add(pivot);
      const w = new Wobble(28, 2, 0.0012);
      kit.zone(dome, 1.8, { wobble: w, burst: 0xff6b6b });
      return (st) => { w.step(st); pivot.rotation.set(w.y * 0.7, 0, w.x * 0.9); ledM.emissiveIntensity = Math.sin(st.t * 6) > 0 ? 2 : 0.1; };
    },
  },

  // ----- fun extras -----
  {
    icon: '🤿', name: 'Scuba', look: 'saturate(1.15) hue-rotate(-10deg) brightness(1.03)',
    build(g, kit) {
      const THREE = T();
      // A real dive mask: a black frame, a glass lens reflecting the room, a see-through silicone skirt
      // sealing it to your face, a wide silicone strap; and a snorkel with a ribbed flexible section and
      // a clear mouthpiece.
      const rr = (s, w, h, r) => { s.moveTo(-w + r, -h); s.lineTo(w - r, -h); s.quadraticCurveTo(w, -h, w, -h + r); s.lineTo(w, h - r); s.quadraticCurveTo(w, h, w - r, h);
        s.lineTo(-w + r, h); s.quadraticCurveTo(-w, h, -w, h - r); s.lineTo(-w, -h + r); s.quadraticCurveTo(-w, -h, -w + r, -h); return s; };
      const glass = new THREE.MeshPhysicalMaterial({ color: 0xdff4ff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.18, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 2.5, depthWrite: false });
      const lens = new THREE.ShapeGeometry(rr(new THREE.Shape(), 6.1, 2.9, 1.6), 16);
      g.add(mesh(lens, glass, [0, 2.6, 7.0]));
      const frameM = mat(0x16181c, { r: 0.45 });
      const frame = rr(new THREE.Shape(), 6.7, 3.45, 1.9); frame.holes.push(rr(new THREE.Path(), 6.0, 2.85, 1.5));
      g.add(mesh(new THREE.ExtrudeGeometry(frame, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.25, bevelSegments: 3, curveSegments: 12 }), frameM, [0, 2.6, 6.3]));
      const skirtPath = []; for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2, x = Math.cos(a) * 6.6, y = Math.sin(a) * 3.5; skirtPath.push(new THREE.Vector3(Math.sign(x) * Math.min(Math.abs(x), 6.4), 2.6 + Math.sign(y) * Math.min(Math.abs(y), 3.2), 5.4 - Math.abs(Math.cos(a)) * 1.2)); }
      g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(skirtPath, true), 128, 0.9, 10, true), new THREE.MeshPhysicalMaterial({ color: 0xc8d4dc, roughness: 0.35, transparent: true, opacity: 0.45, clearcoat: 0.6, depthWrite: false })));
      const strapPts = [[6.4, 2.6, 5.6], [8.6, 2.8, 2], [8.8, 3, -4], [7, 3, -10.5], [0, 3, -13.6]];
      const strap = [...strapPts.map(([x, y, z]) => [-x, y, z]), ...strapPts.slice(0, -1).reverse()].map((q) => new THREE.Vector3(...q));
      const strapGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(strap), 80, 0.5, 8); strapGeo.scale(1, 2.2, 1);
      g.add(mesh(strapGeo, mat(0x1b1d22, { r: 0.6 }), [0, -3.6, 0]));
      const tubeM = new THREE.MeshPhysicalMaterial({ color: 0xf2c200, roughness: 0.3, clearcoat: 0.6 });
      const curve = new THREE.CatmullRomCurve3([[2.4, -4.6, 6.2], [6.8, -4.2, 3.2], [8.6, 2, 1.2], [8.8, 13, 0.4]].map((q) => new THREE.Vector3(...q)));
      const tube = new THREE.TubeGeometry(curve, 120, 1, 14), tp = tube.attributes.position, cq = new THREE.Vector3();
      for (let i = 0; i < tp.count; i++) { const t = Math.floor(i / 15) / 120; curve.getPointAt(Math.min(1, t), cq); const ribs = t < 0.3 ? 1 + 0.12 * Math.max(0, Math.sin(t * 160)) : 1; const r = 0.55 * ribs; tp.setXYZ(i, cq.x + (tp.getX(i) - cq.x) * r, cq.y + (tp.getY(i) - cq.y) * r, cq.z + (tp.getZ(i) - cq.z) * r); }
      tube.computeVertexNormals();
      g.add(mesh(tube, tubeM));
      g.add(mesh(new THREE.TorusGeometry(1.0, 0.35, 10, 24), new THREE.MeshPhysicalMaterial({ color: 0xe8eef2, roughness: 0.3, transparent: true, opacity: 0.6, clearcoat: 0.5 }), [2.1, -4.6, 6.6], [0, 0.5, 0])); // clear mouthpiece
      const top = at(8.8, 13, 0.4); g.add(top);
      kit.zone(top, 2, { burst: 0x74c0fc });
      const bubble = bubbleMaker();
      let carry = 0;
      return (st) => { carry += st.dt * (1 + st.jaw * 4); while (carry >= 1) { carry--; bubble(st, st.toWorld(8.8, 13.5, 0.4)); } };
    },
  },
  {
    icon: '🧔', name: 'Beard',
    // A full, natural brown beard and moustache painted onto your face, following your jaw and lip.
    face(c, f) {
      const P = f.P, W = f.w;
      const BEARD = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 447, 425, 410, 2, 186, 205, 227];
      c.save();
      soft(c, W * 0.035); polyPath(c, P, BEARD); c.fillStyle = 'rgba(70,45,28,.72)'; c.fill();
      const col = (r) => `rgba(${55 + r * 50 | 0},${35 + r * 30 | 0},${20 + r * 18 | 0},.6)`;
      furStrands(c, f, BEARD.slice(0, 21), { count: 600, len: [0.03, 0.065], inward: 0.13, droop: 1.0, colour: col, seed: 130 });
      furStrands(c, f, [205, 186, 2, 410, 425], { count: 220, len: [0.025, 0.05], inward: 0.02, droop: 0.9, colour: col, seed: 131, centre: { x: P(13).x, y: P(13).y - W * 0.3 } }); // moustache
      c.save(); c.globalCompositeOperation = 'destination-out'; soft(c, W * 0.006); polyPath(c, P, LIPS); c.fill(); c.restore();
      c.restore();
    },
    build(g, kit) {
      const spot = at(0, -9.5, 4); g.add(spot);
      kit.zone(spot, 4, { burst: 0xc49a6c });
    },
  },
  {
    icon: '🤩', name: 'Star Eyes',
    // Star-struck: gleaming star-shaped catchlights in your irises that twinkle, and a soft gold shimmer on the lids.
    face(c, f, t = 0) {
      const P = f.P, W = f.w;
      c.save();
      for (const [ids, lid] of [[EYE_L, [70, 63, 105, 66, 107]], [EYE_R, [300, 293, 334, 296, 336]]]) {
        const e = centreOf(P, ids), b = centreOf(P, lid);
        soft(c, W * 0.025); const gr = c.createRadialGradient((e.x + b.x) / 2, (e.y + b.y) / 2, 0, (e.x + b.x) / 2, (e.y + b.y) / 2, W * 0.1);
        gr.addColorStop(0, 'rgba(230,180,80,.42)'); gr.addColorStop(1, 'rgba(230,180,80,0)'); c.fillStyle = gr; c.fillRect(e.x - W * 0.12, b.y - W * 0.1, W * 0.24, W * 0.2);
      }
      keepEyes(c, P);
      soft(c, 0);
      for (const [k, [ci, e1, e2]] of [[468, 469, 471], [473, 474, 476]].entries()) {
        try { const cc = P(ci), r = Math.hypot(P(e1).x - P(e2).x, P(e1).y - P(e2).y) * 0.5; if (!(r > 0)) continue;
          const tw = 0.75 + 0.25 * Math.sin(t * 4 + k * 1.7), x = cc.x - r * 0.25, y = cc.y - r * 0.25, L = r * 0.9 * tw;
          const glow = c.createRadialGradient(x, y, 0, x, y, L); glow.addColorStop(0, 'rgba(255,250,230,.8)'); glow.addColorStop(1, 'rgba(255,250,230,0)');
          c.fillStyle = glow; c.beginPath(); c.arc(x, y, L, 0, 7); c.fill();
          c.fillStyle = 'rgba(255,255,255,.95)'; c.beginPath(); // a four-pointed star of light
          for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + t * 0.3, rr = i % 2 ? L * 0.16 : L; i ? c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
          c.closePath(); c.fill(); } catch {}
      }
      c.restore();
    },
    build(g, kit) {
      for (const s of [-1, 1]) { const e = at(s * 3.3, 2.9, 5.5); g.add(e); kit.zone(e, 2.4, { burst: 0xffd43b }); }
    },
  },
  {
    icon: '🎧', name: 'Headphones',
    build(g, kit) {
      const THREE = T();
      // Real over-ear headphones: matte black band with a stitched leather pad on top, aluminium sliders
      // and yokes, oval cups with soft leather cushions, a cable.
      const matte = mat(0x1d1f23, { r: 0.6 }), alu = mat(0xb8bcc2, { m: 1, r: 0.32 }), leather = new THREE.MeshPhysicalMaterial({ color: 0x222326, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color(0x55565c) });
      g.add(overHead(matte, { rx: 9.3, y: 4.4, ry: 10.6, thick: 0.6 }));
      g.add(overHead(leather, { rx: 8.6, y: 6.0, ry: 8.6, thick: 0.9 })); // padded underside of the band
      const cups = [-1, 1].map((s) => {
        const cup = at(s * 9.2, 0.4, -3.6);
        cup.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 4.6, 12), alu, [s * 0.2, 3.3, 0])); // slider
        const yoke = new THREE.TorusGeometry(3.4, 0.28, 8, 40, Math.PI); cup.add(mesh(yoke, alu, [s * 0.4, 0.2, 0], [0, Math.PI / 2, 0]));
        const shell = new THREE.CylinderGeometry(3.1, 3.3, 1.9, 48); shell.scale(1, 1, 1.25);
        cup.add(mesh(shell, matte, [0, 0, 0], [0, 0, Math.PI / 2]));
        cup.add(mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.1, 40), alu, [s * 0.97, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1.25])); // brushed plate
        const pad = new THREE.TorusGeometry(2.55, 0.85, 14, 48); pad.scale(1, 1.25, 1);
        cup.add(mesh(pad, leather, [-s * 1.15, 0, 0], [0, Math.PI / 2, 0]));
        g.add(cup);
        kit.zone(cup, 3.6, { squish: true, burst: 0xb197fc });
        return cup;
      });
      const cable = new THREE.CatmullRomCurve3([[-9.4, -3, -3.4], [-9, -7, -2.5], [-8, -12, -1], [-7.5, -18, 0]].map((q) => new THREE.Vector3(...q)));
      g.add(mesh(new THREE.TubeGeometry(cable, 40, 0.16, 6), matte));
      let beat = 0;
      const notes = [0xf783ac, 0x74c0fc, 0xffd43b, 0x8ce99a];
      return (st) => {
        beat += st.dt;
        if (beat > 0.45) { beat = 0; const s = Math.random() < 0.5 ? -1 : 1; sparkle(st, st.toWorld(s * 11, 2, -3.6), notes[(Math.random() * 4) | 0], 1, 1); }
      };
    },
  },
  {
    icon: '🎀', name: 'Bow',
    // a soft, natural blush (not painted circles)
    face(c, f) {
      const P = f.P, W = f.w;
      c.save(); soft(c, W * 0.05);
      for (const i of [205, 425]) { const p = P(i), gr = c.createRadialGradient(p.x, p.y - W * 0.02, 0, p.x, p.y - W * 0.02, W * 0.12); gr.addColorStop(0, 'rgba(230,110,130,.28)'); gr.addColorStop(1, 'rgba(230,110,130,0)'); c.fillStyle = gr; c.fillRect(p.x - W * 0.13, p.y - W * 0.15, W * 0.26, W * 0.26); }
      c.restore();
    },
    build(g, kit) {
      const THREE = T();
      // A satin ribbon hair bow: two real ribbon loops, a wrapped knot, two tails with V-cut ends.
      const satin = new THREE.MeshPhysicalMaterial({ color: 0xd63a6c, roughness: 0.3, sheen: 1, sheenColor: new THREE.Color(0xffa6c4), sheenRoughness: 0.3, clearcoat: 0.3, side: THREE.DoubleSide });
      const ribbon = (pts, width, twist = 0) => { // a flat ribbon swept along a curve
        const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q))), N = 60, pos = [], idx = [];
        const frames = curve.computeFrenetFrames(N, false);
        for (let i = 0; i <= N; i++) { const P = curve.getPointAt(i / N), B = frames.binormals[i].clone().applyAxisAngle(frames.tangents[i], twist * i / N);
          pos.push(P.x - B.x * width / 2, P.y - B.y * width / 2, P.z - B.z * width / 2, P.x + B.x * width / 2, P.y + B.y * width / 2, P.z + B.z * width / 2); }
        for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
        return mesh(geo, satin);
      };
      const bow = at(4.6, 11.6, -0.6);
      bow.rotation.set(0.2, -0.3, -0.35);
      for (const s2 of [-1, 1]) {
        bow.add(ribbon([[0, 0.3, 0], [s2 * 1.5, 1.4, 0.3], [s2 * 3.6, 1.6, 0.1], [s2 * 4.2, 0.2, -0.2], [s2 * 3.4, -1.2, 0.1], [s2 * 1.5, -0.9, 0.3], [0, -0.3, 0]], 2.2)); // loop
        const tail = ribbon([[s2 * 0.2, -0.4, 0.2], [s2 * 0.9, -2.2, 0.5], [s2 * 1.6, -4.0, 0.3], [s2 * 2.0, -5.4, 0.1]], 1.7, s2 * 0.4);
        bow.add(tail);
        const vcut = new THREE.Shape(); vcut.moveTo(-0.85, 0); vcut.lineTo(0.85, 0); vcut.lineTo(0, 0.7); vcut.closePath(); // the V notch at the end
        bow.add(mesh(new THREE.ShapeGeometry(vcut), mat(0xffffff, { op: 0 }), [s2 * 2.0, -5.5, 0.1]));
      }
      bow.add(mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.2, 24, 1, true), satin, [0, 0, 0.1], [0, 0, 0], [1, 1, 0.7])); // the wrapped knot
      g.add(bow);
      kit.zone(bow, 3.4, { grab: true, squish: true, burst: 0xffa8d8 });
    },
  },
  {
    icon: '🌧️', name: 'Rain Cloud', look: 'saturate(.85) brightness(.95)',
    build(g, kit) {
      const THREE = T();
      // A small storm cloud: many soft puffs, light on top, dark and flat underneath; thin rain streaks;
      // touch it and a jagged bolt of lightning cracks out of it.
      const cloud = at(0, 19.5, -2);
      const puffMat = (k) => new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.6, 0.07, 0.22 + k * 0.34), roughness: 1, emissive: 0x000000 });
      const mats = [0, 0.25, 0.5, 0.75, 1].map(puffMat);
      for (let i = 0; i < 38; i++) {
        const x = (rnd(i) - 0.5) * 11, z = (rnd(i + 50) - 0.5) * 6, y = Math.max(-1.2, (rnd(i + 99) - 0.3) * 3.4 - Math.abs(x) * 0.18), r = 1.4 + rnd(i + 7) * 1.6 - Math.abs(x) * 0.08;
        cloud.add(mesh(ball(r, 18), mats[Math.min(4, Math.max(0, Math.round((y + 1.2) / 4.6 * 4)))], [x, y, z], [0, 0, 0], [1, y < -0.8 ? 0.6 : 1, 1]));
      }
      g.add(cloud);
      kit.zone(cloud, 6, { squish: true, burst: 0xffe066 }); // touch it: lightning!
      const dropGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.4, 4), dropM = mat(0xcfe3f5, { op: 0.45, dw: false });
      const bolt = (() => { const pts = [new THREE.Vector3(0, -1, 0)]; for (let i = 1; i <= 8; i++) pts.push(new THREE.Vector3((Math.random() - 0.5) * 2.2, -1 - i * 1.6, (Math.random() - 0.5) * 0.6));
        return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'chordal', 0), 60, 0.12, 5), mat(0xfff8e0, { e: 0xfff3c0, ei: 3 })); })();
      bolt.visible = false; cloud.add(bolt);
      let carry = 0, flash = 0, prevSq = 0;
      return (st) => {
        carry += st.dt * 18;
        while (carry >= 1 && parts.length < 90) {
          carry--;
          const d = new THREE.Mesh(dropGeo, dropM);
          d.position.copy(st.toWorld((Math.random() - 0.5) * 9, 17.5, -2 + (Math.random() - 0.5) * 5));
          d.quaternion.copy(st.world.parent ? d.quaternion : d.quaternion);
          emit(st.world, d, st.up().multiplyScalar(-42), 0.7, 'float', { size: 1 });
        }
        if (carry >= 1) carry = 0;
        const sq = cloud.parent?.scale?.y ?? 1; // the touch wrapper squashes the cloud: that's our lightning cue
        if (prevSq - sq > 0.02) flash = 0.3;
        prevSq = sq;
        flash = Math.max(0, flash - st.dt);
        bolt.visible = flash > 0.12 || (flash > 0 && flash < 0.06);
        for (const m of mats) m.emissive.setHex(flash > 0 ? 0x6a6a58 : 0x000000);
      };
    },
  },
  {
    icon: '🎈', name: 'Balloons',
    build(g, kit) {
      const THREE = T();
      // Real latex balloons: teardrop-shaped, glossy and a little see-through, a knot at the bottom,
      // curly ribbon strings.
      const cols = [0xd9232e, 0x1f6fd1, 0xf2b705, 0x2a9d4a];
      const shape = new THREE.LatheGeometry([[0.01, -3.1], [0.5, -2.9], [1.5, -2.2], [2.25, -0.9], [2.45, 0.4], [2.25, 1.7], [1.5, 2.65], [0.01, 3.0]].map(([x, y]) => new THREE.Vector2(x, y)), 48);
      const tie = new THREE.Vector3(0, 11.5, -3);
      const items = cols.map((c, i) => {
        const pivot = at(tie.x, tie.y, tie.z);
        const a = -0.75 + i * 0.5;
        pivot.rotation.z = -a;
        const len = 9 + (i % 2) * 2;
        const curl = []; for (let k = 0; k <= 60; k++) { const t = k / 60; curl.push(new THREE.Vector3(Math.sin(t * 14) * 0.25 * (1 - t), t * len, Math.cos(t * 14) * 0.25 * (1 - t))); } // curly ribbon
        pivot.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curl), 120, 0.05, 4), mat(0xf0ece4, { r: 0.4 })));
        const b = at(0, len + 3.3, 0);
        const latex = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, transparent: true, opacity: 0.93, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) });
        b.add(mesh(shape, latex));
        b.add(mesh(new THREE.TorusGeometry(0.28, 0.16, 8, 16), latex, [0, -3.25, 0], [Math.PI / 2, 0, 0])); // knot
        pivot.add(b); g.add(pivot);
        const w = new Wobble(8, 1.2, 0.0018);
        kit.zone(b, 2.8, { squish: true, wobble: w, burst: c });
        return { pivot, a, w, i };
      });
      return (st) => { for (const it of items) { it.w.step(st); it.pivot.rotation.set(Math.sin(st.t * 1.1 + it.i) * 0.06 + it.w.y * 0.3, 0, -it.a + it.w.x * 0.6 + Math.sin(st.t * 0.9 + it.i * 2) * 0.05); } };
    },
  },
  {
    icon: '😵‍💫', name: 'Dizzy',
    build(g, kit) {
      const THREE = T();
      // little glowing star-shaped lights with a soft halo, circling your head
      const ring = at(0, 12.5, -3);
      ring.rotation.x = 0.25;
      const lightM = new THREE.MeshStandardMaterial({ color: 0xfff0b0, emissive: 0xffd36a, emissiveIntensity: 1.6, roughness: 0.3 });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2, st0 = at(Math.sin(a) * 8.5, 0, Math.cos(a) * 8.5);
        st0.add(mesh(starGeometry(0.9, 0.35), lightM));
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0xffc860, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.6 }));
        halo.scale.setScalar(4); st0.add(halo); ring.add(st0);
      }
      g.add(ring);
      kit.zone(ring, 3, { spin: true, burst: 0xffd43b });
      return (st) => { ring.rotation.y = st.t * 2.4; ring.children.forEach((s2) => (s2.rotation.y = -ring.rotation.y)); };
    },
  },
];
