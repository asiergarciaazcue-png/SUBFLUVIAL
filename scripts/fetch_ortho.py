"""
Genera la ortofoto del territorio en el marco local del trazado, troceada en teselas de textura
(public/ortho/*.jpg + public/ortho/ortho.json) para el acabado realista tipo Google Earth.

Fuentes:
  --source pnoa       PNOA máxima actualidad (IGN, CC BY 4.0, ~0,15–0,25 m/px)   ← recomendada
  --source xyz --url  cualquier servicio de teselas XYZ/TMS ({z}/{x}/{y})
  --source sentinel2  Sentinel-2 L2A (ESA/Copernicus, 10 m/px) — solo provisional

Uso: python3 scripts/fetch_ortho.py --source pnoa --res 0.5
"""
import argparse, io, json, math, os, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

ROOT = os.path.join(os.path.dirname(__file__), "..")
GEO = json.load(open(os.path.join(ROOT, "src", "data", "geo.json")))
OUT = os.path.join(ROOT, "public", "ortho")
CACHE = os.path.join(ROOT, "data", "raw", "ortho")
D2R = math.pi / 180

SOURCES = {
    "pnoa": {"url": "https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{y}.jpeg", "tms": True, "zoom": 19,
             "credit": "PNOA cedido por © Instituto Geográfico Nacional (CC BY 4.0)"},
    "sentinel2": {"credit": "Contiene datos Copernicus Sentinel-2 modificados (2025)"},
}

ap = argparse.ArgumentParser()
ap.add_argument("--source", default="pnoa")
ap.add_argument("--url")
ap.add_argument("--zoom", type=int)
ap.add_argument("--tms", action="store_true")
ap.add_argument("--res", type=float, default=0.5, help="m/px de la textura")
ap.add_argument("--tile", type=int, default=4096, help="lado máximo de cada tesela de textura")
ap.add_argument("--scene", default="sentinel-s2-l2a-cogs/30/T/VP/2025/7/S2C_30TVP_20250709_0_L2A")
args = ap.parse_args()

# ---- marco local (idéntico a build_territory.py)
A, B = GEO["artaza"], GEO["ballonti"]
lat0, lon0 = (A["lat"] + B["lat"]) / 2, (A["lon"] + B["lon"]) / 2
kx, ky = 111320 * math.cos(lat0 * D2R), 110574
eAB, nAB = (B["lon"] - A["lon"]) * kx, (B["lat"] - A["lat"]) * ky
L = math.hypot(eAB, nAB)
fe, fn = eAB / L, nAB / L
MA, MS = GEO["margin"]["along"], GEO["margin"]["side"]
XMIN, XMAX, ZMIN, ZMAX = -L / 2 - MA, L / 2 + MA, -MS, MS


def to_ll(x, z):
    e, n = x * fe + z * fn, x * fn - z * fe
    return lat0 + n / ky, lon0 + e / kx


# ---- muestreadores: (lat[], lon[]) -> rgb[] (float 0..255)
def xyz_sampler(url, zoom, tms):
    os.makedirs(CACHE, exist_ok=True)
    cache = {}

    def tile(tx, ty):
        k = (tx, ty)
        if k in cache:
            return cache[k]
        yy = (2 ** zoom - 1 - ty) if tms else ty
        f = os.path.join(CACHE, f"{args.source}_{zoom}_{tx}_{ty}.jpg")
        if not os.path.exists(f):
            req = urllib.request.Request(url.format(z=zoom, x=tx, y=yy), headers={"User-Agent": "subfluvial-render"})
            with urllib.request.urlopen(req, timeout=60) as r:
                open(f, "wb").write(r.read())
        cache[k] = np.asarray(Image.open(f).convert("RGB"))
        return cache[k]

    def sample(lat, lon):
        n = 2 ** zoom
        fx = (lon + 180) / 360 * n
        fy = (1 - np.arcsinh(np.tan(lat * D2R)) / math.pi) / 2 * n
        tx0, tx1, ty0, ty1 = int(fx.min()), int(fx.max()), int(fy.min()), int(fy.max())
        keys = [(x, y) for x in range(tx0, tx1 + 1) for y in range(ty0, ty1 + 1)]
        with ThreadPoolExecutor(16) as ex:
            list(ex.map(lambda k: tile(*k), keys))
        mos = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256, 3), np.uint8)
        for (x, y) in keys:
            t = tile(x, y)
            if t.shape[0] != 256:
                t = np.asarray(Image.fromarray(t).resize((256, 256)))
            mos[(y - ty0) * 256:(y - ty0 + 1) * 256, (x - tx0) * 256:(x - tx0 + 1) * 256] = t
        px, py = (fx - tx0) * 256 - 0.5, (fy - ty0) * 256 - 0.5
        return np.stack([map_coordinates(mos[..., c].astype(np.float32), [py, px], order=1, mode="nearest") for c in range(3)], -1)

    return sample


