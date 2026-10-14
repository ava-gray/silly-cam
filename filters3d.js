// 3D face filters for Silly Cam.
//
// MediaPipe gives a 4x4 "facial transformation matrix" for every face: it moves
// points from its canonical face model (centimetres, y up, z out of the face,
// nose tip ≈ (0, -0.5, 7.6), forehead ≈ (0, 8.3, 4.5), chin ≈ (0, -9.4, 4.3),
// face edges ≈ (±7.7, 0.7, -2.4)) into camera space. We put a Three.js group
// on that matrix, so anything placed in canonical coordinates sticks to the head.

import { FACE_POSITIONS, FACE_INDICES } from './facemesh.js';
// Phones (iPhone, iPad, Android) get a lighter version of the same filters: see PHONE below and in index.html.
export const PHONE = /iPhone|iPad|iPod|Android/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const V = '0.160.0';
let THREE, RoundedBoxGeometry;

const FOV = 63; // vertical field of view MediaPipe assumes when solving the pose
const TAN = Math.tan((FOV / 2) * Math.PI / 180);

export async function createStage3D(canvas, opts = {}) {
  THREE = await import('three'); // mapped to the CDN build by the import map in index.html
  ({ RoundedBoxGeometry } = await import(`https://cdn.jsdelivr.net/npm/three@${V}/examples/jsm/geometries/RoundedBoxGeometry.js`));

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !PHONE, powerPreference: 'low-power' }); // smooth edges: jagged ones shimmer like grain (phones: off, a big saving at phone size)
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !PHONE; // hats, glasses and ears cast soft shadows on your face (phones: off, it's a whole extra drawing pass)
  renderer.shadowMap.type = THREE.VSMShadowMap; // soft-edged, like shadows from room lights

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.3, 1, 1);
  sun.castShadow = !PHONE;
  sun.shadow.mapSize.set(PHONE ? 512 : 1024, PHONE ? 512 : 1024); // phones: half the shadow pixels, same softness (radius below)
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 160 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  sun.shadow.radius = PHONE ? 7 : 14; sun.shadow.blurSamples = PHONE ? 8 : 16;
  scene.add(sun, sun.target);
  // Shadows only show up on your face and head (the video is behind everything else).
  const catchers = [new THREE.ShadowMaterial({ opacity: 0.35, depthWrite: false }), new THREE.ShadowMaterial({ opacity: 0.22, depthWrite: false })];
  const room = senseRoomSetup(opts.picture, pmrem);
  // Reflections always come from the same small room picture (a neutral one until the camera starts),
  // so their size never changes: a new size makes the browser rebuild every 3D shader (a long freeze).
  scene.environment = room.neutralEnv();

  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 10000);
  const world = new THREE.Group(); // camera-space things that live on their own (fire, bubbles)
  scene.add(world);

  const faceGeo = new THREE.BufferGeometry();
  faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(FACE_POSITIONS, 3));
  faceGeo.setIndex(FACE_INDICES);
  const heads = Array.from({ length: 5 }, () => makeHead(scene, faceGeo, catchers)); // up to 5 people at once
  const hands = makeHands(scene);
  let filter = null, lastHandAt = -1e9;
  let size = '';

  function setFilter(def) {
    filter = def && def.build ? def : null;
    for (const h of heads) h.reset();
    clearParticles(world);
  }

  // opts.cutout: false when the page draws your exact hand on top itself (then the rough hand shape isn't needed)
  // opts.handCover[i]: where a hand is over face i ({ mouth, eyes, any }), so tracking that a hand
  // confuses is held there instead of followed; everything else keeps updating
  function update(result, fit, mirror, dt, t, handResult, opts = {}) {
    // Line the 3D canvas up exactly with the (cover-fitted, maybe mirrored) video.
    const key = [fit.vw, fit.vh, fit.s, fit.ox, fit.oy, mirror].join();
    if (key !== size) {
      size = key;
      const w = Math.round(fit.vw * fit.s), h = Math.round(fit.vh * fit.s);
      renderer.setPixelRatio(PHONE ? 1 : Math.min(window.devicePixelRatio || 1, w * h > 1.5e6 ? 1.25 : 1.5)); // phones: 1x
      renderer.setSize(w, h);
      Object.assign(canvas.style, { left: fit.ox + 'px', top: fit.oy + 'px', transform: mirror ? 'scaleX(-1)' : 'none' });
      camera.aspect = fit.vw / fit.vh;
      camera.updateProjectionMatrix();
    }
    if (!filter) { canvas.style.visibility = 'hidden'; return; }
    canvas.style.visibility = 'visible';

    const touches = hands.update(handResult, fit, dt, opts.cutout !== false);
    stats.hands = handResult?.landmarks?.length || 0;
    // When a hand comes near your face, the face tracker (and the hand tracker) often lose track for a
    // moment. Remember when we last saw any hand, so filters can wait for your face instead of vanishing.
    if (stats.hands || touches.length) lastHandAt = t;
    const handRecent = t - lastHandAt < 1.5;
    const view = { camera, vw: fit.vw, vh: fit.vh, f: (fit.vh / 2) / TAN };
    const mats = result?.facialTransformationMatrixes || [];
    const shapes = result?.faceBlendshapes || [];
    heads.forEach((h, i) => {
      const cover = opts.handCover?.[i] || null;
      if (!mats[i]) return h.hide(dt, touches.length > 0 || handRecent, cover?.any);
      if (!h.group) { h.build(filter); prepare(h.group); }
      h.track(mats[i].data, shapes[i]?.categories, dt, cover, result.ts ?? null, opts.pictureTs ?? null);
      h.tick({ t, dt, world, view, touches, tongue: opts.tongue?.[i] || 0 });
    });
    tickParticles(world, dt, view, touches);
    matchRoom(t, mirror);
    renderer.render(scene, camera);
  }

  // Get a new filter's shaders ready in the background, and only show it once they are, so picking a
  // filter never freezes the app (the browser can build shaders without blocking where supported).
  function prepare(group) {
    group.visible = true;
    let ready;
    try { ready = renderer.compileAsync(group, camera, scene); } catch { return; }
    group.visible = false;
    const show = () => { group.visible = true; };
    ready.then(show, show);
    setTimeout(show, 1500); // never stay hidden for long
  }
  // Warm up the common kinds of surface while the start screen is up, so the first filters appear fast.
  (() => {
    const warm = new THREE.Group(); warm.position.set(0, 0, -60);
    const geo = ball(1, 8), tex = canvasTexture(8, 8, (c) => { c.fillStyle = '#888'; c.fillRect(0, 0, 8, 8); });
    for (const m of [mat(0xffffff), mat(0xffffff, { r: 0.9 }), mat(0xffffff, { r: 0.1 }), mat(0xffffff, { m: 1, r: 0.3 }), mat(0xffffff, { ir: 1, cc: 1, r: 0.1 }),
      mat(0xffffff, { op: 0.5, dw: false }), mat(0xffffff, { e: 0xffffff }), mat(0xffffff, { map: tex, r: 0.8 }), mat(0xffffff, { map: tex }), fur(0xffffff)]) warm.add(new THREE.Mesh(geo, m));
    makeReal(warm);
    scene.add(warm);
    const done = () => { scene.remove(warm); };
    try { renderer.compileAsync(warm, camera, scene).then(done, done); } catch { done(); }
    warm.visible = false;
  })();

  // Make the filters look like they're really in your room: same light colour, brightness and direction
  // as the camera picture, reflections of the room in shiny things, and shadows that land on the right head.
  const _centre = new THREE.Vector3(), _lx = new THREE.Vector3(), _ly = new THREE.Vector3(), _lz = new THREE.Vector3();
  function matchRoom(t, mirror) {
    const env = room.sense(t, mirror);
    if (env) scene.environment = env;
    hemi.color.copy(room.sky);
    hemi.groundColor.copy(room.ground);
    hemi.intensity = 0.35 + room.lum * 1.4;
    sun.color.copy(room.key);
    sun.intensity = 0.55 + clamp(room.contrast, 0, 0.6) * 3.4 * (0.5 + room.lum);
    renderer.toneMappingExposure = clamp(0.5 + room.lum * 1.2, 0.55, 1.3);
    catchers[0].opacity = clamp(0.12 + room.contrast * 0.7, 0.12, 0.45);
    catchers[1].opacity = catchers[0].opacity * 0.65;
    // aim the shadow "camera" at the people in view
    let n = 0, far = 0;
    _centre.set(0, 0, 0);
    for (const h of heads) if (h.centre) { _centre.add(h.centre); n++; }
    if (!n) return;
    _centre.divideScalar(n);
    for (const h of heads) if (h.centre) far = Math.max(far, h.centre.distanceTo(_centre));
    const half = 24 + Math.ceil(far / 8) * 8;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
    sun.shadow.camera.updateProjectionMatrix();
    // Snap the shadow camera to whole shadow-map texels (seen from the light), so shadow edges stay
    // put instead of crawling while you move.
    const texel = (2 * half) / sun.shadow.mapSize.x;
    _lz.copy(room.dir).normalize(); _lx.set(0, 1, 0).cross(_lz).normalize(); _ly.copy(_lz).cross(_lx);
    const sx = Math.round(_centre.dot(_lx) / texel) * texel, sy = Math.round(_centre.dot(_ly) / texel) * texel, sz = _centre.dot(_lz);
    _centre.copy(_lx).multiplyScalar(sx).addScaledVector(_ly, sy).addScaledVector(_lz, sz);
    sun.target.position.copy(_centre);
    sun.position.copy(room.dir).multiplyScalar(80).add(_centre);
    sun.target.updateMatrixWorld();
  }

  // holding(): is someone carrying a hat/crown/glasses in their hand right now? (then the page outlines that hand too)
  // pose(): where the first visible head's filter is right now (camera space, cm), for smoothness tests
  return { setFilter, update, stats: () => ({ ...stats }), holding: () => heads.some((h) => h.holding), pose: () => heads.find((h) => h.centre)?.centre.toArray() || null };
}
const stats = { hands: 0, touches: 0 }; // for testing

// Where a camera-space point lands in the video picture (pixels), and how many pixels 1 cm is there.
const _p = { x: 0, y: 0, cmPx: 0 };
function toPicture(v3, view) {
  const depth = -v3.z;
  if (depth <= 0) return null;
  _p.x = (v3.x / depth) * view.f + view.vw / 2;
  _p.y = view.vh / 2 - (v3.y / depth) * view.f;
  _p.cmPx = view.f / depth;
  return _p;
}

