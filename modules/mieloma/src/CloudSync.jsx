import React, { useState, useEffect, useRef, useCallback } from "react";
import * as cloud from "./cloud.js";
import { diffCatalog, diffSchemes, diffHistoryVoids, isConflict, mergeCatalog, mergeSchemes, stableStringify } from "./cloudMap.js";
import { diffEco, ecoDiffEmpty, mergeEco, isMissingTable } from "./cloudEco.js";
import { CLOUD } from "./cloudConfig.js";
import { checkEmail, loginErrorMessage, parseAuthHash, checkNewPassword, MSG_LINK_CADUCADO, MSG_RESET_NEUTRO } from "./cloudAuth.js";

const ROLE_TXT = { lector: "solo lectura", editor: "editor", revisor: "revisor", admin: "administrador" };
const canEdit = (r) => r === "editor" || r === "revisor" || r === "admin";
const ecoSlice = (S) => ({ ref: S.ref, priceVersions: S.priceVersions, agreements: S.agreements, spendEntries: S.spendEntries });
const RETRY_MS = 30000, POLL_MS = 90000;

// Fusión catálogo + esquemas con el estado local (pura). Un lector no puede subir nada: la nube manda.
function mergeLocal(cur, remote, prev, editable) {
  if (!editable) return { catalog: remote.catalog.length ? remote.catalog : cur.catalog, userSchemes: remote.schemes, conflicts: [] };
  const mc = mergeCatalog(cur.catalog, remote.catalog, prev && prev.catalog);
  const ms = mergeSchemes(cur.userSchemes || [], remote.schemes, prev && prev.schemes);
  // Si el resultado es idéntico al estado actual se conservan las referencias (evita bucles de «cambio → subir → bajar»).
  const catalog = stableStringify(mc.catalog) === stableStringify(cur.catalog) ? cur.catalog : mc.catalog;
  const userSchemes = stableStringify(ms.schemes) === stableStringify(cur.userSchemes || []) ? cur.userSchemes : ms.schemes;
  return { catalog, userSchemes, conflicts: [...mc.conflicts, ...ms.conflicts] };
}
// Los cambios locales descartados por conflicto no se pierden sin rastro: se guardan para poder reaplicarlos.
function backupConflicts(list) {
  try { const k = "mielofarma:v1:conflicts"; const old = JSON.parse(window.localStorage.getItem(k) || "[]"); window.localStorage.setItem(k, JSON.stringify([...old, ...list.map((c) => ({ at: new Date().toISOString(), kind: c.kind, id: c.id, name: c.name, local: c.local }))].slice(-50))); } catch (e) {}
}

