"""
Convierte los datos reales descargados (data/raw/*.geojson, Overture Maps) y el relieve
(Terrarium / Mapzen en AWS) en public/territory.json, ya proyectado al marco local del trazado:

  x = metros a lo largo del eje Artaza → Ballonti (0 en el punto medio)
  z = metros a la derecha del eje
  y = altura (m)

Las coordenadas se guardan como enteros en decímetros para aligerar el fichero.
Uso: python3 scripts/build_territory.py
"""
import io, json, math, os, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image
from shapely.geometry import shape, box, Polygon, MultiPolygon, LineString, MultiLineString
from shapely.ops import substring, unary_union
from shapely.prepared import prep
from shapely import affinity

ROOT = os.path.join(os.path.dirname(__file__), "..")
RAW = os.path.join(ROOT, "data", "raw")
GEO = json.load(open(os.path.join(ROOT, "src", "data", "geo.json")))
OUT = os.path.join(ROOT, "public", "territory.json")
D2R = math.pi / 180

A, B = GEO["artaza"], GEO["ballonti"]
lat0, lon0 = (A["lat"] + B["lat"]) / 2, (A["lon"] + B["lon"]) / 2
kx, ky = 111320 * math.cos(lat0 * D2R), 110574
eAB, nAB = (B["lon"] - A["lon"]) * kx, (B["lat"] - A["lat"]) * ky
L = math.hypot(eAB, nAB)
fe, fn = eAB / L, nAB / L
MA, MS = GEO["margin"]["along"], GEO["margin"]["side"]
XMIN, XMAX, ZMIN, ZMAX = -L / 2 - MA, L / 2 + MA, -MS, MS
RECT = box(XMIN, ZMIN, XMAX, ZMAX)


def to_local(lon, lat):
    e, n = (lon - lon0) * kx, (lat - lat0) * ky
    return e * fe + n * fn, e * fn - n * fe


def to_ll(x, z):
    e, n = x * fe + z * fn, x * fn - z * fe
    return lat0 + n / ky, lon0 + e / kx


def proj(geom):
    from shapely.ops import transform
    return transform(lambda xs, ys, zs=None: tuple(np.array(v) for v in zip(*[to_local(a, b) for a, b in zip(np.atleast_1d(xs), np.atleast_1d(ys))])), geom)


def load(name):
    return json.load(open(os.path.join(RAW, f"{name}.geojson")))["features"]


def dm(v):
    return int(round(v * 10))


def ring_flat(coords):
    pts = list(coords)[:-1]
    return [c for p in pts for c in (dm(p[0]), dm(p[1]))]


def polys(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    if hasattr(g, "geoms"):
        return [p for x in g.geoms for p in polys(x)]
    return []


def lines(g):
    if g.is_empty:
        return []
    if isinstance(g, LineString):
        return [g]
    if hasattr(g, "geoms"):
        return [p for x in g.geoms for p in lines(x)]
    return []


# ---------------------------------------------------------------- relieve (Terrarium z14)
Z = 14


def tile_xy(lat, lon):
    n = 2 ** Z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(lat * D2R)) / math.pi) / 2 * n
    return x, y


def fetch_tile(tx, ty):
    cache = os.path.join(RAW, "dem", f"{Z}_{tx}_{ty}.png")
    if not os.path.exists(cache):
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png"
        with urllib.request.urlopen(url, timeout=30) as r:
            open(cache, "wb").write(r.read())
    im = np.asarray(Image.open(cache).convert("RGB")).astype(np.float64)
    return im[..., 0] * 256 + im[..., 1] + im[..., 2] / 256 - 32768


corners = [to_ll(x, z) for x, z in [(XMIN, ZMIN), (XMAX, ZMIN), (XMAX, ZMAX), (XMIN, ZMAX)]]
txs = [tile_xy(la, lo) for la, lo in corners]
tx0, tx1 = int(min(t[0] for t in txs)), int(max(t[0] for t in txs))
ty0, ty1 = int(min(t[1] for t in txs)), int(max(t[1] for t in txs))
tiles = {}
with ThreadPoolExecutor(8) as ex:
    keys = [(x, y) for x in range(tx0, tx1 + 1) for y in range(ty0, ty1 + 1)]
    for k, t in zip(keys, ex.map(lambda k: fetch_tile(*k), keys)):
        tiles[k] = t
mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256))
for (x, y), t in tiles.items():
    mosaic[(y - ty0) * 256:(y - ty0 + 1) * 256, (x - tx0) * 256:(x - tx0 + 1) * 256] = t


def dem(lat, lon):
    x, y = tile_xy(lat, lon)
    px, py = (x - tx0) * 256 - 0.5, (y - ty0) * 256 - 0.5
    i, j = int(math.floor(px)), int(math.floor(py))
    u, v = px - i, py - j
    i = min(max(i, 0), mosaic.shape[1] - 2)
    j = min(max(j, 0), mosaic.shape[0] - 2)
    a, b, c, d = mosaic[j, i], mosaic[j, i + 1], mosaic[j + 1, i], mosaic[j + 1, i + 1]
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v


