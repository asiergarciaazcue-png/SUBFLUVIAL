"""Utilidades para el tracking 3D de Google Earth Studio (modelo esférico R = 6 371 010 m)."""
import json, math, itertools
import numpy as np
R = 6371010.0

def sph(lat, lon, h):
    la, lo = math.radians(lat), math.radians(lon)
    return np.array([(R + h) * math.cos(la) * math.cos(lo), (R + h) * math.cos(la) * math.sin(lo), (R + h) * math.sin(la)])

def enu(lat, lon):
    la, lo = math.radians(lat), math.radians(lon)
    E = np.array([-math.sin(lo), math.cos(lo), 0])
    N = np.array([-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la)])
    U = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    return E, N, U

def R1(ax, d):
    t = math.radians(d); c, s = math.cos(t), math.sin(t)
    if ax == 'x': return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if ax == 'y': return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def camera_basis(fr):
    """Base de la cámara en coordenadas geocéntricas: (derecha, arriba, adelante)."""
    r = fr['rotation']
    M = R1('x', r['x']) @ R1('y', r['y']) @ R1('z', r['z'])
    c = fr['coordinate']
    _, _, U = enu(c['latitude'], c['longitude'])
    fwd = M[:, 2]
    up = M[:, 1] * (1 if M[:, 1] @ U > 0 else -1)
    right = np.cross(fwd, up)
    return right, up, fwd


def convert(tracking_path, territory_path, out_path):
    """Convierte el tracking de Earth Studio al marco local del trazado (x a lo largo, y arriba, z a la derecha)."""
    j = json.load(open(tracking_path))
    meta = json.load(open(territory_path))['meta']
    lat0, lon0, fe, fn = meta['lat0'], meta['lon0'], meta['fe'], meta['fn']
    O = sph(lat0, lon0, 0)
    E, N, U = enu(lat0, lon0)
    X = fe * E + fn * N
    Z = fn * E - fe * N
    B = np.stack([X, U, Z], 0)  # filas: ejes locales en geocéntricas
    frames = []
    for fr in j['cameraFrames']:
        P = np.array([fr['position'][k] for k in 'xyz'])
        rr = np.linalg.norm(P)
        lat, lon, h = math.degrees(math.asin(P[2] / rr)), math.degrees(math.atan2(P[1], P[0])), rr - R
        # posición: misma proyección que el trazado (lat/lon → metros locales con kx, ky)
        e, n = (lon - lon0) * meta['kx'], (lat - lat0) * meta['ky']
        pos = [e * fe + n * fn, h, e * fn - n * fe]
        # orientación: vectores en la ENU esférica de la cámara → ejes locales del trazado
        Ec, Nc, Uc = enu(lat, lon)
        Bc = np.stack([fe * Ec + fn * Nc, Uc, fn * Ec - fe * Nc], 0)
        right, up, fwd = camera_basis(fr)
        frames.append({
            'p': [round(float(v), 3) for v in pos],
            'r': [round(float(v), 6) for v in Bc @ right],
            'u': [round(float(v), 6) for v in Bc @ up],
            'f': [round(float(v), 6) for v in Bc @ fwd],
            'fov': fr['fovVertical'],
        })
    json.dump({'width': j['width'], 'height': j['height'], 'fps': j['frameRate'], 'frames': frames}, open(out_path, 'w'))
    return frames


if __name__ == '__main__':
    import sys
    convert(sys.argv[1], 'public/territory.json', sys.argv[2])
    print('ok')
