"""Convert the exported campus OBJ set into compact game assets.

Usage:
  tools/.venv/bin/python tools/build_obj_map.py "E:/.../Truong Dai Hoc Bach Khoa" [--out assets/map] [--tris 450000]

Input : a folder of model_N.obj files (one per material, units = cm, Y up, no .mtl).
Output: assets/map/campus.bin   quantized geometry, all objects back to back
        assets/map/campus.json  objects (color, offsets), collision boxes, boundary, spawns
        assets/map/minimap.png  top-down render used by the HUD

Collision model: a 2D grid (RES m). Per cell we take the lowest and highest solid geometry.
If the lowest is close to the ground the cell is a solid column 0..top, otherwise it is a
floating slab lo..top (roofs / walkways you can walk under). Equal neighbouring cells are
merged into boxes for physics.js.
"""
import argparse
import glob
import json
import os
import re

import cv2
import fast_simplification
import numpy as np
from PIL import Image
from scipy import ndimage

RES = 0.5          # collision / minimap grid (m)
CM = 0.01          # OBJ unit -> m
GROUND_EPS = 0.15  # below this, a cell is just ground (roads sit at -0.2, campus pad at 0)
HEAD = 2.0         # geometry starting above this leaves room to walk under
QH = 0.25          # height quantization for merging boxes
TRUNK_SAMPLE = 2.2  # tree geometry below this is trunk
TRUNK_H = 3.0      # trunk collider height (too tall to jump onto)
CLIMB = 1.0        # highest ledge a jump reaches (jump 6.8 m/s, gravity 21 -> 1.1 m apex)
SKY = 400.0        # top of invisible cage pillars
CEIL_MARGIN = 3.5  # ceiling above the highest legit floor (jump 1.1 + body 1.8 + slack)

# Material classes. The export has no .mtl, so every object (= one material) gets a color
# picked from its role. Unlisted objects fall back to a rule on their normals.
GROUND = {15: '#8e8c84', 34: '#b9b4a6', 21: '#7d8288', 102: '#7d8288', 7: '#6f9a4f', 18: '#a8a395',
          38: '#a8a395', 77: '#6f9a4f', 82: '#7d8288', 48: '#c9c3b2', 89: '#c9c3b2', 117: '#c9c3b2',
          47: '#a8a395', 32: '#a8a395', 5: '#9a958a', 1: '#9a958a'}
TREES = {13: '#3f8a3a', 40: '#4a9a40', 30: '#5e8f3c'}
NO_COLLIDE = {15, 34} | set(TREES)  # road/pad = physics ground plane; trees only collide by their trunks (below)
OVERRIDE = {41: '#e3dccb'}  # walls / building shells
# textured ground surfaces
GROUND_KIND = {15: 'asphalt', 34: 'pavers', 7: 'grass', 77: 'grass', 21: 'pitch'}  # 21 = big football field
# per-building styles (textures.js facade() styles / roof colors), weighted toward the campus look
FACADES = ['cream', 'yellow', 'white', 'grey', 'corridor', 'a2', 'a4', 'a5']  # a2/a4/a5: landmark-only styles
FACADE_W = [0.3, 0.25, 0.2, 0.1, 0.15, 0, 0, 0]
FACADE_COL = {'cream': '#ece3cf', 'yellow': '#e9cf8c', 'white': '#eef1f3', 'grey': '#c3c7c9', 'corridor': '#e8e2d2', 'a2': '#f1f3f5', 'a4': '#e4e6e3', 'a5': '#b7d0ec'}
ROOFS = [('#c8664e', 'tile'), ('#b9bdbf', 'flat'), ('#8fb4d4', 'metal'), ('#cfcfc8', 'flat')]
ROOF_W = [0.35, 0.25, 0.2, 0.2]
KIND_COL = {'pitch': '#55a242', 'asphalt': '#4a4f55', 'pavers': '#bdbdb5', 'grass': '#5f9a45', 'concrete': '#cfccc2'}


