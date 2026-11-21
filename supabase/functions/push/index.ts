// Cantiere360 – notifiche push (scadenze, modifiche dei colleghi, nuove versioni, prova)
import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptPayload, generateVapidKeys, vapidAuthorization } from "./webpush.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = "https://appcantieri360.netlify.app";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Cfg = { public_key: string; private_key: string; secret: string };
let cfgCache: Cfg | null = null;
async function cfg(): Promise<Cfg> {
  if (cfgCache) return cfgCache;
  const { data } = await admin.from("push_config").select("public_key,private_key,secret").eq("id", 1).maybeSingle();
  if (data) return (cfgCache = data as Cfg);
  const k = await generateVapidKeys();
  const row = { id: 1, public_key: k.publicKey, private_key: k.privateKey, secret: crypto.randomUUID() + crypto.randomUUID() };
  await admin.from("push_config").upsert(row, { onConflict: "id", ignoreDuplicates: true });
  cfgCache = null; return cfg();
}
type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string };
type Msg = { title: string; body: string; url: string; tag: string };
async function sendOne(s: Sub, m: Msg, c: Cfg) {
  try {
    const body = await encryptPayload({ p256dh: s.p256dh, auth: s.auth }, JSON.stringify(m));
    const authz = await vapidAuthorization(s.endpoint, "mailto:appcantiere360@gmail.com", { publicKey: c.public_key, privateKey: c.private_key });
    const r = await fetch(s.endpoint, { method: "POST", headers: { Authorization: authz, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "normal" }, body, redirect: "manual", signal: AbortSignal.timeout(10000) });
    await r.body?.cancel();
    if (r.status === 404 || r.status === 410) await admin.from("push_subs").delete().eq("endpoint", s.endpoint);
    else if (r.status < 300) await admin.from("push_subs").update({ last_ok: new Date().toISOString() }).eq("endpoint", s.endpoint);
    return r.status;
  } catch (_) { return 0; }
}
async function sendTo(subs: Sub[], m: Msg) { const c = await cfg(); const st = await Promise.all(subs.map((s) => sendOne(s, m, c))); return st.filter((x) => x >= 200 && x < 300).length; }
async function subsWhere(f: (q: any) => any): Promise<Sub[]> { const { data } = await f(admin.from("push_subs").select("endpoint,user_id,p256dh,auth")); return (data || []) as Sub[]; }