// ---------------------------------------------------------------------------
// Hands: an invisible hand-shaped "cut-out" right in front of the camera, so filters
// go behind your hand instead of drawing over it; plus fingertip points for touching.
// ---------------------------------------------------------------------------
const HAND_BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const PALM = [0, 1, 5, 9, 13, 17];
const TOUCHERS = [4, 8, 12, 16, 20, 9]; // fingertips + middle of the palm
function makeHands(scene) {
  const MAXH = 2, per = HAND_BONES.length * 4 + PALM.length;
  const pos = new Float32Array(MAXH * per * 3);
  const idx = [];
  for (let h = 0; h < MAXH; h++) {
    for (let q = 0; q < HAND_BONES.length; q++) { const b = h * per + q * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    const p0 = h * per + HAND_BONES.length * 4;
    for (let k = 1; k < PALM.length - 1; k++) idx.push(p0, p0 + k, p0 + k + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);
  const cutout = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
  cutout.renderOrder = -10; cutout.frustumCulled = false;
  scene.add(cutout);

  const D = 6; // cm from the camera: in front of every face
  let prev = new Map();
  // Hands are only checked every few frames; in between, keep moving the cut-out the way the
  // hand was moving, so it doesn't trail behind your real hand.
  let lastRes = null, base = [], vel = [], since = 0;
  const predicted = (res, fit, dt) => {
    const lms = (res?.landmarks || []).map((lm) => lm.map((p) => [p.x * fit.vw, p.y * fit.vh]));
    if (res !== lastRes) {
      const gap = Math.max(since + dt, 1 / 60);
      vel = lms.map((P, h) => (base[h] ? P.map((q, i) => [(q[0] - base[h][i][0]) / gap, (q[1] - base[h][i][1]) / gap]) : null));
      base = lms; lastRes = res; since = 0;
      return lms;
    }
    since = Math.min(since + dt, 0.12);
    return base.map((P, h) => (vel[h] ? P.map((q, i) => [q[0] + vel[h][i][0] * since, q[1] + vel[h][i][1] * since]) : P));
  };
  return {
    update(res, fit, dt, cutoutOn = true) {
      pos.fill(0);
      const touches = [];
      const next = new Map();
      const put = (o, u, v) => {
        if (!cutoutOn) return; // all-zero triangles draw nothing
        pos[o] = ((u / fit.vw) * 2 - 1) * D * TAN * (fit.vw / fit.vh);
        pos[o + 1] = (1 - (v / fit.vh) * 2) * D * TAN;
        pos[o + 2] = -D;
      };
      predicted(res, fit, dt).slice(0, MAXH).forEach((P, h) => {
        const size = Math.hypot(P[0][0] - P[9][0], P[0][1] - P[9][1]);
        HAND_BONES.forEach(([a, b], q) => {
          const w = (a === 0 || (a === 5 && b === 9) || a === 13 && b === 17 ? 0.12 : 0.065) * size; // a bit thinner than a real hand: never a hole bigger than it
          const [ax, ay] = P[a], [bx, by] = P[b];
          const L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L;
          const sx = ax - ux * w, sy = ay - uy * w, ex = bx + ux * w, ey = by + uy * w; // round the joints
          const o = (h * per + q * 4) * 3;
          put(o, sx - uy * w, sy + ux * w); put(o + 3, ex - uy * w, ey + ux * w);
          put(o + 6, ex + uy * w, ey - ux * w); put(o + 9, sx + uy * w, sy - ux * w);
        });
        PALM.forEach((i, k) => put((h * per + HAND_BONES.length * 4 + k) * 3, P[i][0], P[i][1]));
        for (const i of TOUCHERS) {
          const key = h * 100 + i, before = prev.get(key);
          const t = { x: P[i][0], y: P[i][1], r: size * 0.12, vx: 0, vy: 0 };
          if (before && dt > 0) { t.vx = (t.x - before.x) / dt; t.vy = (t.y - before.y) / dt; }
          next.set(key, t); touches.push(t);
        }
      });
      prev = next;
      geo.attributes.position.needsUpdate = true;
      return touches;
    },
  };
}

// ---------------------------------------------------------------------------
// One tracked head: smoothed pose, face-motion springs, touch zones, and the filter's objects.
// ---------------------------------------------------------------------------
function makeHead(scene, faceGeo, catchers) {
  const anchor = new THREE.Group();
  anchor.matrixAutoUpdate = false;
  anchor.visible = false;
  scene.add(anchor);

  // Invisible shapes that only write depth, so things behind your face, skull or neck get hidden:
  // your real face shape in front, a skull (with hair room) behind it, and a neck.
  const hide = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  const face = new THREE.Mesh(faceGeo, hide);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), hide);
  skull.position.set(0, 2.5, -4); skull.scale.set(7.8, 11.5, 9);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 6.2, 22, 20), hide);
  neck.position.set(0, -17, -3.8);
  for (const m of [face, skull, neck]) { m.renderOrder = -1; anchor.add(m); }
  // same shapes again, showing only the shadows that filters cast on you
  const faceShade = new THREE.Mesh(faceGeo, catchers[0]), skullShade = new THREE.Mesh(skull.geometry, catchers[1]);
  skullShade.position.copy(skull.position); skullShade.scale.copy(skull.scale);
  for (const m of [faceShade, skullShade]) { m.receiveShadow = true; m.renderOrder = 1; anchor.add(m); }

  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(1, 1, 1);
  const mPos = new THREE.Vector3(), mQuat = new THREE.Quaternion(), mScl = new THREE.Vector3();
  const vel = new THREE.Vector3(), prevPos = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3();
  const accSmooth = new THREE.Vector3(), invQ = new THREE.Quaternion(), wpos = new THREE.Vector3();
  const blend = {};
  let seen = false, lost = 0, updateFn = null, zones = [];
  let tongueX = 0, tongueV = 0; // the filter tongue's spring
  // smoothing state: the last tracker answer we used, and how fast the head is moving (itself smoothed)
  let lastData = null, lastTs = null;
  const moveV = new THREE.Vector3(), turnV = new THREE.Vector3(), dq = new THREE.Quaternion();
  // looking ahead: how fast the tracked head really moves (cm/s, radians/s), to draw it where it is *now*
  const rawV = new THREE.Vector3(), rawW = new THREE.Vector3(), lastM = new THREE.Vector3(), lastMQ = new THREE.Quaternion();
  const pPos = new THREE.Vector3(), pQuat = new THREE.Quaternion(), wq = new THREE.Quaternion(), dq2 = new THREE.Quaternion(), wAxis = new THREE.Vector3();
  // When the tracker's answer is older than the camera picture it's drawn on (it skipped a frame), the filter is
  // drawn a little further along the way your head is moving, by about that gap, so it stays right on your face
  // instead of trailing behind. Holding still (or a hand on your face) adds nothing.
  // pictureTs: when the camera frame being drawn came in. Usually it's the very frame the answer is for, and then
  // only the smoothing's own small delay is made up.
  function placeAnchor(ts, steady, pictureTs) {
    const ahead = steady || ts == null ? 0 : clamp(((pictureTs ?? performance.now()) - ts) / 1000 + 0.02, 0, 0.12);
    // Only sideways/up-down: the tracker's distance guess is too shaky to look ahead on. Speeds under
    // 3 cm/s (0.25 radian/s) are tracking shake and add nothing; the look-ahead then fades in up to 3x that.
    // (Simulated with the tracker's real shake and delay: half the trailing on fast moves, same calm when still.)
    const vx = rawV.x, vy = rawV.y, v = Math.hypot(vx, vy), w = rawW.length();
    const fv = clamp((v - 3) / 6, 0, 1) * ahead, fw = clamp((w - 0.25) / 0.5, 0, 1) * ahead;
    pPos.copy(pos); pPos.x += vx * fv; pPos.y += vy * fv;
    pQuat.copy(quat);
    if (fw > 0) pQuat.premultiply(wq.setFromAxisAngle(wAxis.copy(rawW).divideScalar(w), w * fw));
    anchor.matrix.compose(pPos, pQuat, scl);
    anchor.matrixWorldNeedsUpdate = true;
    anchor.updateMatrixWorld(true);
    anchor.visible = true;
  }

  // Builders call kit.zone(object, radiusCm, { wobble, spin, squish, burst }) to make something touchable.
  const _box = new THREE.Box3(), _sph = new THREE.Sphere();
  const kit = {
    zone(obj, r, opts = {}) {
      let w = null;
      if ((opts.spin || opts.squish || opts.grab) && obj.parent) {
        // a wrapper we can spin/squash/carry without fighting the filter's own animation
        const parent = obj.parent;
        w = new THREE.Group(); w.position.copy(obj.position); obj.position.set(0, 0, 0);
        parent.add(w); w.add(obj);
      }
      zones.push({ obj, r, opts, w, spinV: 0, sq: 0, sqV: 0, cool: 0, home: w?.position.clone(), held: null, lost: 0 });
    },
  };

  function react(z, touch, st) {
    stats.touches++;
    const dir = Math.abs(touch.vx) > 60 ? Math.sign(touch.vx) : (Math.random() < 0.5 ? -1 : 1);
    if (z.opts.wobble) { z.opts.wobble.vx += dir * 7; z.opts.wobble.vy += 3; }
    if (z.opts.spin) z.spinV += dir * 9;
    if (z.opts.squish) z.sqV += 4.5;
    if (z.opts.burst != null) burst(st.world, z.obj.getWorldPosition(new THREE.Vector3()), z.opts.burst);
    try { navigator.vibrate?.(12); } catch {}
  }

  const head = {
    group: null,
    reset() {
      if (head.group) { anchor.remove(head.group); disposeTree(head.group); }
      head.group = null; updateFn = null; seen = false; zones = [];
    },
    build(def) {
      head.group = new THREE.Group();
      anchor.add(head.group);
      zones = [];
      updateFn = def.build(head.group, kit) || null;
      makeReal(head.group);
    },
    get centre() { return anchor.visible ? pos : null; }, // smoothed head position (camera space)
    get holding() { return zones.some((z) => z.held); },
    hide(dt, handNear, handOver) {
      lost += dt;
      // Normally vanish fast so nothing floats in the air; but a hand over your face can briefly hide
      // it from the tracker, so hold on a little longer while you're touching.
      // A hand covering your face can hide it from the tracker: then the filter stays put behind your hand.
      // With a hand around, wait (up to 6s) right where your face was until the tracker finds it again.
      if (lost > (handOver || handNear ? 6 : 0.15)) { anchor.visible = false; seen = false; }
    },
    track(data, cats, dt, cover = null, ts = null, pictureTs = null) {
      const steady = !!cover?.any;
      lost = 0;
      // The picture is drawn more often than the tracker answers. Only a new answer moves the filter;
      // feeding the same answer in again and again made it go "stop, jump, stop".
      if (data === lastData) return placeAnchor(lastTs, steady, pictureTs); // no new answer: just keep looking ahead
      lastData = data;
      new THREE.Matrix4().fromArray(data).decompose(mPos, mQuat, mScl);
      if (!seen) { pos.copy(mPos); quat.copy(mQuat); scl.copy(mScl); prevPos.copy(mPos); vel.set(0, 0, 0); accSmooth.set(0, 0, 0); moveV.set(0, 0, 0); turnV.set(0, 0, 0); lastM.copy(mPos); lastMQ.copy(mQuat); rawV.set(0, 0, 0); rawW.set(0, 0, 0); seen = true; }
      // "One-euro" smoothing: very steady when you hold still, snappy when you move, so filters neither
      // shake nor lag behind your head. The speed that decides this is smoothed too; using the raw,
      // shaky speed made the shake itself look like movement, which switched the smoothing off.
      const step = ts != null && lastTs != null ? clamp((ts - lastTs) / 1000, 1 / 120, 0.25) : clamp(dt, 1 / 120, 0.25);
      lastTs = ts;
      const kd = 1 - Math.exp(-2 * Math.PI * 1.2 * step); // the speed estimate is smoothed too
      moveV.lerp(tmp.copy(mPos).sub(pos).divideScalar(step), kd);
      dq.copy(mQuat).multiply(invQ.copy(quat).invert());
      if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
      const half = Math.acos(Math.min(1, dq.w)), sinHalf = Math.sin(half);
      turnV.lerp(sinHalf > 1e-6 ? tmp.set(dq.x, dq.y, dq.z).multiplyScalar((2 * half) / sinHalf / step) : tmp.set(0, 0, 0), kd);
      // Tracking shake alone reads as a cm/s or two and about 0.1 radian/s, so only speeds above that count
      // as moving. Tuned in a simulation with the tracker's real shake: half the wobble of the first version,
      // and no more delay (a calmer setting made filters trail behind slow head moves).
      const speed = Math.max(0, moveV.length() - 1.5), turn = Math.max(0, turnV.length() - 0.12); // cm/s and radians/s
      // A hand on your face makes the tracking jumpy, so then follow much more calmly.
      const kPos = 1 - Math.exp(-2 * Math.PI * (steady ? 0.5 + 0.03 * speed : 0.8 + 0.6 * speed) * step);
      const kRot = 1 - Math.exp(-2 * Math.PI * (steady ? 0.4 + 1 * turn : 0.6 + 10 * turn) * step);
      pos.lerp(mPos, kPos); quat.slerp(mQuat, kRot); scl.lerp(mScl, kPos);
      // the head's real speed, from one answer to the next (smoothed a little, so shake doesn't count)
      const kv = 1 - Math.exp(-2 * Math.PI * 2 * step);
      rawV.lerp(tmp.copy(mPos).sub(lastM).divideScalar(step), kv);
      dq2.copy(mQuat).multiply(invQ.copy(lastMQ).invert());
      if (dq2.w < 0) { dq2.x = -dq2.x; dq2.y = -dq2.y; dq2.z = -dq2.z; dq2.w = -dq2.w; }
      const h2 = Math.acos(Math.min(1, dq2.w)), s2 = Math.sin(h2);
      rawW.lerp(s2 > 1e-6 ? tmp.set(dq2.x, dq2.y, dq2.z).multiplyScalar((2 * h2) / s2 / step) : tmp.set(0, 0, 0), kv);
      lastM.copy(mPos); lastMQ.copy(mQuat);
      placeAnchor(ts, steady, pictureTs);
      // Head motion in the head's own frame, for wobbly ears and antennae (with tracking noise filtered out).
      tmp.copy(pos).sub(prevPos).divideScalar(step);
      prevPos.copy(pos);
      acc.copy(tmp).sub(vel).divideScalar(step).applyQuaternion(invQ.copy(quat).invert());
      vel.lerp(tmp, 0.5);
      accSmooth.lerp(acc, 0.3);
      // Face motions (mouth open, blinks): a hand over your mouth looks like an open mouth, so let them rest instead.
      // Face motions: a hand over your mouth looks like an open mouth, and over your eyes like a blink,
      // so just those hold still while covered. Everything else keeps updating.
      for (const c of cats || []) {
        const n = c.categoryName;
        if (cover?.mouth && (n === 'jawOpen' || n.startsWith('mouth') || n === 'cheekPuff' || n === 'tongueOut')) continue;
        if (cover?.eyes && n.startsWith('eye')) continue;
        blend[n] = (blend[n] ?? 0) * 0.4 + c.score * 0.6;
      }
    },
    tick({ t, dt, world, view, touches, tongue = 0 }) {
      // Stick your tongue out and the filter's tongue shoots out (a springy overshoot), then
      // snaps back in when you stop. st.tongue: 0 = in, about 1 = out (a bit more mid-shot).
      const step = Math.min(dt, 1 / 30);
      tongueV += (tongue ? (tongue - tongueX) * 320 - tongueV * 14 : (0 - tongueX) * 260 - tongueV * 32) * step;
      tongueX = Math.max(0, tongueX + tongueV * step);
      if (!head.group) return;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
      const dz = (v) => (Math.abs(v) < 60 ? 0 : clamp(v - Math.sign(v) * 60, -500, 500)); // ignore jitter
      const st = {
        t, dt, world,
        b: (n) => blend[n] || 0,
        jaw: Math.min(1, Math.max(0, ((blend.jawOpen || 0) - 0.08) / 0.4)),
        tongue: tongueX, tongueOn: tongue > 0.5,
        ax: dz(accSmooth.x), ay: dz(accSmooth.y),
        roll: Math.atan2(-up.x, up.y),
        toWorld: (x, y, z) => anchor.localToWorld(new THREE.Vector3(x, y, z)),
        forward: () => new THREE.Vector3(0, 0, 1).transformDirection(anchor.matrixWorld),
        up: () => up.clone(),
      };
      updateFn?.(st);
      // touch reactions
      if (zones.length) head.group.updateMatrixWorld(true);
      for (const z of zones) {
        z.cool -= dt;
        if (z.opts.grab && z.w && carry(z, touches, view, dt, st)) continue;
        if (z.w) {
          z.spinV *= Math.exp(-1.4 * dt);
          z.w.rotation[z.opts.axis || 'y'] += z.spinV * dt;
          z.sqV += (-140 * z.sq - 8 * z.sqV) * Math.min(dt, 1 / 30);
          z.sq += z.sqV * Math.min(dt, 1 / 30);
          z.w.scale.set(1 + z.sq * 0.5, 1 - z.sq * 0.6, 1 + z.sq * 0.5);
        }
        if (!touches.length || z.cool > 0) continue;
        let rad = z.r;
        z.obj.getWorldPosition(wpos);
        if (z.opts.grab) { // a hat can be grabbed anywhere on it, not just near its middle
          _box.setFromObject(z.obj).getBoundingSphere(_sph);
          wpos.copy(_sph.center); rad = Math.max(z.r, _sph.radius * 0.85);
        }
        const p = toPicture(wpos, view);
        if (!p) continue;
        const reach = rad * p.cmPx;
        const hit = touches.find((tc) => Math.hypot(tc.x - p.x, tc.y - p.y) < reach + tc.r);
        if (hit && z.opts.grab) { // grab it: it follows your hand until you let go or put it back
          z.held = { x: hit.x, y: hit.y, dx: p.x - hit.x, dy: p.y - hit.y, depth: -wpos.z, away: false };
          z.lost = 0;
          try { navigator.vibrate?.(12); } catch {}
          continue;
        }
        if (hit) { react(z, hit, st); z.cool = 0.4; }
      }
    },
  };

  // Hats, crowns, glasses...: while held, follow the same bit of your hand (at the hat's own distance
  // from the camera). Bring it back to your head and it pops back on; let go and it floats home.
  function carry(z, touches, view, dt, st) {
    if (!z.held) {
      if (z.w.position.distanceToSquared(z.home) > 0.0001) { z.w.position.lerp(z.home, 1 - Math.exp(-dt * 6)); return true; }
      return false;
    }
    const h = z.held;
    let near = null, best = Infinity;
    for (const tc of touches) { const d = Math.hypot(tc.x - h.x, tc.y - h.y); if (d < best) { best = d; near = tc; } }
    if (near && best < 140) {
      h.x = near.x; h.y = near.y; z.lost = 0;
      const target = new THREE.Vector3(((near.x + h.dx - view.vw / 2) / view.f) * h.depth, ((view.vh / 2 - (near.y + h.dy)) / view.f) * h.depth, -h.depth);
      z.w.parent.worldToLocal(target);
      z.w.position.lerp(target, 1 - Math.exp(-dt * 25));
      const fromHome = z.w.position.distanceTo(z.home);
      if (fromHome > 6) h.away = true;
      if (h.away && fromHome < 2.5) { // put it back on: snap, sparkle, done
        z.held = null; z.cool = 1; z.w.position.copy(z.home);
        burst(st.world, z.obj.getWorldPosition(new THREE.Vector3()), 0xffffff);
        try { navigator.vibrate?.(20); } catch {}
      }
    } else if ((z.lost += dt) > 0.35) { z.held = null; z.cool = 0.8; } // your hand left: let it float home
    return true;
  }
  return head;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;

function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) { if (!m.map?.userData.shared) m.map?.dispose(); m.dispose(); }
  });
}

// A little spring: makes ears/antennae swing when you move your head (or touch them).
class Wobble {
  constructor(stiff = 70, damp = 5, gain = 0.0007) { Object.assign(this, { stiff, damp, gain, x: 0, vx: 0, y: 0, vy: 0 }); }
  step(st, targetX = 0) {
    const dt = Math.min(st.dt, 1 / 30);
    this.vx += (-this.stiff * (this.x - targetX) - this.damp * this.vx - st.ax * this.gain * 60) * dt;
    this.vy += (-this.stiff * this.y - this.damp * this.vy + st.ay * this.gain * 40) * dt;
    this.x = clamp(this.x + this.vx * dt, -0.9, 0.9);
    this.y = clamp(this.y + this.vy * dt, -0.7, 0.7);
    return this;
  }
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------
// Every material gets real-world surface detail: tiny roughness changes (so highlights aren't plastic-perfect),
// scratches on metal, a woven feel on cloth, a lacquer coat on shiny things, and real fur on furry things.
// Standard materials are cheap; the physical one is only used where its extras really show.
function mat(color, o = {}) {
  const r = o.r ?? 0.45, m = o.m ?? 0, plain = o.op == null && !o.e;
  const common = {
    color, roughness: r, metalness: m,
    emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1,
    transparent: o.op != null, opacity: o.op ?? 1, depthWrite: o.dw ?? true,
    side: o.double ? THREE.DoubleSide : THREE.FrontSide,
    map: o.map ?? null,
    roughnessMap: m >= 0.5 ? surface('scratches') : null, // plain surfaces stay smooth (speckles looked grainy)
  };
  const lighter = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5);
  if (o.furry) {
    // soft fur: gentle colour streaks and a velvety sheen (no bumpy speckles: they looked grainy)
    const fm = new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.95, roughnessMap: null, map: o.map ?? surface('furColor'),
      sheen: 1, sheenRoughness: 0.5, sheenColor: lighter });
    fm.userData.fur = true;
    return fm;
  }
  const cloth = r >= 0.7 && m < 0.5 && plain, shiny = r <= 0.25 && m < 0.5 && plain;
  if (!o.ir && !cloth && !shiny && !o.cc) return new THREE.MeshStandardMaterial(common);
  return new THREE.MeshPhysicalMaterial({
    ...common,
    iridescence: o.ir ?? 0, iridescenceIOR: 1.6,
    clearcoat: o.cc ?? (shiny ? 0.7 : 0), clearcoatRoughness: shiny ? 0.08 : 0.25,
    sheen: cloth ? 0.7 : 0, sheenRoughness: 0.7, sheenColor: lighter,
    // (no woven bump texture on cloth: at camera size its fine pattern shimmered like grain)
  });
}
function mesh(geo, material, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...p); m.rotation.set(...r);
  if (Array.isArray(s)) m.scale.set(...s); else m.scale.setScalar(s);
  return m;
}
const ball = (r, w = 24) => new THREE.SphereGeometry(r, w, Math.max(8, w * 0.6 | 0));
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 16);
const cone = (r, h, seg = 28) => new THREE.ConeGeometry(r, h, seg);
const at = (x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); return g; };
const fur = (color) => mat(color, { r: 0.9, furry: true });
const gloss = (color, o = {}) => mat(color, { r: 0.18, ...o });
const gold = () => mat(0xffc93c, { m: 1, r: 0.25 });
// Short, smooth fur (dog and cat ears): a velvety sheen with soft streaks; the long-fur shells looked crumbly here.
const velvet = (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.85, map: surface('furColor'), sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45), side: THREE.DoubleSide });

