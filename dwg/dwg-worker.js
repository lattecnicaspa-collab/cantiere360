// Cantiere360 – conversione DWG/DXF → SVG in un worker separato.
// Usa @mlightcad/libredwg-web 0.9.2 (GPL-3.0, sorgente: https://github.com/mlightcad/libredwg-web)
import { Dwg_File_Type, LibreDwg } from "./dist/libredwg-web.js";

const SKIP = new Set(["XLINE", "RAY", "VIEWPORT"]);

self.onmessage = async (ev) => {
  const { buf, dxf } = ev.data || {};
  try {
    const lib = await LibreDwg.create();
    const dwg = lib.dwg_read_data(buf, dxf ? Dwg_File_Type.DXF : Dwg_File_Type.DWG);
    if (!dwg) throw new Error("file non leggibile");
    const db = lib.convert(dwg);
    try { lib.dwg_free(dwg); } catch (_) {}
    if (!db || !db.tables || !db.tables.BLOCK_RECORD) throw new Error("file non leggibile");
    let n = 0;
    db.tables.BLOCK_RECORD.entries.forEach((b) => {
      if (Array.isArray(b.entities)) {
        b.entities = b.entities.filter((e) => !SKIP.has(e.type));
        if (/^\*model_space$/i.test(b.name)) n = b.entities.length;
      }
    });
    if (!n) throw new Error("nessun disegno nello spazio modello");
    const svg = lib.dwg_to_svg(db);
    self.postMessage({ ok: true, svg, n });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err || "errore") });
  }
};
