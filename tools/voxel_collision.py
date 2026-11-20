"""Voxel collision for the campus map (used by build_obj_map.py).

The old model made every 0.5 m cell one solid column from the ground to its highest geometry,
so any low floor inside a building turned the whole building into a block. Here geometry is
voxelized (RES x VY x RES), every vertical run of solid voxels in a cell becomes a box, and
interiors stay hollow: floors are slabs, walls are columns, doorways and colonnades stay open.

Reachability is computed on standable surfaces (top of a run with >= HEADROOM free above,
or the ground) by walking: step/jump up at most CLIMB, fall down any amount, blocked by
walls. Surfaces nobody can legitimately reach get an invisible movement-only box up to the
next structure (or the sky), and reachable open-sky cells get a ceiling CEIL_MARGIN above
their floor, so physics glitches can't put players on roofs or above the map.
"""
from collections import deque

import numpy as np
from scipy import ndimage

VY = 0.25          # vertical voxel size (m)
HEADROOM = 1.8     # free height needed to stand
CLIMB = 1.0        # highest ledge reachable by a jump
CEIL_MARGIN = 3.5  # ceiling above a reachable open-sky floor
SKY = 400.0


def voxelize(objs, solid_ids, tree_ids, grid, sample_points, ground_eps, trunk_sample, trunk_h):
    x0, z0, res, W, H = grid
    ymax = 0.0
    for o in objs:
        if o['id'] in solid_ids:
            v = o['v']
            inside = (v[:, 0] >= x0) & (v[:, 0] < x0 + W * res) & (v[:, 2] >= z0) & (v[:, 2] < z0 + H * res)
            if inside.any():
                ymax = max(ymax, float(v[inside, 1].max()))
    L = int(np.ceil(ymax / VY)) + 2
    V = np.zeros((H, W, L), bool)

    def mark(P):
        ix = ((P[:, 0] - x0) / res).astype(np.int64)
        iz = ((P[:, 2] - z0) / res).astype(np.int64)
        iy = (P[:, 1] / VY).astype(np.int64)
        ok = (ix >= 0) & (ix < W) & (iz >= 0) & (iz < H) & (iy >= 0) & (iy < L)
        V[iz[ok], ix[ok], iy[ok]] = True

    for o in objs:
        if o['id'] not in solid_ids:
            continue
        T = o['v'][o['f']]
        for k in range(0, len(T), 200000):  # chunks keep memory bounded
            P, _ = sample_points(T[k:k + 200000], 0.3)  # ~4 samples per voxel face
            mark(P[P[:, 1] > ground_eps * 0.5])
    # tree trunks: short posts
    for o in objs:
        if o['id'] not in tree_ids:
            continue
        T = o['v'][o['f']]
        P, _ = sample_points(T, res)
        P = P[(P[:, 1] > ground_eps) & (P[:, 1] < trunk_sample)]
        ix = ((P[:, 0] - x0) / res).astype(np.int64)
        iz = ((P[:, 2] - z0) / res).astype(np.int64)
        ok = (ix >= 0) & (ix < W) & (iz >= 0) & (iz < H)
        V[iz[ok], ix[ok], 0:int(trunk_h / VY)] = True
    # close 1-voxel sampling holes (floors and walls); real openings are wider than one voxel
    V |= ndimage.binary_closing(V, structure=ndimage.generate_binary_structure(3, 1), iterations=1)
    return V


def column_runs(V):
    """List of (has, lo_idx, hi_idx_exclusive) arrays, k-th solid run of every cell, bottom up."""
    pad = np.zeros(V.shape[:2] + (1,), bool)
    st = V & ~np.concatenate([pad, V[:, :, :-1]], 2)
    en = V & ~np.concatenate([V[:, :, 1:], pad], 2)
    jj, ii = np.indices(V.shape[:2])
    runs = []
    while True:
        has = st.any(2)
        if not has.any():
            break
        s = st.argmax(2)
        e = en.argmax(2)
        runs.append((has, np.where(has, s, 0), np.where(has, e + 1, 0)))
        st[jj[has], ii[has], s[has]] = False
        en[jj[has], ii[has], e[has]] = False
    return runs


