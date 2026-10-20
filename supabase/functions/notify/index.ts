// Pogona reminders: called every 15 minutes by pg_cron (x-cron-secret header),
// or by a signed-in user with {"test":true} to send themselves a test notification.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const APP_URL = "https://meirbal.github.io/pogona/";
const TZ = "Asia/Jerusalem";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" } });

function local(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 864e5);
const weekStart = (day: string) => { const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); };
const between = (h: number, a: number, b: number) => h >= a && h < b;

type Sub = { id: string; user_id: string; household_id: string; endpoint: string; p256dh: string; auth: string; prefs: Record<string, boolean> | null };
type Msg = { kind: string; pref: string; title: string; body: string; day?: string };
const wants = (s: Sub, pref: string) => !(s.prefs && s.prefs[pref] === false);

async function send(subs: Sub[], m: Msg) {
  let sent = 0, failed = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: m.title, body: m.body, url: APP_URL, tag: m.kind }), { TTL: 3600 });
      sent++;
    } catch (e) {
      const err = e as { statusCode?: number; body?: string };
      if (err.statusCode === 404 || err.statusCode === 410) await sb.from("push_subscriptions").delete().eq("id", s.id);
      else { failed++; console.error("push failed", err.statusCode, err.body ?? String(e)); }
    }
  }
  return { sent, failed };
}