// Sincroniza catálogo/precios/esquemas con Supabase. Los pacientes NO se sincronizan nunca.
// `store` (opcional): almacenamiento local por usuario (localStore.js).
export function useCloudSync(S, setS, store) {
  const [st, setSt] = useState({ status: typeof document === "undefined" ? "local" : "boot", role: null, email: null, uid: null, msg: null, info: null, at: null, busy: false });
  const [retry, setRetry] = useState(0);
  const snap = useRef({ catalog: [], schemes: {}, eco: null });
  const ecoOff = useRef(!CLOUD.eco);   // se apaga solo si 003 aún no está aplicada
  const roleRef = useRef(null);
  const ownerRef = useRef(null);       // uid cuyo estado local está cargado
  const pushing = useRef(false);
  const needPull = useRef(false);      // un envío a medias exige refrescar la instantánea antes de reintentar (evita duplicar precios)
  const chain = useRef(Promise.resolve());
  const retryT = useRef(null);
  const recovering = useRef(false);
  const Sref = useRef(S); Sref.current = S;
  const stRef = useRef(st); stRef.current = st;
  const upd = (p) => setSt((s) => ({ ...s, ...p }));

  const doPull = async () => {
    const r = await cloud.pullAll();
    const prev = snap.current;
    let eco = null;
    if (!ecoOff.current) {
      try { eco = await cloud.pullEco({ canSeeCommercial: canEdit(roleRef.current) }); }
      catch (e) { if (isMissingTable(e)) ecoOff.current = true; else throw e; }
    }
    snap.current = { catalog: r.catalog, schemes: Object.fromEntries(r.schemes.map((s) => [s.id, s])), eco };
    const editable = canEdit(roleRef.current);
    const first = mergeLocal(Sref.current, r, prev.catalog.length || Object.keys(prev.schemes).length ? { catalog: prev.catalog, schemes: prev.schemes } : null, editable);
    // Se recalcula sobre el estado más reciente al aplicar, para no pisar ediciones hechas mientras se esperaba a la red.
    setS((s) => { const m = mergeLocal(s, r, prev.catalog.length || Object.keys(prev.schemes).length ? { catalog: prev.catalog, schemes: prev.schemes } : null, editable); return { ...s, catalog: m.catalog, userSchemes: m.userSchemes, ...(eco ? mergeEco(ecoSlice(s), eco) : {}) }; });
    needPull.current = false;
    if (first.conflicts.length) {
      backupConflicts(first.conflicts);
      upd({ at: new Date(), busy: false, msg: "Conflicto con cambios de otra persona en: " + first.conflicts.map((c) => c.name).join(", ") + ". Se ha mantenido la versión de la nube; tu versión se guardó como copia en este equipo. Vuelve a aplicar tu cambio." });
    } else upd({ at: new Date(), busy: false });
  };
  // Las bajadas se encadenan: dos a la vez dejarían la instantánea en un orden impredecible.
  const pull = useCallback(() => { const p = chain.current.catch(() => {}).then(doPull); chain.current = p; return p; }, [setS]);

  const start = useCallback(async (session) => {
    const p = await cloud.getProfile(session.user.id);
    if (!p || !p.active) { upd({ status: "login", msg: "Tu usuario no está activo. Pide acceso a un administrador." }); await cloud.signOut(); return; }
    roleRef.current = p.role;
    const uid = session.user.id;
    // Estado local propio de este usuario (nunca el de otra persona que usó antes el mismo navegador).
    if (store && ownerRef.current !== uid) { setS(store.enter(uid, stRef.current.status === "local" ? Sref.current : null)); ownerRef.current = uid; snap.current = { catalog: [], schemes: {}, eco: null }; }
    upd({ status: "ready", role: p.role, uid, email: p.email || session.user.email, msg: null });
    await pull();
  }, [pull, store, setS]);

  useEffect(() => {
    let dead = false, sub = null;
    // El hash se lee antes de crear el cliente de Supabase (que lo consume). Un enlace caducado/usado vuelve con #error=...otp_expired.
    let h = { expired: false, recovery: false };
    try { h = parseAuthHash(window.location.hash); } catch (_) {}
    let expiredMsg = null;
    if (h.expired) { expiredMsg = MSG_LINK_CADUCADO; try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch (_) {} }
    if (h.recovery) recovering.current = true;
    (async () => {
      try {
        sub = cloud.onRecovery(() => { recovering.current = true; upd({ status: "recovery", msg: null, info: null, busy: false }); });
        const s = await cloud.getSession();
        if (dead) return;
        if (recovering.current) upd({ status: "recovery", msg: null, info: null });   // sesión temporal de recuperación: no entrar en la app hasta elegir contraseña
        else if (s) await start(s);
        else upd({ status: "login", msg: expiredMsg });
      } catch (e) { if (!dead) upd({ status: "login", msg: "No se pudo conectar con la nube: " + (e.message || e) }); }
    })();
    return () => { dead = true; if (sub) sub.unsubscribe(); };
  }, [start]);

  // Cambios de otras personas: tiempo real + recuperación. Un evento perdido (equipo en suspensión, red caída, canal roto)
  // no se reenvía, así que se vuelve a bajar al reconectar el canal, al recuperar la red, al volver a la pestaña y cada 90 s.
  useEffect(() => {
    if (st.status !== "ready") return;
    let t, down = false;
    const trigger = () => { clearTimeout(t); t = setTimeout(() => { if (!pushing.current) pull().catch(() => {}); }, 800); };
    const off = cloud.subscribe(trigger, (status) => {
      if (status === "SUBSCRIBED") { if (down) { down = false; trigger(); } }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") down = true;
    });
    const visible = () => { if (typeof document === "undefined" || document.visibilityState === "visible") trigger(); };
    const poll = setInterval(visible, POLL_MS);
    window.addEventListener("online", trigger); window.addEventListener("focus", trigger); document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(t); clearInterval(poll); window.removeEventListener("online", trigger); window.removeEventListener("focus", trigger); document.removeEventListener("visibilitychange", visible); off(); };
  }, [st.status, pull]);

  // Envío de cambios locales (debounce)
  useEffect(() => {
    if (st.status !== "ready" || !canEdit(st.role)) return;
    const id = setTimeout(async () => {
      pushing.current = true;
      try {
        if (needPull.current) await pull();
        const cur = Sref.current;
        const dc = diffCatalog(cur.catalog, snap.current.catalog);
        const ds = diffSchemes(cur.userSchemes || [], snap.current.schemes);
        const de = !ecoOff.current && snap.current.eco ? diffEco(ecoSlice(cur), snap.current.eco) : null;
        const hv = !ecoOff.current ? diffHistoryVoids(cur.catalog, snap.current.catalog) : [];   // anulaciones en price_history (migración 004)
        if (!dc.upserts.length && !dc.prices.length && !ds.inserts.length && !ds.updates.length && !hv.length && (!de || ecoDiffEmpty(de))) return;
        upd({ busy: true });
        needPull.current = true;   // si algo falla a mitad, la instantánea ya no es fiable hasta volver a bajar
        await cloud.pushCatalog(dc); await cloud.pushSchemes(ds); if (de && !ecoDiffEmpty(de)) await cloud.pushEco(de);
        if ((de && (de.voidVersions.length || de.voidSpend.length)) || hv.length) await cloud.pushVoids({ versions: de ? de.voidVersions : [], spend: de ? de.voidSpend : [], history: hv });
        await pull(); upd({ msg: null });
      } catch (e) {
        // Los cambios locales NO se descartan (la bajada los fusiona). Un conflicto se resuelve a favor de la nube con aviso y copia;
        // cualquier otro error se reintenta solo.
        const conflict = isConflict(e);
        let pulled = true;
        try { await pull(); } catch (_) { pulled = false; }
        if (!conflict || !pulled) {
          upd({ msg: "No se pudo guardar en la nube: " + (e.message || e) + " Tus cambios se conservan en este equipo y se reintentarán.", busy: false });
          clearTimeout(retryT.current); retryT.current = setTimeout(() => setRetry((n) => n + 1), RETRY_MS);
        } else upd({ busy: false });
      } finally { pushing.current = false; }
    }, 700);
    return () => clearTimeout(id);
  }, [S.catalog, S.userSchemes, S.ref, S.priceVersions, S.agreements, S.spendEntries, st.status, st.role, pull, retry]);
  useEffect(() => () => clearTimeout(retryT.current), []);

  const login = useCallback(async (email, pw) => {
    const v = checkEmail(email);
    if (!v.ok) { upd({ status: "login", busy: false, info: null, msg: v.msg }); return; }   // no se llama a Supabase
    try { upd({ busy: true, msg: null, info: null }); const s = await cloud.signIn(v.email, pw); await start(s); }
    catch (e) { upd({ status: "login", busy: false, msg: loginErrorMessage(e) }); }
  }, [start]);
  const reset = useCallback(async (email) => {
    const v = checkEmail(email);
    if (!v.ok) { upd({ busy: false, info: null, msg: v.msg }); return; }
    try { upd({ busy: true, msg: null, info: null }); await cloud.requestPasswordReset(v.email); upd({ busy: false, info: MSG_RESET_NEUTRO }); }
    catch (e) { upd({ busy: false, msg: "No se pudo enviar el correo de recuperación: " + (e.message || e) }); }
  }, []);
  const setNewPassword = useCallback(async (a, b) => {
    const bad = checkNewPassword(a, b);
    if (bad) { upd({ msg: bad }); return; }
    try {
      upd({ busy: true, msg: null });
      await cloud.updatePassword(a);
      recovering.current = false;
      const s = await cloud.getSession();
      if (s) await start(s); else upd({ status: "login", busy: false, info: "Contraseña cambiada. Inicia sesión." });
    } catch (e) { upd({ busy: false, msg: "No se pudo cambiar la contraseña: " + (e.message || e) }); }
  }, [start]);
  const cancelRecovery = useCallback(async () => { recovering.current = false; try { await cloud.signOut(); } catch (e) {} upd({ status: "login", msg: null, info: null, busy: false }); }, []);
  const logout = useCallback(async () => {
    try { await cloud.signOut(); } catch (e) {}
    // Se guarda el estado del usuario y se vacía la memoria: quien entre después en este navegador no hereda sus datos locales.
    if (store && ownerRef.current) { setS(store.leave(ownerRef.current, Sref.current)); ownerRef.current = null; }
    snap.current = { catalog: [], schemes: {}, eco: null }; roleRef.current = null;
    upd({ status: "login", role: null, email: null, uid: null });
  }, [store, setS]);
  const local = useCallback(() => upd({ status: "local", msg: null }), []);
  return { ...st, login, reset, setNewPassword, cancelRecovery, logout, local, canEdit: canEdit(st.role), roleTxt: ROLE_TXT[st.role], ecoSync: !!CLOUD.eco };
}

