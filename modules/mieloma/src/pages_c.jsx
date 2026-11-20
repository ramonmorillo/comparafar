import React, { useState, useMemo } from "react";
import { computeScheme, bsa, BSA_METHODS, validatePatient, addDays, fmtDate, fmtEUR, fmtNum, ENGINE_VERSION, DAYS_PER_MONTH } from "./engine.js";
import { LINE_LABEL, SCHEMES_ALL, CATALOG_INITIAL, CONFIG_DEFAULT } from "./data.js";
import { FINDINGS, SEV, EXPLAIN, EXPLAIN_MAINT, TRACE } from "./audit.js";
import INVENTORY from "./inventory.json";
import { useApp, Btn, Field, NumInput, Select, Check, Card, Banner, Tabs, Chip, Kpi, Eur, Dlt, Empty, StackBars, CopyBtn, Modal, cx, drugColor } from "./kit.jsx";
import { ecoSection } from "./exportsEco.js";
import { buildCalcReport, buildCompareReport, reportText, clinicalSummary, calcCSV, compareCSV, dn, calcOpts, DATA_VERSION } from "./report.js";
import { today, enginePat, schemeOptions } from "./pages_a.jsx";

/* ============================== AGENDA ============================== */
const CAUSES = ["Retraso (toxicidad/infección)", "Retraso (logístico)", "Suspensión por decisión clínica", "Modificación de dosis", "No acude", "Otra"];
function planEvents(plan, schemes, catalog, patients) {
  const s = schemes.find((x) => x.id === plan.schemeId); const p = patients.find((x) => x.code === plan.patient);
  if (!s || !p) return { events: [], res: null };
  const res = computeScheme(s, catalog, enginePat(p), { reuse: 0, maint: plan.maint || "none", horizon: "all" });
  return { res, events: res.events.map((e, i) => ({ ...e, id: `${plan.id}:${i}`, date: addDays(plan.start, e.day - 1) })) };
}
export function AgendaPage() {
  const { S, set, schemes } = useApp();
  const [sel, setSel] = useState(S.plans[0] && S.plans[0].id);
  const [form, setForm] = useState(null); const [mark, setMark] = useState(null);
  const plan = S.plans.find((p) => p.id === sel) || S.plans[0];
  const { events, res } = useMemo(() => (plan ? planEvents(plan, schemes, S.catalog, S.patients) : { events: [], res: null }), [plan, schemes, S.catalog, S.patients]);
  const cfg = S.config;
  const td = today();
  const done = (plan && plan.done) || {};
  const setDone = (id, v) => set((x) => ({ ...x, plans: x.plans.map((p) => (p.id === plan.id ? { ...p, done: { ...p.done, [id]: v } } : p)) }));
  const unmark = (id) => set((x) => ({ ...x, plans: x.plans.map((p) => { if (p.id !== plan.id) return p; const d = { ...p.done }; delete d[id]; return { ...p, done: d }; }) }));
  const upcoming = events.filter((e) => !done[e.id] && e.date >= td && e.date <= addDays(td, cfg.alertDays || 7));
  const overdue = events.filter((e) => !done[e.id] && e.date < td);
  const view = events.filter((e) => e.date >= addDays(td, -60)).slice(0, 80);
  const planned = events.filter((e) => e.date <= td).length, realised = Object.keys(done).length;
  const byDay = {}; view.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
  return (
    <div className="page">
      <div className="page-h"><h1>Agenda de tratamiento</h1><Btn variant="primary" onClick={() => setForm({ patient: S.activePatient, schemeId: schemes[0].id, maint: "none", start: td })}>+ Nuevo plan</Btn></div>
      <Banner kind="warn" title="Planes y registros ficticios.">La agenda es informativa: no sustituye a la historia clínica ni a la prescripción electrónica. Las alertas no son recomendaciones clínicas.</Banner>
      <div className="grid-side">
        <Card title="Planes">
          {S.plans.length === 0 ? <Empty title="Sin planes">Crea un plan para ver el calendario.</Empty> : <ul className="plist">{S.plans.map((p) => <li key={p.id}><button className={cx(plan && p.id === plan.id && "on")} onClick={() => setSel(p.id)}><b>{p.patient}</b><span>{(schemes.find((s) => s.id === p.schemeId) || {}).name} · inicio {fmtDate(p.start)}</span></button></li>)}</ul>}
          <Field label="Avisar con antelación de (días)"><NumInput value={cfg.alertDays || 7} onChange={(v) => set((x) => ({ ...x, config: { ...x.config, alertDays: Math.max(1, Math.round(v || 7)) } }))} unit="d" min={1} /></Field>
        </Card>
        {plan && res ? <div className="stack">
          <div className="kpis"><Kpi label="Previstas hasta hoy" value={planned} /><Kpi label="Registradas" value={realised} sub="administradas o con incidencia" /><Kpi label="Sin registrar y vencidas" value={overdue.length} tone={overdue.length ? "warn" : undefined} /><Kpi label={`Próximos ${cfg.alertDays || 7} d`} value={upcoming.length} /></div>
          {overdue.length > 0 && <Banner kind="warn" title={`${overdue.length} administración(es) prevista(s) sin registro.`}>Revísalas: puede ser un olvido de registro o una dosis no administrada.</Banner>}
          {upcoming.length > 0 && <Banner kind="info" title="Próximas administraciones">{upcoming.slice(0, 5).map((e) => `${fmtDate(e.date)}: ${e.label || dn(e.drug)} ${e.dose != null ? fmtNum(e.dose, 1) + " mg" : ""}`).join(" · ")}</Banner>}
          <Card title={`Calendario · ${plan.patient}`} sub="Últimos 60 días y siguientes. «Prevista» viene del esquema; «realizada» la registras tú." flush>
            <div className="tbl-w"><table className="tbl"><thead><tr><th>Fecha</th><th>Fase / ciclo</th><th>Fármaco</th><th className="r">Dosis prevista</th><th>Registro</th><th /></tr></thead><tbody>
              {Object.entries(byDay).map(([d, es]) => es.map((e, i) => { const r = done[e.id]; const st = r ? (r.status === "ok" ? "ok" : "inc") : e.date < td ? "ven" : "pend"; return (
                <tr key={e.id} className={cx(st === "ven" && "row-warn")}><td>{i === 0 ? <b>{fmtDate(d)}</b> : ""}</td><td className="small">{e.segName} · C{e.cycle}</td><td>{e.label || dn(e.drug)}</td><td className="r num-mono">{e.dose != null ? fmtNum(e.dose, 1) + " mg" : "—"}</td>
                  <td>{r ? (r.status === "ok" ? <Chip kind="verificado">Administrada{r.dose != null && r.dose !== e.dose ? ` · ${fmtNum(r.dose, 1)} mg` : ""}</Chip> : <Chip kind="warn" title={r.cause}>Incidencia: {r.cause}</Chip>) : st === "ven" ? <Chip kind="crit">Sin registrar</Chip> : <span className="muted">Prevista</span>}{r && r.date !== e.date && <span className="sub"> el {fmtDate(r.date)}</span>}</td>
                  <td className="r">{r ? <Btn small onClick={() => unmark(e.id)}>Deshacer</Btn> : <Btn small onClick={() => setMark({ e, status: "ok", date: e.date <= td ? e.date : td, dose: e.dose, cause: CAUSES[0] })}>Registrar</Btn>}</td></tr>); }))}
            </tbody></table></div>
          </Card>
        </div> : <Empty title="Selecciona o crea un plan" />}
      </div>
      {form && <Modal title="Nuevo plan" onClose={() => setForm(null)} footer={<><Btn onClick={() => setForm(null)}>Cancelar</Btn><Btn variant="primary" disabled={!form.start} onClick={() => { const id = "PL" + Date.now().toString(36); set((x) => ({ ...x, plans: [...x.plans, { id, ...form, done: {} }] })); setSel(id); setForm(null); }}>Crear</Btn></>}>
        <Field label="Paciente"><Select value={form.patient} onChange={(v) => setForm({ ...form, patient: v })} options={S.patients.map((p) => ({ value: p.code, label: p.code }))} /></Field>
        <Field label="Esquema"><Select value={form.schemeId} onChange={(v) => setForm({ ...form, schemeId: v, maint: "none" })} options={schemeOptions(schemes)} /></Field>
        {(() => { const s = schemes.find((x) => x.id === form.schemeId); return s && s.maint && s.maint.length ? <Field label="Mantenimiento"><Select value={form.maint} onChange={(v) => setForm({ ...form, maint: v })} options={[{ value: "none", label: "Sin mantenimiento" }, ...s.maint.map((m) => ({ value: m.id, label: m.label }))]} /></Field> : null; })()}
        <Field label="Fecha de inicio (ciclo 1, día 1)"><input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
      </Modal>}
      {mark && <Modal title={`Registrar · ${mark.e.label || dn(mark.e.drug)}`} onClose={() => setMark(null)} footer={<><Btn onClick={() => setMark(null)}>Cancelar</Btn><Btn variant="primary" onClick={() => { setDone(mark.e.id, mark.status === "ok" ? { status: "ok", date: mark.date, dose: mark.dose } : { status: "inc", date: mark.date, cause: mark.cause }); setMark(null); }}>Guardar</Btn></>}>
        <Field label="Resultado"><Select value={mark.status} onChange={(v) => setMark({ ...mark, status: v })} options={[{ value: "ok", label: "Administrada" }, { value: "inc", label: "No administrada / incidencia" }]} /></Field>
        <Field label="Fecha real"><input type="date" value={mark.date} onChange={(e) => setMark({ ...mark, date: e.target.value })} /></Field>
        {mark.status === "ok" ? <Field label="Dosis real (mg)" hint={`Prevista: ${fmtNum(mark.e.dose, 1)} mg`}><NumInput value={mark.dose} onChange={(v) => setMark({ ...mark, dose: v })} unit="mg" min={0} /></Field> : <Field label="Causa"><Select value={mark.cause} onChange={(v) => setMark({ ...mark, cause: v })} options={CAUSES.map((c) => ({ value: c, label: c }))} /></Field>}
      </Modal>}
    </div>
  );
}

