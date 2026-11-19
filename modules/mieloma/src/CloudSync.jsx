import React, { useState, useEffect, useRef, useCallback } from "react";
import * as cloud from "./cloud.js";
import { diffCatalog, diffSchemes, isConflict } from "./cloudMap.js";

const ROLE_TXT = { lector: "solo lectura", editor: "editor", revisor: "revisor", admin: "administrador" };
const canEdit = (r) => r === "editor" || r === "revisor" || r === "admin";

// Sincroniza catálogo/precios/esquemas con Supabase. Los pacientes NO se sincronizan nunca.
export function useCloudSync(S, setS) {
  const [st, setSt] = useState({ status: typeof document === "undefined" ? "local" : "boot", role: null, email: null, msg: null, at: null, busy: false });
  const snap = useRef({ catalog: [], schemes: {} });
  const pushing = useRef(false);
  const Sref = useRef(S); Sref.current = S;
  const upd = (p) => setSt((s) => ({ ...s, ...p }));

  const pull = useCallback(async () => {
    const r = await cloud.pullAll();
    snap.current = { catalog: r.catalog, schemes: Object.fromEntries(r.schemes.map((s) => [s.id, s])) };
    setS((s) => ({ ...s, catalog: r.catalog.length ? r.catalog : s.catalog, userSchemes: r.schemes }));
    upd({ at: new Date(), busy: false });
  }, [setS]);

  const start = useCallback(async (session) => {
    const p = await cloud.getProfile(session.user.id);
    if (!p || !p.active) { upd({ status: "login", msg: "Tu usuario no está activo. Pide acceso a un administrador." }); await cloud.signOut(); return; }
    upd({ status: "ready", role: p.role, email: p.email || session.user.email, msg: null });
    await pull();
  }, [pull]);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const s = await cloud.getSession();
        if (dead) return;
        if (s) await start(s); else upd({ status: "login" });
      } catch (e) { if (!dead) upd({ status: "login", msg: "No se pudo conectar con la nube: " + (e.message || e) }); }
    })();
    return () => { dead = true; };
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
      if (!dc.upserts.length && !dc.prices.length && !ds.inserts.length && !ds.updates.length) return;
      pushing.current = true; upd({ busy: true });
      try {
        await cloud.pushCatalog(dc); await cloud.pushSchemes(ds);
        await pull(); upd({ msg: null });
      } catch (e) {
        const m = isConflict(e) ? e.message + " Se ha recargado la versión de la nube; vuelve a aplicar tu cambio." : "No se pudo guardar en la nube: " + (e.message || e) + " Se ha recargado la versión de la nube.";
        try { await pull(); } catch (_) {}
        upd({ msg: m, busy: false });
      } finally { pushing.current = false; }
    }, 700);
    return () => clearTimeout(id);
  }, [S.catalog, S.userSchemes, st.status, st.role, pull]);

  const login = useCallback(async (email, pw) => {
    try { upd({ busy: true, msg: null }); const s = await cloud.signIn(email, pw); await start(s); }
    catch (e) { upd({ status: "login", busy: false, msg: /Invalid login/i.test(e.message || "") ? "Correo o contraseña incorrectos." : "No se pudo iniciar sesión: " + (e.message || e) }); }
  }, [start]);
  const logout = useCallback(async () => { try { await cloud.signOut(); } catch (e) {} upd({ status: "login", role: null, email: null }); }, []);
  const local = useCallback(() => upd({ status: "local", msg: null }), []);
  return { ...st, login, logout, local, canEdit: canEdit(st.role), roleTxt: ROLE_TXT[st.role] };
}

export function LoginGate({ cs }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  return (
    <div className="page" style={{ maxWidth: 440, margin: "48px auto" }}>
      <div className="lead"><h1>Comparafar</h1><p>Acceso para el equipo del Servicio de Farmacia. Los cambios en precios y esquemas se comparten en tiempo real.</p></div>
      <form onSubmit={(e) => { e.preventDefault(); cs.login(email.trim(), pw); }} style={{ display: "grid", gap: 12 }}>
        <label>Correo<input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} /></label>
        <label>Contraseña<input type="password" required autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ width: "100%" }} /></label>
        {cs.msg && <div role="alert" style={{ color: "var(--bad, #b3261e)" }}>{cs.msg}</div>}
        <button type="submit" className="btn primary" disabled={cs.busy}>{cs.busy ? "Entrando…" : "Entrar"}</button>
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
      Base compartida · {cs.email} ({cs.roleTxt}) · {cs.busy ? "guardando…" : "sincronizado " + hh}
      {!cs.canEdit && " · Con tu rol no se guardan cambios en la nube."}
      {cs.msg && <span role="alert" style={{ display: "block", fontWeight: 600 }}>{cs.msg}</span>}
      {" "}<button className="btn" onClick={cs.logout}>Cerrar sesión</button>
    </div>
  );
}