def sentinel_sampler(scene):
    import rasterio
    from rasterio.warp import transform as wtransform
    from rasterio.windows import from_bounds
    url = f"/vsicurl/https://sentinel-cogs.s3.us-west-2.amazonaws.com/{scene}/TCI.tif"
    src = rasterio.open(url)
    corners = [to_ll(x, z) for x, z in [(XMIN, ZMIN), (XMAX, ZMIN), (XMAX, ZMAX), (XMIN, ZMAX)]]
    xs, ys = wtransform("EPSG:4326", src.crs, [c[1] for c in corners], [c[0] for c in corners])
    win = from_bounds(min(xs) - 200, min(ys) - 200, max(xs) + 200, max(ys) + 200, src.transform).round_offsets().round_lengths()
    img = src.read(window=win).astype(np.float32)  # (3, h, w)
    wt = src.window_transform(win)
    # Sentinel-2 TCI es oscuro y algo apagado: corrección tonal suave
    img = np.clip((img / 255.0) ** 0.8 * 255 * 1.08, 0, 255)

    def sample(lat, lon):
        X, Y = wtransform("EPSG:4326", src.crs, lon.ravel().tolist(), lat.ravel().tolist())
        X, Y = np.array(X).reshape(lat.shape), np.array(Y).reshape(lat.shape)
        col, row = ~wt * (X, Y)
        return np.stack([map_coordinates(img[c], [row - 0.5, col - 0.5], order=3, mode="nearest") for c in range(3)], -1)

    return sample


if args.source == "sentinel2":
    sampler = sentinel_sampler(args.scene)
else:
    s = SOURCES.get(args.source, {})
    sampler = xyz_sampler(args.url or s["url"], args.zoom or s["zoom"], args.tms or s.get("tms", False))

# ---- rejilla de teselas de textura
W, D = XMAX - XMIN, ZMAX - ZMIN
pw, ph = int(math.ceil(W / args.res)), int(math.ceil(D / args.res))
nx, nz = int(math.ceil(pw / args.tile)), int(math.ceil(ph / args.tile))
tw, th = int(math.ceil(pw / nx)), int(math.ceil(ph / nz))
os.makedirs(OUT, exist_ok=True)
tiles = []
for j in range(nz):
    for i in range(nx):
        # cada tesela cubre [x0,x1]x[z0,z1]; los píxeles muestrean en sus centros
        x0, z0 = XMIN + i * tw * args.res, ZMIN + j * th * args.res
        x1, z1 = min(XMAX, x0 + tw * args.res), min(ZMAX, z0 + th * args.res)
        w, h = int(round((x1 - x0) / args.res)), int(round((z1 - z0) / args.res))
        xs = x0 + (np.arange(w) + 0.5) * args.res
        zs = z0 + (np.arange(h) + 0.5) * args.res
        X, Z = np.meshgrid(xs, zs)
        e, n = X * fe + Z * fn, X * fn - Z * fe
        lat, lon = lat0 + n / ky, lon0 + e / kx
        rgb = np.clip(sampler(lat, lon), 0, 255).astype(np.uint8)
        name = f"t_{i}_{j}.jpg"
        Image.fromarray(rgb).save(os.path.join(OUT, name), quality=88, optimize=True)
        tiles.append({"file": name, "x0": x0, "x1": x1, "z0": z0, "z1": z1, "w": w, "h": h})
        print(f"{name} {w}x{h}", flush=True)

credit = SOURCES.get(args.source, {}).get("credit", args.url or "")
json.dump({"source": args.source, "credit": credit, "res": args.res, "rect": [XMIN, XMAX, ZMIN, ZMAX], "tiles": tiles},
          open(os.path.join(OUT, "ortho.json"), "w"), indent=1)
print("OK", len(tiles), "teselas →", OUT)