def load(src):
    objs = []
    for p in glob.glob(os.path.join(src, '*.obj')):
        i = int(re.findall(r'(\d+)\.obj$', p)[0])
        txt = open(p).read()
        v = np.array(re.findall(r'^v (\S+) (\S+) (\S+)', txt, re.M), np.float64) * CM
        f = np.array(re.findall(r'^f (\d+)\S* (\d+)\S* (\d+)', txt, re.M), np.int64) - 1
        if len(f):
            # drop degenerate triangles (zero-width slivers, often hundreds of meters long):
            # invisible when rendered but they would poison the collision grid
            T = v[f]
            L = np.max([np.linalg.norm(T[:, k] - T[:, (k + 1) % 3], axis=1) for k in range(3)], axis=0)
            A2 = np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1)
            f = f[A2 / (L + 1e-9) > 0.01]
        if len(f):
            objs.append({'id': i, 'v': v, 'f': f})
    objs.sort(key=lambda o: o['id'])
    return objs


def stats(o):
    T = o['v'][o['f']]
    N = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    A = np.linalg.norm(N, axis=1) / 2
    ny = N[:, 1] / (2 * A + 1e-12)
    s = A.sum() + 1e-9
    return {'area': float(s), 'up': float(A[ny > 0.7].sum() / s), 'vert': float(A[np.abs(ny) < 0.3].sum() / s),
            'y': float(np.average(T.mean(1)[:, 1], weights=A + 1e-12))}


def pick_color(o, st):
    i = o['id']
    if i in OVERRIDE: return OVERRIDE[i]
    if i in GROUND: return GROUND[i]
    if i in TREES: return TREES[i]
    rng = np.random.default_rng(i)
    if st['up'] > 0.6:  # roofs
        return ['#c96f55', '#b9bdbf', '#8fb0cc', '#cfcfc8'][rng.integers(4)]
    if st['vert'] > 0.7:  # facades
        return ['#e8dcc0', '#f1ede4', '#e6cf86', '#d9d5cc', '#c9c3b6'][rng.integers(5)]
    return ['#d8d2c4', '#bfc3c6', '#a9a397'][rng.integers(3)]


def weld(v, f, tol=1e-3):
    """Merge duplicated vertices (the export splits them per face normal), drop degenerate tris."""
    uq, inv = np.unique(np.round(v / tol).astype(np.int64), axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    nv = np.zeros((len(uq), 3))
    np.add.at(nv, inv, v)
    nv /= np.bincount(inv, minlength=len(uq))[:, None]
    f = inv[f]
    f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
    return nv, f


def simplify(o, target):
    v, f = weld(o['v'], o['f'])
    if len(f) <= target:
        return v, f
    red = 1 - target / len(f)
    try:
        v2, f2 = fast_simplification.simplify(v.astype(np.float32), f.astype(np.int64), target_reduction=red)
        if len(f2) > 0:
            return v2.astype(np.float64), f2.astype(np.int64)
    except Exception as e:
        print('  simplify failed', o['id'], e)
    return v, f


def sample_points(T, res):
    """Points covering every triangle (≈4 per grid cell of area) for rasterizing."""
    A = np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1) / 2
    # vertical faces have no plan area but long edges: use edge length too
    L = np.maximum(np.linalg.norm(T[:, 1] - T[:, 0], axis=1), np.linalg.norm(T[:, 2] - T[:, 0], axis=1))
    n = np.clip(np.maximum(A / (res * res / 4), L / (res / 2)), 1, 20000).astype(np.int64) + 2
    idx = np.repeat(np.arange(len(T)), n)
    a = np.random.default_rng(0).random((len(idx), 2))
    m = a.sum(1) > 1
    a[m] = 1 - a[m]
    t = T[idx]
    P = t[:, 0] + a[:, :1] * (t[:, 1] - t[:, 0]) + a[:, 1:] * (t[:, 2] - t[:, 0])
    return np.concatenate([P, T.reshape(-1, 3)]), np.concatenate([idx, np.repeat(np.arange(len(T)), 3)])


