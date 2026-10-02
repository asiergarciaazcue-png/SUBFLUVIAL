"""
Descarga los datos reales del territorio Artaza → Ballonti desde Overture Maps
(edificios con altura, agua, viario y usos del suelo; derivados de OpenStreetMap
y otras fuentes abiertas) y los guarda como GeoJSON en data/raw/.

Uso:  pip install pyarrow shapely && python3 scripts/fetch_overture.py
Después: node scripts/build-territory.mjs  (genera public/territory.json)
"""
import json, os, sys
from concurrent.futures import ThreadPoolExecutor
import pyarrow.parquet as pq, pyarrow.fs as pafs, pyarrow as pa
from shapely import wkb
from shapely.geometry import mapping

RELEASE = os.environ.get("OVERTURE_RELEASE", "2026-09-23.1")
# lon_min, lat_min, lon_max, lat_max — cubre el trazado con margen para los planos amplios
BBOX = (-3.052, 43.292, -2.972, 43.352)
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "raw")

THEMES = {
    "buildings": ("buildings/type=building", ["id", "height", "num_floors", "class", "subtype", "geometry", "bbox"]),
    "water": ("base/type=water", ["id", "subtype", "class", "geometry", "bbox"]),
    "land_use": ("base/type=land_use", ["id", "subtype", "class", "geometry", "bbox"]),
    "land": ("base/type=land", ["id", "subtype", "class", "geometry", "bbox"]),
    "segments": ("transportation/type=segment", ["id", "subtype", "class", "subclass", "road_flags", "geometry", "bbox"]),
}

s3 = pafs.S3FileSystem(anonymous=True, region="us-west-2")


def overlaps(st):
    xmin, xmax, ymin, ymax = st
    return not (xmax < BBOX[0] or xmin > BBOX[2] or ymax < BBOX[1] or ymin > BBOX[3])


def scan_file(path, cols):
    pf = pq.ParquetFile(path, filesystem=s3)
    md = pf.metadata
    names = [md.row_group(0).column(i).path_in_schema for i in range(md.row_group(0).num_columns)]
    idx = {k: names.index("bbox." + k) for k in ("xmin", "xmax", "ymin", "ymax")}
    groups = []
    for g in range(md.num_row_groups):
        rg = md.row_group(g)
        s = {k: rg.column(i).statistics for k, i in idx.items()}
        if not all(v is not None and v.has_min_max for v in s.values()):
            continue
        if overlaps((s["xmin"].min, s["xmax"].max, s["ymin"].min, s["ymax"].max)):
            groups.append(g)
    if not groups:
        return []
    avail = [c for c in cols if c in pf.schema_arrow.names]
    tbl = pf.read_row_groups(groups, columns=avail)
    feats = []
    for row in tbl.to_pylist():
        b = row["bbox"]
        if not overlaps((b["xmin"], b["xmax"], b["ymin"], b["ymax"])):
            continue
        geom = wkb.loads(row.pop("geometry"))
        row.pop("bbox")
        feats.append({"type": "Feature", "properties": row, "geometry": mapping(geom)})
    return feats


def main():
    os.makedirs(OUT, exist_ok=True)
    wanted = sys.argv[1:] or list(THEMES)
    for name in wanted:
        prefix, cols = THEMES[name]
        files = [i.path for i in s3.get_file_info(pafs.FileSelector(f"overturemaps-us-west-2/release/{RELEASE}/theme={prefix}")) if i.path.endswith(".parquet") or "part-" in i.path]
        feats = []
        with ThreadPoolExecutor(16) as ex:
            for r in ex.map(lambda p: scan_file(p, cols), files):
                feats.extend(r)
        with open(os.path.join(OUT, f"{name}.geojson"), "w") as fh:
            json.dump({"type": "FeatureCollection", "features": feats}, fh, default=str)
        print(f"{name}: {len(feats)} entidades ({len(files)} ficheros)")


if __name__ == "__main__":
    main()
