import React, { useState, useMemo } from "react";
import { computeScheme, sensitivity, resolvePatient, BSA_METHODS, bsa, HORIZONS, fmtEUR, fmtNum, fmtPct, fmtDate, addDays, ENGINE_VERSION, DAYS_PER_MONTH } from "./engine.js";
import { LINE_LABEL, DRUGS } from "./data.js";
import { FINDINGS } from "./audit.js";
import { useApp, Btn, Field, NumInput, Select, Check, Card, Banner, Tabs, Chip, schemeChips, Kpi, Eur, Dlt, Empty, LineChart, StackBars, Legend, drugColor, GROUP_LABEL, CopyBtn, cx } from "./kit.jsx";
import { ecoSection } from "./exportsEco.js";
import { calcOpts, buildCalcReport, calcCSV, clinicalSummary, lineLabel, dn, horizonLabel } from "./report.js";

export const today = () => new Date().toISOString().slice(0, 10);
export const enginePat = (p) => ({ weight: p.weight, height: p.height, scMethod: p.scMethod, scOverride: p.scOverride });
export const schemeOptions = (schemes, includeArchived = false) => {
  const groups = {};
  schemes.filter((s) => includeArchived || !s.archived).forEach((s) => { (groups[s.line] = groups[s.line] || []).push(s); });
  return Object.keys(LINE_LABEL).filter((k) => groups[k]).map((k) => ({ group: LINE_LABEL[k], items: groups[k].map((s) => ({ value: s.id, label: `${s.name}${s.trial ? " · " + s.trial.replace(" (según Excel)", "") : ""}${s.noFinanciada ? " (no financ.)" : ""}${s.fueraFicha ? " (fuera ficha)" : ""}` })) }));
};

