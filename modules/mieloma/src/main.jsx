import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useCloudSync, LoginGate, CloudBar } from "./CloudSync.jsx";
import { KEY, makeStore } from "./localStore.js";
import { createRoot } from "react-dom/client";
import { CATALOG_INITIAL, SCHEMES_ALL, PATIENTS_DEMO, CONFIG_DEFAULT, BSAB_PRESETS } from "./data.js";
import { addDays } from "./engine.js";
import { AppCtx, Banner, Btn } from "./kit.jsx";
import { Inicio, PacientePage, CalculadoraPage } from "./pages_a.jsx";
import { ComparadorPage, EsquemasPage, PreciosPage, AvanzadasPage } from "./pages_b.jsx";
import { ImportarPage, CatalogoPage } from "./pages_d.jsx";
import { CostesPage, AcuerdosPage } from "./pages_e.jsx";
import { commercialAccess } from "./access.js";
import { emptyRef } from "./refcatalog.js";
import { AgendaPage, PanelPage, InformesPage, AuditoriaPage, AdminPage } from "./pages_c.jsx";
import { ENGINE_VERSION } from "./engine.js";

const ROUTES = [
  ["plataforma", "Comparafar", null], ["inicio", "Inicio", Inicio], ["paciente", "Paciente", PacientePage], ["calculadora", "Calculadora", CalculadoraPage], ["comparador", "Comparador", ComparadorPage],
  ["esquemas", "Esquemas", EsquemasPage], ["precios", "Precios", PreciosPage], ["importar", "Importar desde Oncofar", ImportarPage], ["catalogo", "Catálogo de medicamentos", CatalogoPage], ["costes", "Costes", CostesPage], ["acuerdos", "Acuerdos de gasto", AcuerdosPage], ["avanzadas", "Terapias avanzadas", AvanzadasPage], ["agenda", "Agenda", AgendaPage],
  ["panel", "Panel", PanelPage], ["informes", "Informes", InformesPage], ["auditoria", "Auditoría", AuditoriaPage], ["admin", "Administración", AdminPage],
];
const MODULES = [{ id: "mieloma", name: "Mieloma múltiple", desc: "Calculadora individualizada, comparación farmacoeconómica de esquemas, precios, terapias avanzadas, agenda e informes.", status: "Activo · datos pendientes de validación" }];
const todayIso = () => new Date().toISOString().slice(0, 10);

export function initialState() {
  const t = todayIso();
  return {
    v: 1,
    catalog: JSON.parse(JSON.stringify(CATALOG_INITIAL)),
    userSchemes: [],
    patients: JSON.parse(JSON.stringify(PATIENTS_DEMO)).map((p) => ({ ...p, demo: true, exposure: {} })),
    activePatient: "DEMO-001",
    config: { ...CONFIG_DEFAULT, alertDays: 7 },
    calcs: [],
    plans: [
      { id: "PL-D1", patient: "DEMO-001", schemeId: "1N-DVRD-SC", maint: "none", start: addDays(t, -40), done: {} },
      { id: "PL-D2", patient: "DEMO-002", schemeId: "1C-DVRD-IV", maint: "none", start: addDays(t, -20), done: {} },
      { id: "PL-D3", patient: "DEMO-003", schemeId: "2-KD", maint: "none", start: addDays(t, -9), done: {} },
    ],
    calc: { schemeId: "1N-ISAVRD-IV", maint: "none", horizon: "12", horizonCustom: 365, reuse: 0, roundStep: 0, applyCaps: false, cycles: {}, metric: "eff" },
    cmp: { items: [{ schemeId: "1N-ISAVRD-IV", maint: "none" }, { schemeId: "1N-DVRD-IV", maint: "none" }, { schemeId: "1N-DRD-IV", maint: "none" }], horizon: "12", horizonCustom: 365, reuse: 0, roundStep: 0, applyCaps: false },
    adv: { drug: "tec", stepUp: true, mode: "weekly", weeksBefore: 24, months: 12, reuse: 0, cfg: {}, inst: {}, scen: [] },
    report: {}, reportSource: "calc", log: [],
    // Módulos económicos (aditivos: los datos anteriores se abren con estos valores por defecto)
    ref: emptyRef(), priceVersions: [], agreements: [], spendEntries: [], importDrafts: [], importedPlans: [], estimates: [],
  };
}
// Completa un estado guardado con los valores por defecto (compatibilidad con copias anteriores).
const normalize = (s) => {
  const base = initialState();
  if (!s || s.v !== 1) return base;
  return { ...base, ...s, config: { ...base.config, ...s.config }, calc: { ...base.calc, ...s.calc }, cmp: { ...base.cmp, ...s.cmp }, adv: { ...base.adv, ...s.adv } };
};
const getLS = () => window.localStorage;
const store = makeStore(getLS, { normalize, fresh: initialState });
const load = () => {
  try { const raw = window.localStorage.getItem(KEY); return raw ? normalize(JSON.parse(raw)) : initialState(); } catch (e) { return initialState(); }
};
const routeFromHash = () => { const h = (window.location.hash || "").replace("#", ""); return ROUTES.some((r) => r[0] === h) ? h : "plataforma"; };