const fd = (x?: string) => { if (!x) return ""; const p = String(x).slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(x); };
const cut = (x: unknown) => String(x ?? "").slice(0, 60);
function describe(col: string, d: any, ins: boolean): string | null {
  d = d || {}; const v = ins ? "ha aggiunto" : "ha modificato";
  const T: Record<string, string> = { giornale: "il giornale dei lavori", sopralluogo: "il verbale di sopralluogo", cse: "il verbale CSE", sal: "il rapportino / SAL" };
  switch (col) {
    case "reports": return `${v} ${T[d.mtype] || "il rapportino"} del ${fd(d.date)}`;
    case "boards": return `${v} il cantiere «${cut(d.name)}»`;
    case "cards": return `${v} l'attività «${cut(d.title)}»`;
    case "issues": return `${v} la segnalazione n. ${d.n ?? ""} «${cut(d.title)}»`;
    case "companies": return `${v} l'azienda «${cut(d.name)}»`;
    case "people": return `${v} la scheda di ${cut(d.name)}`;
    case "docs": return `${v} il documento «${cut(d.name)}»`;
    case "photos": return d.type === "plan" ? `${v} una pianta` : `${ins ? "ha aggiunto" : "ha modificato"} una foto`;
    case "punches": return `ha registrato ${d.type === "in" ? "l'entrata" : "l'uscita"} di ${cut(d.name)}`;
    default: return null;
  }
}
async function nameOf(uid: string) {
  const { data } = await admin.from("kv").select("data").eq("col", "_profiles").eq("id", uid).maybeSingle();
  return (data?.data?.name as string) || "Un collega";
}
function today() { return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" }); }
const days = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
async function deadlines() {
  const t = today();
  const { data } = await admin.from("kv").select("col,id,data").in("col", ["people", "companies", "issues", "cards", "boards", "settings"]);
  const rows = data || [];
  const mods = (rows.find((r: any) => r.col === "settings" && r.id === "modules")?.data) || {};
  const on = (k: string) => mods[k] !== false;
  const boards: Record<string, any> = {}; rows.filter((r: any) => r.col === "boards").forEach((r: any) => boards[r.id] = r.data);
  const out: { d: string; txt: string }[] = [];
  const add = (d: string, txt: string) => { if (!d) return; const n = days(t, d.slice(0, 10)); if (n <= 7) out.push({ d: d.slice(0, 10), txt: (n < 0 ? "SCADUTO " : "") + fd(d) + " · " + txt }); };
  for (const r of rows as any[]) {
    const x = r.data || {};
    if (r.col === "people" && on("scadenzario")) (x.docs || []).forEach((d: any) => add(d.expiry, `${d.type} (${x.name})`));
    if (r.col === "companies" && on("imprese")) (x.docs || []).forEach((d: any) => add(d.expiry, `${d.type} (${x.name})`));
    if (r.col === "issues" && on("planimetria") && x.status !== "chiusa") add(x.due, `Segnalazione n. ${x.n} ${x.title || ""}`);
    if (r.col === "cards" && x.due && !x.done && !x.dueDone && !x.archived && boards[x.boardId] && !boards[x.boardId].archived) add(x.due, `${x.title} (${boards[x.boardId].name})`);
  }
  out.sort((a, b) => a.d.localeCompare(b.d));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let b: any = {}; try { b = await req.json(); } catch (_) { /* vuoto */ }
  const c = await cfg();
  const internal = req.headers.get("x-c360-secret") === c.secret;
  let uid: string | null = null;
  if (!internal) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = await admin.auth.getUser(jwt);
    if (!data?.user) return json({ error: "Accesso richiesto" }, 401);
    uid = data.user.id;
  }
  switch (b.action) {
    case "key": return json({ publicKey: c.public_key });
    case "subscribe": {
      const s = b.sub || {}; if (!s.endpoint || !s.keys?.p256dh || !s.keys?.auth || !/^https:\/\//.test(s.endpoint)) return json({ error: "Dispositivo non valido" }, 400);
      await admin.from("push_subs").upsert({ endpoint: s.endpoint, user_id: uid, p256dh: s.keys.p256dh, auth: s.keys.auth, device: String(b.device || "").slice(0, 80) }, { onConflict: "endpoint" });
      return json({ ok: true });
    }
    case "unsubscribe": await admin.from("push_subs").delete().eq("endpoint", String(b.endpoint || "")).eq("user_id", uid); return json({ ok: true });
    case "devices": { const { data } = await admin.from("push_subs").select("endpoint,device,created_at,last_ok").eq("user_id", uid).order("created_at"); return json({ devices: data || [] }); }
    case "test": { const subs = await subsWhere((q) => q.eq("user_id", uid)); const n = await sendTo(subs, { title: "Cantiere360 · Prova", body: "Le notifiche funzionano su questo dispositivo.", url: SITE + "/#m-avvisi", tag: "c360-prova" }); return json({ sent: n, devices: subs.length }); }
    case "change": {
      if (!internal) return json({ error: "no" }, 403);
      const txt = describe(String(b.col), b.data, !!b.ins); if (!txt) return json({ skip: true });
      const who = await nameOf(String(b.owner));
      const subs = await subsWhere((q) => q.neq("user_id", b.owner));
      const url = b.col === "issues" ? SITE + "/#m-planimetria" : b.col === "reports" ? SITE + "/#r-" + b.id : SITE + "/#m-avvisi";
      return json({ sent: await sendTo(subs, { title: `Cantiere360 · ${who}`, body: `${who} ${txt}`, url, tag: "c360-mod-" + b.col }) });
    }
    case "release": {
      if (!internal) return json({ error: "no" }, 403);
      const subs = await subsWhere((q) => q);
      return json({ sent: await sendTo(subs, { title: "Aggiornamento di Cantiere360", body: String(b.note || "È disponibile una nuova versione: apri l'app per aggiornarla."), url: SITE + "/#home", tag: "c360-versione" }) });
    }
    case "deadlines": {
      if (!internal) return json({ error: "no" }, 403);
      const l = await deadlines(); if (!l.length) return json({ sent: 0, items: 0 });
      const late = l.filter((x) => x.txt.startsWith("SCADUTO")).length;
      const title = `Cantiere360 · ${l.length} scadenz${l.length === 1 ? "a" : "e"}${late ? ` (${late} già scadut${late === 1 ? "a" : "e"})` : ""}`;
      const subs = await subsWhere((q) => q);
      return json({ sent: await sendTo(subs, { title, body: l.slice(0, 5).map((x) => x.txt.replace(/^SCADUTO /, "")).join("\n"), url: SITE + "/#m-avvisi", tag: "c360-scadenze" }), items: l.length });
    }
  }
  return json({ error: "Azione sconosciuta" }, 400);
});