// ---------------------------------------------------------------------------
// Realism helpers
// ---------------------------------------------------------------------------
// Small repeating detail textures, made once.
const surfaces = {};
function surface(kind) {
  if (surfaces[kind]) return surfaces[kind];
  const R = Math.random;
  const spec = {
    // tiny roughness changes all over: real things are never perfectly smooth
    micro: [128, 2, (c, n) => { c.fillStyle = '#e6e6e6'; c.fillRect(0, 0, n, n); for (let i = 0; i < 900; i++) { const v = 200 + R() * 55 | 0; c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(R() * n, R() * n, 1 + R() * 3, 1 + R() * 3); } }],
    // fine scratches and rubbed spots on metal
    scratches: [256, 1, (c, n) => {
      c.fillStyle = '#c8c8c8'; c.fillRect(0, 0, n, n);
      if ('filter' in c) c.filter = 'blur(1.5px)'; // soft smudges and faint lines, never sparkly
      for (let i = 0; i < 60; i++) { const v = 150 + R() * 105 | 0; c.fillStyle = `rgba(${v},${v},${v},.5)`; c.beginPath(); c.arc(R() * n, R() * n, 4 + R() * 20, 0, 7); c.fill(); }
      for (let i = 0; i < 60; i++) { const v = R() < 0.5 ? 235 : 160; c.strokeStyle = `rgba(${v},${v},${v},${0.2 + R() * 0.3})`; c.lineWidth = 0.5 + R(); const x = R() * n, y = R() * n, a = R() * 6.3, L = 6 + R() * 40; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); c.stroke(); }
    }],
    // the colour variation of fur: lots of short strands, mostly running one way
    furColor: [256, 2, (c, n) => {
      c.fillStyle = '#e8e8e8'; c.fillRect(0, 0, n, n);
      if ('filter' in c) c.filter = 'blur(0.8px)'; // soft streaks, never speckly
      for (let i = 0; i < 2500; i++) { const v = 195 + R() * 60 | 0; c.strokeStyle = `rgba(${v},${v},${v},.5)`; c.lineWidth = 1.2 + R() * 1.2; const x = R() * n, y = R() * n, a = Math.PI / 2 + (R() - 0.5) * 0.7, L = 4 + R() * 10; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); c.stroke(); }
    }, true],
    // single hairs: each texel is one hair with its own length (used by the fur shells)
    strands: [128, 2, (c, n) => {
      // soft tufts: round blobs of different sizes, blurred, so no single pixel can sparkle
      c.fillStyle = '#000'; c.fillRect(0, 0, n, n);
      if ('filter' in c) c.filter = 'blur(2px)';
      for (let i = 0; i < 900; i++) { const v = R() * 255 | 0, x = R() * n, y = R() * n, r = 2 + R() * 4; c.fillStyle = `rgb(${v},${v},${v})`;
        for (const [dx, dy] of [[0, 0], [n, 0], [-n, 0], [0, n], [0, -n]]) { c.beginPath(); c.ellipse(x + dx, y + dy, r * 0.7, r * 1.4, 0, 0, 7); c.fill(); } } // wraps around seamlessly
    }],
    // woven threads for cloth hats and scarves
    weave: [64, 10, (c, n) => {
      c.fillStyle = '#808080'; c.fillRect(0, 0, n, n);
      for (let y = 0; y < n; y += 8) for (let x = 0; x < n; x += 8) {
        const over = ((x + y) / 8) % 2;
        const g = over ? c.createLinearGradient(x, 0, x + 8, 0) : c.createLinearGradient(0, y, 0, y + 8);
        g.addColorStop(0, '#555'); g.addColorStop(0.5, '#ddd'); g.addColorStop(1, '#555');
        c.fillStyle = g; c.fillRect(x, y, 8, 8);
      }
    }],
  }[kind];
  const [n, rep, draw, colour] = spec;
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  draw(cv.getContext('2d'), n);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 4;
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  t.userData.shared = true;
  return (surfaces[kind] = t);
}

// After a filter is built: everything casts shadows, and furry parts grow real fur
// (a few see-through "shells" around the shape, each with fewer, shorter hairs: the classic fur trick).
const FUR_SHELLS = PHONE ? 6 : 10, FUR_LEN = 0.3; // centimetres (phones: fewer shells, the fur still reads soft at phone size)
// Phones (iPhone, iPad, Android): same filters, cheaper surfaces. The "physical" material's extra layers
// (sheen, clearcoat, iridescence) cost a lot on a phone's GPU and barely show at phone size, so phones get
// the standard material with the same colour, texture, roughness and glow.
const cheaper = new WeakMap();
function phoneMaterial(m) {
  if (!m?.isMeshPhysicalMaterial || m.userData?.fur) return m; // (fur keeps its own path)
  let c = cheaper.get(m);
  if (!c) {
    c = new THREE.MeshStandardMaterial({ color: m.color, map: m.map, roughness: Math.max(m.roughness, m.clearcoat ? 0.25 : 0), metalness: m.metalness,
      emissive: m.emissive, emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity, roughnessMap: m.roughnessMap, normalMap: m.normalMap,
      transparent: m.transparent, opacity: m.opacity, alphaMap: m.alphaMap, alphaTest: m.alphaTest, depthWrite: m.depthWrite, side: m.side,
      vertexColors: m.vertexColors, flatShading: m.flatShading, envMapIntensity: m.envMapIntensity });
    // filters animate some materials (pulsing glows, fades): the cheaper copy follows the original
    for (const k of ['emissiveIntensity', 'opacity', 'visible']) Object.defineProperty(c, k, { get: () => m[k], set: (v) => { m[k] = v; }, configurable: true });
    c.emissive = m.emissive; c.color = m.color; // shared colour objects, so colour changes carry over too
    cheaper.set(m, c);
  }
  return c;
}
function makeReal(group) {
  const furry = [];
  group.traverse((o) => {
    if (!o.isMesh || o.userData.shell) return;
    if (PHONE) o.material = Array.isArray(o.material) ? o.material.map(phoneMaterial) : phoneMaterial(o.material);
    const m = o.material;
    o.castShadow = !(m.transparent && m.opacity < 0.6) && !(m.emissiveIntensity > 0.5 && m.emissive?.getHex());
    if (m.userData?.fur) furry.push(o);
  });
  for (const o of furry) {
    // All the shells of one furry part are drawn together as copies of the same shape, each copy
    // pushed a little further out (inner ones first, so they blend in order): one draw instead of many.
    const geo = o.geometry;
    if (!geo.getAttribute('furLayer')) geo.setAttribute('furLayer', new THREE.InstancedBufferAttribute(Float32Array.from({ length: FUR_SHELLS }, (_, i) => (i + 1) / FUR_SHELLS), 1));
    const sm = new THREE.MeshStandardMaterial({
      color: o.material.color, roughness: 1, map: surface('furColor'), alphaMap: surface('strands'),
      transparent: true, depthWrite: false, side: o.material.side,
    });
    // Each shell keeps only the thicker tufts, with soft blended edges (hard edges sparkled like grain).
    sm.onBeforeCompile = (sh) => {
      sh.uniforms.uFurLen = { value: FUR_LEN };
      sh.vertexShader = 'uniform float uFurLen;\nattribute float furLayer;\nvarying float vFurK;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normal * furLayer * uFurLen; vFurK = furLayer;');
      sh.fragmentShader = 'varying float vFurK;\n' + sh.fragmentShader.replace('#include <alphamap_fragment>',
        '#include <alphamap_fragment>\n  diffuseColor.a = smoothstep(vFurK * 0.8, vFurK * 0.8 + 0.3, diffuseColor.a) * (1.0 - vFurK * 0.5);\n  diffuseColor.rgb *= 0.6 + 0.4 * vFurK; // darker near the skin');
    };
    sm.customProgramCacheKey = () => 'furshell2';
    const shell = new THREE.InstancedMesh(geo, sm, FUR_SHELLS);
    shell.userData.shell = true; shell.renderOrder = 2; shell.frustumCulled = false;
    o.add(shell);
  }
}

// Reads the camera picture a few times a second: how bright the room is, what colour the light is,
// which side it comes from, and a blurry picture of the room for reflections.
function senseRoomSetup(picture, pmrem) {
  const W = 32, H = 18;
  const probe = document.createElement('canvas'); probe.width = W; probe.height = H;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  const envCanvas = document.createElement('canvas'); envCanvas.width = 128; envCanvas.height = 64;
  const ectx = envCanvas.getContext('2d');
  const envTex = new THREE.CanvasTexture(envCanvas);
  envTex.mapping = THREE.EquirectangularReflectionMapping; envTex.colorSpace = THREE.SRGBColorSpace;
  const white = new THREE.Color(1, 1, 1), c = new THREE.Color(), d = new THREE.Vector3();
  let probeAt = -1, envAt = -1, envRT = null, envLum = -1;
  const room = {
    neutralEnv() { // soft grey room: brighter ceiling, darker floor
      const g = ectx.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, '#f2f2f2'); g.addColorStop(0.45, '#9a9a9a'); g.addColorStop(1, '#3c3c3c');
      ectx.fillStyle = g; ectx.fillRect(0, 0, 128, 64);
      envTex.needsUpdate = true;
      envRT = pmrem.fromEquirectangular(envTex);
      return envRT.texture;
    },
    sky: new THREE.Color(1, 1, 1), ground: new THREE.Color(0.53, 0.6, 0.67), key: new THREE.Color(1, 1, 1),
    lum: 0.45, contrast: 0.3, dir: new THREE.Vector3(0.3, 0.8, 1).normalize(),
    sense(t, mirror) {
      if (!picture?.width || t - probeAt < 0.25) return null;
      probeAt = t;
      try {
        pctx.drawImage(picture, 0, 0, W, H);
        const px = pctx.getImageData(0, 0, W, H).data;
        const lin = (v) => Math.pow(v / 255, 2.2);
        const top = [0, 0, 0], bot = [0, 0, 0], all = [];
        let sum = 0, wx = 0, wy = 0, ws = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4, r = lin(px[i]), g = lin(px[i + 1]), b = lin(px[i + 2]);
          const L = 0.2126 * r + 0.7152 * g + 0.0722 * b, half = y < H / 2 ? top : bot;
          half[0] += r; half[1] += g; half[2] += b;
          sum += L; all.push([L, r, g, b]);
          const w = L * L * L * L; wx += w * (x / (W - 1)); wy += w * (y / (H - 1)); ws += w;
        }
        all.sort((a, b) => b[0] - a[0]);
        const n = Math.max(1, all.length * 0.12 | 0), key = [0, 0, 0];
        let keyL = 0;
        for (let i = 0; i < n; i++) { keyL += all[i][0]; key[0] += all[i][1]; key[1] += all[i][2]; key[2] += all[i][3]; }
        // light colour, kept partly white so a red wall doesn't turn everything red
        const tint = (rgb, toWhite) => { const m = Math.max(...rgb, 1e-5); return c.setRGB(rgb[0] / m, rgb[1] / m, rgb[2] / m).lerp(white, toWhite); };
        room.key.lerp(tint(key, 0.6), 0.3);
        room.sky.lerp(tint(top, 0.6), 0.3);
        room.ground.lerp(tint(bot, 0.6).multiplyScalar(0.7), 0.3);
        const lum = Math.pow(sum / all.length, 1 / 2.2), keyLum = Math.pow(keyL / n, 1 / 2.2);
        room.lum = lerp(room.lum, lum, 0.3);
        room.contrast = lerp(room.contrast, keyLum - lum, 0.3);
        // the light comes from roughly where the bright part of the picture is
        if (ws > 0) {
          const sx = (wx / ws - 0.5) * 2 * (mirror ? -1 : 1), sy = (0.5 - wy / ws) * 2;
          room.dir.lerp(d.set(sx * 0.9, 0.55 + sy * 0.6, 0.85).normalize(), 0.25).normalize();
        }
        // reflections: a soft picture of the room, refreshed about once a second
        const changed = Math.abs(lum - envLum) > 0.05 || envLum < 0;
        if (t - envAt > 1.2 && changed) {
          envAt = t; envLum = lum;
          if ('filter' in ectx) ectx.filter = 'blur(4px)';
          ectx.drawImage(picture, -8, -8, 144, 80);
          ectx.filter = 'none';
          // Shiny things facing you mostly reflect the ceiling and lights above and behind the camera,
          // which the camera can't see: so add a bright ceiling and a light where the room's light comes from.
          const hex = (col, k) => `rgb(${Math.min(255, col.r * 255 * k) | 0},${Math.min(255, col.g * 255 * k) | 0},${Math.min(255, col.b * 255 * k) | 0})`;
          const bright = 0.6 + room.lum * 0.8;
          const sky = ectx.createLinearGradient(0, 0, 0, 30);
          sky.addColorStop(0, hex(room.key, bright)); sky.addColorStop(1, 'rgba(0,0,0,0)');
          ectx.fillStyle = sky; ectx.fillRect(0, 0, 128, 30);
          const lx = 64 + Math.atan2(room.dir.x, room.dir.z) / Math.PI * 64, ly = 32 - Math.asin(clamp(room.dir.y, -1, 1)) / Math.PI * 64;
          for (const ox of [-64, 0, 64]) { // the lamp/window, softly (repeated so it wraps around)
            const lamp = ectx.createRadialGradient(lx + ox, ly, 0, lx + ox, ly, 14);
            lamp.addColorStop(0, hex(room.key, 1.6)); lamp.addColorStop(1, 'rgba(255,255,255,0)');
            ectx.fillStyle = lamp; ectx.fillRect(lx + ox - 14, ly - 14, 28, 28);
          }
          const floor = ectx.createLinearGradient(0, 46, 0, 64);
          floor.addColorStop(0, 'rgba(0,0,0,0)'); floor.addColorStop(1, 'rgba(0,0,0,.6)');
          ectx.fillStyle = floor; ectx.fillRect(0, 46, 128, 18);
          envTex.needsUpdate = true;
          const old = envRT;
          envRT = pmrem.fromEquirectangular(envTex);
          old?.dispose();
          return envRT.texture;
        }
      } catch {}
      return null;
    },
  };
  return room;
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function heartGeometry(size = 1, depth = 0.5) {
  const s = new THREE.Shape();
  s.moveTo(0, -1); s.bezierCurveTo(-0.2, -0.75, -1.15, -0.25, -1.1, 0.35);
  s.bezierCurveTo(-1.05, 0.95, -0.25, 1.1, 0, 0.55);
  s.bezierCurveTo(0.25, 1.1, 1.05, 0.95, 1.1, 0.35);
  s.bezierCurveTo(1.15, -0.25, 0.2, -0.75, 0, -1);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.18, bevelSegments: 3, curveSegments: 14 });
  g.center(); g.scale(size, size, size);
  return g;
}
// A horn/curl made of shrinking balls along a curve: smooth, chunky and cartoony.
function beadHorn(points, r0, r1, material, beads = 18) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.Group();
  for (let i = 0; i <= beads; i++) {
    const k = i / beads;
    g.add(mesh(ball(1, 14), material, curve.getPoint(k).toArray(), [0, 0, 0], lerp(r0, r1, k)));
  }
  return g;
}
function whiskers(g, color) {
  const m = mat(color, { r: 0.6, cc: 0 });
  const len = 6.5;
  for (const s of [-1, 1]) for (const k of [-1, 0, 1]) {
    const d = new THREE.Vector3(s * Math.cos(k * 0.2), Math.sin(k * 0.2), 0);
    const w = mesh(new THREE.CylinderGeometry(0.1, 0.05, len, 6), m);
    w.rotation.z = Math.atan2(-d.x, d.y);
    w.position.set(s * 2.4 + d.x * len / 2, -2 + k * 0.5 + d.y * len / 2, 6.9);
    g.add(w);
  }
}

// Fire / bubbles / snow live in camera space so they trail behind as you move.
const parts = [];
let glowTex = null;
function glow() {
  return glowTex ||= canvasTexture(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  });
}
function emit(world, obj, v, life, kind, extra = {}) {
  world.add(obj);
  parts.push({ obj, v, life, max: life, kind, ...extra });
}
// A puff of glowing sparkles where something got touched.
function burst(world, at, color) {
  for (let i = 0; i < 10 && parts.length < 140; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    s.position.copy(at);
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(14 + Math.random() * 10);
    emit(world, s, v, 0.5 + Math.random() * 0.3, 'spark', { ownMat: true, size: 1.2 + Math.random() });
  }
}
function tickParticles(world, dt, view, touches = []) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    // poke a bubble and it pops
    if (p.kind === 'bubble' && touches.length && p.life > 0.15) {
      const q = toPicture(p.obj.position, view);
      if (q && touches.some((tc) => Math.hypot(tc.x - q.x, tc.y - q.y) < p.size * q.cmPx + tc.r)) {
        p.life = 0.15; try { navigator.vibrate?.(8); } catch {}
      }
    }
    p.life -= dt;
    p.obj.position.addScaledVector(p.v, dt);
    const k = 1 - p.life / p.max;
    if (p.kind === 'fire') {
      p.obj.scale.setScalar(lerp(1.5, 7, k));
      p.obj.material.opacity = (1 - k) * 0.9;
      p.obj.material.color.setHSL(lerp(0.14, 0.0, k), 1, lerp(0.65, 0.45, k));
      p.v.y += 14 * dt;
    } else if (p.kind === 'bubble') {
      p.v.y += 3 * dt; p.v.multiplyScalar(1 - 0.6 * dt);
      p.obj.position.x += Math.sin((p.max - p.life) * 4 + p.seed) * 0.05;
      const pop = p.life < 0.15 ? 1 + (0.15 - p.life) * 6 : Math.min(1, (p.max - p.life) * 4);
      p.obj.scale.setScalar(p.size * pop);
      if (p.life < 0.15) p.obj.material.opacity = p.life / 0.15 * 0.35;
    } else if (p.kind === 'spark') {
      p.v.multiplyScalar(1 - 3 * dt);
      p.obj.scale.setScalar(p.size * (1 - k * 0.5));
      p.obj.material.opacity = 1 - k;
    } else if (p.kind === 'float') {
      p.obj.rotation.y += dt * 2;
      p.obj.scale.setScalar(p.size * Math.min(1, p.life * 2, (p.max - p.life) * 4));
    }
    if (p.life <= 0) {
      world.remove(p.obj);
      if (p.ownMat) p.obj.material.dispose();
      parts.splice(i, 1);
    }
  }
}
function clearParticles(world) {
  for (const p of parts) { world.remove(p.obj); if (p.ownMat) p.obj.material.dispose(); }
  parts.length = 0;
}