async function remindersFor(hh: string, now: Date): Promise<Msg[] | null> {
  const L = local(now); const out: Msg[] = [];
  const recent = new Date(now.getTime() - 2 * 864e5).toISOString();
  const wSince = new Date(now.getTime() - 60 * 864e5).toISOString();
  const [dr, lo, wt, st, bu] = await Promise.all([
    sb.from("dragons").select("id,name,hatch").eq("household_id", hh),
    sb.from("logs").select("type,ts").eq("household_id", hh).in("type", ["salad", "insect"]).gte("ts", recent),
    sb.from("logs").select("dragon_id,ts").eq("household_id", hh).eq("type", "weight").gte("ts", wSince).order("ts", { ascending: false }),
    sb.from("household_settings").select("salad_prepared,location,supp,colony").eq("household_id", hh).maybeSingle(),
    sb.from("bulbs").select("id,label,installed").eq("household_id", hh),
  ]);
  if (dr.error || lo.error || wt.error || st.error || bu.error) { console.error("query failed", hh, dr.error || lo.error || wt.error || st.error || bu.error); return null; }
  const dragons = dr.data || []; if (!dragons.length) return out;
  const today = (t: string) => (lo.data || []).some(l => l.type === t && local(new Date(l.ts)).day === L.day);
  const names = dragons.map(d => d.name).join(" ו");
  // age: under 12 months (or unknown) insects daily; from 12 months only on the household's insect days
  const months = (h: string | null) => { if (!h) return null; const [y, m] = String(h).split("-").map(Number); if (!Number.isFinite(y) || !Number.isFinite(m)) return null; const [cy, cm] = L.day.split("-").map(Number); const v = (cy - y) * 12 + (cm - m); return v < 0 ? null : v; };
  const sv = (st.data?.supp || {}) as { insectDays?: number[] };
  const insDays = Array.isArray(sv.insectDays) && sv.insectDays.length ? sv.insectDays.map(Number) : [0, 3];
  const wd = new Date(L.day + "T12:00:00Z").getUTCDay();
  const eaters = dragons.filter(d => { const m = months(d.hatch); return m === null || m < 12 || insDays.includes(wd); });
  const whoIns = eaters.length && eaters.length < dragons.length ? `רק ל${eaters.map(d => d.name).join(" ו")}: ` : "";

  if (between(L.hour, 6, 10) && !today("salad")) out.push({ kind: "salad", pref: "salad", title: "בוקר טוב, זמן סלט", body: `חופן מהקופסה ל${names}, וכמה טיפות מים.` });
  if (eaters.length && between(L.hour, 17, 20) && !today("insect")) out.push({ kind: "insects", pref: "insects", title: "זמן חרקים", body: whoIns + "דוביה מאובקים בקערה העמוקה, ולהוציא את שאריות הסלט." });
  if (eaters.length && between(L.hour, 20, 22) && !today("insect")) out.push({ kind: "insects_late", pref: "insects", title: "עוד לא נרשמה ארוחת חרקים היום", body: whoIns + "אם כבר האכלתם, אפשר לסמן באפליקציה. אם לא, עדיף עכשיו לפני כיבוי האור." });
  if (between(L.hour, 9, 13)) {
    const late = dragons.filter(d => { const w = (wt.data || []).find(l => l.dragon_id === d.id); return !w || daysBetween(local(new Date(w.ts)).day, L.day) >= 7; });
    if (late.length) out.push({ kind: "weigh:" + late.map(d => d.id).sort().join(","), pref: "care", day: weekStart(L.day), title: "יום שקילה", body: `לשקול את ${late.map(d => d.name).join(" ו")}, בבוקר לפני אוכל.` });
    const sp = st.data?.salad_prepared as string | null;
    if (sp && daysBetween(sp, L.day) >= 3) out.push({ kind: "salad_box", pref: "care", title: daysBetween(sp, L.day) >= 4 ? "קופסת הסלט ישנה" : "הסלט נגמר מחר", body: "הזמן להכין קופסה חדשה: 2/3 ירוקים, 1/3 דלורית וזוקיני." });
    const col = (st.data?.colony || {}) as Record<string, unknown>;
    if (col.on) {
      const need = [["food", "אוכל יבש"], ["water", "ג׳ל מים או ירק"]].filter(([k]) => { const ymd = (x: unknown) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null; const v = ymd(col[k]) || ymd(col.started); return !!v && daysBetween(v, L.day) >= 3; }).map(([, l]) => l);
      if (need.length) out.push({ kind: "colony", pref: "colony", title: "המושבה מחכה", body: `לדוביה: ${need.join(" ו")}. ירק שלא נאכל להוציא לפני שמעפיש.` });
    }
    const meal = (col.meal || {}) as Record<string, unknown>;
    if (meal.on) {
      const ymd = (x: unknown) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null;
      const v = ymd(meal.carrot) || ymd(meal.started);
      if (v && daysBetween(v, L.day) >= 4) out.push({ kind: "colony_meal", pref: "colony", title: "תולעי הקמח צריכות לחות", body: "פרוסת גזר או תפוח אדמה חדשה, ולהוציא את הישנה לפני שמעפישה." });
    }
    for (const b of bu.data || []) {
      if (!b.installed) continue;
      const months = daysBetween(b.installed, L.day) / 30.4;
      if (months >= 12) out.push({ kind: "bulb:" + b.id, pref: "care", day: weekStart(L.day), title: "לבדוק החלפת נורה", body: `${b.label || "הנורה"} מותקנת ${Math.floor(months)} חודשים. ה־UVB נחלש גם כשהיא מאירה.` });
    }
  }
  const loc = (st.data?.location || {}) as { lat?: number; lon?: number; name?: string };
  if (loc.lat && (between(L.hour, 18, 21) || between(L.hour, 8, 11))) {
    const w = await forecast(loc.lat, loc.lon!, L);
    if (w && between(L.hour, 18, 21) && w.nightMin != null && w.nightMin <= 12) out.push({ kind: "cold", pref: "weather", title: `לילה קר: ${w.nightMin}° ב${loc.name || "חוץ"}`, body: "למדוד הלילה בתוך הטרריום. אם יורד מתחת ל־15° (18° לצעירים), גוף קרמי על טרמוסטט." });
    if (w && between(L.hour, 8, 11) && w.dayMax != null && w.dayMax >= 35) out.push({ kind: "heat", pref: "weather", title: `יום חם: ${w.dayMax}° ב${loc.name || "חוץ"}`, body: "לבדוק שהצד הקר נשאר עד 29°, ולהרחיק משמש ישירה. אם חם מדי, קודם להצל ולאוורר." });
  }
  return out;
}

