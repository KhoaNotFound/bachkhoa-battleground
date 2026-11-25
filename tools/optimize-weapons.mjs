#!/usr/bin/env node
/**
 * Offline GLB optimization pipeline for Bách Khoa Battleground weapon models.
 *
 * Preserves 100% of original mesh geometry (zero destructive decimation) while:
 *  1. Pruning unused animation clips (keeps only gameplay-required clips)
 *  2. Resizing oversized 4K textures -> 2048x2048 (baseColor/normal/emissive)
 *     and 1024x1024 (metallicRoughness/occlusion)
 *  3. Converting embedded PNG/JPEG textures -> high-quality WebP (EXT_texture_webp)
 *  4. Deduplicating & pruning unused accessors/materials/buffers
 *  5. Applying Meshopt compression (EXT_meshopt_compression) for fast CPU decode
 *
 * Usage:
 *   node tools/optimize-weapons.mjs [--dry-run] [--no-backup]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, '_backup_glb');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const NO_BACKUP = args.has('--no-backup');

const GUN_CLIPS = new Set(['draw', 'idle', 'fire', 'reload', 'inspect']);
const BUTTERFLY_CLIPS = new Set(['draw', 'idle', 'slash_1', 'slash_2', 'heavy', 'inspect']);

const TARGETS = [
  { rel: 'assets/skins/cs2/ak47-cs2.glb',          clips: GUN_CLIPS },
  { rel: 'assets/skins/cs2/awp-cs2.glb',           clips: GUN_CLIPS },
  { rel: 'assets/skins/cs2/deagle-cs2.glb',        clips: GUN_CLIPS },
  { rel: 'assets/skins/cs2/usps-cs2.glb',          clips: GUN_CLIPS },
  { rel: 'assets/skins/cs2/m4a1s-cs2.glb',         clips: GUN_CLIPS },
  { rel: 'assets/skins/vandal/vandal-rgx.glb',     clips: GUN_CLIPS },
  { rel: 'assets/skins/vandal/vandal-default.glb', clips: GUN_CLIPS },
  { rel: 'assets/skins/vandal/vandal-forsaken.glb',clips: GUN_CLIPS },
  { rel: 'assets/awp-dragon-lore.glb',             clips: GUN_CLIPS },
  { rel: 'assets/butterfly-viewmodel.glb',         clips: BUTTERFLY_CLIPS },
  { rel: 'assets/butterfly-knife.glb',             clips: null },
  { rel: 'assets/karambit.glb',                    clips: null },
];

function fmtMB(bytes) {
  return (bytes / 1048576).toFixed(2) + ' MB';
}

function getMeshStats(doc) {
  let verts = 0;
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (pos) verts += pos.getCount();
      const idx = prim.getIndices();
      if (idx) tris += idx.getCount() / 3;
      else if (pos) tris += pos.getCount() / 3;
    }
  }
  return { verts: Math.round(verts), tris: Math.round(tris) };
}

async function optimizeTextureSlots(doc) {
  // Classify textures by their material usage so normal maps keep maximum sharpness
  // and low-frequency roughness/metallic/occlusion maps can safely cap at 1024px.
  const normalTextures = new Set();
  const dataTextures = new Set();
  const colorTextures = new Set();

  for (const mat of doc.getRoot().listMaterials()) {
    const base = mat.getBaseColorTexture();
    const emi = mat.getEmissiveTexture();
    const norm = mat.getNormalTexture();
    const mr = mat.getMetallicRoughnessTexture();
    const occ = mat.getOcclusionTexture();

    if (base) colorTextures.add(base);
    if (emi) colorTextures.add(emi);
    if (norm) normalTextures.add(norm);
    if (mr) dataTextures.add(mr);
    if (occ) dataTextures.add(occ);
  }

  // Register EXT_texture_webp extension on document
  doc.createExtension(EXTTextureWebP).setRequired(false);

  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img || img.byteLength < 16 * 1024) continue; // skip tiny textures (<16KB)

    const isNormal = normalTextures.has(tex);
    const isColor = colorTextures.has(tex);
    const isDataOnly = dataTextures.has(tex) && !isColor && !isNormal;

    const maxDim = isDataOnly ? 1024 : 2048;

    const meta = await sharp(Buffer.from(img)).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;

    let pipeline = sharp(Buffer.from(img));
    if (w > maxDim || h > maxDim) {
      pipeline = pipeline.resize({
        width: maxDim,
        height: maxDim,
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      });
    }

    const webpBuf = await pipeline
      .webp({
        quality: isNormal ? 92 : 90,
        alphaQuality: 95,
        effort: 5,
        smartSubsample: !isNormal,
      })
      .toBuffer();

    // Only replace if smaller (or resized)
    if (webpBuf.byteLength < img.byteLength || w > maxDim || h > maxDim) {
      tex.setImage(new Uint8Array(webpBuf));
      tex.setMimeType('image/webp');
    }
  }
}

async function main() {
  await MeshoptEncoder.ready;

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
    });

  let totalBefore = 0;
  let totalAfter = 0;

  console.log(`\nOptimizing weapon GLBs (${DRY_RUN ? 'DRY RUN' : 'WRITE MODE'})...\n`);

  for (const target of TARGETS) {
    const fullPath = path.join(ROOT, target.rel);
    if (!fs.existsSync(fullPath)) {
      console.log(`  [SKIP] ${target.rel} (not found)`);
      continue;
    }

    // Always read from pristine backup if available to avoid generational loss
    const backupPath = path.join(BACKUP_DIR, target.rel);
    let sourcePath = fullPath;
    if (fs.existsSync(backupPath)) {
      sourcePath = backupPath;
    } else if (!DRY_RUN && !NO_BACKUP) {
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(fullPath, backupPath);
    }

    const beforeBytes = fs.statSync(sourcePath).size;
    totalBefore += beforeBytes;

    const doc = await io.read(sourcePath);
    const beforeStats = getMeshStats(doc);
    const animsBefore = doc.getRoot().listAnimations().length;

    // 1. Prune unused animations while strictly preserving required gameplay clips
    if (target.clips) {
      for (const anim of [...doc.getRoot().listAnimations()]) {
        if (!target.clips.has(anim.getName())) {
          anim.dispose();
        }
      }
    }

    // 2. Optimize textures (resize + WebP)
    await optimizeTextureSlots(doc);

    // 3. Dedup + prune unused buffers/accessors/materials
    await doc.transform(dedup(), prune());

    // 4. Lossless Meshopt compression WITHOUT quantize() so SkinnedMesh POSITION
    // coordinates stay in exact world space (prevents scale distortion when
    // CollectionPreview3D / Avatar extracts static meshes without skeletons).
    if (beforeBytes > 100 * 1024) {
      await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
      doc
        .createExtension(EXTMeshoptCompression)
        .setRequired(true)
        .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
    }

    const afterStats = getMeshStats(doc);
    const animsAfter = doc.getRoot().listAnimations().map((a) => a.getName());

    const outBin = await io.writeBinary(doc);
    const afterBytes = outBin.byteLength;
    totalAfter += afterBytes;

    if (!DRY_RUN) {
      fs.writeFileSync(fullPath, outBin);
    }

    const pct = (((beforeBytes - afterBytes) / beforeBytes) * 100).toFixed(1);
    const geoOk = beforeStats.tris === afterStats.tris ? 'OK' : `CHANGED(${beforeStats.tris}->${afterStats.tris})`;
    console.log(
      `  ${target.rel.padEnd(42)} ${fmtMB(beforeBytes).padStart(9)} -> ${fmtMB(afterBytes).padStart(9)} (-${pct}%) | tris:${geoOk} | anims:${animsBefore}->${animsAfter.length} [${animsAfter.join(',')}]`
    );
  }

  const totalPct = totalBefore ? (((totalBefore - totalAfter) / totalBefore) * 100).toFixed(1) : '0.0';
  console.log(`\nTOTAL: ${fmtMB(totalBefore)} -> ${fmtMB(totalAfter)} (-${totalPct}%)\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
