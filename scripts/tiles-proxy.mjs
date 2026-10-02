/* Proxy local para Google Photorealistic 3D Tiles (Map Tiles API).
   - Añade la clave (GOOGLE_MAPS_API_KEY, leída del entorno o de .env.local): nunca llega al navegador ni al repo.
   - Propaga el parámetro `session` que exige la API a todas las peticiones.
   - Caché en disco durante el render (data/cache/tiles, no versionada).
   Uso: NODE_USE_ENV_PROXY=1 node scripts/tiles-proxy.mjs   (escucha en http://localhost:8787) */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const env = fs.existsSync(".env.local") ? Object.fromEntries(fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => l.split(/=(.*)/s).slice(0, 2).map((s) => s.trim()))) : {};
const KEY = process.env.GOOGLE_MAPS_API_KEY ?? env.GOOGLE_MAPS_API_KEY;
if (!KEY) { console.error("Falta GOOGLE_MAPS_API_KEY"); process.exit(1); }
const PORT = Number(process.env.TILES_PORT ?? 8787);
const CACHE = path.resolve("data/cache/tiles");
fs.mkdirSync(CACHE, { recursive: true });
let session = null, hits = 0, misses = 0;

http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  try {
    const u = new URL(req.url, "http://localhost");
    if (u.searchParams.get("session")) session = u.searchParams.get("session");
    u.searchParams.delete("key");
    const cacheKey = crypto.createHash("sha1").update(u.pathname).digest("hex");
    const file = path.join(CACHE, cacheKey);
    if (!u.pathname.endsWith("root.json") && fs.existsSync(file)) {
      hits++;
      const meta = JSON.parse(fs.readFileSync(file + ".meta"));
      res.writeHead(200, { "Content-Type": meta.type });
      return res.end(fs.readFileSync(file));
    }
    if (session && !u.searchParams.get("session") && !u.pathname.endsWith("root.json")) u.searchParams.set("session", session);
    u.searchParams.set("key", KEY);
    let r;
    for (let a = 0; a < 4; a++) {
      try { r = await fetch(`https://tile.googleapis.com${u.pathname}${u.search}`); if (r.status < 500) break; } catch (e) { if (a === 3) throw e; }
      await new Promise((ok) => setTimeout(ok, 500 * 2 ** a));
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get("content-type") ?? "application/octet-stream";
    if (r.ok) { misses++; fs.writeFileSync(file, buf); fs.writeFileSync(file + ".meta", JSON.stringify({ type })); }
    res.writeHead(r.status, { "Content-Type": type });
    res.end(buf);
  } catch (e) {
    res.writeHead(502); res.end(String(e));
  }
}).listen(PORT, () => console.log(`tiles-proxy en http://localhost:${PORT}`));
setInterval(() => console.log(`caché: ${hits} aciertos · ${misses} descargas`), 30000).unref();