def reach_and_cage(runs, grid, inside, seeds):
    """BFS over standable surfaces. Returns (reach_ground_mask, cage boxes as (lo,hi) layer arrays)."""
    x0, z0, res, W, H = grid
    K = len(runs)
    LO = np.stack([r[1] for r in runs], 2) if K else np.zeros((H, W, 0), int)
    HI = np.stack([r[2] for r in runs], 2) if K else np.zeros((H, W, 0), int)
    HAS = np.stack([r[0] for r in runs], 2) if K else np.zeros((H, W, 0), bool)
    hr, cl = int(round(HEADROOM / VY)), int(round(CLIMB / VY))
    BIG = 1 << 20
    LOb = np.where(HAS, LO, BIG)
    # standable levels per cell: ground (0) if the first run starts high enough, and each run top
    # with enough room before the next run. Level index: 0 = ground, k+1 = top of run k.
    nxt_lo = np.concatenate([LOb[:, :, 1:], np.full((H, W, 1), BIG)], 2)
    stand = np.concatenate([(LOb[:, :, :1] >= hr), HAS & (nxt_lo - HI >= hr)], 2)
    height = np.concatenate([np.zeros((H, W, 1), int), np.where(HAS, HI, 0)], 2)
    reached = np.zeros_like(stand)
    dq = deque()
    for (j, i) in seeds:
        if stand[j, i, 0] and not reached[j, i, 0]:
            reached[j, i, 0] = True
            dq.append((j, i, 0))
    lo_l, hi_l = LOb.tolist(), HI.tolist()
    st_l, h_l = stand.tolist(), height.tolist()
    rc = reached  # numpy writes are fine, reads go through the lists
    ins = inside
    while dq:
        j, i, s = dq.popleft()
        h = h_l[j][i][s]
        for jj, ii in ((j + 1, i), (j - 1, i), (j, i + 1), (j, i - 1)):
            if jj < 0 or ii < 0 or jj >= H or ii >= W or not ins[jj, ii]:
                continue
            los, his = lo_l[jj][ii], hi_l[jj][ii]
            # a run in the way at body height that we can't step onto -> wall
            blocked = False
            for k in range(K):
                if los[k] >= BIG:
                    break
                if los[k] < h + hr and his[k] > h + cl:
                    blocked = True
                    break
            if blocked:
                continue
            # land on the highest standable surface at or below h + climb
            best = -1
            sts, hs = st_l[jj][ii], h_l[jj][ii]
            for t in range(K + 1):
                if sts[t] and hs[t] <= h + cl and (best < 0 or hs[t] > hs[best]):
                    best = t
            if best >= 0 and not rc[jj, ii, best]:
                rc[jj, ii, best] = True
                dq.append((jj, ii, best))
    return stand, reached, height, LOb, HI, HAS


def cage_layers(stand, reached, height, LOb, HAS, inside):
    """Per-cell lists of movement-only boxes as layer intervals [(lo, hi)], merged later."""
    H, W, S = stand.shape
    BIG = 1 << 20
    out = []
    # unreachable standable run tops (not ground): block from the top to the next run / sky
    nxt_lo = np.concatenate([LOb[:, :, 1:], np.full((H, W, 1), BIG)], 2)
    for k in range(S - 1):
        m = stand[:, :, k + 1] & ~reached[:, :, k + 1]
        top = np.where(nxt_lo[:, :, k] >= BIG, int(SKY / VY), nxt_lo[:, :, k])
        out.append((m, height[:, :, k + 1], top))
    # ceiling over reachable cells with nothing above the reachable floor
    hmax = np.where(reached, height, -1).max(2)
    above = (HAS & (LOb > hmax[:, :, None])).any(2)
    m = (hmax >= 0) & ~above & inside
    ceil = hmax + int(round(CEIL_MARGIN / VY))
    ceil = (np.round(ceil / 2) * 2).astype(int)  # 0.5 m steps merge better
    out.append((m, ceil, np.full((H, W), int(SKY / VY))))
    return out