/* ============================== PANEL ============================== */
export function PanelPage() {
  const { S, schemes } = useApp();
  const [pf, setPf] = useState("all"); const [sf, setSf] = useState("all");
  const data = useMemo(() => S.plans.filter((p) => (pf === "all" || p.patient === pf) && (sf === "all" || p.schemeId === sf)).map((p) => ({ p, ...planEvents(p, schemes, S.catalog, S.patients) })), [S, pf, sf, schemes]);
  const td = today(); const horizon = addDays(td, 90);
  const byMonth = {}; const byScheme = {}; let nDone = 0, nPlanned = 0, nWindow = 0;
  data.forEach(({ p, events }) => events.forEach((e) => {
    const m = e.date.slice(0, 7); if (e.date >= td && e.date <= horizon) { byMonth[m] = (byMonth[m] || 0) + (e.eff || 0); nWindow++; }
    if (e.date <= td) { nPlanned++; if (p.done && p.done[e.id]) nDone++; }
  }));
  data.forEach(({ p, res }) => { const n = (schemes.find((s) => s.id === p.schemeId) || {}).name || p.schemeId; byScheme[n] = (byScheme[n] || 0) + 1; });
  const months = Object.keys(byMonth).sort();
  return (
    <div className="page">
      <h1>Panel de actividad</h1>
      <Banner kind="warn" title="Datos ficticios.">Calculado a partir de los planes de la agenda (de ejemplo). No es actividad asistencial real.</Banner>
      <div className="form-grid"><Field label="Paciente"><Select value={pf} onChange={setPf} options={[{ value: "all", label: "Todos" }, ...S.patients.map((p) => ({ value: p.code, label: p.code }))]} /></Field><Field label="Esquema"><Select value={sf} onChange={setSf} options={[{ value: "all", label: "Todos" }, ...schemeOptions(schemes).flatMap((g) => g.items)]} /></Field></div>
      <div className="kpis"><Kpi label="Planes activos" value={data.length} /><Kpi label="Administraciones próximos 90 d" value={nWindow} /><Kpi label="Coste previsto 90 d" value={fmtEUR(Object.values(byMonth).reduce((a, b) => a + b, 0), 0)} sub="Envases completos (sin reaprovechar)" strong /><Kpi label="Cumplimiento del registro" value={nPlanned ? `${fmtNum((nDone / nPlanned) * 100, 0)} %` : "—"} sub={`${nDone} de ${nPlanned} previstas`} /></div>
      <div className="grid2">
        <Card title="Coste previsto por mes">{months.length === 0 ? <Empty title="Sin actividad prevista" /> : <StackBars labelWidth={90} fmt={(v) => fmtEUR(v, 0)} rows={months.map((m) => ({ label: m, segments: [{ key: m, label: m, value: byMonth[m], color: "var(--s0)" }] }))} />}</Card>
        <Card title="Pacientes por esquema">{Object.keys(byScheme).length === 0 ? <Empty title="Sin planes" /> : <StackBars labelWidth={150} fmt={(v) => `${v}`} rows={Object.entries(byScheme).map(([n, v]) => ({ label: n, segments: [{ key: n, label: n, value: v, color: "var(--s1)" }] }))} />}</Card>
      </div>
    </div>
  );
}