let wxCache = new Map<string, { nightMin: number | null; dayMax: number | null } | null>();
async function forecast(lat: number, lon: number, L: { day: string }) {
  const k = `${lat},${lon}`; if (wxCache.has(k)) return wxCache.get(k)!;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&forecast_days=2&timezone=Asia%2FJerusalem`);
    if (!r.ok) throw new Error("http " + r.status);
    const j = await r.json(); const t: string[] = j.hourly.time, v: number[] = j.hourly.temperature_2m;
    const tmw = new Date(Date.parse(L.day) + 864e5).toISOString().slice(0, 10);
    const hr = (x: string) => Number(x.slice(11, 13));
    const ok = (i: number) => typeof v[i] === "number";
    const night = t.map((x, i) => i).filter(i => ok(i) && ((t[i].startsWith(L.day) && hr(t[i]) >= 20) || (t[i].startsWith(tmw) && hr(t[i]) <= 8)));
    const day = t.map((x, i) => i).filter(i => ok(i) && t[i].startsWith(L.day) && hr(t[i]) >= 9 && hr(t[i]) <= 18);
    const w = { nightMin: night.length ? Math.round(Math.min(...night.map(i => v[i]))) : null, dayMax: day.length ? Math.round(Math.max(...day.map(i => v[i]))) : null };
    wxCache.set(k, w); return w;
  } catch (e) { console.error("forecast", e); wxCache.set(k, null); return null; }
}

async function allSubs(): Promise<Sub[]> {
  const out: Sub[] = []; const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb.from("push_subscriptions").select("*").range(from, from + page - 1);
    if (error) { console.error(error); break; }
    out.push(...(data as Sub[])); if (!data || data.length < page) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  const sec = Object.fromEntries(((await sb.from("app_secrets").select("key,value")).data || []).map(r => [r.key, r.value]));
  webpush.setVapidDetails("mailto:balulu12@gmail.com", sec.vapid_public, sec.vapid_private);
  let body: Record<string, unknown> = {}; try { body = await req.json(); } catch { /* empty */ }

  if (body.test) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = await sb.auth.getUser(token); const user = data?.user;
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: subs } = await sb.from("push_subscriptions").select("*").eq("user_id", user.id);
    const r = await send((subs || []) as Sub[], { kind: "test", pref: "test", title: "פוגונה", body: "ההתראות עובדות. נתראה בשעת הסלט." });
    return json({ sent: r.sent, failed: r.failed, devices: (subs || []).length });
  }

  if (!sec.cron_secret || req.headers.get("x-cron-secret") !== sec.cron_secret) return json({ error: "unauthorized" }, 401);
  const now = new Date(); const L = local(now);
  wxCache = new Map(); // fresh forecast every run
  const subs = await allSubs();
  const byHh = new Map<string, Sub[]>(); for (const s of subs) { if (!byHh.has(s.household_id)) byHh.set(s.household_id, []); byHh.get(s.household_id)!.push(s); }
  let total = 0;
  for (const [hh, list0] of byHh) {
    const mem = await sb.from("household_members").select("user_id").eq("household_id", hh);
    const members = new Set((mem.data || []).map(m => m.user_id));
    const list = list0.filter(s => members.has(s.user_id));
    if (!list.length) continue;
    const msgs = await remindersFor(hh, now); if (!msgs) continue;
    for (const m of msgs) {
      const targets = list.filter(s => wants(s, m.pref)); if (!targets.length) continue;
      const day = m.day || L.day;
      const { error } = await sb.from("push_sent").insert({ household_id: hh, kind: m.kind, day });
      if (error) { if (error.code !== "23505") console.error("push_sent insert", error); continue; }
      const r = await send(targets, m); total += r.sent;
      if (r.sent === 0 && r.failed > 0) await sb.from("push_sent").delete().eq("household_id", hh).eq("kind", m.kind).eq("day", day); // retry next run
    }
  }
  return json({ ok: true, at: L, sent: total });
});
