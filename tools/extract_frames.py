"""Extract frames from a video into a folder of JPEGs (streaming, low RAM).

Usage:
  tools/.venv/bin/python tools/extract_frames.py VIDEO OUT_DIR [--fps 60] [--quality 95] [--scale 1920]

--fps     target frames per second (default: native). Lower = fewer images
          (e.g. 2-5 fps is usually plenty for multi-view depth / point clouds).
--scale   max output width in px (keeps aspect ratio); omit to keep original.
"""
import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import av
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out_dir")
    ap.add_argument("--fps", type=float, default=None)
    ap.add_argument("--quality", type=int, default=95)
    ap.add_argument("--scale", type=int, default=None)
    ap.add_argument("--prefix", default="frame_")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    container = av.open(args.video)
    stream = container.streams.video[0]
    stream.thread_type = "AUTO"  # multi-threaded decode

    native = float(stream.average_rate)
    fps = args.fps or native
    step = 1.0 / fps
    duration = float(container.duration / 1e6) if container.duration else 0
    expected = int(duration * fps) if duration else "?"
    print(f"{stream.width}x{stream.height} @ {native:g}fps, {duration:.1f}s -> ~{expected} images at {fps:g}fps")

    def save(img, path):
        if args.scale and img.width > args.scale:
            img = img.resize((args.scale, round(img.height * args.scale / img.width)), Image.LANCZOS)
        img.save(path, "JPEG", quality=args.quality)

    next_t = 0.0
    n = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=os.cpu_count()) as pool:
        pending = []
        for frame in container.decode(stream):
            t = float(frame.pts * stream.time_base) if frame.pts is not None else n * step
            if t + 1e-6 < next_t:
                continue
            next_t += step
            path = os.path.join(args.out_dir, f"{args.prefix}{n:06d}.jpg")
            pending.append(pool.submit(save, frame.to_image(), path))
            n += 1
            if len(pending) > 256:  # bound memory
                for f in pending[:128]:
                    f.result()
                pending = pending[128:]
            if n % 500 == 0:
                print(f"  {n} images  ({n / (time.time() - t0):.0f} img/s)", flush=True)
        for f in pending:
            f.result()
    print(f"Done: {n} images -> {args.out_dir} in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    sys.exit(main())
