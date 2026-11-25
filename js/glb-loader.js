import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

// Shared ArrayBuffer cache across ViewModel, CollectionPreview3D, and Avatar
// so the same .glb is never fetched twice over the network.
const bufferCache = new Map();
const inFlightBuffers = new Map();

const TEXTURE_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'bumpMap',
  'specularMap',
  'specularColorMap',
  'specularIntensityMap',
  'clearcoatMap',
  'clearcoatRoughnessMap',
  'clearcoatNormalMap',
  'alphaMap',
];

function normalizeUrl(url) {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return String(url);
  }
}

async function fetchGLBBuffer(url) {
  const key = normalizeUrl(url);
  if (bufferCache.has(key)) return bufferCache.get(key);
  if (inFlightBuffers.has(key)) return inFlightBuffers.get(key);

  const promise = fetch(key)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
      return res.arrayBuffer();
    })
    .then((buf) => {
      bufferCache.set(key, buf);
      inFlightBuffers.delete(key);
      return buf;
    })
    .catch((err) => {
      inFlightBuffers.delete(key);
      throw err;
    });

  inFlightBuffers.set(key, promise);
  return promise;
}

/**
 * Loads and parses a GLB using the shared singleton GLTFLoader (with MeshoptDecoder)
 * and shared ArrayBuffer cache. Each call returns a fresh parsed GLTF object so
 * separate WebGL contexts (ViewModel vs CollectionPreview3D) and SkinnedMeshes
 * never collide on GPU resources or skeleton bindings.
 */
export async function loadGLB(url) {
  const buf = await fetchGLBBuffer(url);
  const key = normalizeUrl(url);
  const basePath = key.slice(0, key.lastIndexOf('/') + 1);
  // Pass a fresh slice only if needed; GLTFLoader.parse does not detach the buffer.
  return new Promise((resolve, reject) => {
    loader.parse(buf, basePath, resolve, reject);
  });
}

/**
 * Pre-fetches the raw GLB binary into the shared buffer cache without parsing yet.
 */
export function prefetchGLB(url) {
  if (!url) return Promise.resolve();
  return fetchGLBBuffer(url).catch(() => {});
}

const nextAnimationFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Uploads textures staggered (1 texture per animation frame) and compiles shaders
 * asynchronously before a model is shown, eliminating the post-load GPU freeze.
 */
export async function warmUpModel(renderer, scene, camera, root, { lowGfx = false } = {}) {
  if (!renderer || !root) return;

  const textures = new Set();
  const maxAniso = lowGfx
    ? 1
    : Math.min(4, renderer.capabilities?.getMaxAnisotropy?.() || 1);

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      for (const key of TEXTURE_KEYS) {
        const tex = mat[key];
        if (tex && tex.isTexture) {
          tex.anisotropy = maxAniso;
          textures.add(tex);
        }
      }
    }
  });

  // Stagger GPU texture uploads (1 texture per frame) so main thread & GPU stay smooth
  for (const tex of textures) {
    try {
      renderer.initTexture(tex);
    } catch {}
    await nextAnimationFrame();
  }

  // Parallel/async shader compilation against target scene's lights & environment
  if (scene && camera) {
    try {
      const prevVis = root.visible;
      root.visible = true;
      if (typeof renderer.compileAsync === 'function') {
        await renderer.compileAsync(root, camera, scene);
      } else {
        renderer.compile(root, camera, scene);
      }
      root.visible = prevVis;
    } catch {}
  }
}

/**
 * Cleanly disposes all geometries, materials, and textures under an Object3D
 * to release GPU VRAM when evicting cached models.
 */
export function disposeObject3D(root) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();

  root.traverse((obj) => {
    if (obj.geometry) geometries.add(obj.geometry);
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        materials.add(m);
        for (const key of TEXTURE_KEYS) {
          if (m[key] && m[key].isTexture) textures.add(m[key]);
        }
      }
    }
  });

  for (const t of textures) t.dispose();
  for (const m of materials) m.dispose();
  for (const g of geometries) g.dispose();
}