// ---------------------------------------------------------------------------
// Realistic animal parts used by many filters: cupped ears, wet noses with nostrils,
// tongues with a groove down the middle, fine curved whiskers and frog eyes.
// ---------------------------------------------------------------------------
// A soft ear, cupped like a real one. Base at y = 0, tip at y = len. pointy = cat/fox, else dog/bunny.
function earGeometry(len, wid, { cup = 0.35, thick = 0.35, pointy = false } = {}) {
  const s = new THREE.Shape();
  if (pointy) {
    s.moveTo(-wid / 2, 0);
    s.quadraticCurveTo(-wid * 0.42, len * 0.55, -wid * 0.07, len * 0.96);
    s.quadraticCurveTo(0, len * 1.03, wid * 0.07, len * 0.96);
    s.quadraticCurveTo(wid * 0.42, len * 0.55, wid / 2, 0);
    s.quadraticCurveTo(0, -wid * 0.1, -wid / 2, 0);
  } else {
    s.moveTo(-wid * 0.3, 0);
    s.bezierCurveTo(-wid * 0.62, len * 0.25, -wid * 0.6, len * 0.85, 0, len);
    s.bezierCurveTo(wid * 0.6, len * 0.85, wid * 0.62, len * 0.25, wid * 0.3, 0);
    s.quadraticCurveTo(0, -wid * 0.08, -wid * 0.3, 0);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.6, bevelSize: Math.min(wid, len) * 0.06, bevelSegments: 4, curveSegments: 22 });
  g.translate(0, 0, -thick / 2);
  const p = g.attributes.position; // cup it: edges curl forward, the middle sits back
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) / (wid / 2); p.setZ(i, p.getZ(i) + cup * wid * x * x * 0.5); }
  // Texture coordinates 0..1 across the ear (extruded shapes come in centimetres, which tiled the fur
  // texture many times over and made a fine shimmering grid)
  const uv = g.attributes.uv; let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (let i = 0; i < uv.count; i++) { u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i)); v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i)); }
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - u0) / (u1 - u0 || 1), (uv.getY(i) - v0) / (v1 - v0 || 1));
  g.computeVertexNormals();
  return g;
}
// A real tongue: flat, wider and rounder near the tip, with a groove down the middle. Root at y = 0, tip at y = -len.
function tongueGeometry(len = 4.5, wid = 2.6, thick = 0.7) {
  const g = new THREE.SphereGeometry(1, 36, 24), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = (1 - y) / 2; // t: 0 root .. 1 tip
    const w = (wid / 2) * (0.78 + 0.22 * Math.sin(t * Math.PI * 0.85));
    let nz = (z * thick) / 2;
    if (z > 0) nz -= thick * 0.3 * Math.exp(-(x * x) / 0.05) * (0.3 + 0.7 * t);
    p.setXYZ(i, x * w, -t * len, nz);
  }
  g.computeVertexNormals();
  return g;
}
let tongueTex = null;
function tongueMat() {
  tongueTex ||= canvasTexture(64, 128, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, 0, h); // sphere UVs: top of the texture is the root
    gr.addColorStop(0, '#a3324d'); gr.addColorStop(0.45, '#e2546f'); gr.addColorStop(1, '#ff7891');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) { c.fillStyle = `rgba(255,${190 + Math.random() * 50 | 0},${200 + Math.random() * 40 | 0},${0.15 + Math.random() * 0.25})`; c.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
  });
  return mat(0xffffff, { map: tongueTex, r: 0.18 }); // r <= 0.25: a wet lacquer shine
}
// A wet animal nose: two lobes, nostrils, the little groove underneath. Faces +z.
function animalNose(color, w = 2.6) {
  const g = new THREE.Group(), skin = mat(color, { r: 0.2 }), dark = mat(0x050505, { r: 0.9 });
  g.add(mesh(ball(1, 28), skin, [0, 0.05 * w, 0], [0, 0, 0], [w * 0.36, w * 0.27, w * 0.3]));
  for (const s of [-1, 1]) {
    g.add(mesh(ball(1, 22), skin, [s * w * 0.2, 0, -w * 0.03], [0, 0, 0], [w * 0.24, w * 0.24, w * 0.26]));
    g.add(mesh(ball(1, 12), dark, [s * w * 0.17, -w * 0.06, w * 0.21], [0, 0, s * 0.55], [w * 0.11, w * 0.055, w * 0.06]));
  }
  g.add(mesh(capsule(w * 0.025, w * 0.18), dark, [0, -w * 0.24, w * 0.18]));
  return g;
}
// A cat's small pink nose: a soft rounded triangle with two slits.
function catNose(color = 0xf4a3b4, w = 1.9) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, w * 0.22); s.quadraticCurveTo(0, w * 0.34, w / 2, w * 0.22);
  s.quadraticCurveTo(w * 0.12, -w * 0.32, 0, -w * 0.38); s.quadraticCurveTo(-w * 0.12, -w * 0.32, -w / 2, w * 0.22);
  const geo = new THREE.ExtrudeGeometry(s, { depth: w * 0.18, bevelEnabled: true, bevelThickness: w * 0.14, bevelSize: w * 0.1, bevelSegments: 5, curveSegments: 16 });
  geo.center();
  const g = new THREE.Group();
  g.add(mesh(geo, mat(color, { r: 0.25 })));
  for (const sd of [-1, 1]) g.add(mesh(ball(1, 10), mat(0x7a2e3d, { r: 0.8 }), [sd * w * 0.17, w * 0.02, w * 0.2], [0, 0, sd * 0.7], [w * 0.09, w * 0.035, w * 0.04]));
  return g;
}
// Fine whiskers that taper and droop a little, coming out of dotted whisker pads.
function realWhiskers(g, color, { y = -2, z = 6.9, len = 7 } = {}) {
  // about a dozen fine whiskers a side in loose rows, each its own length and arc, thinning to the tip
  const m = mat(color, { r: 0.4, op: 0.85 }), dot = mat(0x3a2a20, { r: 0.9, op: 0.6, dw: false });
  for (const s of [-1, 1]) {
    for (let row = 0; row < 4; row++) for (let k = 0; k < 3; k++) {
      const a = (row - 1.5) * 0.13 + (k - 1) * 0.04, L = len * (0.75 + ((row * 3 + k) * 0.37 % 1) * 0.4);
      const start = new THREE.Vector3(s * (1.7 + k * 0.4), y + 0.6 - row * 0.38, z - k * 0.08);
      const end = start.clone().add(new THREE.Vector3(s * Math.cos(a) * L, Math.sin(a) * L - 0.8 - row * 0.15, -1.6 - k * 0.3));
      const mid = start.clone().lerp(end, 0.45).add(new THREE.Vector3(0, 0.45, 0.35));
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const tube = new THREE.TubeGeometry(curve, 16, 0.032, 4);
      const p = tube.attributes.position, c = new THREE.Vector3(); // taper toward the tip
      for (let i = 0; i < p.count; i++) { const t = Math.floor(i / 5) / 16; curve.getPoint(Math.min(1, t), c); p.setXYZ(i, c.x + (p.getX(i) - c.x) * (1 - t * 0.8), c.y + (p.getY(i) - c.y) * (1 - t * 0.8), c.z + (p.getZ(i) - c.z) * (1 - t * 0.8)); }
      g.add(mesh(tube, m));
    }
    for (let i = 0; i < 8; i++) g.add(mesh(ball(0.07, 6), dot, [s * (1.3 + (i % 4) * 0.42), y + 0.55 - Math.floor(i / 4) * 0.5, z + 0.1]));
  }
}
function catTongue(g, { y = -4.7, z = 6 } = {}) {
  const tongue = at(0, y, z);
  tongue.add(mesh(tongueGeometry(3.2, 2, 0.5), tongueMat()));
  g.add(tongue);
  return (st) => {
    const out = clamp(st.tongue, 0, 1.25), lick = Math.max(0, Math.sin(st.t * 7)); // only when you stick your tongue out
    tongue.visible = out > 0.02;
    tongue.scale.set(1, Math.max(0.02, out * (0.6 + 0.4 * lick)), 1);
    tongue.rotation.x = -0.5 - lick * 0.6 * out;
  };
}
// A real frog eye: golden iris with flecks, a dark sideways pupil, wet and shiny.
let frogEyeTex = null, frogSkinTex = null;
function frogEyeMat() {
  frogEyeTex ||= canvasTexture(512, 256, (c, w, h) => {
    c.fillStyle = '#4a3a12'; c.fillRect(0, 0, w, h);
    const cx = w * 0.25, cy = h / 2; // the front of a sphere is at u = 0.25
    const ir = c.createRadialGradient(cx, cy, 10, cx, cy, 105);
    ir.addColorStop(0, '#f5d76e'); ir.addColorStop(0.55, '#d9a521'); ir.addColorStop(0.9, '#8a6414'); ir.addColorStop(1, '#2e2306');
    c.fillStyle = ir; c.beginPath(); c.ellipse(cx, cy, 108, 100, 0, 0, 7); c.fill();
    for (let i = 0; i < 260; i++) { const a = Math.random() * 7, r = 20 + Math.random() * 82; c.fillStyle = Math.random() < 0.5 ? 'rgba(60,40,5,.45)' : 'rgba(255,240,170,.35)'; c.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.93, 2 + Math.random() * 3, 1 + Math.random() * 2); }
    c.fillStyle = '#050505'; c.beginPath(); c.ellipse(cx, cy, 46, 17, 0, 0, 7); c.fill();
  });
  return mat(0xffffff, { map: frogEyeTex, r: 0.08 });
}
function frogSkinMat() {
  frogSkinTex ||= canvasTexture(256, 128, (c, w, h) => {
    c.fillStyle = '#4f9a33'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(${30 + Math.random() * 30 | 0},${70 + Math.random() * 30 | 0},${20},${0.5 + Math.random() * 0.4})`; c.beginPath(); c.ellipse(Math.random() * w, Math.random() * h, 3 + Math.random() * 9, 2 + Math.random() * 6, Math.random() * 3, 0, 7); c.fill(); }
    for (let i = 0; i < 400; i++) { c.fillStyle = 'rgba(200,230,120,.35)'; c.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
  });
  return mat(0xffffff, { map: frogSkinTex, r: 0.32 });
}

// ---------------------------------------------------------------------------
// The 3D filters. build(group) adds objects in canonical-face coordinates and
// may return update(st) which runs every frame with face info (st.jaw = how
// open your mouth is, st.b('eyeBlinkLeft') etc.).
// ---------------------------------------------------------------------------
export const FILTERS_3D = [
  {
    icon: '🐶', name: 'Puppy',
    build(g, kit) {
      const brown = velvet(0x7d4f27);
      // a real floppy dog ear: bulging softly outward along its length, edges curling in, a little twist
      const earGeo = earGeometry(9, 5.6, { cup: 0.25, thick: 0.45 }), ep = earGeo.attributes.position;
      for (let i = 0; i < ep.count; i++) { const x = ep.getX(i), y = ep.getY(i), k = Math.max(0, Math.min(1, y / 9)), e2 = Math.pow(x / 2.8, 2);
        ep.setXYZ(i, x * (1 - 0.08 * k), y, ep.getZ(i) + 1.3 * Math.sin(Math.PI * k) - 0.7 * e2 * (0.4 + k) + x * 0.06 * k); }
      earGeo.computeVertexNormals();
      const ears = [-1, 1].map((s) => {
        const pivot = at(s * 9, 9.6, -1.6); // just outside your head, so the ears never sink into it
        pivot.add(mesh(earGeo, brown, [0, 0, 0], [0, s * 0.35, Math.PI])); // hangs down from the top of your head
        const mid = at(0, -4.5, 0); pivot.add(mid);
        g.add(pivot);
        const w = new Wobble(55, 4);
        kit.zone(mid, 3.6, { wobble: w });
        return { pivot, s, w };
      });
      const nose = animalNose(0x1a1a1a, 2.9);
      nose.position.set(0, -0.6, 8.2);
      g.add(nose);
      kit.zone(nose, 1.8, { squish: true, burst: 0xffffff }); // boop!
      const tongue = at(0, -4.7, 6.1);
      tongue.add(mesh(tongueGeometry(5, 2.7, 0.75), tongueMat()));
      g.add(tongue);
      return (st) => {
        for (const e of ears) {
          e.w.step(st, -st.roll * 0.6); // ears hang down even when you tilt
          e.pivot.rotation.set(-0.15 + e.w.y * 0.5, 0, e.s * 0.12 + e.w.x);
        }
        // stick your tongue out: the tongue shoots out and pants
        const out = clamp(st.tongue, 0, 1.25);
        tongue.visible = out > 0.02;
        tongue.scale.set(1, Math.max(0.02, out) * (1 + Math.sin(st.t * 10) * 0.06 * out), 1);
        tongue.rotation.set(-0.35 - out * 0.35, 0, Math.sin(st.t * 3) * 0.08 * out);
      };
    },
  },
  {
    icon: '🐱', name: 'Kitty',
    build(g, kit) {
      const orange = velvet(0xe0954f), pink = mat(0xc99099, { r: 0.75 }); // real cat skin: a dusky pink, not candy
      const outerGeo = earGeometry(5.6, 5, { pointy: true, cup: 0.5, thick: 0.4 }), innerGeo = earGeometry(4.2, 3.4, { pointy: true, cup: 0.5, thick: 0.2 });
      const ears = [-1, 1].map((s) => {
        const e = at(s * 5.2, 11.2, -1.4);
        e.rotation.set(-0.15, 0, -s * 0.3);
        e.add(mesh(outerGeo, orange), mesh(innerGeo, pink, [0, 0.4, 0.55]));
        const hairM = mat(0xe9e2da, { r: 0.7, op: 0.75, dw: false }); // fine pale ear hairs fanning up from inside
        for (let i = 0; i < 12; i++) { const sd = i % 2 ? 1 : -1, k = (i >> 1) / 6, x0 = sd * (0.4 + k * 0.6), y0 = 0.5 + k * 1.3;
          const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x0, y0, 0.6), new THREE.Vector3(x0, y0 + 1.1, 1.0), new THREE.Vector3(x0 * 0.4, y0 + 2.4 + (i % 3) * 0.3, 0.9));
          e.add(mesh(new THREE.TubeGeometry(curve, 8, 0.035, 4), hairM)); }
        const mid = at(0, 2.8, 0); e.add(mid);
        g.add(e);
        const w = new Wobble(110, 6, 0.0003);
        kit.zone(mid, 3, { wobble: w });
        return { e, s, w };
      });
      const nose = catNose(0xf4a3b4, 2.4);
      nose.position.set(0, -0.45, 8.2);
      g.add(nose);
      kit.zone(nose, 1.4, { squish: true, burst: 0xff8fab });
      realWhiskers(g, 0xf8f9fa);
      const lick = catTongue(g);
      return (st) => {
        for (const k of ears) { k.w.step(st); k.e.rotation.set(-0.15 + k.w.y * 0.4, 0, -k.s * 0.3 + k.w.x * 0.7); }
        lick(st);
      };
    },
  },
  {
    icon: '🐰', name: 'Bunny',
    build(g, kit) {
      const white = fur(0xfafafa);
      // inside a rabbit's ear: thin pink skin the light shines through, with fine veins
      const veinTex = canvasTexture(64, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#e8b4bc'); gr.addColorStop(0.5, '#f4c8cf'); gr.addColorStop(1, '#e8b4bc');
        c.fillStyle = gr; c.fillRect(0, 0, w, h); if ('filter' in c) c.filter = 'blur(1px)'; c.strokeStyle = 'rgba(200,90,110,.45)'; c.lineWidth = 1.5;
        for (const dx of [-10, 0, 10]) { c.beginPath(); c.moveTo(w / 2, h); c.bezierCurveTo(w / 2 + dx, h * 0.6, w / 2 + dx * 1.4, h * 0.3, w / 2 + dx * 0.6, 8); c.stroke(); } });
      const pinkInner = new THREE.MeshPhysicalMaterial({ map: veinTex, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color(0xffd5dc), emissive: new THREE.Color(0x40141c), emissiveIntensity: 0.35 });
      const outerGeo = earGeometry(11.5, 3.9, { cup: 0.45, thick: 0.45 }), innerGeo = earGeometry(9, 2.4, { cup: 0.45, thick: 0.2 });
      const ears = [-1, 1].map((s) => {
        const pivot = at(s * 3.4, 12.9, -1.2); // on top of your head, not inside it
        pivot.add(mesh(outerGeo, white), mesh(innerGeo, pinkInner, [0, 1, 0.55]));
        const mid = at(0, 6, 0); pivot.add(mid);
        g.add(pivot);
        const w = new Wobble(45, 3.5);
        kit.zone(mid, 3.5, { wobble: w });
        return { pivot, s, w };
      });
      const nose = catNose(0xff9fb6, 1.5);
      nose.position.set(0, -0.4, 8.2);
      g.add(nose);
      kit.zone(nose, 1.4, { squish: true, burst: 0xffc2d1 });
      realWhiskers(g, 0xffffff);
      const teeth = new THREE.Group();
      for (const x of [-0.62, 0.62]) teeth.add(mesh(new RoundedBoxGeometry(1.15, 1.7, 0.5, 3, 0.2), gloss(0xfffdf5, { r: 0.25 }), [x, -5, 5.9]));
      g.add(teeth);
      return (st) => {
        for (const e of ears) { e.w.step(st); e.pivot.rotation.set(-0.2 - e.w.y * 0.6, 0, -e.s * 0.14 - e.w.x * 0.8); }
        nose.scale.y = 0.92 + Math.sin(st.t * 18) * 0.08; // twitchy bunny nose
        teeth.visible = st.jaw > 0.18;
      };
    },
  },
  {
    icon: '🐻', name: 'Teddy',
    build(g, kit) {
      const brown = velvet(0x6e4424); // soft plush, like a real teddy bear
      for (const s of [-1, 1]) {
        const e = at(s * 6.6, 9.4, -2.4);
        e.add(mesh(earGeometry(5.4, 6.6, { pointy: false, cup: 0.6, thick: 0.55 }), brown, [0, -2.55, 0])); // one cupped fur ear
        g.add(e);
        kit.zone(e, 3.2, { squish: true });
      }
      const nose = animalNose(0x1a1a1a, 2.7);
      nose.position.set(0, -0.5, 8.2);
      g.add(nose);
      kit.zone(nose, 1.6, { squish: true, burst: 0xffffff });
      // bow tie under the chin
      const bow = at(0, -11.6, 3.2);
      const red = new THREE.MeshPhysicalMaterial({ color: 0x9e1020, roughness: 0.32, sheen: 1, sheenColor: new THREE.Color(0xff6070), sheenRoughness: 0.35, side: THREE.DoubleSide });
      for (const s of [-1, 1]) { // a satin bow tie: folded wings pinched in at the knot
        const wing = new THREE.CylinderGeometry(1.5, 0.45, 2.8, 32, 6, false), wp = wing.attributes.position;
        for (let i = 0; i < wp.count; i++) { const y = wp.getY(i), a = Math.atan2(wp.getZ(i), wp.getX(i)); wp.setZ(i, wp.getZ(i) * 0.35); wp.setX(i, wp.getX(i) * (1 + 0.08 * Math.sin(a * 6) * (y + 1.4) / 2.8)); }
        wing.computeVertexNormals();
        bow.add(mesh(wing, red, [s * 1.5, 0, 0], [0, 0, s * Math.PI / 2]));
      }
      bow.add(mesh(new RoundedBoxGeometry(0.9, 1.1, 0.7, 3, 0.25), red));
      g.add(bow);
      kit.zone(bow, 2.6, { squish: true, burst: 0xff6b6b });
    },
  },
  {
    icon: '🐸', name: 'Froggy', look: 'saturate(1.15) hue-rotate(12deg)',
    build(g, kit) {
      const skin = frogSkinMat(), eyeM = frogEyeMat();
      const eyes = [-1, 1].map((s) => {
        const eye = at(s * 3.35, 3, 4.3); // sitting right over your own eye
        eye.add(mesh(ball(2.9, 32), skin, [0, -0.3, -0.7], [0, 0, 0], [1.1, 1, 1])); // bumpy froggy socket
        const look = new THREE.Group();
        look.add(mesh(ball(2.45, 40), eyeM)); // golden iris, sideways pupil, wet shine
        eye.add(look);
        const lid = new THREE.Group();
        lid.add(mesh(new THREE.SphereGeometry(2.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), skin));
        eye.add(lid);
        g.add(eye);
        kit.zone(eye, 2.8, { squish: true, burst: 0x8ce99a });
        // MediaPipe's "Left/Right" means *your* left/right eye; canonical +x is your left.
        return { s, look, lid, side: s > 0 ? 'Left' : 'Right' };
      });
      // a fly buzzing in front of you... stick your tongue out and THWIP! the tongue catches it
      const pink = tongueMat();
      const shooter = at(0, -4.4, 6.2); g.add(shooter);
      const tongue = new THREE.Group(); shooter.add(tongue);
      tongue.add(mesh(new THREE.CylinderGeometry(0.42, 0.55, 1, 12), pink, [0, 0, 0.5], [Math.PI / 2, 0, 0]));
      const tip = mesh(ball(1.05, 18), pink); shooter.add(tip);
      const fly = new THREE.Group();
      fly.add(mesh(ball(0.42, 12), mat(0x1a1a1a, { r: 0.3 })), mesh(ball(0.3, 10), mat(0x2b2b2b, { r: 0.3 }), [0, 0, 0.5]));
      const wingM = mat(0xffffff, { op: 0.45, double: true, dw: false, r: 0.1 });
      const wings = [-1, 1].map((s) => { const w = mesh(new THREE.CircleGeometry(0.5, 10), wingM, [s * 0.35, 0.3, 0], [Math.PI / 2, 0, 0], [1, 1.7, 1]); fly.add(w); return w; });
      g.add(fly);
      kit.zone(fly, 1.6, { burst: 0x8ce99a });
      let shot = 0, gone = 0, wasOpen = false;
      const flyPos = new THREE.Vector3(), dir = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
      return (st) => {
        for (const e of eyes) {
          const S = e.side, out = st.b('eyeLookOut' + S) - st.b('eyeLookIn' + S);
          const gx = e.s > 0 ? out : -out, gy = st.b('eyeLookUp' + S) - st.b('eyeLookDown' + S);
          e.look.rotation.set(-gy * 0.6, gx * 0.7, 0); // the pupils follow where you look
          e.lid.rotation.x = lerp(-0.6, 1.7, clamp((st.b('eyeBlink' + S) - 0.3) / 0.35, 0, 1)); // blink when you blink
        }
        gone = Math.max(0, gone - st.dt);
        flyPos.set(Math.sin(st.t * 1.3) * 6 + Math.sin(st.t * 5.1) * 0.6, -1 + Math.sin(st.t * 2.1) * 3, 13 + Math.sin(st.t * 0.7) * 2);
        fly.position.copy(flyPos);
        fly.visible = gone === 0;
        for (const w of wings) w.rotation.z = Math.sin(st.t * 60) * 0.6;
        const open = st.tongueOn; // stick your tongue out: THWIP!
        if (open && !wasOpen && shot <= 0) shot = 0.55;
        wasOpen = open;
        let reach = 0;
        if (shot > 0) {
          shot -= st.dt;
          const k = 0.55 - shot; // time since the tongue launched
          reach = k < 0.12 ? k / 0.12 : k < 0.22 ? 1 : Math.max(0, 1 - (k - 0.22) / 0.33);
          if (k >= 0.12 && fly.visible) { gone = 2.5; fly.visible = false; burst(st.world, fly.getWorldPosition(new THREE.Vector3()), 0x8ce99a); } // got it!
        }
        dir.copy(flyPos).sub(shooter.position);
        const dist = dir.length();
        tongue.quaternion.setFromUnitVectors(Z, dir.normalize());
        tongue.scale.set(1, 1, Math.max(0.01, dist * reach));
        tip.position.copy(dir).multiplyScalar(dist * reach);
        tongue.visible = tip.visible = reach > 0.01;
      };
    },
  },
  {
    icon: '👑', name: 'Royal',
    build(g, kit) {
      // A real state crown: a jewelled gold band edged with pearls, crosses and fleurs-de-lis round the rim,
      // two pearl-lined arches over a purple velvet cap, a gold orb and cross on top, an ermine band below.
      const crown = at(0, 11.2, -2.8);
      crown.rotation.x = -0.12;
      const goldM = mat(0xd9a93a, { m: 1, r: 0.28, double: true });
      const pearl = new THREE.MeshPhysicalMaterial({ color: 0xf6f0e6, roughness: 0.25, sheen: 1, sheenColor: new THREE.Color(0xffe6f0), iridescence: 0.4, clearcoat: 0.6 });
      const gemMat = (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.04, metalness: 0, clearcoat: 1, flatShading: true, envMapIntensity: 2 });
      const gems = [0x9b0d1e, 0x123f9e, 0x0f6b3a, 0x9b0d1e].map(gemMat);
      const R = 6.6;
      crown.add(mesh(new THREE.CylinderGeometry(R, R + 0.2, 2.8, 72, 1, true), goldM));
      for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; for (const y of [-1.2, 1.25]) crown.add(mesh(ball(0.2, 8), pearl, [Math.sin(a) * (R + 0.18), y, Math.cos(a) * (R + 0.18)])); }
      for (let i = 0; i < 8; i++) { // gems in gold settings round the band
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8, x = Math.sin(a) * (R + 0.3), z = Math.cos(a) * (R + 0.3);
        crown.add(mesh(new THREE.TorusGeometry(0.62, 0.12, 8, 20), goldM, [x, 0, z], [0, a, 0]));
        crown.add(mesh(new THREE.OctahedronGeometry(0.62, 1), gems[i % 4], [x * 1.01, 0, z * 1.01], [0, a, 0], [1, 1.2, 0.55]));
      }
      const cross = (() => { const sh = new THREE.Shape(), a = 0.35, b = 1.05; // a cross pattée, flaring arms
        sh.moveTo(-a, -b); sh.lineTo(a, -b); sh.lineTo(a * 0.5, -a); sh.lineTo(b, -a); sh.lineTo(b, a); sh.lineTo(a * 0.5, a); sh.lineTo(a, b); sh.lineTo(-a, b); sh.lineTo(-a * 0.5, a); sh.lineTo(-b, a); sh.lineTo(-b, -a); sh.lineTo(-a * 0.5, -a); sh.closePath();
        const g2 = new THREE.ExtrudeGeometry(sh, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2 }); g2.center(); return g2; })();
      const fleur = (() => { const sh = new THREE.Shape(); // a simple fleur-de-lis: three petals over a band
        sh.moveTo(0, 1.4); sh.bezierCurveTo(0.5, 0.9, 0.45, 0.2, 0.15, -0.1); sh.bezierCurveTo(0.6, 0.3, 1.2, 0.4, 1.1, -0.3); sh.bezierCurveTo(0.9, -0.6, 0.4, -0.4, 0.25, -0.6);
        sh.lineTo(0.4, -1.1); sh.lineTo(-0.4, -1.1); sh.lineTo(-0.25, -0.6); sh.bezierCurveTo(-0.4, -0.4, -0.9, -0.6, -1.1, -0.3); sh.bezierCurveTo(-1.2, 0.4, -0.6, 0.3, -0.15, -0.1); sh.bezierCurveTo(-0.45, 0.2, -0.5, 0.9, 0, 1.4);
        const g2 = new THREE.ExtrudeGeometry(sh, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.05, bevelSegments: 2, curveSegments: 10 }); g2.center(); return g2; })();
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; crown.add(mesh(i % 2 ? fleur : cross, goldM, [Math.sin(a) * R, 2.5, Math.cos(a) * R], [0, a, 0], 1.1)); }
      crown.add(mesh(new THREE.SphereGeometry(R - 0.15, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x4b1260, roughness: 0.7, sheen: 1, sheenColor: new THREE.Color(0xb070d0) }), [0, 1.2, 0], [0, 0, 0], [1, 0.62, 1])); // velvet cap
      for (const rot of [0, Math.PI / 2]) { // two arches, dipping a little in the middle
        const pts = []; for (let j = 0; j <= 40; j++) { const t = -1 + 2 * j / 40, ang = t * Math.PI / 2; pts.push(new THREE.Vector3(Math.sin(ang) * (R - 0.2), 1.4 + Math.cos(ang) * 4.4 - 0.9 * Math.pow(Math.cos(ang), 6), 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot)); }
        const curve = new THREE.CatmullRomCurve3(pts); crown.add(mesh(new THREE.TubeGeometry(curve, 80, 0.32, 10), goldM));
        for (let j = 1; j < 30; j++) crown.add(mesh(ball(0.2, 8), pearl, curve.getPointAt(j / 30).add(new THREE.Vector3(0, 0.3, 0)).toArray()));
      }
      crown.add(mesh(ball(0.9, 24), goldM, [0, 5.4, 0]), mesh(cross, goldM, [0, 7.0, 0], [0, 0, 0], 0.9)); // orb and cross
      // ermine: white fur with little black tail-tips
      const ermine = new THREE.TorusGeometry(R + 0.45, 0.9, 12, 72); ermine.rotateX(Math.PI / 2);
      crown.add(mesh(ermine, fur(0xf6f4ef), [0, -1.9, 0]));
      for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; crown.add(mesh(capsule(0.12, 0.35), mat(0x111111, { r: 0.8 }), [Math.sin(a) * (R + 1.3), -1.9 + (i % 2) * 0.3, Math.cos(a) * (R + 1.3)])); }
      g.add(crown);
      kit.zone(crown, 7, { grab: true, spin: true, burst: 0xffd43b });
      return (st) => { crown.rotation.z = Math.sin(st.t * 1.5) * 0.03; };
    },
  },
  {
    icon: '😎', name: 'So Cool',
    build(g, kit) {
      // tinted glass: darker at the top, you can just see your eyes through it, and it reflects the room
      const fade = canvasTexture(4, 64, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f2f2f2'); g.addColorStop(1, '#a8a8a8'); c.fillStyle = g; c.fillRect(0, 0, w, h); });
      const lens = mat(0x1a1a30, { r: 0.04, m: 0.3, cc: 1, ir: 0.5, op: 0.86 });
      lens.alphaMap = fade; lens.envMapIntensity = 2.5;
      lens.opacity = 1; // the fade texture sets how see-through each part is
      fade.colorSpace = THREE.NoColorSpace;
      // wayfarer-style frames: glossy black acetate, a thick top bar, lenses angled in, hinges with
      // little metal rivets, real temple arms
      const acetate = new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1 }), rivet = mat(0xd8d8d8, { m: 1, r: 0.25 });
      const lensShape = () => { const sh = new THREE.Shape(); sh.moveTo(-2.6, 1.6); sh.lineTo(2.9, 1.7); sh.quadraticCurveTo(3.1, -0.4, 2.2, -1.6); sh.quadraticCurveTo(0, -2.2, -2.2, -1.5); sh.quadraticCurveTo(-2.9, -0.2, -2.6, 1.6); return sh; };
      const shades = at(0, 2.9, 6.3);
      for (const s of [-1, 1]) {
        const side = at(s * 3.45, 0, 0); side.rotation.y = s * 0.12; side.scale.x = s; shades.add(side);
        side.add(mesh(new THREE.ShapeGeometry(lensShape(), 16), lens, [0, 0, 0.05]));
        const rim = lensShape(); const outer = new THREE.Shape(rim.getPoints(40).map((p) => new THREE.Vector2(p.x * 1.12, p.y * 1.14 + (p.y > 0 ? 0.25 : 0)))); outer.holes.push(new THREE.Path(rim.getPoints(40)));
        side.add(mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.45, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.08, bevelSegments: 3, curveSegments: 16 }), acetate, [0, 0, -0.2]));
        side.add(mesh(new THREE.BoxGeometry(0.8, 0.9, 0.7), acetate, [3.35, 1.3, -0.3])); // hinge block
        for (const ry of [1.55, 1.05]) side.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 10), rivet, [1.6 + (ry - 1) * 2, ry + 0.15, 0.32], [Math.PI / 2, 0, 0]));
        const arm = new THREE.CatmullRomCurve3([[3.6, 1.3, -0.6], [3.9, 1.25, -5], [3.7, 0.9, -9.5], [3.2, -0.6, -11.2]].map((q) => new THREE.Vector3(...q)));
        side.add(mesh(new THREE.TubeGeometry(arm, 40, 0.22, 8), acetate));
      }
      shades.add(mesh(new THREE.BoxGeometry(1.2, 0.55, 0.5), acetate, [0, 1.05, 0.15])); // the bridge
      g.add(shades);
      kit.zone(shades, 5, { grab: true, squish: true, burst: 0x74c0fc });
    },
  },
  {
    icon: '🤡', name: 'Clown',
    // Real clown greasepaint, painted onto your face: white round the eyes and mouth, big red lip line,
    // blue marks above and below the eyes, soft rosy cheeks.
    face(c, f) {
      const P = f.P, W = f.w, soft = (k) => { if ('filter' in c) c.filter = k ? `blur(${(W * k).toFixed(1)}px)` : 'none'; };
      const blob = (x, y, rx, ry, col) => { c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, ry, f.angle, 0, 7); c.fill(); };
      const ctr = (ids) => { let x = 0, y = 0; for (const i of ids) { x += P(i).x; y += P(i).y; } return { x: x / ids.length, y: y / ids.length }; };
      c.save();
      soft(0.012);
      const m = ctr([61, 291, 13, 14]);
      blob(m.x, m.y + W * 0.01, W * 0.24, W * 0.15, 'rgba(250,250,248,.82)'); // white muzzle
      for (const ids of [[33, 133, 159, 145], [263, 362, 386, 374]]) { const e = ctr(ids); blob(e.x, e.y - W * 0.02, W * 0.11, W * 0.12, 'rgba(250,250,248,.8)'); }
      soft(0.03); for (const i of [205, 425]) { const p = P(i); blob(p.x, p.y, W * 0.09, W * 0.07, 'rgba(225,70,90,.32)'); } // rosy cheeks
      soft(0.004); c.strokeStyle = 'rgba(200,20,40,.9)'; c.lineWidth = W * 0.022; c.lineJoin = 'round';
      c.beginPath(); [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146].forEach((i, k) => { const p = P(i), dx = p.x - m.x, dy = p.y - m.y, x = p.x + dx * 0.35, y = p.y + dy * 0.6; k ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); c.stroke(); // big red mouth line
      c.fillStyle = 'rgba(30,80,200,.85)';
      for (const ids of [[33, 133, 159, 145], [263, 362, 386, 374]]) { const e = ctr(ids); for (const s2 of [-1, 1]) { c.beginPath(); c.moveTo(e.x - W * 0.012, e.y + s2 * W * 0.05); c.lineTo(e.x + W * 0.012, e.y + s2 * W * 0.05); c.lineTo(e.x, e.y + s2 * W * 0.12); c.closePath(); c.fill(); } }
      c.globalCompositeOperation = 'destination-out'; soft(0);
      for (const ids of [[33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7], [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249], [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]]) { c.beginPath(); ids.forEach((i, k) => { const p = P(i); k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); c.closePath(); c.fill(); } // your eyes and mouth show through
      c.restore();
    },
    build(g, kit) {
      const nose = mesh(ball(1.9, 32), mat(0xd3132b, { r: 0.85 }), [0, -0.6, 8.5]); // a matte foam clown nose
      g.add(nose);
      kit.zone(nose, 2.2, { squish: true, burst: 0xff4d6d }); // honk!
      // a curly synthetic rainbow wig: lumpy clumps of fluffy curls in bands of colour
      const bands = [0xd8232e, 0xf07a12, 0xf2c200, 0x2f9e44, 0x1f6fd1, 0x7a3fd0].map((c2) => fur(c2));
      const clump = (() => { const geo = ball(2.6, 20), p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + 0.18 * Math.sin(x * 3.1) * Math.sin(y * 2.7 + z * 2.3); p.setXYZ(i, x * k, y * k, z * k); } geo.computeVertexNormals(); return geo; })();
      const wig = new THREE.Group(); g.add(wig);
      for (let i = 0; i < 26; i++) {
        const a = -Math.PI * 0.95 + (i / 25) * Math.PI * 1.9, side = Math.sin(a), up = Math.cos(a);
        const x = side * 10.2, y = 4.5 + up * 6.5 + (i % 2) * 0.8, z = -3 + Math.abs(up) * -1 + (i % 3) * 0.6 - 1.2;
        wig.add(mesh(clump, bands[Math.min(5, Math.floor(((side + 1) / 2) * 6))], [x, y, z], [i, i * 0.7, 0], 1 + (i % 3) * 0.12));
      }
      return (st) => { wig.scale.setScalar(1 + Math.sin(st.t * 6) * 0.01); };
    },
  },
  {
    icon: '🥸', name: 'Disguise',
    build(g, kit) {
      const black = gloss(0x151515, { r: 0.3 }), hair = fur(0x3b2416);
      for (const s of [-1, 1]) {
        g.add(mesh(new THREE.TorusGeometry(2.4, 0.32, 16, 48), black, [s * 3.3, 2.9, 6.4], [0, s * 0.1, 0]));
        g.add(mesh(new THREE.BoxGeometry(0.3, 0.3, 9), black, [s * 6.4, 3.1, 2], [0, s * 0.08, 0]));
      }
      g.add(mesh(new THREE.TorusGeometry(0.9, 0.25, 12, 24, Math.PI), black, [0, 2.8, 6.8]));
      const noseGeo = ball(1, 40), np = noseGeo.attributes.position; // a sculpted plastic nose: narrow bridge, round tip, flared nostril wings
      for (let i = 0; i < np.count; i++) { let x = np.getX(i), y = np.getY(i), z = np.getZ(i); const top = Math.max(0, y);
        x *= 1 - 0.5 * top + 0.25 * Math.max(0, -y) * (1 - Math.abs(z)); z *= 1 + 0.25 * Math.max(0, -y); np.setXYZ(i, x * 1.7, y * 2.6, z * 1.9); }
      noseGeo.computeVertexNormals();
      const plastic = new THREE.MeshPhysicalMaterial({ color: 0xe7b394, roughness: 0.4, clearcoat: 0.35, sheen: 0.4, sheenColor: new THREE.Color(0xffd0c0) });
      const nose = at(0, -0.4, 8.2); nose.add(mesh(noseGeo, plastic));
      for (const s2 of [-1, 1]) nose.add(mesh(ball(1, 12), mat(0x3a2018, { r: 0.9 }), [s2 * 0.6, -2.1, 0.7], [0, 0, s2 * 0.4], [0.32, 0.16, 0.3])); // nostrils
      g.add(nose);
      kit.zone(nose, 2.4, { squish: true });
      const tuft = (pts, r0) => { const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q))), geo = new THREE.TubeGeometry(curve, 30, 1, 12), p = geo.attributes.position, c3 = new THREE.Vector3();
        for (let i = 0; i < p.count; i++) { const t = Math.floor(i / 13) / 30; curve.getPointAt(Math.min(1, t), c3); const r = r0 * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05))) * (1 + 0.12 * Math.sin(i * 1.7)); p.setXYZ(i, c3.x + (p.getX(i) - c3.x) * r, c3.y + (p.getY(i) - c3.y) * r, c3.z + (p.getZ(i) - c3.z) * r * 0.7); }
        geo.computeVertexNormals(); return mesh(geo, hair); }; // bushy synthetic fur, thick in the middle, wispy at the ends
      const brows = [-1, 1].map((s) => { const b = at(0, 0, 0); b.add(tuft([[s * 1.4, 5.7, 6.6], [s * 3.2, 6.25, 6.4], [s * 5.0, 5.9, 5.6]], 0.75)); b.position.y = 0; g.add(b); return b; });
      for (const s of [-1, 1]) g.add(tuft([[s * 0.2, -2.6, 8.3], [s * 2.0, -2.9, 8.0], [s * 3.6, -3.6, 7.2], [s * 4.4, -4.6, 6.4]], 1.0));
      return (st) => { const lift = st.b('browInnerUp') * 1.8; for (const b of brows) b.position.y = lift; };
    },
  },
  {
    icon: '🦄', name: 'Unicorn', look: (t) => `hue-rotate(${Math.sin(t) * 12}deg) saturate(1.15)`,
    build(g, kit) {
      // A real spiralled horn (like a narwhal tusk): pearly ivory that grows out of the forehead in one
      // twisted piece, with deep grooves winding up it; and a crown of real-looking flowers.
      const horn = at(0, 10.8, 3.6);
      horn.rotation.x = 0.38;
      const twirl = new THREE.Group();
      horn.add(twirl);
      const H = 9.5, geo = new THREE.CylinderGeometry(0.06, 1.45, H, 64, 120), hp = geo.attributes.position;
      for (let i = 0; i < hp.count; i++) {
        const x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i), k = (y + H / 2) / H, a = Math.atan2(z, x), r = Math.hypot(x, z);
        const groove = 1 - 0.13 * Math.pow(0.5 + 0.5 * Math.cos(a * 2 - k * Math.PI * 9), 3) * (1 - k * 0.6); // two grooves spiralling up
        hp.setXYZ(i, Math.cos(a) * r * groove, y, Math.sin(a) * r * groove);
      }
      geo.computeVertexNormals();
      const ivory = new THREE.MeshPhysicalMaterial({ color: 0xf6efe2, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0.6, sheenColor: new THREE.Color(0xffe8f2), iridescence: 0.35, iridescenceIOR: 1.4 });
      twirl.add(mesh(geo, ivory, [0, H / 2 - 0.4, 0]));
      g.add(horn);
      kit.zone(twirl, 4.5, { spin: true, burst: 0xf783ac });
      // flower crown: roses, small daisies and leaves on a twig band
      const band = new THREE.Group(); g.add(band);
      const twig = []; for (let i = 0; i <= 30; i++) { const a = -1.35 + (i / 30) * 2.7; twig.push(new THREE.Vector3(Math.sin(a) * 7.9, 9.0 + Math.cos(a) * 0.4, -2.5 + Math.cos(a) * 7.4)); }
      band.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(twig), 60, 0.16, 6), mat(0x6b5a3a, { r: 0.85 })));
      const petal = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const rose = (col) => { const r = new THREE.Group(), m2 = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.55, sheen: 1, sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide });
        for (let ring = 0; ring < 4; ring++) for (let j = 0; j < 5; j++) { const a = (j / 5) * Math.PI * 2 + ring, rr = 0.15 + ring * 0.28;
          r.add(mesh(petal, m2, [Math.cos(a) * rr, 0.1 - ring * 0.08, Math.sin(a) * rr], [0.9 - ring * 0.25, -a, 0], [0.55 + ring * 0.12, 0.5 + ring * 0.1, 0.35])); }
        return r; };
      const daisy = () => { const d = new THREE.Group(), w = mat(0xfbfaf6, { r: 0.6, double: true });
        for (let j = 0; j < 12; j++) { const a = (j / 12) * Math.PI * 2; d.add(mesh(capsule(0.12, 0.55), w, [Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42], [Math.PI / 2, 0, -a + Math.PI / 2])); }
        d.add(mesh(ball(0.22, 12), mat(0xe8b10c, { r: 0.8 }), [0, 0.05, 0])); return d; };
      const leaf = new THREE.Shape(); leaf.moveTo(0, 0); leaf.quadraticCurveTo(0.55, 0.6, 0, 1.6); leaf.quadraticCurveTo(-0.55, 0.6, 0, 0);
      const leafGeo = new THREE.ShapeGeometry(leaf, 8), leafM = mat(0x4f7a3a, { r: 0.6, double: true });
      const roseCols = [0xf2b5c8, 0xd97c9b, 0xf4d6c6, 0xc7a5e0];
      for (let i = 0; i < 11; i++) {
        const a = -1.25 + (i / 10) * 2.5, pos = [Math.sin(a) * 8.0, 9.25 + Math.cos(a) * 0.4, -2.5 + Math.cos(a) * 7.5];
        const fl = i % 3 === 1 ? daisy() : rose(roseCols[i % 4]); fl.position.set(...pos); fl.rotation.set(-0.2 + Math.cos(a) * 0.9, a, 0); fl.scale.setScalar(i % 3 === 1 ? 1 : 1.05); band.add(fl);
        for (const s2 of [-1, 1]) band.add(mesh(leafGeo, leafM, [pos[0] + s2 * 0.6, pos[1] - 0.2, pos[2]], [-0.6, a, s2 * 1.2]));
      }
    },
  },
  {
    icon: '👽', name: 'Alien', look: 'saturate(.85) contrast(1.05)',
    // Alien make-up: a cool grey-green skin tone painted onto your face, deeper around the eyes and temples,
    // with faint bluish veins; your eyes turn big, dark and glossy.
    face(c, f) {
      const P = f.P, W = f.w, soft = (k) => { if ('filter' in c) c.filter = k ? `blur(${(W * k).toFixed(1)}px)` : 'none'; };
      const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
      const ctr = (ids) => { let x = 0, y = 0; for (const i of ids) { x += P(i).x; y += P(i).y; } return { x: x / ids.length, y: y / ids.length }; };
      c.save();
      soft(0.04); c.beginPath(); OVAL.forEach((i, k) => { const p = P(i); k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); c.closePath(); c.fillStyle = 'rgba(120,160,140,.45)'; c.fill();
      for (const ids of [[33, 133, 159, 145], [263, 362, 386, 374]]) { const e = ctr(ids), r = W * 0.17;
        const gr = c.createRadialGradient(e.x, e.y, r * 0.2, e.x, e.y, r); gr.addColorStop(0, 'rgba(40,60,60,.55)'); gr.addColorStop(1, 'rgba(40,60,60,0)'); c.fillStyle = gr; c.fillRect(e.x - r, e.y - r, r * 2, r * 2); }
      soft(0.003); c.strokeStyle = 'rgba(60,90,140,.35)'; c.lineCap = 'round';
      for (const [a, b] of [[54, 21], [284, 251], [103, 67], [332, 297]]) { const A = P(a), B = P(b); for (let k = 0; k < 3; k++) { c.lineWidth = W * (0.006 - k * 0.0015); c.beginPath(); c.moveTo(A.x, A.y); c.quadraticCurveTo((A.x + B.x) / 2 + (k - 1) * W * 0.02, (A.y + B.y) / 2, B.x + (k - 1) * W * 0.03, B.y + W * 0.02 * k); c.stroke(); } }
      soft(0.002);
      for (const ids of [[33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7], [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]]) { // big glossy black eyes, inside your eye shape
        const e = ctr(ids); c.save(); c.beginPath(); ids.forEach((i, k) => { const p = P(i); k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); c.closePath(); c.clip();
        const gr = c.createRadialGradient(e.x, e.y, 0, e.x, e.y, W * 0.09); gr.addColorStop(0, 'rgba(25,30,40,.96)'); gr.addColorStop(1, 'rgba(5,6,10,.96)'); c.fillStyle = gr; c.fillRect(e.x - W * 0.1, e.y - W * 0.1, W * 0.2, W * 0.2);
        c.fillStyle = 'rgba(255,255,255,.75)'; c.beginPath(); c.ellipse(e.x - W * 0.02, e.y - W * 0.012, W * 0.012, W * 0.007, -0.4, 0, 7); c.fill(); c.restore(); }
      c.restore();
    },
    build(g, kit) {
      // organic antennae: segmented, slightly translucent, ending in softly glowing bulbs
      const skin = new THREE.MeshPhysicalMaterial({ color: 0x6f9a86, roughness: 0.45, clearcoat: 0.4, sheen: 0.5, sheenColor: new THREE.Color(0xbfe8d6) });
      const bulbM = new THREE.MeshPhysicalMaterial({ color: 0xbff5d8, emissive: 0x4fd18a, emissiveIntensity: 0.9, roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.9 });
      const ants = [-1, 1].map((s) => {
        const pivot = at(s * 2.6, 8.8, 0);
        const curve = new THREE.CatmullRomCurve3([[0, 0, 0], [s * 0.3, 2.5, 0.2], [s * 0.9, 5, 0.5], [s * 2.6, 7.4, 0.6]].map((q) => new THREE.Vector3(...q)));
        const tube = new THREE.TubeGeometry(curve, 60, 1, 12), tp = tube.attributes.position, c3 = new THREE.Vector3();
        for (let i = 0; i < tp.count; i++) { const t = Math.floor(i / 13) / 60; curve.getPointAt(Math.min(1, t), c3); const r = (0.42 - t * 0.2) * (1 + 0.12 * Math.max(0, Math.sin(t * 50))); tp.setXYZ(i, c3.x + (tp.getX(i) - c3.x) * r, c3.y + (tp.getY(i) - c3.y) * r, c3.z + (tp.getZ(i) - c3.z) * r); }
        tube.computeVertexNormals();
        pivot.add(mesh(tube, skin));
        const knob = mesh(ball(0.85, 24), bulbM, [s * 2.6, 7.7, 0.6]);
        pivot.add(knob);
        g.add(pivot);
        const w = new Wobble(30, 2.2, 0.0012);
        kit.zone(knob, 2, { wobble: w, burst: 0x8ce99a });
        return { pivot, s, w };
      });
      return (st) => { for (const a of ants) { a.w.step(st); a.pivot.rotation.set(a.w.y * 0.7, 0, a.w.x * 0.9); } bulbM.emissiveIntensity = 0.8 + Math.sin(st.t * 2.5) * 0.25; };
    },
  },
  {
    icon: '🐲', name: 'Dragon',
    build(g, kit) {
      // ridged horns of yellowed bone sweeping back from the brow, darker toward the tips, and a row of
      // scaly spines down the middle of the head
      const hornTex = canvasTexture(64, 256, (c, w, h) => { const gr = c.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, '#d8c7a0'); gr.addColorStop(0.7, '#9c8a66'); gr.addColorStop(1, '#3d3426');
        c.fillStyle = gr; c.fillRect(0, 0, w, h); if ('filter' in c) c.filter = 'blur(1.5px)'; for (let y = 8; y < h; y += 11) { c.fillStyle = 'rgba(60,45,25,.3)'; c.fillRect(0, y, w, 3); } });
      const hornM = new THREE.MeshPhysicalMaterial({ map: hornTex, roughness: 0.5, clearcoat: 0.3 });
      for (const s of [-1, 1]) {
        const curve = new THREE.CatmullRomCurve3([[s * 4.0, 9.2, 1.5], [s * 4.8, 11.8, 0], [s * 5.9, 13.6, -2.6], [s * 6.8, 14.2, -5.6], [s * 7.0, 13.4, -8]].map((q) => new THREE.Vector3(...q)));
        const geo = new THREE.TubeGeometry(curve, 60, 1, 16), hp = geo.attributes.position, c3 = new THREE.Vector3();
        for (let i = 0; i < hp.count; i++) { const t = Math.floor(i / 17) / 60; curve.getPointAt(Math.min(1, t), c3); const r = 1.35 * Math.pow(1 - t, 0.9) * (1 + 0.07 * Math.sin(t * 60)) + 0.03; hp.setXYZ(i, c3.x + (hp.getX(i) - c3.x) * r, c3.y + (hp.getY(i) - c3.y) * r, c3.z + (hp.getZ(i) - c3.z) * r); }
        const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
        geo.computeVertexNormals(); g.add(mesh(geo, hornM));
      }
      const scale = new THREE.MeshPhysicalMaterial({ color: 0x2f5a2a, roughness: 0.4, clearcoat: 0.5, sheen: 0.4, sheenColor: new THREE.Color(0x8ac070) });
      const spine = (() => { const sh = new THREE.Shape(); sh.moveTo(-1, 0); sh.quadraticCurveTo(-0.2, 0.6, 0.6, 2.4); sh.quadraticCurveTo(0.4, 0.8, 1, 0); sh.closePath();
        const g2 = new THREE.ExtrudeGeometry(sh, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 3 }); g2.center(); return g2; })();
      for (let i = 0; i < 5; i++) g.add(mesh(spine, scale, [0, 12.6 - i * 0.4, 1.8 - i * 2.8], [0, Math.PI / 2, 0.4 + i * 0.25], 1.1 - i * 0.12));
      const fireMat = new THREE.SpriteMaterial({ map: glow(), color: 0xffb703, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
      // the silly surprises
      const smokeMat = new THREE.SpriteMaterial({ map: glow(), color: 0x3a3a3a, transparent: true, depthWrite: false, opacity: 0.8 });
      const duck = new THREE.Group();
      duck.add(mesh(ball(1.2, 16), gloss(0xffd43b, { r: 0.2 }), [0, 0, 0], [0, 0, 0], [1.25, 0.85, 1]), mesh(ball(0.75, 14), gloss(0xffd43b, { r: 0.2 }), [0.75, 0.95, 0]));
      duck.add(mesh(cone(0.32, 0.8, 10), gloss(0xff922b), [1.45, 0.85, 0], [0, 0, -Math.PI / 2]), mesh(ball(0.12, 6), gloss(0x111111), [1.0, 1.2, 0.45]));
      const popcorn = new THREE.Group();
      for (let i = 0; i < 4; i++) popcorn.add(mesh(ball(0.55, 10), mat(0xfff9db, { r: 0.8 }), [Math.sin(i * 2) * 0.45, Math.cos(i * 3) * 0.4, Math.sin(i * 5) * 0.4]));
      const heart = mesh(heartGeometry(0.9, 0.35), gloss(0xff4d8d, { r: 0.2 }));
      const bubbleGeo = ball(1, 20), bubbleMat = mat(0xffffff, { r: 0, ir: 1, op: 0.35, dw: false });
      const SURPRISES = ['smoke', 'ducks', 'bubbles', 'hearts', 'popcorn', 'sneeze'];
      let carry = 0, wasOpen = false, mode = 'fire', left = 0;
      const rnd = (a) => (Math.random() - 0.5) * a;
      return (st) => {
        const open = st.jaw > 0.3;
        if (open && !wasOpen) { mode = Math.random() < 0.35 ? SURPRISES[(Math.random() * SURPRISES.length) | 0] : 'fire'; left = 1.3; carry = 0; }
        wasOpen = open;
        if (!open) return;
        const origin = st.toWorld(0, -4.6, 7), dir = st.forward(), up = st.up();
        if (mode === 'fire') {
          carry += st.dt * 35 * st.jaw;
          while (carry >= 1) {
            carry--;
            if (parts.length > 90) break;
            const s = new THREE.Sprite(fireMat.clone());
            s.position.copy(origin);
            const v = dir.clone().multiplyScalar(55 + Math.random() * 25).add(new THREE.Vector3(rnd(12), rnd(12), rnd(12)));
            emit(st.world, s, v, 0.7 + Math.random() * 0.3, 'fire', { ownMat: true });
          }
          return;
        }
        // not fire this time... something silly!
        if (left <= 0) return;
        left -= st.dt;
        if (mode === 'sneeze') { if (left > 1.2) for (let i = 0; i < 5; i++) burst(st.world, origin.clone().add(dir.clone().multiplyScalar(4 + i * 3)), [0xff6b6b, 0xffd43b, 0x74c0fc, 0x8ce99a, 0xf783ac][i]); return; }
        carry += st.dt * (mode === 'smoke' ? 18 : 8);
        while (carry >= 1 && parts.length < 80) {
          carry--;
          const v = dir.clone().multiplyScalar(14 + Math.random() * 10).add(up.clone().multiplyScalar(4 + Math.random() * 5)).add(new THREE.Vector3(rnd(6), rnd(4), rnd(6)));
          if (mode === 'smoke') { const p = new THREE.Sprite(smokeMat); p.position.copy(origin); emit(st.world, p, v.multiplyScalar(0.5).add(up.clone().multiplyScalar(6)), 1.4, 'float', { size: 2.5 + Math.random() * 2.5 }); }
          else if (mode === 'bubbles') { const b = new THREE.Mesh(bubbleGeo, bubbleMat); b.position.copy(origin); emit(st.world, b, v.multiplyScalar(0.7), 2.5, 'bubble', { size: 0.8 + Math.random(), seed: Math.random() * 6 }); }
          else { const o = (mode === 'ducks' ? duck : mode === 'hearts' ? heart : popcorn).clone(); o.position.copy(origin); emit(st.world, o, v, 1.8, 'float', { size: 1 }); }
        }
      };
    },
  },
  {
    icon: '🫧', name: 'Bubbles',
    build(g, kit) {
      // real soap bubbles: almost invisible in the middle, with swirling rainbow film and bright
      // reflections at the edges (a fresnel rim), never a solid colour
      const bubbleMat = new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 } },
        vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform float uT; varying vec3 vN; varying vec3 vV; varying vec3 vP;
          void main() { float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
            float film = vP.y * 3.0 + sin(vP.x * 4.0 + uT) * 0.6 + uT * 0.3;
            vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (film + vec3(0.0, 0.33, 0.67)));
            vec3 col = mix(vec3(1.0), rainbow, 0.55);
            float spec = pow(max(0.0, dot(reflect(-vV, vN), normalize(vec3(-0.4, 0.8, 0.5)))), 40.0);
            gl_FragColor = vec4(col + spec, clamp(0.04 + f * 0.75 + spec, 0.0, 1.0)); }`,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const geo = ball(1, 32);
      let carry = 0;
      const spot = at(0, -0.5, 8.4); g.add(spot); // (still touchable)
      kit.zone(spot, 1.4, { burst: 0x74c0fc });
      return (st) => {
        bubbleMat.uniforms.uT.value = st.t;
        carry += st.dt * (st.jaw > 0.25 ? 5 : 0.6);
        if (parts.length > 40) carry = 0;
        while (carry >= 1) {
          carry--;
          const b = new THREE.Mesh(geo, bubbleMat);
          b.position.copy(st.jaw > 0.25 ? st.toWorld(0, -4.6, 7) : st.toWorld((Math.random() - 0.5) * 24, -6 + Math.random() * 8, 2));
          const v = st.forward().multiplyScalar(st.jaw > 0.25 ? 18 : 2).add(new THREE.Vector3((Math.random() - 0.5) * 6, 4 + Math.random() * 4, 0));
          emit(st.world, b, v, 3 + Math.random() * 2, 'bubble', { size: 1 + Math.random() * 1.8, seed: Math.random() * 6 });
        }
      };
    },
  },
  {
    icon: '🧑‍🚀', name: 'Astronaut',
    build(g, kit) {
      // A spacesuit helmet: a clear polycarbonate bubble reflecting the room, a white fabric suit collar
      // with an aluminium neck ring and locking latches, lights and a camera on the side, a mission patch.
      const visor = new THREE.MeshPhysicalMaterial({ color: 0xeef6ff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.1, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 3, depthWrite: false, iridescence: 0.25 });
      g.add(mesh(ball(14.5, 64), visor, [0, 0.5, -2]));
      const suit = new THREE.MeshPhysicalMaterial({ color: 0xeceae4, roughness: 0.85, sheen: 0.6, sheenColor: new THREE.Color(0xffffff) });
      const collar = new THREE.TorusGeometry(12.2, 2.6, 24, 96), cp = collar.attributes.position; // padded, quilted fabric
      for (let i = 0; i < cp.count; i++) { const a = Math.atan2(cp.getY(i), cp.getX(i)), k = 1 + 0.02 * Math.cos(a * 24); cp.setX(i, cp.getX(i) * k); cp.setY(i, cp.getY(i) * k); }
      collar.computeVertexNormals();
      g.add(mesh(collar, suit, [0, -13.2, -2], [Math.PI / 2, 0, 0]));
      const alu = mat(0xb5b9bf, { m: 1, r: 0.3 }), dark = mat(0x2a2d33, { m: 0.5, r: 0.5 });
      g.add(mesh(new THREE.CylinderGeometry(13.4, 13.6, 1.6, 96, 1, true), alu, [0, -11.4, -2]));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.5; g.add(mesh(new RoundedBoxGeometry(1.4, 1.1, 0.8, 2, 0.2), dark, [Math.sin(a) * 13.9, -11.4, -2 + Math.cos(a) * 13.9], [0, a, 0])); } // latches
      const pod = at(12.2, 3.5, 1.5); pod.rotation.y = -0.5; g.add(pod); // helmet light + camera pod
      pod.add(mesh(new RoundedBoxGeometry(2.2, 2.6, 2.4, 3, 0.4), mat(0xe9e7e1, { r: 0.6 })));
      const lamp = mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.3, 24), mat(0xfff8e0, { e: 0xfff1c0, ei: 1.5 }), [0, 0.5, 1.25], [Math.PI / 2, 0, 0]); pod.add(lamp);
      const led = mesh(ball(0.2, 10), mat(0xff3b30, { e: 0xff1a10, ei: 1 }), [0.6, -0.8, 1.22]); pod.add(led);
      pod.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.4, 16), dark, [-0.5, -0.7, 1.3], [Math.PI / 2, 0, 0]));
      const patch = canvasTexture(128, 128, (c, w, h) => { c.fillStyle = '#123a8a'; c.beginPath(); c.arc(64, 64, 62, 0, 7); c.fill(); c.strokeStyle = '#e8e8e8'; c.lineWidth = 6; c.stroke();
        c.fillStyle = '#f2f2f2'; for (let i = 0; i < 14; i++) { c.beginPath(); c.arc(20 + Math.random() * 88, 20 + Math.random() * 88, 1.5, 0, 7); c.fill(); }
        c.strokeStyle = '#d8232e'; c.lineWidth = 7; c.beginPath(); c.arc(64, 70, 34, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); });
      g.add(mesh(new THREE.CircleGeometry(1.8, 32), new THREE.MeshStandardMaterial({ map: patch, roughness: 0.8 }), [-6.5, -12.4, 9.2], [-0.7, -0.45, 0]));
      kit.zone(pod, 2.2, { squish: true, burst: 0xff6b6b });
      return (st) => { led.material.emissiveIntensity = (Math.sin(st.t * 5) > 0) ? 1.8 : 0.1; };
    },
  },
  {
    icon: '🌸', name: 'Flowers',
    build(g, kit) {
      const petalCols = [0xf2a7c3, 0xfbf7f2, 0xc9b5ea, 0xf4c3c0];
      for (let i = 0; i < 11; i++) {
        const a = -1.55 + (i / 10) * 3.1;
        const p = new THREE.Vector3(Math.sin(a) * 8.1, 9.2 + Math.cos(a) * 0.3, -2.4 + Math.cos(a) * 7.4);
        const f = at(p.x, p.y, p.z);
        const pm = new THREE.MeshPhysicalMaterial({ color: petalCols[i % 4], roughness: 0.5, sheen: 1, sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide }); // soft, velvety petals
        const petalShape = new THREE.Shape(); petalShape.moveTo(0, 0); petalShape.bezierCurveTo(0.7, 0.4, 0.8, 1.5, 0.1, 1.9); petalShape.lineTo(-0.1, 1.9); petalShape.bezierCurveTo(-0.8, 1.5, -0.7, 0.4, 0, 0);
        const pg = new THREE.ShapeGeometry(petalShape, 12), pp = pg.attributes.position; // cupped, curling at the tip
        for (let q = 0; q < pp.count; q++) { const x = pp.getX(q), y = pp.getY(q); pp.setZ(q, 0.25 * x * x + 0.12 * y * y - 0.05 * y); }
        pg.computeVertexNormals();
        for (let k = 0; k < 5; k++) { const pa = (k / 5) * Math.PI * 2 + i; f.add(mesh(pg, pm, [0, 0, 0], [0, 0, pa - Math.PI / 2], 0.85)); }
        for (let k = 0; k < 12; k++) { const pa = (k / 12) * Math.PI * 2; f.add(mesh(ball(0.08, 6), mat(0xe8b10c, { r: 0.7 }), [Math.cos(pa) * 0.32, Math.sin(pa) * 0.32, 0.25])); } // stamens
        f.add(mesh(ball(0.3, 12), mat(0x8a6a1a, { r: 0.9 }), [0, 0, 0.15], [0, 0, 0], [1, 1, 0.5]));
        f.lookAt(p.clone().add(new THREE.Vector3(Math.sin(a), 0.6, Math.cos(a))));
        f.scale.setScalar(i % 2 ? 0.8 : 1);
        g.add(f);
        const bloom = new THREE.Group();
        bloom.add(...f.children); f.add(bloom);
        kit.zone(bloom, 1.8, { spin: true, axis: 'z', burst: petalCols[i % 4] });
      }
      // two butterflies fluttering around the head
      const flies = [0, 1].map((n) => {
        const b = new THREE.Group();
        const tex = canvasTexture(128, 128, (c, w, h) => { // a cabbage white / a common blue, painted from life
          const shape = (cx, cy, rx, ry) => { c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, 7); };
          c.fillStyle = n ? '#7aa7e8' : '#f6f3ea'; shape(70, 44, 54, 40); c.fill(); shape(60, 98, 38, 28); c.fill();
          c.fillStyle = n ? '#2a3a6a' : '#3a3a3a'; if (n) { c.lineWidth = 6; c.strokeStyle = '#1e2a50'; shape(70, 44, 54, 40); c.stroke(); } else { c.beginPath(); c.arc(112, 18, 14, 0, 7); c.fill(); c.beginPath(); c.arc(78, 52, 6, 0, 7); c.fill(); } });
        const wm = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
        const wings = [-1, 1].map((s) => {
          const w = new THREE.Group();
          w.add(mesh(new THREE.PlaneGeometry(2.6, 2.6), wm, [s * 1.3, -0.1, 0], [0, s < 0 ? Math.PI : 0, 0]));
          b.add(w); return { w, s };
        });
        b.add(mesh(capsule(0.13, 1.6), fur(0x2a2622)));
        g.add(b);
        kit.zone(b, 2.2, { burst: n ? 0x4dabf7 : 0xf783ac });
        return { b, wings, n };
      });
      return (st) => {
        for (const f of flies) {
          const a = st.t * 0.9 + f.n * Math.PI;
          f.b.position.set(Math.sin(a) * 12, 10 + Math.sin(st.t * 2 + f.n) * 2, -3 + Math.cos(a) * 11);
          f.b.rotation.set(-0.6, a + Math.PI / 2, 0);
          for (const w of f.wings) w.w.rotation.y = w.s * Math.sin(st.t * 22 + f.n) * 0.9;
        }
      };
    },
  },
  {
    icon: '😇', name: 'Angel', look: 'brightness(1.06) saturate(1.05)',
    build(g, kit) {
      // A halo of pure light: a thin bright ring with a soft glow around it, gently floating.
      const core = mesh(new THREE.TorusGeometry(5, 0.22, 16, 96), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
      const glowRing = (r, op) => mesh(new THREE.TorusGeometry(5, r, 16, 96), new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
      const halo = at(0, 15.2, -3); halo.rotation.x = Math.PI / 2 - 0.4;
      halo.add(core, glowRing(0.6, 0.35), glowRing(1.2, 0.15), glowRing(2.0, 0.06));
      g.add(halo);
      kit.zone(halo, 5.5, { grab: true, spin: true, burst: 0xffe066 });
      return (st) => { halo.position.y = Math.sin(st.t * 2) * 0.4; }; // (the touch wrapper holds its place: float relative to it)
    },
  },
  {
    icon: '🧙', name: 'Wizard',
    build(g, kit) {
      // A real wizard's hat: worn deep-blue wool felt, tall and crumpled, the tip slumping over, a wide
      // floppy brim, an old leather band with a brass buckle, faded stitched stars.
      const tex = canvasTexture(256, 256, (c, w, h) => {
        c.fillStyle = '#26245a'; c.fillRect(0, 0, w, h);
        if ('filter' in c) c.filter = 'blur(10px)';
        for (let i = 0; i < 30; i++) { c.fillStyle = Math.random() < 0.5 ? 'rgba(70,65,130,.35)' : 'rgba(10,10,30,.35)'; c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 15 + Math.random() * 35, 0, 7); c.fill(); }
        c.filter = 'none'; c.strokeStyle = 'rgba(200,180,120,.45)'; c.lineWidth = 2; // faded embroidered stars
        for (let i = 0; i < 9; i++) { const x = (i * 83) % w, y = (i * 59) % h + 20, r = 9; c.beginPath(); for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5 - Math.PI / 2, rr = k % 2 ? r * 0.4 : r; k ? c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); c.stroke(); }
      });
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      const felt = mat(0xffffff, { map: tex, r: 0.9, double: true });
      const hat = at(0, 9.6, -3);
      hat.rotation.x = -0.12;
      const spine = new THREE.CatmullRomCurve3([[0, 0, 0], [0, 5, 0.3], [0.4, 10, -0.4], [1.6, 14, -1.2], [4.4, 16.2, -1.6], [6.6, 15.4, -1]].map((q) => new THREE.Vector3(...q)));
      const body = new THREE.TubeGeometry(spine, 90, 1, 40), bp = body.attributes.position, c3 = new THREE.Vector3();
      for (let i = 0; i < bp.count; i++) { const t = Math.floor(i / 41) / 90; spine.getPointAt(Math.min(1, t), c3);
        const crumple = 1 - 0.07 * Math.exp(-Math.pow((t - 0.45) / 0.04, 2)) - 0.06 * Math.exp(-Math.pow((t - 0.66) / 0.04, 2)) + 0.03 * Math.sin(i * 0.9) * t;
        const r = (6.6 * Math.pow(1 - t, 1.05) + 0.15) * crumple; bp.setXYZ(i, c3.x + (bp.getX(i) - c3.x) * r, c3.y + (bp.getY(i) - c3.y) * r, c3.z + (bp.getZ(i) - c3.z) * r * 1.1); }
      body.computeVertexNormals();
      hat.add(mesh(body, felt));
      const brim = new THREE.RingGeometry(6.4, 14, 120, 8), rp = brim.attributes.position;
      for (let i = 0; i < rp.count; i++) { const x = rp.getX(i), z = rp.getY(i) * 1.1, r = Math.hypot(x, rp.getY(i)), a = Math.atan2(rp.getY(i), x), k = (r - 6.4) / 7.6;
        rp.setXYZ(i, x, -1.8 * k * k + 0.7 * Math.sin(a * 4 + 1) * k * k, z); }
      brim.computeVertexNormals();
      hat.add(mesh(brim, felt, [0, 0.4, 0]));
      const leatherBand = new THREE.CylinderGeometry(6.55, 6.62, 1.3, 72, 1, true); leatherBand.scale(1, 1, 1.1);
      hat.add(mesh(leatherBand, mat(0x4a2e1a, { r: 0.6, double: true }), [0, 1.2, 0]));
      const brass = mat(0xa8863e, { m: 1, r: 0.4 }), buckle = at(0, 1.2, 7.25);
      for (const [x, y, w2, h2] of [[0, 0.62, 1.8, 0.2], [0, -0.62, 1.8, 0.2], [-0.8, 0, 0.2, 1.44], [0.8, 0, 0.2, 1.44]]) buckle.add(mesh(new THREE.BoxGeometry(w2, h2, 0.15), brass, [x, y, 0]));
      hat.add(buckle);
      g.add(hat);
      kit.zone(hat, 8, { grab: true, spin: true, burst: 0xb197fc });
    },
  },
  {
    icon: '🏴‍☠️', name: 'Pirate',
    build(g, kit) {
      // A weathered black tricorn hat with gold braid edging, a red silk bandana knotted under it,
      // a leather eye patch with its cord, and a gold hoop earring.
      const felt = mat(0x1a1716, { r: 0.85, double: true });
      const hat = at(0, 9.4, -3.2); hat.rotation.x = -0.1; g.add(hat);
      hat.add(mesh(new THREE.SphereGeometry(7.2, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), felt, [0, 0, 0], [0, 0, 0], [1, 0.75, 1.1]));
      const brim = new THREE.RingGeometry(6.8, 13.5, 3 * 48, 6), rp = brim.attributes.position; // three sides turned up into points
      for (let i = 0; i < rp.count; i++) { const x = rp.getX(i), y = rp.getY(i), r = Math.hypot(x, y), a = Math.atan2(y, x), k = (r - 6.8) / 6.7;
        const tri = 0.5 + 0.5 * Math.cos(3 * (a - Math.PI / 2)); const reach = 0.75 + 0.25 * tri;
        rp.setXYZ(i, x * reach, k * (4.2 - 1.2 * tri), y * reach * 1.1); }
      brim.computeVertexNormals();
      hat.add(mesh(brim, felt, [0, 0.2, 0]));
      const edge = []; for (let i = 0; i <= 240; i++) { const a = (i / 240) * Math.PI * 2, tri = 0.5 + 0.5 * Math.cos(3 * (a - Math.PI / 2)), reach = 0.75 + 0.25 * tri; edge.push(new THREE.Vector3(Math.cos(a) * 13.5 * reach, 0.2 + 4.2 - 1.2 * tri, Math.sin(a) * 13.5 * reach * 1.1)); }
      hat.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge, true), 480, 0.22, 6, true), mat(0xc9a14a, { m: 0.9, r: 0.4 }))); // gold braid
      const silk = new THREE.MeshPhysicalMaterial({ color: 0x8e1b20, roughness: 0.4, sheen: 1, sheenColor: new THREE.Color(0xff6a6a), side: THREE.DoubleSide });
      const band = new THREE.CylinderGeometry(8.4, 8.6, 2.2, 72, 1, true); band.scale(1, 1, 1.12);
      g.add(mesh(band, silk, [0, 7.6, -3.4], [-0.15, 0, 0]));
      g.add(mesh(ball(1.3, 16), silk, [6.4, 7.2, -8.6]), mesh(capsule(0.9, 3.2), silk, [7.2, 4.8, -9.4], [0.3, 0, 0.5]), mesh(capsule(0.8, 2.6), silk, [5.6, 4.6, -9.6], [0.2, 0, -0.4])); // knot and tails
      const leather = new THREE.MeshPhysicalMaterial({ color: 0x1c1512, roughness: 0.55, clearcoat: 0.3 });
      const ps = new THREE.Shape(); ps.moveTo(-2.1, 0.9); ps.quadraticCurveTo(0, 2.1, 2.1, 0.9); ps.quadraticCurveTo(2.2, -1.6, 0, -2.0); ps.quadraticCurveTo(-2.2, -1.6, -2.1, 0.9);
      const patch = mesh(new THREE.ExtrudeGeometry(ps, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 3 }), leather, [-3.4, 2.9, 6.1], [0, -0.12, 0]);
      g.add(patch);
      kit.zone(patch, 2.5, { squish: true });
      g.add(mesh(new THREE.TorusGeometry(9.1, 0.09, 6, 80), leather, [0, 4.6, -2.6], [Math.PI / 2 + 0.15, 0, -0.32])); // the cord
      const ring = mesh(new THREE.TorusGeometry(0.9, 0.12, 12, 40), mat(0xd4a43a, { m: 1, r: 0.25 }), [7.9, -1.8, -2.6], [0, Math.PI / 2, 0]);
      g.add(ring);
      kit.zone(ring, 1.8, { spin: true, burst: 0xffd43b });
    },
  },
  {
    icon: '🪖', name: 'Viking',
    build(g, kit) {
      // A real Norse spangenhelm: riveted iron plates over a dark, slightly rusted skull cap, a nasal guard
      // down over the nose, a brow band; (and, because everyone expects them, a pair of curved horns).
      const ironTex = canvasTexture(256, 256, (c, w, h) => { c.fillStyle = '#5c5f63'; c.fillRect(0, 0, w, h); if ('filter' in c) c.filter = 'blur(8px)';
        for (let i = 0; i < 28; i++) { c.fillStyle = Math.random() < 0.6 ? 'rgba(110,70,40,.35)' : 'rgba(150,155,160,.35)'; c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 10 + Math.random() * 30, 0, 7); c.fill(); } });
      const iron = mat(0xffffff, { m: 0.8, r: 0.5, map: ironTex });
      const helm = at(0, 5.3, -3.2);
      helm.add(mesh(new THREE.SphereGeometry(9, 64, 28, 0, Math.PI * 2, 0, Math.PI / 2), iron, [0, 0, 0], [0, 0, 0], [1, 1.02, 1.08]));
      const bandM = mat(0x6b6e72, { m: 0.85, r: 0.4 }), rivet = mat(0x8a8d91, { m: 0.9, r: 0.35 });
      helm.add(mesh(new THREE.TorusGeometry(9.05, 0.55, 12, 96), bandM, [0, 0.4, 0], [Math.PI / 2, 0, 0], [1, 1.08, 1.6]));
      for (const rot of [0, Math.PI / 2]) { const strap = new THREE.TorusGeometry(9.1, 0.35, 8, 64, Math.PI); strap.scale(1, 1.02, 1); helm.add(mesh(strap, bandM, [0, 0, 0], [0, rot, 0], [1, 1, 1.08])); }
      for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; helm.add(mesh(ball(0.28, 8), rivet, [Math.sin(a) * 9.35, 0.4, Math.cos(a) * 9.35 * 1.08])); }
      helm.add(mesh(new RoundedBoxGeometry(1.4, 5.2, 0.5, 3, 0.2), bandM, [0, -1.5, 9.5], [0.12, 0, 0])); // nasal guard
      const hornTex = canvasTexture(64, 256, (c, w, h) => { const gr = c.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, '#d9ccb0'); gr.addColorStop(0.75, '#b8a580'); gr.addColorStop(1, '#4a3a28'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
        if ('filter' in c) c.filter = 'blur(1.5px)'; for (let y = 6; y < h; y += 13) { c.fillStyle = 'rgba(80,60,35,.25)'; c.fillRect(0, y, w, 3); } });
      const hornM = new THREE.MeshPhysicalMaterial({ map: hornTex, roughness: 0.45, clearcoat: 0.3 });
      for (const s of [-1, 1]) {
        const curve = new THREE.CatmullRomCurve3([[s * 8, 3.2, 0], [s * 11.5, 5, 0.5], [s * 13, 9, 1], [s * 12, 12.5, 2]].map((q) => new THREE.Vector3(...q)));
        const geo = new THREE.TubeGeometry(curve, 60, 1, 18), hp = geo.attributes.position, c3 = new THREE.Vector3();
        for (let i = 0; i < hp.count; i++) { const t = Math.floor(i / 19) / 60; curve.getPointAt(Math.min(1, t), c3); const r = 1.9 * Math.pow(1 - t, 0.85) * (1 + 0.05 * Math.sin(t * 70)) + 0.04; hp.setXYZ(i, c3.x + (hp.getX(i) - c3.x) * r, c3.y + (hp.getY(i) - c3.y) * r, c3.z + (hp.getZ(i) - c3.z) * r); }
        const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), 1 - uv.getX(i));
        geo.computeVertexNormals(); helm.add(mesh(geo, hornM));
      }
      g.add(helm);
      kit.zone(helm, 9, { grab: true, squish: true, burst: 0xffffff });
    },
  },
  {
    icon: '🥳', name: 'Party', confetti: true,
    build(g, kit) {
      // A real paper party hat: shiny printed card in stripes, a seam up the back, a metallic foil tinsel
      // pom-pom on top and a thin elastic under the chin.
      const tex = canvasTexture(256, 256, (c, w, h) => {
        const cols = ['#2a6fd1', '#d8233e', '#f2b705', '#2a9d4a'];
        for (let i = 0; i < 8; i++) { c.fillStyle = cols[i % 4]; c.save(); c.translate(w / 2, h / 2); c.rotate(0.5); c.fillRect(-w, -h + i * h / 4, w * 2, h / 8 + 1); c.restore(); }
        c.fillStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i < 26; i++) { c.beginPath(); c.arc((i * 53) % w, (i * 37) % h, 4, 0, 7); c.fill(); }
      });
      const card = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2, side: THREE.DoubleSide });
      const hat = at(2.8, 12, -1.5);
      hat.rotation.z = -0.32;
      hat.add(mesh(new THREE.ConeGeometry(3.8, 10, 64, 1, true), card, [0, 4.5, 0]));
      hat.add(mesh(new THREE.BoxGeometry(0.06, 10.4, 0.12), mat(0xf4f0e6, { r: 0.6 }), [0, 4.5, -1.9], [0.36, 0, 0])); // the glued seam
      const foil = new THREE.MeshPhysicalMaterial({ color: 0xd9b23a, metalness: 1, roughness: 0.22, iridescence: 0.5 });
      const pom = at(0, 9.7, 0); hat.add(pom);
      for (let i = 0; i < 70; i++) { const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize(); // tinsel strands
        const strand = mesh(new THREE.BoxGeometry(0.05, 1.4, 0.18), foil); strand.position.copy(d.clone().multiplyScalar(0.7)); strand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); pom.add(strand); }
      g.add(hat);
      kit.zone(hat, 4.5, { grab: true, spin: true, burst: 0xff4d6d });
      return (st) => { hat.rotation.x = Math.sin(st.t * 3) * 0.05; pom.rotation.y = st.t * 0.6; };
    },
  },
  {
    icon: '😍', name: 'Love',
    // Love-struck eyes: your pupils glow with a soft rosy light and heart-shaped catchlights.
    face(c, f, t = 0) {
      const P = f.P, W = f.w;
      c.save();
      for (const [ci, e1, e2] of [[468, 469, 471], [473, 474, 476]]) {
        try { const cc = P(ci), r = Math.hypot(P(e1).x - P(e2).x, P(e1).y - P(e2).y) * 0.5; if (!(r > 0)) continue;
          const beat = 1 + Math.max(0, Math.sin(t * 7)) * 0.15, x = cc.x - r * 0.2, y = cc.y - r * 0.2, s2 = r * 0.6 * beat;
          const gr = c.createRadialGradient(cc.x, cc.y, 0, cc.x, cc.y, r * 1.1); gr.addColorStop(0, 'rgba(255,90,140,.45)'); gr.addColorStop(1, 'rgba(255,90,140,0)');
          c.fillStyle = gr; c.beginPath(); c.arc(cc.x, cc.y, r * 1.1, 0, 7); c.fill();
          c.fillStyle = 'rgba(255,235,240,.95)'; c.beginPath(); c.moveTo(x, y + s2 * 0.35); // a little heart of light
          c.bezierCurveTo(x - s2 * 0.6, y - s2 * 0.1, x - s2 * 0.3, y - s2 * 0.6, x, y - s2 * 0.25); c.bezierCurveTo(x + s2 * 0.3, y - s2 * 0.6, x + s2 * 0.6, y - s2 * 0.1, x, y + s2 * 0.35); c.fill(); } catch {}
      }
      c.restore();
    },
    build(g, kit) {
      // glass hearts floating round your head, catching the light
      for (const s of [-1, 1]) { const e = at(s * 3.3, 2.9, 6.0); g.add(e); kit.zone(e, 2.2, { squish: true, burst: 0xff6fa8 }); }
      const ring = new THREE.Group();
      ring.position.set(0, 9, -3);
      const glass = new THREE.MeshPhysicalMaterial({ color: 0xff4d80, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.8, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 2.2 });
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ring.add(mesh(heartGeometry(1.1, 0.5), glass, [Math.sin(a) * 10, 0, Math.cos(a) * 10])); }
      g.add(ring);
      return (st) => {
        ring.rotation.y = st.t * 0.8;
        ring.children.forEach((h, i) => { h.rotation.y = -ring.rotation.y; h.position.y = Math.sin(st.t * 2 + i) * 0.8; });
      };
    },
  },
];

// Building blocks shared with filters-more.js (THREE is filled in once createStage3D has loaded it).
export { THREE, RoundedBoxGeometry, mat, mesh, ball, capsule, cone, at, fur, gloss, gold, beadHorn, whiskers, Wobble, emit, glow, parts, canvasTexture, heartGeometry, clamp, lerp,
  earGeometry, tongueGeometry, tongueMat, animalNose, catNose, realWhiskers, catTongue };