const eyeStyle = { position: "absolute", right: 4, top: 0, bottom: 0, background: "none", border: 0, cursor: "pointer", padding: "0 8px" };
function PwField({ label, value, onChange, autoComplete, minLength }) {
  const [show, setShow] = useState(false);
  return (
    <label>{label}
      <span style={{ position: "relative", display: "block" }}>
        <input type={show ? "text" : "password"} required minLength={minLength} autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%", paddingRight: 40, boxSizing: "border-box" }} />
        <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={show} title={show ? "Ocultar contraseña" : "Mostrar contraseña"} style={eyeStyle}>{show ? "🙈" : "👁"}</button>
      </span>
    </label>
  );
}
const Msgs = ({ cs }) => (<>
  {cs.msg && <div role="alert" style={{ color: "var(--bad, #b3261e)" }}>{cs.msg}</div>}
  {cs.info && <div role="status">{cs.info}</div>}
</>);

function RecoveryGate({ cs }) {
  const [a, setA] = useState(""); const [b, setB] = useState("");
  return (
    <div className="page" style={{ maxWidth: 440, margin: "48px auto" }}>
      <div className="lead"><h1>Elige una nueva contraseña</h1><p>Mínimo 8 caracteres. Después entrarás directamente.</p></div>
      <form noValidate onSubmit={(e) => { e.preventDefault(); cs.setNewPassword(a, b); }} style={{ display: "grid", gap: 12 }}>
        <PwField label="Nueva contraseña" value={a} onChange={setA} autoComplete="new-password" minLength={8} />
        <PwField label="Repite la nueva contraseña" value={b} onChange={setB} autoComplete="new-password" minLength={8} />
        <Msgs cs={cs} />
        <button type="submit" className="btn primary" disabled={cs.busy}>{cs.busy ? "Guardando…" : "Guardar contraseña"}</button>
        <button type="button" className="btn" onClick={cs.cancelRecovery}>Cancelar</button>
      </form>
    </div>
  );
}