# ---------------------------------------------------------------- agua
water_polys = []
water_lines = []
for f in load("water"):
    g = proj(shape(f["geometry"]))
    if not g.intersects(RECT):
        continue
    g = g.intersection(RECT)
    if g.geom_type in ("Polygon", "MultiPolygon", "GeometryCollection"):
        water_polys += [p for p in polys(g) if p.area > 150]
    for l in lines(g):
        if l.length > 20:
            water_lines.append(l)
water_union = unary_union(water_polys).buffer(0)
water_out = [p.simplify(1.0) for p in polys(water_union) if p.area > 150]
pw = prep(water_union.buffer(4))

# ---------------------------------------------------------------- rejilla de relieve
STEP = 15
nx = int(round((XMAX - XMIN) / STEP)) + 1
nz = int(round((ZMAX - ZMIN) / STEP)) + 1
H = np.zeros((nz, nx))
from shapely.geometry import Point
for j in range(nz):
    for i in range(nx):
        x, z = XMIN + i * STEP, ZMIN + j * STEP
        la, lo = to_ll(x, z)
        H[j, i] = dem(la, lo)
# agua al nivel 0 con orillas suaves; tierra siempre por encima del agua
wm = np.zeros((nz, nx))
for j in range(nz):
    for i in range(nx):
        if pw.contains(Point(XMIN + i * STEP, ZMIN + j * STEP)):
            wm[j, i] = 1
from scipy.ndimage import gaussian_filter  # noqa: E402
wsoft = np.clip(gaussian_filter(wm, 1.0) * 1.6, 0, 1)
H = np.maximum(H, 1.2)
H = H * (1 - wsoft)
H = gaussian_filter(H, 0.6)


def h_at(x, z):
    fx, fz = (x - XMIN) / STEP, (z - ZMIN) / STEP
    i, j = int(min(max(math.floor(fx), 0), nx - 2)), int(min(max(math.floor(fz), 0), nz - 2))
    u, v = min(max(fx - i, 0), 1), min(max(fz - j, 0), 1)
    return (H[j, i] * (1 - u) + H[j, i + 1] * u) * (1 - v) + (H[j + 1, i] * (1 - u) + H[j + 1, i + 1] * u) * v


# ---------------------------------------------------------------- edificios
def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return float("nan")


def hash01(s):
    h = 2166136261
    for ch in s:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h / 4294967296


def height(p, area):
    h = num(p.get("height"))
    if h == h and h > 1.5:
        return h, True
    fl = num(p.get("num_floors"))
    if fl == fl and fl > 0:
        return fl * 3.1 + 1.4, True
    r = hash01(p["id"])
    c = (p.get("class") or "") + " " + (p.get("subtype") or "")
    if any(k in c for k in ("garage", "shed", "hut", "carport", "roof", "kiosk", "service", "greenhouse")):
        return 3.4 + r, False
    if any(k in c for k in ("industrial", "warehouse", "hangar", "factory")):
        return 8 + 5 * r, False
    if "church" in c or "chapel" in c:
        return 14, False
    if area < 45:
        return 3.5 + 2 * r, False
    if area < 160:
        return 6.5 + 5 * r, False
    if area < 600:
        return 10 + 9 * r, False
    return 12 + 10 * r, False


buildings = []
guessed = 0
for f in load("buildings"):
    g = proj(shape(f["geometry"]))
    c = g.centroid
    if not RECT.contains(c):
        continue
    for p in polys(g):
        p = p.simplify(0.4)
        if p.is_empty or p.area < 12:
            continue
        p = Polygon(p.exterior.coords, [i.coords for i in p.interiors if Polygon(i).area > 6])
        if not p.is_valid:
            p = p.buffer(0)
            if p.geom_type != "Polygon":
                continue
        p = p.__class__(p)  # copia
        if p.exterior.is_ccw:
            p = Polygon(list(p.exterior.coords)[::-1], [list(i.coords)[::-1] if not i.is_ccw else list(i.coords) for i in p.interiors])
        h, known = height(f["properties"], p.area)
        guessed += 0 if known else 1
        under = [h_at(x, z) for x, z in p.exterior.coords] + [h_at(c.x, c.y) for c in [p.representative_point()]]
        base = min(under)
        if pw.contains(p.representative_point()) and base < 0.5:
            base = 0.0
        # edificios en ladera: la cubierta nunca queda por debajo del terreno que cubren
        h = max(h, max(under) - base + 3)
        buildings.append({
            "o": ring_flat(p.exterior.coords),
            "i": [ring_flat(i.coords) for i in p.interiors],
            "b": round(base, 1),
            "h": round(h, 1),
            "t": round(hash01(f["properties"]["id"] + "t"), 2),
        })