/* ============================== INFORMES ============================== */
function PrintBtn({ title }) {
  const [msg, setMsg] = useState(null);
  const run = () => {
    const prev = document.title; setMsg(null);
    const restore = () => { document.title = prev; window.removeEventListener("afterprint", restore); };
    try { document.title = title; window.addEventListener("afterprint", restore); window.print(); setTimeout(restore, 4000); }
    catch (e) { restore(); setMsg("No se ha podido abrir la impresión en este entorno. Abre la aplicación en su propia pestaña y usa Ctrl+P, o copia el informe."); }
  };
  return <div className="actions v"><Btn variant="primary" onClick={run}>Imprimir informe</Btn>{msg && <div role="alert" className="small">{msg}</div>}</div>;
}
export function InformesPage() {
  const { S, set, patient, schemes, access } = useApp();
  const src = S.reportSource || "calc";
  const rep = useMemo(() => (src === "cmp" ? buildCompareReport(S, enginePat(patient), S.cmp, schemes, { eco: ecoSection(S, schemes, { access }) }) : buildCalcReport(S, enginePat(patient), S.calc, schemes.find((s) => s.id === S.calc.schemeId) || schemes[0], { eco: ecoSection(S, schemes, { access }) })), [S, patient, schemes, src, access]);
  const cfg = S.config; const rp = S.report || {};
  const meta = { date: today(), patientCode: patient.code, author: rp.author || cfg.author, reviewer: rp.reviewer || cfg.reviewer, notes: rp.notes };
  const setRp = (patch) => set((x) => ({ ...x, report: { ...(x.report || {}), ...patch } }));
  const text = reportText(S, rep, cfg, meta);
  const t = src === "calc" ? rep.res.totals : null;
  return (
    <div className="page">
      <div className="page-h no-print"><h1>Informes</h1></div>
      <div className="grid-calc">
        <div className="stack no-print">
          <Card title="Contenido">
            <Field label="Origen"><Select value={src} onChange={(v) => set((x) => ({ ...x, reportSource: v }))} options={[{ value: "calc", label: "Último cálculo de la calculadora" }, { value: "cmp", label: "Comparación actual" }]} /></Field>
            <Field label="Paciente"><Select value={patient.code} onChange={(v) => set((x) => ({ ...x, activePatient: v }))} options={S.patients.map((p) => ({ value: p.code, label: p.code }))} /></Field>
            <Field label="Elaborado por"><input value={rp.author != null ? rp.author : cfg.author} onChange={(e) => setRp({ author: e.target.value })} /></Field>
            <Field label="Revisado por"><input value={rp.reviewer != null ? rp.reviewer : cfg.reviewer} onChange={(e) => setRp({ reviewer: e.target.value })} /></Field>
            <Field label="Observaciones (sin identificadores del paciente)"><textarea rows={3} value={rp.notes || ""} onChange={(e) => setRp({ notes: e.target.value })} /></Field>
          </Card>
          <Card title="Imprimir o guardar en PDF">
            <PrintBtn title={`Informe_${patient.code}_${meta.date}`} />
            <p className="muted small">En el cuadro de impresión elige «Guardar como PDF» si quieres un archivo. Se imprime solo el informe de la derecha.</p>
          </Card>
          <Card title="Copiar">
            <div className="actions v">
              <CopyBtn variant="primary" label="Copiar informe completo (texto)" getText={() => text} />
              <CopyBtn label="Copiar tablas (CSV)" getText={() => (src === "cmp" ? compareCSV(rep) : calcCSV(rep))} />
              {src === "calc" && <CopyBtn label="Resumen para historia clínica (sin identificadores)" getText={() => clinicalSummary(rep)} />}
            </div>
          </Card>
        </div>
        <div className="paper" id="informe">
          <header><div className="sub">{cfg.center}</div><h2>{cfg.header}</h2><div className="sub">Fecha {fmtDate(meta.date)} · Motor v{ENGINE_VERSION} · {DATA_VERSION}</div></header>
          <section><h3>Paciente</h3><p>Código pseudonimizado <b>{patient.code}</b> · {fmtNum(rep.pt.weight, 1)} kg · {fmtNum(rep.pt.height, 2)} m · SC {rep.pt.sc ? fmtNum(rep.pt.sc, 3) : "—"} m² <span className="muted">({rep.pt.scSource})</span></p></section>
          {src === "calc" ? <>
            <section><h3>Esquema</h3><p><b>{rep.scheme.name}</b> {rep.scheme.route && `(${rep.scheme.route})`} · {LINE_LABEL[rep.scheme.line]}{rep.variant ? ` · Mantenimiento: ${rep.variant.label}` : ""}<br />Horizonte {rep.horizon.toLowerCase()} · aprovechamiento de viales {rep.reuse || 0} % · {rep.scheme.status === "verificado" ? "verificado" : "pauta pendiente de validación"}</p></section>
            {t && <section><h3>Resultado económico</h3><table className="tbl"><tbody><tr><td>Coste teórico (por mg)</td><td className="r"><Eur v={t.theor} /></td></tr><tr><td>Envases completos</td><td className="r"><Eur v={t.full} /></td></tr><tr><td><b>Coste tras ajustes</b></td><td className="r"><b><Eur v={t.eff} /></b></td></tr><tr><td>Administraciones</td><td className="r">{t.admins}</td></tr></tbody></table></section>}
            <section><h3>Desglose</h3><table className="tbl"><thead><tr><th>Fármaco</th><th className="r">Admin.</th><th className="r">mg</th><th className="r">Tras ajustes</th></tr></thead><tbody>{rep.lines.map((l, i) => <tr key={i}><td>{l.nombre}</td><td className="r">{l.admin}</td><td className="r">{fmtNum(l.mg, 0)}</td><td className="r">{l.priced ? <Eur v={l.eff} /> : "sin precio"}</td></tr>)}</tbody></table></section>
          </> : <section><h3>Comparación económica</h3><table className="tbl"><thead><tr><th>Esquema</th><th className="r">Tras ajustes</th><th className="r">Dif. vs ref.</th></tr></thead><tbody>{rep.cols.map((c, i) => <tr key={i}><td>{c.name}</td><td className="r"><Eur v={c.eff} d={0} /></td><td className="r">{c.diff == null ? "referencia" : <Dlt v={c.diff} pct={c.pct} d={0} />}</td></tr>)}</tbody></table><p className="sub">Horizonte {rep.horizon.toLowerCase()}; aprovechamiento {rep.reuse} %.</p></section>}
          {(rep.warn || []).length > 0 && <section><h3>Avisos</h3><ul>{rep.warn.map((w, i) => <li key={i}>{w}</li>)}</ul></section>}
          {src === "calc" && rep.flags.length > 0 && <section><h3>Pendiente de validar</h3><ul>{rep.flags.map((w, i) => <li key={i}>{w}</li>)}</ul></section>}
          {src === "calc" && <section><h3>Precios y fuentes</h3><ul className="small">{rep.sources.map((s, i) => <li key={i}>{s}</li>)}</ul></section>}
          {meta.notes && <section><h3>Observaciones</h3><p>{meta.notes}</p></section>}
          <footer><p>{cfg.footer}</p><p>Elaborado por: {meta.author || "—"} · Revisado por: {meta.reviewer || "—"}</p></footer>
        </div>
      </div>
    </div>
  );
}

