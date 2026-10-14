// 3D face filters for Silly Cam.
//
// MediaPipe gives a 4x4 "facial transformation matrix" for every face: it moves
// points from its canonical face model (centimetres, y up, z out of the face,
// nose tip ≈ (0, -0.5, 7.6), forehead ≈ (0, 8.3, 4.5), chin ≈ (0, -9.4, 4.3),
// face edges ≈ (±7.7, 0.7, -2.4)) into camera space. We put a Three.js group
// on that matrix, so anything placed in canonical coordinates sticks to the head.

import { FACE_POSITIONS, FACE_INDICES } from './facemesh.js';

const V = '0.160.0';
let THREE, RoundedBoxGeometry;

const FOV = 63; // vertical field of view MediaPipe assumes when solving the pose
const TAN = Math.tan((FOV / 2) * Math.PI / 180);

export async function createStage3D(canvas, opts = {}) {
  THREE = await import('three'); // mapped to the CDN build by the import map in index.html
  ({ RoundedBoxGeometry } = await import(`https://cdn.jsdelivr.net/npm/three@${V}/examples/jsm/geometries/RoundedBoxGeometry.js`));

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' }); // smooth edges: jagged ones shimmer like grain
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; // hats, glasses and ears cast soft shadows on your face
  renderer.shadowMap.type = THREE.VSMShadowMap; // soft-edged, like shadows from room lights

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.3, 1, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 160 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 14; sun.shadow.blurSamples = 16;
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
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w * h > 1.5e6 ? 1.25 : 1.5));
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
      h.track(mats[i].data, shapes[i]?.categories, dt, cover, result.ts ?? null);
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
  // The tracker's answer is always a little old (about 50-100 ms by the time it's drawn). So the filter is drawn
  // a little further along the way your head is moving, by about that much, and stays right on your face
  // instead of trailing behind. Holding still (or a hand on your face) adds nothing.
  function placeAnchor(ts, steady) {
    const ahead = steady || ts == null ? 0 : clamp((performance.now() - ts) / 1000 + 0.02, 0, 0.12);
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
    track(data, cats, dt, cover = null, ts = null) {
      const steady = !!cover?.any;
      lost = 0;
      // The picture is drawn more often than the tracker answers. Only a new answer moves the filter;
      // feeding the same answer in again and again made it go "stop, jump, stop".
      if (data === lastData) return placeAnchor(lastTs, steady); // no new answer: just keep looking ahead
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
      placeAnchor(ts, steady);
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
const FUR_SHELLS = 10, FUR_LEN = 0.3; // centimetres
function makeReal(group) {
  const furry = [];
  group.traverse((o) => {
    if (!o.isMesh || o.userData.shell) return;
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
      const brown = fur(0x7b4a2a), tan = fur(0xd8a878);
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
      const red = gloss(0xe03131, { r: 0.4 });
      for (const s of [-1, 1]) bow.add(mesh(cone(1.6, 3, 24), red, [s * 1.5, 0, 0], [0, 0, s * Math.PI / 2], [1, 1, 0.5]));
      bow.add(mesh(ball(0.9), red));
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
    icon: '👑', name: 'Royal', sparkle: true,
    build(g, kit) {
      const crown = at(0, 11.2, -2.8);
      crown.rotation.x = -0.12;
      const metal = gold();
      crown.add(mesh(new THREE.CylinderGeometry(6.3, 6.7, 2.8, 64, 1, true), mat(0xffc93c, { m: 1, r: 0.22, double: true })));
      const gems = [0xe03131, 0x1c7ed6, 0x2f9e44, 0xae3ec9];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const x = Math.sin(a) * 6.5, z = Math.cos(a) * 6.5;
        crown.add(mesh(cone(1, 3.4, 24), metal, [x, 2.9, z]));
        crown.add(mesh(ball(0.6), gloss(0xfff3d6, { r: 0.1, ir: 1 }), [x, 4.7, z]));
        crown.add(mesh(ball(0.75), gloss(gems[i % 4], { r: 0.05 }), [Math.sin(a) * 6.75, 0, Math.cos(a) * 6.75], [0, 0, 0], [1, 1, 0.6]));
      }
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
      const frame = gloss(0x111111, { r: 0.3 });
      const shades = at(0, 2.9, 6.3);
      for (const s of [-1, 1]) {
        shades.add(mesh(new RoundedBoxGeometry(5.8, 3.9, 0.45, 4, 0.9), lens, [s * 3.4, 0, 0], [0.05, s * 0.12, 0]));
        shades.add(mesh(new THREE.BoxGeometry(0.35, 0.35, 10.5), frame, [s * 7.2, 0.7, -5.1], [0, s * 0.05, 0]));
      }
      shades.add(mesh(new THREE.BoxGeometry(1.6, 0.45, 0.45), frame, [0, 0.9, 0.4]));
      g.add(shades);
      kit.zone(shades, 5, { grab: true, squish: true, burst: 0x74c0fc });
    },
  },
  {
    icon: '🤡', name: 'Clown', cheeks: true,
    build(g, kit) {
      const nose = mesh(ball(1.9), gloss(0xe8172f), [0, -0.6, 8.5]);
      g.add(nose);
      kit.zone(nose, 2.2, { squish: true, burst: 0xff4d6d }); // honk!
      const spots = [];
      const n = 140;
      for (let i = 0; i < n; i++) {
        // spread puffs over the top/sides of a sphere around the head, leaving the face clear
        const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996;
        const p = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
        if (p.y < 0.05 || (p.z > 0.25 && p.y < 0.6)) continue;
        spots.push(p);
      }
      const hair = new THREE.InstancedMesh(ball(2.4, 12), mat(0xffffff, { r: 0.9 }), spots.length);
      const m4 = new THREE.Matrix4();
      spots.forEach((p, i) => {
        hair.setMatrixAt(i, m4.makeTranslation(p.x * 9.5, 3.5 + p.y * 8, -3 + p.z * 9));
        hair.setColorAt(i, new THREE.Color().setHSL(((Math.atan2(p.x, p.z) / Math.PI + 1) / 2 + p.y * 0.3) % 1, 0.85, 0.58));
      });
      g.add(hair);
      return (st) => { hair.scale.setScalar(1 + Math.sin(st.t * 6) * 0.015); };
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
      const nose = mesh(ball(2), mat(0xf2b8a0, { r: 0.55, cc: 0.2 }), [0, -0.4, 8.4], [0, 0, 0], [0.95, 1.35, 1.1]);
      g.add(nose);
      kit.zone(nose, 2.4, { squish: true });
      const brows = [-1, 1].map((s) => { const b = mesh(capsule(0.6, 3.2), hair, [s * 3.3, 6, 6.2], [0, 0, Math.PI / 2 + s * 0.12]); g.add(b); return b; });
      for (const s of [-1, 1]) g.add(mesh(capsule(0.9, 3.6), hair, [s * 2.1, -3, 7.8], [0, 0, Math.PI / 2 - s * 0.35]));
      return (st) => { const lift = st.b('browInnerUp') * 1.8; for (const b of brows) b.position.y = 6 + lift; };
    },
  },
  {
    icon: '🦄', name: 'Unicorn', sparkle: true, look: (t) => `hue-rotate(${Math.sin(t) * 20}deg) saturate(1.35)`,
    build(g, kit) {
      const horn = at(0, 10.8, 3.6);
      horn.rotation.x = 0.38;
      const twirl = new THREE.Group();
      horn.add(twirl);
      twirl.add(mesh(cone(1.45, 9, 48), mat(0xfff0fa, { r: 0.15, ir: 1, cc: 1 }), [0, 4.3, 0]));
      const pts = [];
      for (let i = 0; i <= 80; i++) { const k = i / 80, a = k * Math.PI * 7, r = 1.5 * (1 - k) + 0.1; pts.push(new THREE.Vector3(Math.cos(a) * r, k * 8.4, Math.sin(a) * r)); }
      twirl.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 200, 0.2, 8), gold()));
      g.add(horn);
      kit.zone(twirl, 4.5, { spin: true, burst: 0xf783ac });
      // flower crown of little pastel puffs
      const colors = [0xffa8d8, 0xb197fc, 0x99e9f2, 0xfff3bf];
      for (let i = 0; i < 9; i++) {
        const a = -1.25 + (i / 8) * 2.5;
        g.add(mesh(ball(1.1, 20), fur(colors[i % 4]), [Math.sin(a) * 7.6, 9 + Math.cos(a) * 0.4, -2.5 + Math.cos(a) * 7.2]));
      }
    },
  },
  {
    icon: '👽', name: 'Alien', look: 'hue-rotate(85deg) saturate(1.7)',
    build(g, kit) {
      const stalk = gloss(0x37b24d, { r: 0.3 }), tip = mat(0x8ce99a, { e: 0x51cf66, ei: 0.8, cc: 1, r: 0.1 });
      const ants = [-1, 1].map((s) => {
        const pivot = at(s * 2.6, 8.8, 0);
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.4, 4, 0), new THREE.Vector3(s * 2.8, 7.5, 0.5));
        pivot.add(mesh(new THREE.TubeGeometry(curve, 30, 0.32, 10), stalk));
        const knob = mesh(ball(1.3), tip, [s * 2.8, 7.8, 0.5]);
        pivot.add(knob);
        g.add(pivot);
        const w = new Wobble(30, 2.2, 0.0012);
        kit.zone(knob, 2, { wobble: w, burst: 0x8ce99a });
        return { pivot, s, w };
      });
      return (st) => { for (const a of ants) { a.w.step(st); a.pivot.rotation.set(a.w.y * 0.7, 0, a.w.x * 0.9); } };
    },
  },
  {
    icon: '🐲', name: 'Dragon',
    build(g, kit) {
      const horn = mat(0xe9d8a6, { r: 0.45 });
      for (const s of [-1, 1]) g.add(beadHorn([[s * 4.2, 9.5, -0.5], [s * 5.2, 12.5, -2], [s * 6.5, 14.5, -4.5]], 1.4, 0.25, horn, 14));
      for (let i = 0; i < 4; i++) g.add(mesh(cone(0.9 - i * 0.12, 2.4 - i * 0.3, 20), mat(0x2f9e44, { r: 0.4 }), [0, 11.2 - i * 0.6, 1 - i * 3], [-0.5 - i * 0.3, 0, 0]));
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
      const bubbleMat = mat(0xffffff, { r: 0, cc: 1, ir: 1, op: 0.35, dw: false });
      const geo = ball(1, 32);
      let carry = 0;
      const nose = mesh(ball(1.1), gloss(0x74c0fc, { ir: 1, op: 0.6 }), [0, -0.5, 8.4]); // little bubble nose
      g.add(nose);
      kit.zone(nose, 1.4, { squish: true, burst: 0x74c0fc });
      return (st) => {
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
      g.add(mesh(ball(14.5, 64), mat(0xdbeeff, { r: 0, cc: 1, op: 0.16, dw: false, ir: 0.4 }), [0, 0.5, -2]));
      const white = mat(0xf8f9fa, { r: 0.5, cc: 0.3 });
      g.add(mesh(new THREE.TorusGeometry(11.5, 2, 20, 64), white, [0, -12.5, -2], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.TorusGeometry(11.6, 0.5, 12, 64), gloss(0x868e96, { m: 0.8 }), [0, -11.4, -2], [Math.PI / 2, 0, 0]));
      // little NASA-ish light on the side
      const light = mesh(ball(0.9), mat(0xff6b6b, { e: 0xff0000, ei: 1 }), [11.5, 4, 4]);
      g.add(light);
      kit.zone(light, 2.2, { squish: true, burst: 0xff6b6b });
      return (st) => { light.material.emissiveIntensity = (Math.sin(st.t * 5) > 0) ? 1.5 : 0.1; };
    },
  },
  {
    icon: '🌸', name: 'Flowers',
    build(g, kit) {
      const petalCols = [0xffa8d8, 0xffffff, 0xd0bfff, 0xffc9c9];
      for (let i = 0; i < 11; i++) {
        const a = -1.55 + (i / 10) * 3.1;
        const p = new THREE.Vector3(Math.sin(a) * 8.1, 9.2 + Math.cos(a) * 0.3, -2.4 + Math.cos(a) * 7.4);
        const f = at(p.x, p.y, p.z);
        const pm = mat(petalCols[i % 4], { r: 0.55 }); // soft, slightly waxy petals
        for (let k = 0; k < 6; k++) {
          const pa = (k / 6) * Math.PI * 2;
          f.add(mesh(ball(1, 16), pm, [Math.cos(pa) * 1.15, Math.sin(pa) * 1.15, 0], [0, 0, pa], [1.15, 0.7, 0.35]));
        }
        f.add(mesh(ball(0.65, 16), gloss(0xffd43b, { r: 0.5 }), [0, 0, 0.3], [0, 0, 0], [1, 1, 0.6]));
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
        const wm = mat(n ? 0x4dabf7 : 0xf783ac, { r: 0.4, double: true, ir: 0.8 });
        const wings = [-1, 1].map((s) => {
          const w = new THREE.Group();
          w.add(mesh(new THREE.CircleGeometry(1.4, 24), wm, [s * 1.3, 0.5, 0], [0, 0, 0], [1, 1.25, 1]));
          w.add(mesh(new THREE.CircleGeometry(0.9, 24), wm, [s * 1, -0.9, 0]));
          b.add(w); return { w, s };
        });
        b.add(mesh(capsule(0.22, 1.8), gloss(0x222222)));
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
    icon: '😇', name: 'Angel', sparkle: true, look: 'brightness(1.1) saturate(1.1)',
    build(g, kit) {
      const halo = mesh(new THREE.TorusGeometry(5, 0.6, 20, 64), mat(0xffe066, { e: 0xffd43b, ei: 1.2, m: 0.5, r: 0.2 }), [0, 15, -2], [Math.PI / 2 - 0.3, 0, 0]);
      g.add(halo);
      kit.zone(halo, 5.5, { grab: true, spin: true, burst: 0xffe066 });
      return (st) => { halo.position.y = 15 + Math.sin(st.t * 2) * 0.6; halo.rotation.z = st.t; };
    },
  },
  {
    icon: '🧙', name: 'Wizard', sparkle: true,
    build(g, kit) {
      const tex = canvasTexture(256, 256, (c, w, h) => {
        c.fillStyle = '#3b2c85'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#ffe066'; c.font = '40px serif';
        for (let i = 0; i < 18; i++) c.fillText(i % 3 ? '★' : '☾', (i * 67) % w, (i * 41) % h + 20);
      });
      const hat = at(0, 9.6, -3);
      hat.rotation.x = -0.12;
      hat.add(mesh(cone(6.4, 13, 64), mat(0xffffff, { map: tex, r: 0.75, cc: 0 }), [0, 7, 0]));
      hat.add(mesh(new THREE.CylinderGeometry(11.5, 11.5, 0.5, 64), mat(0x3b2c85, { r: 0.8, cc: 0 }), [0, 0.6, 0]));
      hat.add(mesh(new THREE.TorusGeometry(6.2, 0.55, 12, 64), gold(), [0, 1.2, 0], [Math.PI / 2, 0, 0]));
      const tip = mesh(ball(0.8), mat(0xfff3bf, { e: 0xffe066, ei: 1 }), [0, 13.6, 0]);
      hat.add(tip);
      g.add(hat);
      kit.zone(hat, 8, { grab: true, spin: true, burst: 0xb197fc });
      return (st) => { tip.material.emissiveIntensity = 0.6 + Math.sin(st.t * 6) * 0.5; };
    },
  },
  {
    icon: '🏴‍☠️', name: 'Pirate',
    build(g, kit) {
      const tex = canvasTexture(256, 128, (c, w, h) => {
        c.fillStyle = '#d6203a'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#fff';
        for (let y = 8; y < h; y += 26) for (let x = (y / 26 % 2) * 13; x < w; x += 26) { c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill(); }
      });
      g.add(mesh(new THREE.SphereGeometry(8.9, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.42), mat(0xffffff, { map: tex, r: 0.8, cc: 0 }), [0, 4, -3.4], [-0.25, 0, 0], [1, 1.05, 1.08]));
      const red = mat(0xd6203a, { r: 0.8, cc: 0 });
      g.add(mesh(ball(1.6), red, [6.5, 8, -7]), mesh(capsule(1, 3.5), red, [7.6, 5.5, -8], [0.3, 0, 0.5]));
      const black = mat(0x111111, { r: 0.6, cc: 0.2 });
      const patch = mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.5, 32), black, [-3.4, 2.9, 6], [Math.PI / 2, 0, 0]);
      g.add(patch);
      kit.zone(patch, 2.5, { squish: true });
      g.add(mesh(new THREE.TorusGeometry(9.1, 0.18, 8, 80), black, [0, 4.6, -2.6], [Math.PI / 2 + 0.15, 0, -0.32]));
      const ring = mesh(new THREE.TorusGeometry(0.9, 0.18, 12, 32), gold(), [7.9, -1.8, -2.6], [0, Math.PI / 2, 0]);
      g.add(ring);
      kit.zone(ring, 1.8, { spin: true, burst: 0xffd43b });
    },
  },
  {
    icon: '🪖', name: 'Viking',
    build(g, kit) {
      const steel = mat(0xadb5bd, { m: 0.85, r: 0.3 });
      const helm = at(0, 5.3, -3.2);
      helm.add(mesh(new THREE.SphereGeometry(9, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), steel, [0, 0, 0], [0, 0, 0], [1, 0.95, 1.08]));
      helm.add(mesh(new THREE.TorusGeometry(9, 0.75, 16, 80), gold(), [0, 0.2, 0], [Math.PI / 2, 0, 0], [1, 1.08, 1]));
      helm.add(mesh(new THREE.BoxGeometry(1.2, 0.8, 9.4), gold(), [0, 8.4, 0.6], [-0.05, 0, 0]));
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; helm.add(mesh(ball(0.35), gold(), [Math.sin(a) * 9.15, 0.3, Math.cos(a) * 9.7])); }
      const ivory = mat(0xfff4e0, { r: 0.35, cc: 0.6 });
      for (const s of [-1, 1]) helm.add(beadHorn([[s * 8, 3.2, 0], [s * 11.5, 5, 0.5], [s * 13, 9, 1], [s * 12, 12.5, 2]], 1.9, 0.35, ivory, 22));
      g.add(helm);
      kit.zone(helm, 9, { grab: true, squish: true, burst: 0xffffff });
    },
  },
  {
    icon: '🥳', name: 'Party', confetti: true,
    build(g, kit) {
      const tex = canvasTexture(256, 256, (c, w, h) => {
        const cols = ['#4dabf7', '#ff4d6d', '#ffd43b', '#51cf66', '#cc5de8'];
        for (let i = 0; i < 10; i++) { c.fillStyle = cols[i % 5]; c.fillRect(0, i * h / 10, w, h / 10 + 1); }
        c.fillStyle = 'rgba(255,255,255,.9)';
        for (let i = 0; i < 30; i++) { c.beginPath(); c.arc((i * 53) % w, (i * 37) % h, 6, 0, 7); c.fill(); }
      });
      const hat = at(2.8, 12, -1.5);
      hat.rotation.z = -0.32;
      hat.add(mesh(cone(3.8, 10, 48), mat(0xffffff, { map: tex, r: 0.5, cc: 0.4 }), [0, 4.5, 0]));
      hat.add(mesh(ball(1.3, 20), fur(0xffd43b), [0, 9.8, 0]));
      hat.add(mesh(new THREE.TorusGeometry(3.7, 0.55, 12, 48), fur(0xff4d6d), [0, -0.4, 0], [Math.PI / 2, 0, 0]));
      g.add(hat);
      kit.zone(hat, 4.5, { grab: true, spin: true, burst: 0xff4d6d });
      return (st) => { hat.rotation.x = Math.sin(st.t * 3) * 0.05; };
    },
  },
  {
    icon: '😍', name: 'Love', hearts: true,
    build(g, kit) {
      const red = gloss(0xff1744, { r: 0.2 });
      const eyes = [-1, 1].map((s) => { const h = mesh(heartGeometry(1.9, 0.5), red, [s * 3.3, 2.9, 6.6]); g.add(h); kit.zone(h, 2.2, { squish: true, burst: 0xff6fa8 }); return h; });
      const ring = new THREE.Group();
      ring.position.set(0, 9, -3);
      const pink = gloss(0xff6fa8, { r: 0.25 });
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ring.add(mesh(heartGeometry(1.1, 0.4), pink, [Math.sin(a) * 10, 0, Math.cos(a) * 10])); }
      g.add(ring);
      return (st) => {
        const beat = 1 + Math.max(0, Math.sin(st.t * 7)) * 0.18;
        for (const e of eyes) e.scale.setScalar(beat);
        ring.rotation.y = st.t * 0.8;
        ring.children.forEach((h, i) => { h.rotation.y = -ring.rotation.y; h.position.y = Math.sin(st.t * 2 + i) * 0.8; });
      };
    },
  },
];

// Building blocks shared with filters-more.js (THREE is filled in once createStage3D has loaded it).
export { THREE, RoundedBoxGeometry, mat, mesh, ball, capsule, cone, at, fur, gloss, gold, beadHorn, whiskers, Wobble, emit, glow, parts, canvasTexture, heartGeometry, clamp, lerp,
  earGeometry, tongueGeometry, tongueMat, animalNose, catNose, realWhiskers, catTongue };
