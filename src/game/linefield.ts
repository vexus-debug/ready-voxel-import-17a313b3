// @ts-nocheck
// Linefield cyberpunk downtown, imported 1:1 from the Minecraft map (512x512 core, 378 layers).
// Stored as 64 gzip tiles (64x64 columns each) of per-column runs: [u16 runCount][(u8 id, u8 len)...] bottom-up.
// Tiles stream in on demand when nearby chunks generate; world.ts restamps chunks once a tile arrives.
// Must not import values from world.ts at module scope (world.ts imports this module).
// Tiles are bundled as static files in public/linefield/lf_X_Z.bin.

export const LF_SIZE = 512;
export const LF_TS = 64; // tile size in columns
export const LF_YN = 378; // stored layers
export const LF_BASE = 17; // world y of the lowest stored layer
export const LF_GROUND = LF_BASE + 5; // street level
export const LF_X0 = 38 - 256; // world min corner (north of the kingdom)
export const LF_Z0 = -1000;
export const LF_CX = LF_X0 + LF_SIZE / 2, LF_CZ = LF_Z0 + LF_SIZE / 2;

interface Tile { data: Uint8Array; off: Uint32Array }
const tiles = new Map<string, Tile>();
const pending = new Set<string>();
const listeners: ((tx: number, tz: number) => void)[] = [];
export const onLinefieldTile = (f: (tx: number, tz: number) => void) => listeners.push(f);

async function load(tx: number, tz: number) {
  const k = `${tx}_${tz}`;
  if (tx < 0 || tz < 0 || tx >= LF_SIZE / LF_TS || tz >= LF_SIZE / LF_TS) return;
  try {
    const res = await fetch(`/linefield/lf_${k}.bin`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ds = res.body!.pipeThrough(new DecompressionStream("gzip"));
    const data = new Uint8Array(await new Response(ds).arrayBuffer());
    const off = new Uint32Array(LF_TS * LF_TS);
    let p = 0;
    for (let i = 0; i < off.length; i++) { off[i] = p; p += 2 + (data[p] | (data[p + 1] << 8)) * 2; }
    tiles.set(k, { data, off });
    for (const f of listeners) f(tx, tz);
  } catch (e) {
    console.warn("Linefield tile failed", k, e);
  } finally {
    pending.delete(k);
  }
}

/** Tile for local column (u,v) or null (and starts loading it). */
export function lfTile(tx: number, tz: number): Tile | null {
  const k = `${tx}_${tz}`;
  const t = tiles.get(k);
  if (t) return t;
  if (!pending.has(k)) { pending.add(k); load(tx, tz); }
  return null;
}

/** Writes column runs into `out(y, id)`; returns false if the tile is not loaded yet. */
export function lfColumn(u: number, v: number, out: (y: number, id: number) => void) {
  const t = lfTile((u / LF_TS) | 0, (v / LF_TS) | 0);
  if (!t) return false;
  const { data } = t;
  let p = t.off[(v % LF_TS) * LF_TS + (u % LF_TS)];
  const n = data[p] | (data[p + 1] << 8);
  p += 2;
  let y = LF_BASE;
  for (let r = 0; r < n; r++, p += 2) {
    const id = data[p], len = data[p + 1];
    if (id) for (let k = 0; k < len; k++) out(y + k, id);
    y += len;
  }
  return true;
}