export function LoginGate({ cs }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  if (cs.status === "recovery") return <RecoveryGate cs={cs} />;
  return (
    <div className="page" style={{ maxWidth: 440, margin: "48px auto" }}>
      <div className="lead"><h1>Comparafar</h1><p>Acceso para el equipo del Servicio de Farmacia. Los cambios en precios y esquemas se comparten en tiempo real.</p></div>
      <form noValidate onSubmit={(e) => { e.preventDefault(); cs.login(email, pw); }} style={{ display: "grid", gap: 12 }}>
        <label>Correo<input type="email" required autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} /></label>
        <PwField label="Contraseña" value={pw} onChange={setPw} autoComplete="current-password" />
        <Msgs cs={cs} />
        <button type="submit" className="btn primary" disabled={cs.busy}>{cs.busy ? "Entrando…" : "Entrar"}</button>
        <button type="button" className="btn" disabled={cs.busy} onClick={() => cs.reset(email)}>¿Olvidaste tu contraseña?</button>
        <button type="button" className="btn" onClick={cs.local}>Usar sin conexión (datos solo en este navegador)</button>
      </form>
      <p className="muted" style={{ marginTop: 16 }}>No hay registro público: las cuentas las crea un administrador. Los datos de pacientes nunca se envían a la nube.</p>
    </div>
  );
}

export function CloudBar({ cs }) {
  if (cs.status === "boot") return <div className="demo-bar no-print" role="status">Conectando con la base de datos compartida…</div>;
  if (cs.status === "local") return <div className="demo-bar no-print" role="status">Modo sin conexión: los cambios solo se guardan en este navegador. <button className="btn" onClick={cs.logout}>Iniciar sesión</button></div>;
  if (cs.status !== "ready") return null;
  const hh = cs.at ? cs.at.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—";
  return (
    <div className="demo-bar no-print" role="status">
      Base compartida · {cs.email} ({cs.roleTxt}) · {cs.busy ? "guardando…" : "sincronizado " + hh} · Pacientes: solo en este equipo
      {!cs.canEdit && " · Con tu rol no se guardan cambios en la nube."}
      {!cs.ecoSync && <span style={{ display: "block" }}>Costes por versión, Acuerdos de gasto y Catálogo de medicamentos aún NO se comparten: se guardan solo en este navegador (y «Anular» no está disponible en modo compartido).</span>}
      {cs.msg && <span role="alert" style={{ display: "block", fontWeight: 600 }}>{cs.msg}</span>}
      {" "}<button className="btn" onClick={cs.logout}>Cerrar sesión</button>
    </div>
  );
}