def merge_boxes(lo, hi, solid, x0, z0):
    """Greedy rectangle merge of cells with equal (lo, hi)."""
    H, W = solid.shape
    used = np.zeros_like(solid)
    boxes = []
    for j in range(H):
        i = 0
        while i < W:
            if not solid[j, i] or used[j, i]:
                i += 1
                continue
            a, b = lo[j, i], hi[j, i]
            k = i
            while k + 1 < W and solid[j, k + 1] and not used[j, k + 1] and lo[j, k + 1] == a and hi[j, k + 1] == b:
                k += 1
            r = j
            while r + 1 < H:
                row = slice(i, k + 1)
                if (solid[r + 1, row] & ~used[r + 1, row] & (lo[r + 1, row] == a) & (hi[r + 1, row] == b)).all():
                    r += 1
                else:
                    break
            used[j:r + 1, i:k + 1] = True
            boxes.append([round(x0 + i * RES, 2), round(float(a), 2), round(z0 + j * RES, 2),
                          round(x0 + (k + 1) * RES, 2), round(float(b), 2), round(z0 + (r + 1) * RES, 2)])
            i = k + 1
    return boxes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--out', default='assets/map')
    ap.add_argument('--tris', type=int, default=450000, help='triangle budget for the render mesh')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    objs = load(args.src)
    print(f'{len(objs)} objects, {sum(len(o["f"]) for o in objs)} tris')
    for o in objs:
        o['st'] = stats(o)
        o['color'] = pick_color(o, o['st'])

    # ---- collision grid from the full-resolution mesh ----
    solid_objs = [o for o in objs if o['id'] not in NO_COLLIDE]
    allv = np.concatenate([o['v'] for o in objs if o['id'] not in (15, 39, 24)])
    x0, z0 = np.floor(allv[:, [0, 2]].min(0) / RES) * RES - 4
    x1, z1 = np.ceil(allv[:, [0, 2]].max(0) / RES) * RES + 4
    W, H = int(round((x1 - x0) / RES)), int(round((z1 - z0) / RES))
    lo = np.full((H, W), np.inf)
    hi = np.full((H, W), -np.inf)
    for o in solid_objs:
        T = o['v'][o['f']]
        P, _ = sample_points(T, RES)
        P = P[P[:, 1] > GROUND_EPS * 0.5]
        ix = ((P[:, 0] - x0) / RES).astype(int)
        iz = ((P[:, 2] - z0) / RES).astype(int)
        ok = (ix >= 0) & (ix < W) & (iz >= 0) & (iz < H)
        np.minimum.at(lo, (iz[ok], ix[ok]), P[ok, 1])
        np.maximum.at(hi, (iz[ok], ix[ok]), P[ok, 1])
    # tree trunks: geometry of tree objects near the ground becomes a short solid post.
    # (Canopies used to make tall columns that players could climb by spamming jump.)
    for o in objs:
        if o['id'] not in TREES:
            continue
        T = o['v'][o['f']]
        P, _ = sample_points(T, RES)
        P = P[(P[:, 1] > GROUND_EPS) & (P[:, 1] < TRUNK_SAMPLE)]
        ix = ((P[:, 0] - x0) / RES).astype(int)
        iz = ((P[:, 2] - z0) / RES).astype(int)
        ok = (ix >= 0) & (ix < W) & (iz >= 0) & (iz < H)
        lo[iz[ok], ix[ok]] = np.minimum(lo[iz[ok], ix[ok]], GROUND_EPS)
        hi[iz[ok], ix[ok]] = np.maximum(hi[iz[ok], ix[ok]], TRUNK_H)
    has = hi > GROUND_EPS
    lo = np.where(lo < HEAD, 0.0, lo)
    # fine steps near the ground (curbs, stairs), coarser up high so more cells merge
    qz = lambda h: np.where(h < 3, np.round(h / QH) * QH, np.round(h / 0.5) * 0.5)
    loq = qz(lo)
    hiq = qz(hi)
    hiq = np.where(has, np.maximum(hiq, loq + QH), 0)
    boxes = merge_boxes(loq, hiq, has, x0, z0)
    print(f'collision: {W}x{H} grid, {int(has.sum())} solid cells -> {len(boxes)} boxes')

    # ---- campus boundary: outline of everything that is not the outer terrain ----
    cover = np.zeros((H, W), np.uint8)
    for o in objs:
        if o['id'] in (15, 39, 24):
            continue
        T = o['v'][o['f']]
        P, _ = sample_points(T, RES * 2)
        ix = ((P[:, 0] - x0) / RES).astype(int)
        iz = ((P[:, 2] - z0) / RES).astype(int)
        ok = (ix >= 0) & (ix < W) & (iz >= 0) & (iz < H)
        cover[iz[ok], ix[ok]] = 1
    # close generously: roads (e.g. the main road from the gate) have no geometry of their own
    # and would otherwise cut deep slots out of the playable area
    cover = ndimage.binary_closing(np.pad(cover, 40), iterations=30)[40:-40, 40:-40].astype(np.uint8)
    cover = ndimage.binary_fill_holes(cover).astype(np.uint8)
    cnts, _ = cv2.findContours(cover, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cnts, key=cv2.contourArea)
    # the forecourt in front of the main gate is a recess with no geometry: fill it with the
    # convex hull of the outline around the gate so the gate is inside the playable area
    lm = json.load(open(os.path.join(os.path.dirname(__file__), 'landmarks.json')))
    if lm.get('gate'):
        gx, gz = (lm['gate']['x'] - x0) / RES, (lm['gate']['z'] - z0) / RES
        near = c[:, 0, :][np.hypot(c[:, 0, 0] - gx, c[:, 0, 1] - gz) < 70 / RES]
        if len(near) >= 3:
            cv2.fillPoly(cover, [cv2.convexHull(near.astype(np.int32))], 1)
            cnts, _ = cv2.findContours(cover, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            c = max(cnts, key=cv2.contourArea)
    c = cv2.approxPolyDP(c, 4 / RES, True)[:, 0, :]
    boundary = [[round(x0 + (p[0] + 0.5) * RES, 2), round(z0 + (p[1] + 0.5) * RES, 2)] for p in c]
    # keep CCW in x/z like the rest of the code (positive signed area)
    sa = sum(boundary[i][0] * boundary[(i + 1) % len(boundary)][1] - boundary[(i + 1) % len(boundary)][0] * boundary[i][1] for i in range(len(boundary)))
    if sa < 0:
        boundary.reverse()
    print(f'boundary: {len(boundary)} points')

    # ---- spawns: open ground cells in the biggest reachable area, inside the boundary ----
    inside = np.zeros((H, W), np.uint8)
    cv2.fillPoly(inside, [c.astype(np.int32)], 1)
    inside = ndimage.binary_erosion(inside, iterations=int(4 / RES))
    blocked = has & (loq < 1.8)
    free = inside & ~ndimage.binary_dilation(blocked, iterations=int(1.2 / RES))
    lab, n = ndimage.label(free)
    if n:
        big = np.argmax(ndimage.sum(free, lab, range(1, n + 1))) + 1
        free = lab == big
    open_sky = free & ~has  # nothing overhead
    js, is_ = np.nonzero(open_sky)
    rng = np.random.default_rng(5150)
    spawns = []
    for k in rng.permutation(len(js)):
        x, z = x0 + (is_[k] + 0.5) * RES, z0 + (js[k] + 0.5) * RES
        if all((x - s[0]) ** 2 + (z - s[1]) ** 2 > 18 ** 2 for s in spawns):
            spawns.append([round(float(x), 2), round(float(z), 2)])
        if len(spawns) >= 90:
            break
    print(f'spawns: {len(spawns)}')

    # ---- virtual cage: what can a player legitimately stand on? ----
    # BFS over cells from the spawns: walking steps up at most CLIMB (a jump), down any amount.
    # Solid columns that are never reached get an invisible pillar up to the sky (players can't
    # land on them via physics glitches), slab tops (walkway roofs) always do, and a ceiling
    # sits just above the highest reachable floor.
    column = has & (loq == 0)
    floor_h = np.where(column, hiq, 0.0)
    reach = np.zeros((H, W), bool)
    from collections import deque
    dq = deque()
    for sx, sz in spawns:
        j, i = int((sz - z0) / RES), int((sx - x0) / RES)
        if not reach[j, i]:
            reach[j, i] = True
            dq.append((j, i))
    inside_full = np.zeros((H, W), np.uint8)
    cv2.fillPoly(inside_full, [c.astype(np.int32)], 1)
    inside_full = inside_full.astype(bool)
    while dq:
        j, i = dq.popleft()
        h0 = floor_h[j, i]
        for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            jj, ii = j + dj, i + di
            if 0 <= jj < H and 0 <= ii < W and not reach[jj, ii] and inside_full[jj, ii] and floor_h[jj, ii] - h0 <= CLIMB:
                reach[jj, ii] = True
                dq.append((jj, ii))
    pillar = column & ~reach
    cage = merge_boxes(np.zeros((H, W)), np.full((H, W), SKY), pillar, x0, z0)
    slab = has & (loq > 0)
    cage += merge_boxes(hiq, np.full((H, W), SKY), slab, x0, z0)
    max_floor = float(floor_h[reach].max()) if reach.any() else 0.0
    ceiling = round(max_floor + CEIL_MARGIN, 2)
    print(f'cage: {int(reach.sum())} reachable cells, max floor {max_floor} m, {len(cage)} cage boxes, ceiling {ceiling} m')

    # ---- render mesh: decimate (only if over budget), then a material per triangle ----
    total_area = sum(o['st']['area'] for o in objs)
    dens = args.tris / total_area
    for _ in range(20):  # solve for density so the sum hits the budget
        tot = sum(min(len(o['f']), max(60, o['st']['area'] * dens)) for o in objs)
        dens *= args.tris / tot

    # one label per building (connected tall solid area) -> its own facade + roof style
    blab, nb = ndimage.label(has & (hiq >= 4))
    brng = np.random.default_rng(268)
    bfac = brng.choice(len(FACADES), nb + 1, p=FACADE_W)
    broof = brng.choice(len(ROOFS), nb + 1, p=ROOF_W)
    roofs = list(ROOFS)
    # landmark buildings (tools/landmarks.json): the label covering most of the footprint
    for name, b in lm['buildings'].items():
        mask = np.zeros((H, W), np.uint8)
        cv2.fillPoly(mask, [((np.array(b['poly']) - [x0, z0]) / RES).astype(np.int32)], 1)
        labs = blab[(mask > 0) & (blab > 0)]
        if not len(labs):
            print('  landmark not found', name)
            continue
        k = np.bincount(labs).argmax()
        bfac[k] = FACADES.index(b['facade'])
        roofs.append(tuple(b['roof']))
        broof[k] = len(roofs) - 1
        print(f'  landmark {name}: building label {k}')

    mats, mat_ids = [], {}

    def mat(kind, color=None, style=None, ground=False):
        key = (kind, color, style)
        if key not in mat_ids:
            mat_ids[key] = len(mats)
            mats.append({'kind': kind, 'color': color, 'style': style, 'ground': ground})
        return mat_ids[key]

    tri_pos, tri_mat = [], []
    for o in objs:
        target = int(min(len(o['f']), max(60, o['st']['area'] * dens)))
        v, f = simplify(o, target)
        T = v[f]
        n = len(T)
        i = o['id']
        if i in GROUND_KIND:
            kind = GROUND_KIND[i]
            m = np.full(n, mat(kind, None if kind != 'plain' else o['color'], ground=True))
            if kind == 'pitch':  # texture is stretched over the whole field
                mats[m[0]]['bbox'] = [round(float(T[:, :, 0].min()), 2), round(float(T[:, :, 2].min()), 2),
                                      round(float(T[:, :, 0].max()), 2), round(float(T[:, :, 2].max()), 2)]
        elif i in GROUND:
            m = np.full(n, mat('concrete', None, ground=True))
        elif i in TREES:
            m = np.full(n, mat('leaves', o['color']))
        else:
            m = np.full(n, mat('plain', o['color']))
            if o['st']['area'] > 400:  # major building materials: textured by face orientation
                N = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
                ny = np.abs(N[:, 1]) / (np.linalg.norm(N, axis=1) + 1e-12)
                C = T.mean(1)
                ix = np.clip(((C[:, 0] - x0) / RES).astype(int), 0, W - 1)
                iz = np.clip(((C[:, 2] - z0) / RES).astype(int), 0, H - 1)
                # sample the label slightly around the centroid: walls sit on the region edge
                lb = ndimage.grey_dilation(blab, size=3)[iz, ix]
                wall = (lb > 0) & (ny < 0.4) & (C[:, 1] > 0.3)
                rf = (lb > 0) & (ny > 0.7) & (C[:, 1] > 3)
                # narrow faces (pillars, ledges) get the plain wall color instead of windows
                wide = np.ptp(T[:, :, 0], axis=1) ** 2 + np.ptp(T[:, :, 2], axis=1) ** 2 > 1.5 ** 2
                for k in np.unique(lb[wall]):
                    style = FACADES[bfac[k]]
                    m[wall & (lb == k) & wide] = mat('facade', None, style)
                    m[wall & (lb == k) & ~wide] = mat('plain', FACADE_COL[style])
                for k in np.unique(lb[rf]):
                    col, pat = roofs[broof[k]]
                    m[rf & (lb == k)] = mat('roof', col, pat)
        tri_pos.append(T)
        tri_mat.append(m)
    T = np.concatenate(tri_pos)
    M = np.concatenate(tri_mat)
    order = np.argsort(M, kind='stable')
    T, M = T[order], M[order]
    allmin = np.array([x0, -50.0, z0])
    span = np.array([x1 - x0, 100.0, z1 - z0])
    qscale = span / 65535
    q = np.clip(np.round((T.reshape(-1, 3) - allmin) / qscale), 0, 65535).astype(np.uint16)
    with open(os.path.join(args.out, 'campus.bin'), 'wb') as fh:
        fh.write(q.tobytes())
    counts = np.bincount(M, minlength=len(mats))
    start = 0
    for k, mt in enumerate(mats):
        mt['tris'] = [int(start), int(counts[k])]
        start += counts[k]
    print(f'render mesh: {len(T)} tris, {len(mats)} materials, {q.nbytes / 1e6:.1f} MB')

    # ---- minimap: color of the topmost surface per cell ----
    def mm_color(mt):
        if mt['kind'] == 'facade': return FACADE_COL[mt['style']]
        return mt['color'] or KIND_COL[mt['kind']]
    pal = np.array([[int(mm_color(mt)[k:k + 2], 16) for k in (1, 3, 5)] for mt in mats], np.float64)
    top = np.full((H, W), -np.inf)
    col = np.zeros((H, W, 3), np.float64)
    col[:] = (43, 49, 56)
    keep = (T[:, :, 0].min(1) > x0) & (T[:, :, 0].max(1) < x1) & (T[:, :, 1].min(1) > -1)
    P, idx = sample_points(T[keep], RES * 2)
    Mk = M[keep][idx]
    ix = ((P[:, 0] - x0) / RES).astype(int)
    iz = ((P[:, 2] - z0) / RES).astype(int)
    ok = (ix >= 0) & (ix < W) & (iz >= 0) & (iz < H)
    ix, iz, y, Mk = ix[ok], iz[ok], P[ok, 1], Mk[ok]
    o = np.lexsort((y, iz * W + ix))  # last per cell = highest
    cell = (iz * W + ix)[o]
    last = np.r_[cell[1:] != cell[:-1], True]
    sel = o[last]
    top.flat[cell[last]] = y[sel]
    col.reshape(-1, 3)[cell[last]] = pal[Mk[sel]]
    shade = np.clip(0.8 + np.where(np.isfinite(top), top, 0) / 60, 0.8, 1.15)[..., None]
    img = cv2.medianBlur(np.clip(col * shade, 0, 255).astype(np.uint8), 3)
    Image.fromarray(img).save(os.path.join(args.out, 'minimap.png'), optimize=True)

    meta = {
        'source': 'campus OBJ export (tools/build_obj_map.py)',
        'quant': {'min': allmin.round(4).tolist(), 'scale': qscale.tolist()},
        'grid': {'x0': x0, 'z0': z0, 'res': RES, 'w': W, 'h': H},
        'bbox': [round(float(min(p[0] for p in boundary)), 2), round(float(min(p[1] for p in boundary)), 2),
                 round(float(max(p[0] for p in boundary)), 2), round(float(max(p[1] for p in boundary)), 2)],
        'materials': mats, 'gate': lm.get('gate'), 'boundary': boundary, 'spawns': spawns, 'boxes': boxes, 'cage': cage, 'ceiling': ceiling,
    }
    with open(os.path.join(args.out, 'campus.json'), 'w') as fh:
        json.dump(meta, fh, separators=(',', ':'))
    print('wrote', args.out)


if __name__ == '__main__':
    main()