/* ============================== AUDITORÍA ============================== */
function Regression() {
  const rows = useMemo(() => SCHEMES_ALL.map((s) => {
    const r = computeScheme(s, CATALOG_INITIAL, { weight: 88, height: 1.6, scMethod: "mosteller", scOverride: 1.83 }, { maint: "none", horizon: "all", reuse: 1 });
    const ex = s.excel && s.excel.main ? s.excel.main : null; const app = r.totals ? r.totals.mainTheor : null;
    const out = [{ id: s.id, name: s.name, part: "Principal", app, ex: ex && ex.value, cell: ex && ex.cell, expl: EXPLAIN[s.id] }];
    (s.maint || []).forEach((v) => { const rm = computeScheme(s, CATALOG_INITIAL, { weight: 88, height: 1.6, scMethod: "mosteller", scOverride: 1.83 }, { maint: v.id, reuse: 1 }); const e = s.excel && s.excel.maint && s.excel.maint[v.id]; out.push({ id: s.id, name: s.name, part: "Mant. " + v.id, app: rm.totals.maintTheor, ex: e && e.value, cell: e && e.cell, expl: s.id in EXPLAIN_MAINT ? EXPLAIN_MAINT[s.id] : null }); });
    return out;
  }).flat(), []);
  const st = (r) => (r.ex == null ? "sin" : Math.abs(r.app - r.ex) < 0.5 ? "ok" : r.expl ? "expl" : "rev");
  const cnt = rows.reduce((a, r) => { const k = st(r); a[k] = (a[k] || 0) + 1; return a; }, {});
  return (
    <Card title="Regresión frente al Excel" sub="Caso del Excel: 88 kg, 1,60 m, SC 1,83 m² tecleada. Motor en «modo Excel» (coste teórico por mg, sin redondeo)." flush>
      <div className="pad"><Chip kind="verificado">{cnt.ok || 0} coinciden</Chip> <Chip kind="info">{cnt.expl || 0} difieren por un error identificado del Excel</Chip> <Chip kind={cnt.rev ? "crit" : "info"}>{cnt.rev || 0} por revisar</Chip> <Chip kind="pendiente">{cnt.sin || 0} sin referencia</Chip></div>
      <div className="tbl-w"><table className="tbl"><thead><tr><th>Esquema</th><th>Parte</th><th className="r">MieloFarma</th><th className="r">Excel</th><th className="r">Diferencia</th><th>Estado</th></tr></thead><tbody>
        {rows.map((r, i) => { const s = st(r); return <tr key={i}><td>{r.name}<div className="sub">{r.id}</div></td><td>{r.part}</td><td className="r"><Eur v={r.app} /></td><td className="r">{r.ex != null ? <><Eur v={r.ex} /><div className="sub">{r.cell}</div></> : "—"}</td><td className="r">{r.ex != null ? <Dlt v={r.app - r.ex} /> : "—"}</td><td>{s === "ok" ? <Chip kind="verificado">Coincide</Chip> : s === "expl" ? <Chip kind="info">Explicado: {r.expl.join(", ")}</Chip> : s === "rev" ? <Chip kind="crit">Revisar</Chip> : <Chip kind="pendiente">Sin referencia</Chip>}</td></tr>; })}
      </tbody></table></div>
    </Card>
  );
}
function BsaTool() {
  const [w, setW] = useState(88); const [h, setH] = useState(1.6); const [typed, setTyped] = useState(1.83);
  const errs = validatePatient(w, h);
  return (
    <Card title="Comprobador de superficie corporal">
      <div className="form-grid"><Field label="Peso"><NumInput value={w} onChange={setW} unit="kg" min={25} max={250} /></Field><Field label="Talla"><NumInput value={h} onChange={setH} unit="m" min={1} max={2.3} /></Field><Field label="SC tecleada (como en el Excel)"><NumInput value={typed} onChange={setTyped} unit="m²" /></Field></div>
      {errs.length ? errs.map((e) => <Banner key={e} kind="crit">{e}</Banner> ) : <div className="tbl-w"><table className="tbl"><thead><tr><th>Fórmula</th><th className="r">SC</th><th className="r">Δ vs tecleada</th></tr></thead><tbody>{Object.entries(BSA_METHODS).map(([k, m]) => { const v = bsa(k, w, h); return <tr key={k}><td>{m.label}<div className="sub">{m.formula}</div></td><td className="r num-mono">{fmtNum(v, 3)} m²</td><td className="r num-mono">{typed ? fmtNum(((typed - v) / v) * 100, 1) + " %" : "—"}</td></tr>; })}</tbody></table></div>}
    </Card>
  );
}
function VialImpact() {
  const { S, patient, schemes } = useApp();
  const [line, setLine] = useState("1N");
  const rows = useMemo(() => schemes.filter((s) => s.line === line && !s.archived).map((s) => { const r = (reuse) => computeScheme(s, S.catalog, enginePat(patient), { reuse, horizon: "all" }).totals; const a = r(0), b = r(0.5), c = r(1); return { s, a, b, c }; }), [line, patient, S.catalog, schemes]);
  return (
    <Card title="Impacto de la política de viales" sub={`Paciente ${patient.code}. Coste total de cada esquema con aprovechamiento 0 %, 50 % y 100 %.`} actions={<Select ariaLabel="Línea" value={line} onChange={setLine} options={Object.entries(LINE_LABEL).map(([k, l]) => ({ value: k, label: l }))} />} flush>
      <div className="tbl-w"><table className="tbl"><thead><tr><th>Esquema</th><th className="r">0 % (completos)</th><th className="r">50 %</th><th className="r">100 % (teórico)</th><th className="r">Sobrecoste por desperdicio</th></tr></thead><tbody>
        {rows.map(({ s, a, b, c }) => a && <tr key={s.id}><td>{s.name}</td><td className="r"><Eur v={a.eff} d={0} /></td><td className="r"><Eur v={b.eff} d={0} /></td><td className="r"><Eur v={c.eff} d={0} /></td><td className="r"><Dlt v={a.eff - c.eff} pct={c.eff ? ((a.eff - c.eff) / c.eff) * 100 : 0} d={0} /></td></tr>)}
      </tbody></table></div>
    </Card>
  );
}
export function AuditoriaPage() {
  const [tab, setTab] = useState("hall"); const [sev, setSev] = useState("all");
  const list = FINDINGS.filter((f) => sev === "all" || f.sev === sev);
  return (
    <div className="page">
      <h1>Auditoría del Excel</h1>
      <p className="lead-p">Hallazgos comprobados celda a celda en «Mielola multiple costes 2026.xlsx». Ninguna corrección modifica el Excel; MieloFarma las aplica en su propio motor y las documenta aquí.</p>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "hall", label: `Hallazgos (${FINDINGS.length})` }, { id: "reg", label: "Regresión" }, { id: "bsa", label: "Superficie corporal" }, { id: "vial", label: "Política de viales" }, { id: "trz", label: "Trazabilidad" }, { id: "inv", label: "Inventario" }]} />
      {tab === "hall" && <>
        <div className="actions"><Select ariaLabel="Gravedad" value={sev} onChange={setSev} options={[{ value: "all", label: "Todas las gravedades" }, ...Object.entries(SEV).map(([k, l]) => ({ value: k, label: l }))]} /><CopyBtn label="Copiar listado" getText={() => list.map((f) => `${f.id} [${SEV[f.sev]}] ${f.sheet}!${f.cells} — ${f.title}\n  ${f.detail}\n  Impacto: ${f.impact}\n  Tratamiento: ${f.treatment}`).join("\n\n")} /></div>
        {list.map((f) => <Card key={f.id} title={<span><Chip kind={f.sev === "crit" ? "crit" : f.sev === "warn" ? "warn" : "info"}>{SEV[f.sev]}</Chip> {f.id} · {f.title}</span>} sub={`${f.sheet}!${f.cells}`}>
          <p>{f.detail}</p><p><b>Impacto.</b> {f.impact}</p><p><b>Tratamiento en MieloFarma.</b> {f.treatment}</p></Card>)}
      </>}
      {tab === "reg" && <Regression />}
      {tab === "bsa" && <BsaTool />}
      {tab === "vial" && <VialImpact />}
      {tab === "trz" && <Card title="Matriz de trazabilidad" sub="Qué bloque del Excel va a qué módulo y con qué estado." flush><div className="tbl-w"><table className="tbl"><thead><tr><th>Bloque del Excel</th><th>Contenido</th><th>Módulo</th><th>Nota</th><th>Estado</th></tr></thead><tbody>{TRACE.map((r, i) => <tr key={i}><td>{r.block}</td><td>{r.content}</td><td>{r.module}</td><td className="small">{r.note}</td><td><Chip kind="info">{r.status}</Chip></td></tr>)}</tbody></table></div></Card>}
      {tab === "inv" && <Card title="Inventario del libro" flush><div className="tbl-w"><table className="tbl"><thead><tr><th>Hoja</th><th>Rango</th><th className="r">Celdas</th><th className="r">Fórmulas</th><th className="r">Entre hojas</th><th className="r">Números</th><th className="r">Texto</th></tr></thead><tbody>{INVENTORY.map((s) => <tr key={s.sheet}><td>{s.sheet}</td><td className="num-mono">{s.dims}</td><td className="r">{s.cells}</td><td className="r">{s.formulas}</td><td className="r">{s.crossSheet}</td><td className="r">{s.numbers}</td><td className="r">{s.text}</td></tr>)}</tbody></table></div></Card>}
    </div>
  );
}