function Plataforma() {
  const { go } = React.useContext(AppCtx);
  return (
    <div className="page">
      <div className="lead"><h1>Comparafar</h1><p>Plataforma de apoyo para Farmacia Hospitalaria, organizada en módulos por área clínica. Cada módulo tiene su propio motor de cálculo, sus datos y su estado de validación.</p></div>
      <div className="tiles">
        {MODULES.map((m) => <button key={m.id} className="tile" onClick={() => go("inicio")}><strong>{m.name}</strong><span>{m.desc}</span><span className="muted">{m.status}</span></button>)}
        <div className="tile" style={{ cursor: "default", borderStyle: "dashed" }}><strong>Nuevos módulos</strong><span>Todavía no hay más módulos. Se añadirán a medida que se definan y validen.</span></div>
      </div>
    </div>
  );
}
function App() {
  const [S, setS] = useState(load);
  const [route, setRoute] = useState(routeFromHash);
  const [persist, setPersist] = useState(true);
  const cs = useCloudSync(S, setS, store);
  // Dónde se guarda el estado: por usuario con sesión, KEY en modo sin conexión, y en ningún sitio mientras se espera el login.
  const persistKey = cs.status === "ready" && cs.uid ? store.keyFor(cs.uid) : cs.status === "local" ? KEY : null;
  useEffect(() => { const h = () => setRoute(routeFromHash()); window.addEventListener("hashchange", h); return () => window.removeEventListener("hashchange", h); }, []);
  useEffect(() => {
    if (!persistKey) return;
    const id = setTimeout(() => { setPersist(store.save(persistKey, S)); }, 300);
    return () => clearTimeout(id);
  }, [S, persistKey]);
  useEffect(() => { window.scrollTo && window.scrollTo(0, 0); }, [route]);
  const go = useCallback((r) => { try { window.location.hash = r; } catch (e) {} setRoute(r); }, []);
  const set = useCallback((fn) => setS((x) => (typeof fn === "function" ? fn(x) : fn)), []);
  const schemes = useMemo(() => {
    const u = Object.fromEntries((S.userSchemes || []).map((s) => [s.id, s]));
    const base = SCHEMES_ALL.map((b) => u[b.id] || b);
    return [...base, ...(S.userSchemes || []).filter((s) => !SCHEMES_ALL.some((b) => b.id === s.id))];
  }, [S.userSchemes]);
  const pendingValidation = S.catalog.some((c) => !c.archived && c.status !== "verificado") || schemes.some((s) => !s.archived && s.status !== "verificado");
  const patient = S.patients.find((p) => p.code === S.activePatient) || S.patients[0];
  const resetAll = useCallback(() => { setS(initialState()); if (persistKey) store.clear(persistKey); }, [persistKey]);
  const exportState = useCallback(() => JSON.stringify({ app: "MieloFarma", engine: ENGINE_VERSION, exported: new Date().toISOString(), state: S }), [S]);
  const importState = useCallback((txt) => {
    try {
      const o = JSON.parse(txt); const s = o && o.state;
      if (!s || s.v !== 1 || !Array.isArray(s.catalog) || !Array.isArray(s.patients) || !s.patients.length) return { ok: false, text: "El JSON no tiene el formato de una copia de MieloFarma." };
      setS({ ...initialState(), ...s }); return { ok: true, text: "Copia restaurada." };
    } catch (e) { return { ok: false, text: "No se pudo leer el JSON: " + e.message }; }
  }, []);
  const access = commercialAccess(cs);
  const ctx = { S, set, go, route, schemes, patient, resetAll, exportState, importState, cs, access, user: cs.email || null };
  const Page = (ROUTES.find((r) => r[0] === route) || ROUTES[0])[2] || Plataforma;
  return (
    <AppCtx.Provider value={ctx}>
      <a href="#main" className="skip" onClick={(e) => { e.preventDefault(); const m = document.getElementById("main"); m && m.focus(); }}>Saltar al contenido</a>
      <div className="app">
        <aside className="side no-print">
          <div className="brand"><span className="logo" aria-hidden="true">C</span><div><b>Comparafar</b><span>Farmacia Hospitalaria</span></div></div>
          <nav aria-label="Principal"><a href="#plataforma" className={route === "plataforma" ? "on" : ""} aria-current={route === "plataforma" ? "page" : undefined} onClick={(e) => { e.preventDefault(); go("plataforma"); }}>Todos los módulos</a><div className="mod-h">Módulo · Mieloma múltiple</div>{ROUTES.filter((r) => r[0] !== "plataforma").map(([id, label]) => <a key={id} href={`#${id}`} className={route === id ? "on" : ""} aria-current={route === id ? "page" : undefined} onClick={(e) => { e.preventDefault(); go(id); }}>{label}</a>)}</nav>
          <div className="side-f">Motor v{ENGINE_VERSION}<br />Datos del Excel · sin verificar</div>
        </aside>
        <div className="main-w">
          {pendingValidation && <div className="demo-bar no-print" role="status">Precios y pautas importados del Excel <b>pendientes de validación</b>. No usar como información clínica verificada.{!persist && " · Este entorno no permite guardar entre sesiones."}</div>}
          <CloudBar cs={cs} />
          <main id="main" tabIndex={-1}>{cs.status === "login" || cs.status === "recovery" ? <LoginGate cs={cs} /> : cs.status === "boot" ? null : <Page />}</main>
        </div>
      </div>
    </AppCtx.Provider>
  );
}
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { e: null }; }
  static getDerivedStateFromError(e) { return { e }; }
  render() { return this.state.e ? <div style={{ padding: 24 }}><h2>Algo ha fallado</h2><p>{String(this.state.e.message)}</p><button onClick={() => { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); }}>Restablecer datos locales</button></div> : this.props.children; }
}
export { App, ROUTES };
if (typeof document !== "undefined" && document.getElementById("root")) createRoot(document.getElementById("root")).render(<Boundary><App /></Boundary>);