/* ============================== INICIO ============================== */
export function Inicio() {
  const { S, go, set, schemes } = useApp();
  const [q, setQ] = useState("");
  const tiles = [
    ["calculadora", "Nuevo cálculo", "Dosis, envases, calendario y coste de un esquema para un paciente."],
    ["comparador", "Comparador de esquemas", "2–4 esquemas, mismo paciente, horizontes y sensibilidad."],
    ["agenda", "Agenda", "Calendario planificado y registro de dosis realmente administradas."],
    ["paciente", "Pacientes", "Registro pseudonimizado, SC calculada e historial de visitas."],
    ["precios", "Catálogo de costes", "Precios con vigencia, historial e importación CSV."],
    ["informes", "Informes", "Informe imprimible, CSV y resumen para historia clínica."],
    ["avanzadas", "Terapias avanzadas", "Biespecíficos con step-up configurable y CAR-T."],
    ["auditoria", "Auditoría del Excel", "Hallazgos, regresión y trazabilidad hoja a módulo."],
  ];
  const results = useMemo(() => {
    const t = q.trim().toLowerCase(); if (t.length < 2) return [];
    const r = [];
    schemes.forEach((s) => { if ((s.name + " " + s.trial + " " + s.id).toLowerCase().includes(t)) r.push({ k: "Esquema", label: `${s.name} · ${LINE_LABEL[s.line]}`, go: () => { set((x) => ({ ...x, calc: { ...x.calc, schemeId: s.id, maint: "none", cycles: {} } })); go("calculadora"); } }); });
    S.catalog.forEach((c) => { if ((c.label + " " + c.drug).toLowerCase().includes(t)) r.push({ k: "Precio", label: c.label, go: () => go("precios") }); });
    S.patients.forEach((p) => { if (p.code.toLowerCase().includes(t)) r.push({ k: "Paciente", label: p.code, go: () => { set((x) => ({ ...x, activePatient: p.code })); go("paciente"); } }); });
    FINDINGS.forEach((f) => { if ((f.title + f.id + f.cells).toLowerCase().includes(t)) r.push({ k: "Auditoría", label: `${f.id} · ${f.title}`, go: () => go("auditoria") }); });
    return r.slice(0, 10);
  }, [q, schemes, S.catalog, S.patients]);
  const pend = schemes.filter((s) => s.status !== "verificado" && !s.archived).length;
  const sinPrecio = S.catalog.filter((c) => !c.archived && !c.history.length).length;
  const crit = FINDINGS.filter((f) => f.sev === "crit").length;
  return (
    <div className="page">
      <div className="lead">
        <h1>Mieloma múltiple</h1>
        <p>Apoyo a la consulta de Farmacia Hospitalaria en mieloma múltiple. Parte de tu Excel de costes 2026: conserva sus esquemas y precios, corrige sus errores de cálculo y añade comparación, calendario e informes.</p>
      </div>
      <div className="search"><label htmlFor="q">Búsqueda rápida</label><input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Esquema, fármaco, paciente o hallazgo (p. ej. «Isa-Kd», «lenalidomida», «REF-02»)" />
        {results.length > 0 && <ul className="search-r">{results.map((r, i) => <li key={i}><button onClick={r.go}><span className="k">{r.k}</span>{r.label}</button></li>)}</ul>}
      </div>
      <div className="tiles">{tiles.map(([id, t, d]) => <button key={id} className="tile" onClick={() => go(id)}><strong>{t}</strong><span>{d}</span></button>)}</div>
      <div className="grid2">
        <Card title="Últimos cálculos" sub="Se guardan desde la calculadora; recalculan con los precios vigentes al abrirlos.">
          {S.calcs.length === 0 ? <Empty title="Aún no hay cálculos guardados" action={<Btn variant="primary" onClick={() => go("calculadora")}>Hacer un cálculo</Btn>}>Calcula un esquema y pulsa «Guardar cálculo».</Empty> :
            <div className="tbl-w"><table className="tbl"><thead><tr><th>Fecha</th><th>Paciente</th><th>Esquema</th><th className="r">Tras ajustes</th><th /></tr></thead><tbody>
              {S.calcs.slice(0, 6).map((c) => <tr key={c.id}><td>{fmtDate(c.date)}</td><td>{c.patient}</td><td>{c.schemeName}</td><td className="r"><Eur v={c.eff} /></td><td className="r"><Btn small onClick={() => { set((x) => ({ ...x, activePatient: c.patient, calc: c.settings })); go("calculadora"); }}>Abrir</Btn></td></tr>)}
            </tbody></table></div>}
        </Card>
        <Card title="Estado de los datos">
          <ul className="status-list">
            <li><Chip kind="pendiente" /> <span><b>{pend}</b> esquemas importados sin verificar con fuente y fecha.</span></li>
            <li><Chip kind="crit">Precios</Chip> <span><b>{sinPrecio}</b> fármacos sin precio en el catálogo (dexametasona e ixazomib). Su coste no entra en los totales.</span></li>
            <li><Chip kind="crit">Auditoría</Chip> <span><b>{crit}</b> hallazgos críticos en el Excel original. <button className="link" onClick={() => go("auditoria")}>Ver auditoría</button></span></li>
            <li><Chip kind="ficticio" /> <span>Pacientes y agenda de ejemplo: ficticios.</span></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

/* ============================== PACIENTE ============================== */
const EXPOSURE = [
  ["Inhibidores del proteasoma", ["Bortezomib", "Carfilzomib", "Ixazomib"]],
  ["Inmunomoduladores", ["Lenalidomida", "Pomalidomida", "Talidomida"]],
  ["Anti-CD38", ["Daratumumab", "Isatuximab"]],
  ["Otros", ["Belantamab", "Selinexor", "CAR-T", "Biespecífico", "Trasplante autólogo"]],
];
export function PacientePage() {
  const { S, set, patient, go } = useApp();
  const [newCode, setNewCode] = useState("");
  const p = patient;
  const upd = (k, v) => set((x) => ({ ...x, patients: x.patients.map((q) => (q.code === p.code ? { ...q, [k]: v } : q)) }));
  const res = resolvePatient(enginePat(p));
  const exp = p.exposure || {};
  const setExp = (drug, field, val) => upd("exposure", { ...exp, [drug]: { ...(exp[drug] || {}), [field]: val } });
  const addVisit = () => upd("visits", [...p.visits, { date: today(), weight: p.weight, height: p.height, sc: res.sc, scSource: res.scSource, note: "", ts: Date.now() }]);
  const create = () => {
    const code = newCode.trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,20}$/.test(code)) return;
    if (S.patients.some((x) => x.code === code)) return;
    set((x) => ({ ...x, patients: [...x.patients, { code, age: null, weight: 70, height: 1.7, scMethod: "mosteller", scOverride: 0, line: "1N", transplant: "", renal: null, comorb: "", exposure: {}, goal: "", status: "", visits: [], demo: false }], activePatient: code }));
    setNewCode("");
  };
  const mosteller = res.errors.length ? null : bsa("mosteller", p.weight, p.height);
  return (
    <div className="page">
      <h1>Pacientes</h1>
      <Banner kind="warn" title="Solo códigos pseudonimizados.">No escribas nombre, NHC, fecha de nacimiento ni otros identificadores. Este artefacto no es un almacén clínico seguro; los pacientes de ejemplo son ficticios.</Banner>
      <div className="grid-side">
        <Card title="Registro" actions={null}>
          <ul className="plist">{S.patients.map((q) => <li key={q.code}><button className={cx(q.code === p.code && "on")} onClick={() => set((x) => ({ ...x, activePatient: q.code }))}><b>{q.code}</b><span>{q.demo === false ? "" : "Ficticio · "}{fmtNum(q.weight, 0)} kg · {fmtNum(q.height, 2)} m</span></button></li>)}</ul>
          <div className="row-add"><input aria-label="Código nuevo" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Código nuevo (p. ej. MM-0042)" /><Btn onClick={create}>Añadir</Btn></div>
        </Card>
        <div className="stack">
          <Card title={`Paciente ${p.code}`} sub="Solo peso y talla son necesarios para calcular. El resto es opcional.">
            <div className="form-grid">
              <Field label="Peso (kg)"><NumInput value={p.weight} onChange={(v) => upd("weight", v)} unit="kg" min={25} max={250} /></Field>
              <Field label="Talla (m)" hint="En metros, p. ej. 1,60"><NumInput value={p.height} onChange={(v) => upd("height", v)} unit="m" min={1} max={2.3} /></Field>
              <Field label="Edad (años)"><NumInput value={p.age} onChange={(v) => upd("age", v)} unit="años" min={18} max={110} /></Field>
              <Field label="Fórmula de superficie corporal"><Select value={p.scMethod} onChange={(v) => upd("scMethod", v)} options={Object.entries(BSA_METHODS).map(([k, m]) => ({ value: k, label: m.label }))} /></Field>
              <Field label="SC fijada a mano (opcional)" hint="Solo si hay un motivo documentado. Sustituye a la fórmula."><NumInput value={p.scOverride || null} onChange={(v) => upd("scOverride", v || 0)} unit="m²" min={0.8} max={3.2} /></Field>
              <Field label="Línea actual"><Select value={p.line} onChange={(v) => upd("line", v)} options={Object.entries(LINE_LABEL).map(([k, l]) => ({ value: k, label: l }))} /></Field>
              <Field label="Situación de trasplante"><Select value={p.transplant || ""} onChange={(v) => upd("transplant", v)} options={[{ value: "", label: "No indicado" }, { value: "candidato", label: "Candidato" }, { value: "no candidato", label: "No candidato" }, { value: "trasplantado", label: "Ya trasplantado" }]} /></Field>
              <Field label="Filtrado glomerular (mL/min/1,73 m²)" hint="Opcional. No se aplican ajustes renales automáticos."><NumInput value={p.renal} onChange={(v) => upd("renal", v)} unit="mL/min" min={1} max={200} /></Field>
              <Field label="Situación actual"><Select value={p.status || ""} onChange={(v) => upd("status", v)} options={[{ value: "", label: "No indicada" }, { value: "evaluacion", label: "En evaluación" }, { value: "tratamiento", label: "En tratamiento" }, { value: "progresion", label: "Progresión" }, { value: "respuesta", label: "En respuesta" }]} /></Field>
              <Field label="Comorbilidad (texto libre, sin identificadores)" wide><input value={p.comorb || ""} onChange={(e) => upd("comorb", e.target.value)} /></Field>
              <Field label="Objetivo del análisis" wide><input value={p.goal || ""} onChange={(e) => upd("goal", e.target.value)} /></Field>
            </div>
            {res.errors.map((e) => <Banner key={e} kind="crit">{e}</Banner>)}
            <div className="sc-box">
              <div><span className="kpi-l">Superficie corporal usada</span><div className="big num-mono">{res.sc ? fmtNum(res.sc, 3) : "—"} m²</div></div>
              <div className="sub">Origen: <b>{res.scSource || "sin datos"}</b>.{p.scOverride > 0 ? " Valor fijado a mano: no se recalcula al cambiar peso o talla." : ` Fórmula: ${BSA_METHODS[p.scMethod].formula} (peso en kg, talla en cm).`}{mosteller && Math.abs(mosteller - 1.83) > 0.02 && <> Con estos datos Mosteller da {fmtNum(mosteller, 3)} m²; el Excel original usa 1,83 m² tecleado.</>}</div>
            </div>
          </Card>
          <Card title="Exposición y refractariedad previas" sub="Marca por medicamento. Es información de contexto; no activa recomendaciones.">
            <div className="tbl-w"><table className="tbl"><thead><tr><th>Medicamento</th><th>Expuesto</th><th>Refractario</th></tr></thead><tbody>
              {EXPOSURE.map(([g, ds]) => <React.Fragment key={g}><tr className="grp"><td colSpan={3}>{g}</td></tr>{ds.map((d) => <tr key={d}><td>{d}</td><td><input type="checkbox" aria-label={`${d} expuesto`} checked={!!(exp[d] && exp[d].exp)} onChange={(e) => setExp(d, "exp", e.target.checked)} /></td><td><input type="checkbox" aria-label={`${d} refractario`} checked={!!(exp[d] && exp[d].ref)} onChange={(e) => setExp(d, "ref", e.target.checked)} /></td></tr>)}</React.Fragment>)}
            </tbody></table></div>
          </Card>
          <Card title="Historial de visitas" sub="Inmutable: cada visita guarda una instantánea y no se puede editar ni borrar." actions={<Btn variant="primary" small onClick={addVisit}>Guardar visita con valores actuales</Btn>}>
            {p.visits.length === 0 ? <Empty title="Sin visitas">Guarda la primera visita para empezar el historial.</Empty> :
              <div className="tbl-w"><table className="tbl"><thead><tr><th>Fecha</th><th className="r">Peso</th><th className="r">Talla</th><th className="r">SC</th><th className="r">Δ peso</th><th>Nota</th></tr></thead><tbody>
                {p.visits.map((v, i) => { const prev = p.visits[i - 1]; const dw = prev ? v.weight - prev.weight : null; return <tr key={i}><td>{fmtDate(v.date)}</td><td className="r num-mono">{fmtNum(v.weight, 1)} kg</td><td className="r num-mono">{fmtNum(v.height, 2)} m</td><td className="r num-mono">{v.sc ? fmtNum(v.sc, 3) : "—"}</td><td className="r num-mono">{dw == null ? "—" : (dw > 0 ? "+" : "") + fmtNum(dw, 1) + " kg"}</td><td>{v.note}</td></tr>; })}
              </tbody></table></div>}
            <div className="row-end"><Btn variant="primary" onClick={() => go("calculadora")}>Calcular con este paciente →</Btn></div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ============================== CALCULADORA ============================== */
export function CalculadoraPage() {
  const { S, set, patient, go, schemes, access } = useApp();
  const c = S.calc;
  const setC = (patch) => set((x) => ({ ...x, calc: { ...x.calc, ...patch } }));
  const scheme = schemes.find((s) => s.id === c.schemeId) || schemes[0];
  const pat = enginePat(patient);
  const rep = useMemo(() => buildCalcReport(S, pat, c, scheme, { eco: ecoSection(S, schemes, { access }) }), [S.catalog, patient.weight, patient.height, patient.scMethod, patient.scOverride, c, scheme, S.agreements, S.spendEntries, S.plans, S.estimates, S.ref, access]);
  const res = rep.res;
  const [tab, setTab] = useState("resumen");
  const [saved, setSaved] = useState(false);
  const t = res.totals;
  const save = () => { set((x) => ({ ...x, calcs: [{ id: Date.now(), date: today(), patient: patient.code, schemeName: scheme.name, eff: t ? t.eff : 0, settings: c }, ...x.calcs].slice(0, 40) })); setSaved(true); setTimeout(() => setSaved(false), 1800); };
  const maintOpts = [{ value: "none", label: "Sin mantenimiento" }, ...(scheme.maint || []).map((v) => ({ value: v.id, label: v.label }))];
  const mainSegs = [...scheme.segs, ...((scheme.maint || []).find((v) => v.id === c.maint) || { segs: [] }).segs];
  const sens = useMemo(() => (tab === "sens" ? sensitivity(scheme, S.catalog, pat, calcOpts(c), c.metric || "eff") : null), [tab, scheme, S.catalog, patient.weight, patient.height, patient.scOverride, patient.scMethod, c]);
  const byDrug = useMemo(() => { const m = {}; res.lines.forEach((l) => { m[l.drug] = (m[l.drug] || 0) + l.eff; }); return Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]); }, [res]);
  const total = t ? t.eff : 0;
  const series = useMemo(() => {
    const eff = []; let acc = 0; const th = []; let a2 = 0;
    res.events.forEach((e) => { if (e.eff != null) { acc += e.eff; a2 += e.theor; } eff.push({ x: e.day, y: acc }); th.push({ x: e.day, y: a2 }); });
    return [{ name: "Tras ajustes", color: "var(--s0)", points: eff }, { name: "Teórico (mg)", color: "var(--s1)", points: th, dash: "5 4" }];
  }, [res]);
  return (
    <div className="page">
      <div className="page-h"><h1>Calculadora individualizada</h1><div className="chips">{schemeChips(scheme)}</div></div>
      <div className="grid-calc">
        <div className="stack">
          <Card title="Paciente">
            <div className="form-grid g1">
              <Field label="Paciente (código)"><Select value={patient.code} onChange={(v) => set((x) => ({ ...x, activePatient: v }))} options={S.patients.map((p) => ({ value: p.code, label: p.code + (p.demo === false ? "" : " (ficticio)") }))} /></Field>
            </div>
            <div className="form-grid">
              <Field label="Peso"><NumInput value={patient.weight} onChange={(v) => set((x) => ({ ...x, patients: x.patients.map((q) => (q.code === patient.code ? { ...q, weight: v } : q)) }))} unit="kg" min={25} max={250} /></Field>
              <Field label="Talla"><NumInput value={patient.height} onChange={(v) => set((x) => ({ ...x, patients: x.patients.map((q) => (q.code === patient.code ? { ...q, height: v } : q)) }))} unit="m" min={1} max={2.3} /></Field>
            </div>
            <div className="sc-mini"><span>SC <b className="num-mono">{res.patient.sc ? fmtNum(res.patient.sc, 3) : "—"} m²</b></span><span className="muted">{res.patient.scSource}</span><button className="link" onClick={() => go("paciente")}>Cambiar fórmula</button></div>
            {res.errors.map((e) => <Banner key={e} kind="crit">{e}</Banner>)}
          </Card>
          <Card title="Esquema y horizonte">
            <div className="form-grid g1">
              <Field label="Esquema"><Select value={scheme.id} onChange={(v) => setC({ schemeId: v, maint: "none", cycles: {} })} options={schemeOptions(schemes)} /></Field>
              {scheme.maint && scheme.maint.length > 0 && <Field label="Mantenimiento"><Select value={c.maint || "none"} onChange={(v) => setC({ maint: v })} options={maintOpts} /></Field>}
              <Field label="Horizonte temporal"><Select value={c.horizon} onChange={(v) => setC({ horizon: v })} options={HORIZONS.map((h) => ({ value: h.id, label: h.label }))} /></Field>
              {c.horizon === "custom" && <Field label="Días desde el inicio"><NumInput value={c.horizonCustom} onChange={(v) => setC({ horizonCustom: v || 1 })} unit="d" min={1} /></Field>}
            </div>
            <details className="det"><summary>Ciclos por fase ({mainSegs.length})</summary>
              <div className="form-grid">{mainSegs.map((s) => <Field key={s.id} label={`${s.name} (${s.len} d)`}><NumInput value={(c.cycles && c.cycles[s.id]) != null ? c.cycles[s.id] : s.cycles} onChange={(v) => setC({ cycles: { ...(c.cycles || {}), [s.id]: v && v >= 1 ? Math.round(v) : s.cycles } })} unit="ciclos" min={1} /></Field>)}</div>
              <Btn small onClick={() => setC({ cycles: {} })}>Restaurar ciclos originales</Btn>
            </details>
          </Card>
          <Card title="Política de viales y redondeo" sub="Parámetros del coste. El teórico (por mg) siempre se muestra.">
            <Field label={`Aprovechamiento de viales: ${c.reuse} %`} hint="0 % = el sobrante se desecha (envase completo). 100 % = se aprovecha todo (coste teórico). Solo parenterales.">
              <input type="range" min="0" max="100" step="5" value={c.reuse} onChange={(e) => setC({ reuse: +e.target.value })} />
            </Field>
            <div className="form-grid">
              <Field label="Redondear dosis a múltiplos de" hint="0 = sin redondeo. Solo mg/kg y mg/m²."><NumInput value={c.roundStep} onChange={(v) => setC({ roundStep: v || 0 })} unit="mg" min={0} /></Field>
            </div>
            {scheme.caps && <Check checked={!!c.applyCaps} onChange={(v) => setC({ applyCaps: v })}>Aplicar topes de financiación del Excel (histórico)</Check>}
          </Card>
        </div>
        <div className="stack">
          {rep.res.warnings.map((w, i) => <Banner key={i} kind={w.level === "crit" ? "crit" : w.level === "warn" ? "warn" : "info"}>{w.text}</Banner>)}
          {scheme.status !== "verificado" && <Banner kind="warn" title="Pauta y precios pendientes de validación.">Importados del Excel; úsalos para planificar y comparar, no como pauta verificada.</Banner>}
          <div className="kpis">
            <Kpi label="Coste tras ajustes" value={fmtEUR(t ? t.eff : null)} sub={`Aprovechamiento ${c.reuse} %`} strong />
            <Kpi label="Envases completos" value={fmtEUR(t ? t.full : null)} sub={`${t ? t.vials : 0} envases`} />
            <Kpi label="Teórico (por mg)" value={fmtEUR(t ? t.theor : null)} sub="Método del Excel" />
            <Kpi label="Administraciones" value={t ? t.admins : "—"} sub={`${res.durationDays || 0} d de esquema · ${horizonLabel(c)}`} />
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: "resumen", label: "Resumen" }, { id: "desglose", label: "Desglose" }, { id: "calendario", label: "Calendario" }, { id: "sens", label: "Sensibilidad" }, { id: "pauta", label: "Pauta importada" }]} />
          {tab === "resumen" && t && (
            <>
              <Card title="Coste acumulado" sub="Se suma en el día de cada administración (calendario real).">
                <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />
                <LineChart series={series} xFmt={(x) => `${fmtNum(x / DAYS_PER_MONTH, 1)} m`} yFmt={(y, full) => (full ? fmtEUR(y, 0) : y >= 1000 ? `${fmtNum(y / 1000, 0)} k€` : fmtEUR(y, 0))} xTitle="Meses desde el inicio" yTitle="Coste acumulado" />
              </Card>
              <Card title="Coste por fármaco (tras ajustes)">
                <StackBars labelWidth={140} fmt={(v) => fmtEUR(v, 0)} rows={byDrug.map(([d, v]) => ({ label: dn(d), segments: [{ key: d, label: dn(d), value: v, color: drugColor(d) }] }))} />
                <p className="sub">{byDrug.length === 0 ? "Sin costes." : `Mayor peso económico: ${dn(byDrug[0][0])} (${fmtNum((byDrug[0][1] / total) * 100, 1)} % del total).`}</p>
              </Card>
              <Card title="Por fase">
                <div className="tbl-w"><table className="tbl"><thead><tr><th>Fase</th><th className="r">Ciclos</th><th className="r">Admin.</th><th className="r">Teórico</th><th className="r">Tras ajustes</th></tr></thead><tbody>
                  {res.bySeg.map((s) => <tr key={s.segId}><td>{s.name} {s.maint && <Chip kind="info">Mantenimiento</Chip>}</td><td className="r">{s.cycles}</td><td className="r">{s.admins}</td><td className="r"><Eur v={s.theor} /></td><td className="r"><Eur v={s.eff} /></td></tr>)}
                </tbody></table></div>
              </Card>
            </>
          )}
          {tab === "desglose" && t && (
            <Card title="Desglose por fármaco y dosis" flush>
              <div className="tbl-w"><table className="tbl"><thead><tr><th>Fármaco y dosis</th><th className="r">Dosis/admin.</th><th className="r">Admin.</th><th className="r">mg totales</th><th>Envases por admin.</th><th className="r">Teórico</th><th className="r">Completos</th><th className="r">Tras ajustes</th><th className="r">%</th></tr></thead><tbody>
                {rep.lines.length && res.lines.map((l) => <tr key={l.key} className={cx(!l.priced && "row-warn")}><td>{lineLabel(l)} {l.maint && <Chip kind="info">Mant.</Chip>}</td><td className="r num-mono">{l.sampleDose != null ? fmtNum(l.sampleDose, 1) + " mg" : "—"}</td><td className="r">{l.admins}</td><td className="r num-mono">{fmtNum(l.totalMg, 0)}</td><td className="small">{l.pack || (l.priced ? "" : "sin precio")}</td><td className="r">{l.priced ? <Eur v={l.theor} /> : <Chip kind="crit">Sin precio</Chip>}</td><td className="r">{l.priced ? <Eur v={l.full} /> : "—"}</td><td className="r">{l.priced ? <Eur v={l.eff} /> : "—"}</td><td className="r num-mono">{l.priced && total ? fmtNum((l.eff / total) * 100, 1) : "—"}</td></tr>)}
              </tbody><tfoot><tr><td colSpan={5}>Total</td><td className="r"><Eur v={t.theor} /></td><td className="r"><Eur v={t.full} /></td><td className="r"><Eur v={t.eff} /></td><td /></tr></tfoot></table></div>
              <p className="sub pad">El «teórico» reproduce el método del Excel (mg × precio/mg de la presentación elegida). «Completos» paga cada envase entero; «tras ajustes» aplica tu aprovechamiento de viales.</p>
            </Card>
          )}
          {tab === "calendario" && <CalendarView res={res} scheme={scheme} />}
          {tab === "sens" && sens && (
            <Card title="Análisis de sensibilidad" sub="Una variable cada vez, resto constante. Diferencias frente al caso base." actions={<Select value={c.metric || "eff"} onChange={(v) => setC({ metric: v })} ariaLabel="Métrica" options={[{ value: "eff", label: "Tras ajustes" }, { value: "full", label: "Envases completos" }, { value: "theor", label: "Teórico (mg)" }]} />}>
              <div className="tbl-w"><table className="tbl"><thead><tr><th>Variable</th><th className="r">Coste</th><th className="r">Diferencia</th><th>Efecto</th></tr></thead><tbody>
                <tr className="grp"><td>Caso base</td><td className="r"><Eur v={sens.base} /></td><td /><td /></tr>
                {sens.rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="r"><Eur v={r.value} /></td><td className="r"><Dlt v={r.diff} pct={r.pct} /></td><td><div className="tor"><span style={{ width: `${Math.min(100, Math.abs(r.pct) * 4)}%`, background: r.diff >= 0 ? "var(--crit)" : "var(--good)", [r.diff >= 0 ? "marginLeft" : "marginRight"]: 0 }} /></div></td></tr>)}
              </tbody></table></div>
              <p className="sub">Con envases completos, un cambio pequeño de peso puede no alterar el número de viales (diferencia 0): es lo esperable, no un fallo.</p>
            </Card>
          )}
          {tab === "pauta" && <SchemeDetail scheme={scheme} compact />}
          <div className="actions">
            <Btn variant="primary" onClick={save}>{saved ? "Guardado ✓" : "Guardar cálculo"}</Btn>
            <Btn onClick={() => { set((x) => ({ ...x, reportSource: "calc" })); go("informes"); }}>Generar informe</Btn>
            <CopyBtn label="Copiar tabla CSV" getText={() => calcCSV(rep)} />
            <CopyBtn label="Resumen para historia clínica" getText={() => clinicalSummary(rep)} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function CalendarView({ res, scheme }) {
  const segs = res.bySeg.filter((s) => s.cycles > 0);
  const [segId, setSegId] = useState(segs[0] ? segs[0].segId : "");
  const [cycle, setCycle] = useState(1);
  const seg = segs.find((s) => s.segId === segId) || segs[0];
  if (!seg) return <Empty title="Sin calendario">No hay fases dentro del horizonte.</Empty>;
  const cyc = Math.min(cycle, seg.cycles);
  const evs = res.events.filter((e) => e.seg === seg.segId && e.cycle === cyc);
  const rowsMap = {}; evs.forEach((e) => { (rowsMap[e.key] = rowsMap[e.key] || { key: e.key, drug: e.drug, label: e.label, basis: e.basis, dose: e.doseRef, days: {} }).days[((e.day - seg.start - 1) % seg.len) + 1] = e.dose; });
  const rows = Object.values(rowsMap);
  const len = seg.len;
  return (
    <Card title="Calendario de administración" sub="Cada marca es una administración con su dosis en mg. Las fases con calendario aproximado se indican en los avisos.">
      <div className="form-grid">
        <Field label="Fase"><Select value={seg.segId} onChange={(v) => { setSegId(v); setCycle(1); }} options={segs.map((s) => ({ value: s.segId, label: `${s.name} (${s.cycles} ciclos × ${s.len} d)` }))} /></Field>
        <Field label="Ciclo"><NumInput value={cyc} onChange={(v) => setCycle(Math.max(1, Math.min(seg.cycles, Math.round(v || 1))))} min={1} max={seg.cycles} unit={`de ${seg.cycles}`} /></Field>
      </div>
      <div className="tbl-w"><table className="cal"><thead><tr><th>Fármaco</th>{Array.from({ length: len }, (_, i) => <th key={i}>{i + 1}</th>)}</tr></thead><tbody>
        {rows.length === 0 && <tr><td colSpan={len + 1} className="muted">Sin administraciones en este ciclo.</td></tr>}
        {rows.map((r) => <tr key={r.key}><td className="cal-l">{lineLabel({ drug: r.drug, basis: r.basis, dose: r.dose, label: r.label })}</td>{Array.from({ length: len }, (_, i) => { const d = r.days[i + 1]; return <td key={i} className={cx(d != null || (r.label && r.days[i + 1] === null) ? "on" : "")} style={d !== undefined ? { background: drugColor(r.drug) } : undefined} title={d != null ? `Día ${i + 1}: ${fmtNum(d, 1)} mg` : ""}>{d !== undefined ? "●" : ""}</td>; })}</tr>)}
      </tbody></table></div>
    </Card>
  );
}