/* ============================== ADMIN ============================== */
export function AdminPage() {
  const { S, set, resetAll, exportState, importState } = useApp();
  const [txt, setTxt] = useState(""); const [msg, setMsg] = useState(null); const [conf, setConf] = useState(false);
  const cfg = S.config; const up = (k, v) => set((x) => ({ ...x, config: { ...x.config, [k]: v } }));
  return (
    <div className="page">
      <h1>Administración</h1>
      <div className="grid2">
        <Card title="Datos del centro e informes">
          <Field label="Centro / servicio"><input value={cfg.center} onChange={(e) => up("center", e.target.value)} /></Field>
          <Field label="Título del informe"><input value={cfg.header} onChange={(e) => up("header", e.target.value)} /></Field>
          <Field label="Elaborado por (por defecto)"><input value={cfg.author} onChange={(e) => up("author", e.target.value)} /></Field>
          <Field label="Revisado por (por defecto)"><input value={cfg.reviewer} onChange={(e) => up("reviewer", e.target.value)} /></Field>
          <Field label="Pie del informe"><textarea rows={3} value={cfg.footer} onChange={(e) => up("footer", e.target.value)} /></Field>
        </Card>
        <Card title="Versiones y estado">
          <div className="tbl-w"><table className="tbl"><tbody><tr><td>Versión del motor de cálculo</td><td className="r num-mono">{ENGINE_VERSION}</td></tr><tr><td>Versión de los datos</td><td className="r num-mono">{DATA_VERSION}</td></tr><tr><td>Esquemas importados</td><td className="r">{SCHEMES_ALL.length}</td></tr><tr><td>Presentaciones en catálogo</td><td className="r">{S.catalog.length}</td></tr><tr><td>Pacientes (ficticios + propios)</td><td className="r">{S.patients.length}</td></tr></tbody></table></div>
          <p className="sub">Los resultados pueden cambiar entre versiones del motor. Cada informe indica la versión usada.</p>
          <Banner kind="warn" title="Almacenamiento.">Los datos se guardan en el navegador de este equipo (si el entorno lo permite). No hay servidor, ni telemetría, ni API de pago. Para conservarlos o moverlos, usa la copia de seguridad.</Banner>
        </Card>
      </div>
      <Card title="Copia de seguridad">
        <div className="actions"><CopyBtn variant="primary" label="Copiar copia de seguridad (JSON)" getText={exportState} /></div>
        <Field label="Restaurar: pega aquí el JSON"><textarea className="mono-area" rows={5} value={txt} onChange={(e) => setTxt(e.target.value)} /></Field>
        <div className="actions"><Btn disabled={!txt.trim()} onClick={() => setMsg(importState(txt))}>Restaurar</Btn></div>
        {msg && <Banner kind={msg.ok ? "good" : "crit"}>{msg.text}</Banner>}
      </Card>
      <Card title="Restablecer">
        <p className="sub">Vuelve a los datos importados del Excel y a los pacientes ficticios. Se pierden precios nuevos, esquemas propios, planes y cálculos guardados. Haz antes una copia de seguridad.</p>
        <Btn variant="danger" onClick={() => setConf(true)}>Restablecer datos de demostración…</Btn>
      </Card>
      <Card title="Registro de cambios" sub="Últimas acciones sobre precios y esquemas." flush>
        {S.log.length === 0 ? <Empty title="Sin cambios registrados" /> : <div className="tbl-w"><table className="tbl"><tbody>{S.log.slice(0, 30).map((l, i) => <tr key={i}><td className="small">{new Date(l.ts).toLocaleString("es-ES")}</td><td>{l.what}</td></tr>)}</tbody></table></div>}
      </Card>
      {conf && <Modal title="¿Restablecer todo?" onClose={() => setConf(false)} footer={<><Btn onClick={() => setConf(false)}>Cancelar</Btn><Btn variant="danger" onClick={() => { resetAll(); setConf(false); }}>Sí, restablecer</Btn></>}><p>Se perderán los cambios hechos en este navegador.</p></Modal>}
    </div>
  );
}