# ---------------------------------------------------------------- viario y ferrocarril
ROAD_W = {"motorway": 18, "trunk": 15, "primary": 12.5, "secondary": 10.5, "tertiary": 9, "residential": 7,
          "living_street": 6, "unclassified": 7, "service": 4.5, "pedestrian": 4, "footway": 0, "cycleway": 0,
          "steps": 0, "path": 0, "track": 0, "sidewalk": 0, "crosswalk": 0, "bridleway": 0, "unknown": 5}
roads = []
rail = []
for f in load("segments"):
    p = f["properties"]
    st, cl = p.get("subtype"), p.get("class") or "unknown"
    if st not in ("road", "rail"):
        continue
    w = ROAD_W.get(cl, 5) if st == "road" else 0
    if st == "road" and w <= 0:
        continue
    if st == "road" and p.get("subclass") == "link":
        w = max(6, w * 0.6)
    g = proj(shape(f["geometry"]))
    if not g.intersects(RECT):
        continue
    # recorta los tramos en túnel (no se ven en superficie)
    tun = []
    for fl in p.get("road_flags") or []:
        if "is_tunnel" in (fl.get("values") or []):
            tun.append(fl.get("between") or [0, 1])
    if st == "rail" and any("is_tunnel" in (fl.get("values") or []) for fl in (p.get("rail_flags") or [])):
        continue
    parts = [g]
    if tun:
        keep, cur = [], 0.0
        for a, b in sorted(tun):
            if a > cur:
                keep.append((cur, a))
            cur = max(cur, b)
        if cur < 1:
            keep.append((cur, 1.0))
        parts = [substring(g, a, b, normalized=True) for a, b in keep if b - a > 1e-4]
    for part in parts:
        for l in lines(part.intersection(RECT.buffer(50))):
            l = l.simplify(0.8)
            if l.length < 3:
                continue
            flat = [c for x, z in l.coords for c in (dm(x), dm(z))]
            (roads if st == "road" else rail).append({"p": flat, "w": w} if st == "road" else {"p": flat})

# ---------------------------------------------------------------- usos del suelo
OPEN = {"park", "grass", "meadow", "forest", "wood", "garden", "cemetery", "golf_course", "recreation_ground",
        "village_green", "allotments", "farmland", "orchard", "scrub", "grassland", "heath", "pitch", "playground",
        "nature_reserve", "dog_park", "sports_centre", "stadium"}
GREY = {"industrial", "commercial", "retail", "railway", "port", "construction", "brownfield", "parking", "landfill"}
areas = []
for name in ("land_use", "land"):
    for f in load(name):
        p = f["properties"]
        cl, st = p.get("class") or "", p.get("subtype") or ""
        kind = "open" if (cl in OPEN or st in ("park", "recreation", "agriculture", "forest", "grass", "horticulture")) else \
            ("industrial" if cl in GREY or st in ("developed",) and cl in GREY else None)
        if name == "land" and st not in ("forest", "grass", "shrub", "wetland", "sand"):
            kind = None
        elif name == "land":
            kind = "open" if st != "sand" else None
        if not kind:
            continue
        g = proj(shape(f["geometry"]))
        if not g.intersects(RECT):
            continue
        for p2 in polys(g.intersection(RECT)):
            p2 = p2.simplify(2.0)
            if p2.area < 300:
                continue
            areas.append({"k": kind, "r": [ring_flat(p2.exterior.coords)] + [ring_flat(i.coords) for i in p2.interiors]})

out = {
    "meta": {
        "source": "Overture Maps Foundation (OpenStreetMap, Esri Community Maps, Microsoft, Google Open Buildings…) · Relieve: Mapzen Terrain Tiles (AWS)",
        "lat0": lat0, "lon0": lon0, "kx": kx, "ky": ky, "fe": fe, "fn": fn, "L": L,
        "rect": [XMIN, XMAX, ZMIN, ZMAX], "units": "dm",
        "counts": {"buildings": len(buildings), "guessedHeights": guessed, "roads": len(roads), "rail": len(rail),
                   "water": len(water_out), "areas": len(areas)},
    },
    "dem": {"x0": XMIN, "z0": ZMIN, "step": STEP, "nx": nx, "nz": nz, "h": [int(round(v * 10)) for v in H.ravel()]},
    "water": [[ring_flat(p.exterior.coords)] + [ring_flat(i.coords) for i in p.interiors] for p in water_out],
    "streams": [[c for x, z in l.simplify(1).coords for c in (dm(x), dm(z))] for l in water_lines],
    "areas": areas,
    "roads": roads,
    "rail": rail,
    "buildings": buildings,
}
with open(OUT, "w") as fh:
    json.dump(out, fh, separators=(",", ":"))
print(json.dumps(out["meta"], indent=1))
print(f"{os.path.getsize(OUT) / 1e6:.1f} MB → {OUT}")