/* ---- Detalle de esquema (reutilizado) ---- */
export function SchemeDetail({ scheme, compact }) {
  const groups = [{ id: "main", label: "Fases principales", segs: scheme.segs }, ...(scheme.maint || []).map((v) => ({ id: v.id, label: `Mantenimiento: ${v.label}`, segs: v.segs }))];
  return (
    <div className="stack">
      {!compact && <div className="chips">{schemeChips(scheme)}</div>}
      <div className="meta">
        <div><span className="kpi-l">Línea</span>{LINE_LABEL[scheme.line]}</div>
        <div><span className="kpi-l">Vía</span>{scheme.route || "—"}</div>
        <div><span className="kpi-l">Ensayo / referencia</span>{scheme.trial || "—"}</div>
        <div><span className="kpi-l">Origen en el Excel</span>{scheme.source}</div>
        <div><span className="kpi-l">Versión</span>v{scheme.version || 1}</div>
        <div><span className="kpi-l">Revisión</span>{scheme.verified ? `${fmtDate(scheme.verified.date)} · ${scheme.verified.reviewer}` : "Sin revisar"}</div>
      </div>
      {(scheme.notes || []).map((n, i) => <Banner key={i} kind="info">{n}</Banner>)}
      {(scheme.flags || []).map((f, i) => <Banner key={i} kind={f.code.startsWith("REF") || f.code === "OMITIDO" ? "crit" : "warn"} title={f.code + "."}>{f.text}</Banner>)}
      {groups.map((g) => (
        <Card key={g.id} title={g.label} flush>
          <div className="tbl-w"><table className="tbl"><thead><tr><th>Fase</th><th className="r">Ciclos</th><th className="r">Ciclo (d)</th><th>Fármaco</th><th className="r">Dosis</th><th>Calendario por ciclo (días)</th></tr></thead><tbody>
            {g.segs.map((s) => s.comps.map((c, i) => <tr key={s.id + i}>{i === 0 && <><td rowSpan={s.comps.length}><b>{s.name}</b><br /><span className="muted">{s.phase}</span></td><td className="r" rowSpan={s.comps.length}>{s.cycles == null ? "hasta horizonte" : s.cycles}</td><td className="r" rowSpan={s.comps.length}>{s.len}</td></>}
              <td>{c.fixed ? c.fixed.label : dn(c.drug)}</td><td className="r num-mono">{c.fixed ? fmtEUR(c.fixed.amount) : `${fmtNum(c.dose, c.dose < 1 ? 2 : 1)} ${c.basis === "mgkg" ? "mg/kg" : c.basis === "mgm2" ? "mg/m²" : "mg"}`}</td>
              <td className="small">{c.total != null ? `${c.total} administraciones en total (calendario aproximado)` : c.blocks ? c.blocks.map((b) => `C${b[0]}-${b[1]}: ${b[2].join(",")}`).join(" · ") : c.fixed ? "Una vez" : daysStr(c.days)}</td></tr>))}
          </tbody></table></div>
        </Card>
      ))}
    </div>
  );
}
import { daysToString } from "./engine.js";
const daysStr = (d) => daysToString(d || []);
