// Face tracking for Silly Cam, in a background worker, so looking for faces never holds up the
// camera picture or the filters. Everything stays on this device: the page sends a small copy of
// each camera frame here and gets back where the faces are.
// Hands get a worker of their own (role 'hands'): with a hand tracker in the face worker, the face trackers
// stopped finding faces. On the page, looking for hands held up the picture for up to ~28 ms.
//
// The page runs two of these: one ("main") follows the faces every frame, the other ("finders")
// looks for small faces in picture slices for group shots, so neither one waits for the other.
//
// Messages in:  { type: 'init', V, role: 'main' | 'finders' | 'both' | 'hands' }
//               { type: 'frame', ts, track?: ImageBitmap, slice?: { i, bitmap } }
//               { type: 'hands', ts, bitmap }
// Messages out: { type: 'ready', what: 'faces' | 'finders' | 'hands' }
//               { type: 'result', ts, main?, slice?: { i, result }, ms }
//               { type: 'hands', ts, result, ms }
//               { type: 'failed', error }

let faces = null, finders = [], hands = null;

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') return init(msg.V, msg.role || 'both');
  if (msg.type === 'hands') {
    const start = performance.now(), out = { type: 'hands', ts: msg.ts };
    try { out.result = hands.detectForVideo(msg.bitmap, msg.ts); } catch (err) { out.result = null; out.error = String(err); }
    finally { msg.bitmap.close?.(); }
    out.ms = performance.now() - start;
    return self.postMessage(out);
  }
  if (msg.type !== 'frame') return;
  const start = performance.now();
  const out = { type: 'result', ts: msg.ts };
  try {
    if (msg.track) out.main = faces.detectForVideo(msg.track, msg.ts);
    if (msg.slice && finders[msg.slice.i]) {
      try { out.slice = { i: msg.slice.i, result: finders[msg.slice.i].detectForVideo(msg.slice.bitmap, msg.ts) }; }
      catch { out.slice = { i: msg.slice.i, result: null }; }
    }
  } catch (err) {
    out.main = null; out.error = String(err);
  } finally {
    msg.track?.close?.(); msg.slice?.bitmap.close?.();
  }
  out.ms = performance.now() - start;
  self.postMessage(out);
};

let step = 'loading MediaPipe';
async function init(V, role) {
  try {
    // MediaPipe's CommonJS build works in a classic worker with a tiny "exports" stand-in.
    self.exports = {}; self.module = { exports: self.exports };
    const bundle = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${V}/vision_bundle.cjs`;
    // The CDN labels this file "application/node", which Safari refuses to run as a script,
    // so fetch it and run it from a properly labelled copy.
    try {
      const code = await (await fetch(bundle)).text();
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      importScripts(url); URL.revokeObjectURL(url);
    } catch (err) { throw new Error(`loading ${bundle}: ${err}`); }
    const { FilesetResolver, FaceLandmarker, HandLandmarker } = self.module.exports.FaceLandmarker ? self.module.exports : self.exports;
    const files = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${V}/wasm`);
    if (role === 'hands') {
      step = 'creating the hand tracker';
      const handOpts = (delegate) => ({
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate },
        runningMode: 'VIDEO', numHands: 2,
      });
      // GPU measured faster for hands (8–19 ms vs 20–36 ms on CPU); CPU if the GPU can't be used in a worker here.
      try { hands = await HandLandmarker.createFromOptions(files, handOpts('GPU')); }
      catch { hands = await HandLandmarker.createFromOptions(files, handOpts('CPU')); }
      return self.postMessage({ type: 'ready', what: 'hands' });
    }
    step = 'creating the face tracker';
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate },
      runningMode: 'VIDEO', numFaces: 5,
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    });
    // CPU measured about twice as fast as GPU for faces, and it leaves the graphics chip for the 3D filters.
    let delegate = 'CPU';
    if (role !== 'finders') {
      try { faces = await FaceLandmarker.createFromOptions(files, opts('CPU')); }
      catch { delegate = 'GPU'; faces = await FaceLandmarker.createFromOptions(files, opts('GPU')); }
      self.postMessage({ type: 'ready', what: 'faces' });
    }
    if (role === 'main') return;
    // Three extra face trackers for the group finder's picture slices (each keeps its own timeline).
    try { for (let i = 0; i < 3; i++) finders.push(await FaceLandmarker.createFromOptions(files, opts(delegate))); self.postMessage({ type: 'ready', what: 'finders' }); }
    catch (err) { finders = []; console.warn('Group finder unavailable', err); }
  } catch (err) {
    self.postMessage({ type: 'failed', error: `${step}: ${err}` });
  }
}
