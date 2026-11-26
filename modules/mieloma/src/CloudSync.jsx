import React, { useState, useEffect, useRef, useCallback } from "react";
import * as cloud from "./cloud.js";
import { diffCatalog, diffSchemes, diffHistoryVoids, isConflict } from "./cloudMap.js";
import { diffEco, ecoDiffEmpty, mergeEco, isMissingTable } from "./cloudEco.js";
import { CLOUD } from "./cloudConfig.js";
import { checkEmail, loginErrorMessage, parseAuthHash, checkNewPassword, MSG_LINK_CADUCADO, MSG_RESET_NEUTRO } from "./cloudAuth.js";

const ROLE_TXT = { lector: "solo lectura", editor: "editor", revisor: "revisor", admin: "administrador" };
const canEdit = (r) => r === "editor" || r === "revisor" || r === "admin";
const ecoSlice = (S) => ({ ref: S.ref, priceVersions: S.priceVersions, agreements: S.agreements, spendEntries: S.spendEntries });

// Sincroniza catálogo/precios/esquemas con Supabase. Los pacientes NO se sincronizan nunca.
export function useCloudSync(S, setS) {
  const [st, setSt] = useState({ status: typeof document === "undefined" ? "local" : "boot", role: null, email: null, msg: null, info: null, at: null, busy: false });
  const snap = useRef({ catalog: [], schemes: {}, eco: null });
  const ecoOff = useRef(!CLOUD.eco);   // se apaga solo si 003 aún no está aplicada
  const roleRef = useRef(null);
  const pushing = useRef(false);
  const recovering = useRef(false);
  const Sref = useRef(S); Sref.current = S;
  const upd = (p) => setSt((s) => ({ ...s, ...p }));

  const pull = useCallback(async () => {
    const r = await cloud.pullAll();
    snap.current = { catalog: r.catalog, schemes: Object.fromEntries(r.schemes.map((s) => [s.id, s])) };
    let eco = null;
    if (!ecoOff.current) {
      try { eco = await cloud.pullEco({ canSeeCommercial: canEdit(roleRef.current) }); }
      catch (e) { if (isMissingTable(e)) ecoOff.current = true; else throw e; }
    }
    snap.current.eco = eco;
    setS((s) => ({ ...s, catalog: r.catalog.length ? r.catalog : s.catalog, userSchemes: r.schemes, ...(eco ? mergeEco(ecoSlice(s), eco) : {}) }));
    upd({ at: new Date(), busy: false });
  }, [setS]);

  const start = useCallback(async (session) => {
    const p = await cloud.getProfile(session.user.id);
    if (!p || !p.active) { upd({ status: "login", msg: "Tu usuario no está activo. Pide acceso a un administrador." }); await cloud.signOut(); return; }
    roleRef.current = p.role;
    upd({ status: "ready", role: p.role, email: p.email || session.user.email, msg: null });
    await pull();
  }, [pull]);

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

  useEffect(() => {
    if (st.status !== "ready") return;
    let t;
    const off = cloud.subscribe(() => { clearTimeout(t); t = setTimeout(() => { if (!pushing.current) pull().catch(() => {}); }, 800); });
    return () => { clearTimeout(t); off(); };
  }, [st.status, pull]);

  // Envío de cambios locales (debounce)
  useEffect(() => {
    if (st.status !== "ready" || !canEdit(st.role)) return;
    const id = setTimeout(async () => {
      const cur = Sref.current;
      const dc = diffCatalog(cur.catalog, snap.current.catalog);
      const ds = diffSchemes(cur.userSchemes || [], snap.current.schemes);
      const de = !ecoOff.current && snap.current.eco ? diffEco(ecoSlice(cur), snap.current.eco) : null;
      const hv = !ecoOff.current ? diffHistoryVoids(cur.catalog, snap.current.catalog) : [];   // anulaciones en price_history (migración 004)
      if (!dc.upserts.length && !dc.prices.length && !ds.inserts.length && !ds.updates.length && !hv.length && (!de || ecoDiffEmpty(de))) return;
      pushing.current = true; upd({ busy: true });
      try {
        await cloud.pushCatalog(dc); await cloud.pushSchemes(ds); if (de && !ecoDiffEmpty(de)) await cloud.pushEco(de);
        if ((de && (de.voidVersions.length || de.voidSpend.length)) || hv.length) await cloud.pushVoids({ versions: de ? de.voidVersions : [], spend: de ? de.voidSpend : [], history: hv });
        await pull(); upd({ msg: null });
      } catch (e) {
        const m = isConflict(e) ? e.message + " Se ha recargado la versión de la nube; vuelve a aplicar tu cambio." : "No se pudo guardar en la nube: " + (e.message || e) + " Se ha recargado la versión de la nube.";
        try { await pull(); } catch (_) {}
        upd({ msg: m, busy: false });
      } finally { pushing.current = false; }
    }, 700);
    return () => clearTimeout(id);
  }, [S.catalog, S.userSchemes, S.ref, S.priceVersions, S.agreements, S.spendEntries, st.status, st.role, pull]);

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
  const logout = useCallback(async () => { try { await cloud.signOut(); } catch (e) {} upd({ status: "login", role: null, email: null }); }, []);
  const local = useCallback(() => upd({ status: "local", msg: null }), []);
  return { ...st, login, reset, setNewPassword, cancelRecovery, logout, local, canEdit: canEdit(st.role), roleTxt: ROLE_TXT[st.role] };
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
      {cs.msg && <span role="alert" style={{ display: "block", fontWeight: 600 }}>{cs.msg}</span>}
      {" "}<button className="btn" onClick={cs.logout}>Cerrar sesión</button>
    </div>
  );
}
