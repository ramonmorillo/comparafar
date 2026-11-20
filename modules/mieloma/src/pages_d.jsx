import React, { useState, useMemo, useRef } from "react";
import { fmtDate, fmtNum } from "./engine.js";
import { useApp, Btn, Field, NumInput, Select, Check, Card, Banner, Tabs, Chip, Empty, Modal, Kpi, cx } from "./kit.jsx";
import { extractPdf, hashBytes } from "./pdftext.js";
import { parseOncofar, parseDose, parseDaysLiteral, PARSER_VERSION } from "./oncofar.js";
import { buildDraft, manualDraft, findExisting, reviewIssues, confirmDraft, reviseFromPlan, previewPlan, planCalendar, setField, ImportError, currentPlans } from "./importflow.js";
import { allIngredients, allPresentations, addIngredient, addMedicine, addPresentation, confirmAlias, setConversion, incorporateCima, CatalogError, ensureRef, normalizeName, ingredientName } from "./refcatalog.js";
import { createCima, CimaError } from "./cima.js";
import { evaluateAgreements, spendItems, periodOf, AGREEMENT_TYPES, overlapping } from "./agreements.js";
import { fmtCents } from "./money.js";

const today = () => new Date().toISOString().slice(0, 10);
const STATUS_CHIP = { extraido: ["Extraído", "chip-imp"], corregido: ["Corregido", "chip-calc"], confirmado: ["Confirmado", "chip-ok"], sin_resolver: ["Sin resolver", "chip-crit"] };
function St({ f }) { const [t, c] = STATUS_CHIP[f && f.status] || STATUS_CHIP.sin_resolver; return <span className={cx("chip", c)}>{t}</span>; }
const CAT = { principal: "Tratamiento principal", soporte: "Soporte", premedicacion: "Premedicación", ambiguo: "Sin clasificar" };

/* ============================== IMPORTAR DESDE ONCOFAR ============================== */
export function ImportarPage() {
  const { S, set, user, go } = useApp();
  const [ctxCode, setCtxCode] = useState(S.activePatient || "");
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState(null);
  const [clash, setClash] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [done, setDone] = useState(null);
  const input = useRef(null);
  const drafts = S.importDrafts || [];
  const draft = drafts.find((d) => d.id === openId);

  async function analyze(bytes, hash, extra = {}) {
    const r = await extractPdf(bytes);
    if (!r.ok) { setFail({ ...r, hash, ...extra }); return; }
    const p = parseOncofar(r);
    if (!p.ok) { setFail({ ok: false, reason: p.reason, message: p.message, hash, ...extra }); return; }
    const d = buildDraft({ parsed: p, hash, context: ctxCode, user, S, revisionOf: extra.revisionOf || null, revision: extra.revision || 1 });
    set((x) => ({ ...x, importDrafts: [...(x.importDrafts || []), d] })); setOpenId(d.id);
  }
  async function onFile(file) {
    if (!file) return;
    setBusy(true); setFail(null); setDone(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); // el PDF se procesa en este navegador y no se guarda
      const hash = await hashBytes(bytes);
      const ex = findExisting(S, hash, ctxCode);
      if (ex.drafts.length || ex.plans.length) { setClash({ hash, bytes, ...ex }); return; }
      await analyze(bytes, hash);
    } catch (e) { setFail({ reason: "ilegible", message: "No se pudo procesar el fichero: " + (e.message || e) }); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  const startManual = (f) => { const d = manualDraft({ hash: f ? f.hash : null, context: ctxCode, user, reason: f ? f.message : "", revisionOf: f && f.revisionOf, revision: (f && f.revision) || 1 }); set((x) => ({ ...x, importDrafts: [...(x.importDrafts || []), d] })); setOpenId(d.id); setFail(null); };
  const discard = (id) => { set((x) => ({ ...x, importDrafts: (x.importDrafts || []).filter((d) => d.id !== id) })); if (openId === id) setOpenId(null); };

  if (draft) return <ReviewDraft draft={draft} onClose={() => setOpenId(null)} onDone={(r) => { setDone(r); setOpenId(null); }} />;
  return (
    <div className="page">
      <div className="page-h"><h1>Importar desde Oncofar</h1></div>
      <Banner kind="info" title="Subir PDF → Revisar planificación → Confirmar.">El PDF se lee en este navegador (texto y posiciones); no se envía a ningún servicio, no se guarda y su nombre no se registra. Solo se conservan los campos estructurados de la planificación que confirmes. Parser {PARSER_VERSION}.</Banner>
      {done && <Banner kind="ok" title="Plan confirmado.">«{done.plan.name}» (revisión {done.plan.revision}) guardado como un único plan.{" "}{done.estimate.total.incomplete ? <b>La estimación es parcial: hay líneas pendientes (ver «Costes»).</b> : "Estimación completa."} <Btn small onClick={() => go("costes")}>Ver en Costes</Btn></Banner>}
      <Card title="1 · Subir PDF">
        <div className="form-grid">
          <Field label="Contexto (paciente seudonimizado)" hint="Sirve para detectar reimportaciones del mismo fichero y para resolver dosis por superficie corporal."><Select value={ctxCode} onChange={setCtxCode} options={[{ value: "", label: "Sin paciente" }, ...S.patients.map((p) => ({ value: p.code, label: p.code }))]} /></Field>
          <Field label="Fichero PDF de Oncofar"><input ref={input} type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(e) => onFile(e.target.files && e.target.files[0])} aria-label="Fichero PDF de Oncofar" /></Field>
        </div>
        {busy && <p role="status">Leyendo el documento…</p>}
        {fail && <Banner kind="crit" title="No se ha podido reconstruir la planificación.">{fail.message}<div className="row-end"><Btn variant="primary" onClick={() => startManual(fail)}>Completar manualmente</Btn><Btn onClick={() => setFail(null)}>Cerrar</Btn></div></Banner>}
        <div className="actions"><Btn onClick={() => startManual(null)}>Crear planificación sin PDF</Btn></div>
      </Card>
      <Card title="Borradores pendientes" sub="Se guardan solo con campos estructurados; sin el PDF ni su texto.">
        {drafts.length === 0 ? <Empty title="Sin borradores" /> : <ul className="plist">{drafts.map((d) => <li key={d.id}><button onClick={() => setOpenId(d.id)}><b>{(d.name && d.name.value) || "Sin nombre"}</b><span>Revisión {d.revision} · {d.context || "sin paciente"} · {fmtDate(d.createdAt.slice(0, 10))}{d.manual ? " · manual" : ""}</span></button> <Btn small onClick={() => discard(d.id)}>Descartar</Btn></li>)}</ul>}
      </Card>
      <Card title="Planes importados confirmados">
        {(S.importedPlans || []).length === 0 ? <Empty title="Todavía no hay planes importados" /> : <div className="tbl-w"><table className="tbl"><thead><tr><th>Plan</th><th>Revisión</th><th>Contexto</th><th>Inicio</th><th>Confirmado</th><th>Estado</th></tr></thead><tbody>{S.importedPlans.map((p) => <tr key={p.id}><td><b>{p.name}</b></td><td>{p.revision}{p.revisionOf ? " (de " + p.revisionOf.slice(-5) + ")" : ""}</td><td>{p.context || "—"}</td><td>{p.startDate ? fmtDate(p.startDate) : "relativo"}</td><td>{fmtDate(p.confirmedAt.slice(0, 10))}{p.confirmedBy ? " · " + p.confirmedBy : ""}</td><td>{currentPlans(S).some((c) => c.id === p.id) ? <Chip kind="ok">Vigente</Chip> : <Chip kind="neutral">Sustituido por revisión</Chip>}</td></tr>)}</tbody></table></div>}
      </Card>
      {clash && <Modal title="Este fichero ya se importó en este contexto" onClose={() => setClash(null)} footer={<Btn onClick={() => setClash(null)}>Cancelar</Btn>}>
        <p>Se ha detectado el mismo documento para «{ctxCode || "sin paciente"}». No se crearán administraciones duplicadas.</p>
        <div className="stack">
          {clash.drafts.map((d) => <div key={d.id}><b>Borrador existente</b> ({fmtDate(d.createdAt.slice(0, 10))}) <Btn variant="primary" small onClick={() => { setOpenId(d.id); setClash(null); }}>Recuperar borrador</Btn></div>)}
          {clash.plans.map((p) => <div key={p.id}><b>Plan confirmado</b> «{p.name}», revisión {p.revision}. Ese plan no se modifica. <Btn small onClick={async () => { const c = clash; setClash(null); setBusy(true); try { const rev = reviseFromPlan(S, p.id, { user }); set((x) => ({ ...x, importDrafts: [...(x.importDrafts || []), rev] })); setOpenId(rev.id); } finally { setBusy(false); } }}>Crear revisión explícita a partir del plan</Btn> <Btn small onClick={async () => { const c = clash; setClash(null); setBusy(true); try { await analyze(c.bytes, c.hash, { revisionOf: p.id, revision: Math.max(...c.plans.map((q) => q.revision)) + 1 }); } finally { setBusy(false); } }}>Crear revisión leyendo el PDF de nuevo</Btn></div>)}
        </div>
      </Modal>}
    </div>
  );
}

/* ---------- Revisión del borrador ---------- */
function ReviewDraft({ draft: d, onClose, onDone }) {
  const { S, set, user } = useApp();
  const [err, setErr] = useState(null);
  const ings = useMemo(() => allIngredients(S).slice().sort((a, b) => a.name.localeCompare(b.name, "es")), [S.ref, S.catalog]);
  const issues = useMemo(() => reviewIssues(d), [d]);
  const blockers = issues.filter((i) => i.severity === "bloqueante");
  const upd = (fn) => set((x) => ({ ...x, importDrafts: x.importDrafts.map((q) => (q.id === d.id ? fn(q) : q)) }));
  const editPhase = (pid, patch, keep) => upd((q) => ({ ...q, phases: q.phases.map((p) => (p.id === pid ? { ...p, ...patch, ...(keep ? {} : { reviewed: false }) } : p)) }));
  const editLine = (pid, lid, patch, keep) => upd((q) => ({ ...q, phases: q.phases.map((p) => (p.id !== pid ? p : { ...p, lines: p.lines.map((l) => (l.id === lid ? { ...l, ...patch, ...(keep ? {} : { reviewed: false }) } : l)) })) }));
  const editComp = (pid, lid, cid, patch) => upd((q) => ({ ...q, phases: q.phases.map((p) => (p.id !== pid ? p : { ...p, lines: p.lines.map((l) => (l.id !== lid ? l : { ...l, reviewed: false, components: l.components.map((c) => (c.id === cid ? { ...c, ...patch } : c)) })) })) }));
  const addLine = (pid) => upd((q) => ({ ...q, phases: q.phases.map((p) => (p.id !== pid ? p : { ...p, reviewed: false, lines: [...p.lines, { id: "M" + (p.lines.length + 1) + Date.now().toString(36).slice(-3), order: p.lines.length + 1, page: null, type: setField({}, "Antineoplásico"), category: "principal", categoryExplicit: false, included: true, route: setField({}, "PIV"), days: { value: null, literal: "", status: "sin_resolver" }, adminMinutes: null, reviewed: false, obsFlags: {}, components: [{ id: "c1", nameLiteral: "", doseLiteral: "", doseValue: null, unit: null, basis: null, role: "farmaco", ingredientId: null, match: { status: "ninguna", options: [] }, saveAlias: false }] }] })) }));
  const addPhase = () => upd((q) => ({ ...q, phases: [...q.phases, { id: "F" + (q.phases.length + 1), name: "Fase " + (q.phases.length + 1), interval: { value: null, literal: "", status: "sin_resolver" }, cycles: { value: null, literal: "", status: "sin_resolver" }, horizonCycles: null, cyclesMode: null, reviewed: false, page: null, lines: [] }] }));
  const plan = useMemo(() => { try { return previewPlan(d); } catch (e) { return null; } }, [d]);
  const cal = useMemo(() => (plan ? planCalendar(plan) : []), [plan]);
  const patient = S.patients.find((p) => p.code === d.context);

  function confirm() {
    setErr(null);
    try {
      const res = confirmDraft(S, d.id, { user, est: { patient: patient || null } });
      set((x) => ((x.importDrafts || []).some((q) => q.id === d.id) ? { ...x, ...res.patch } : x)); // una sola operación; si ya se aplicó, no hace nada
      onDone(res);
    } catch (e) { setErr(e instanceof ImportError ? e.message : "No se pudo guardar: " + e.message); }
  }
  return (
    <div className="page">
      <div className="page-h"><h1>Revisar planificación</h1><div className="actions"><Btn onClick={onClose}>Volver (el borrador se conserva)</Btn></div></div>
      {d.manual && <Banner kind="warn" title="Planificación manual.">{d.manualReason || "No se ha usado ningún PDF."} Completa los datos y confírmalos.</Banner>}
      {d.revisionOf && <Banner kind="info" title={`Revisión ${d.revision}.`}>El plan anterior no se modifica; esta revisión lo sustituirá como vigente al confirmarla.</Banner>}
      <Card title="Datos generales" sub={d.pageCount ? `${d.pageCount} página(s) · ${d.parserVersion}` : d.parserVersion}>
        <div className="form-grid">
          <Field label="Nombre del esquema"><input value={(d.name && d.name.value) || ""} aria-label="Nombre del esquema" onChange={(e) => upd((q) => ({ ...q, name: setField(q.name || {}, e.target.value) }))} /></Field>
          <Field label="Fecha inicial del plan" hint="Solo con una fecha explícita se generan fechas de calendario; si la dejas vacía, la pauta queda relativa (día de ciclo)."><input type="date" value={d.startDate || ""} aria-label="Fecha inicial" onChange={(e) => upd((q) => ({ ...q, startDate: e.target.value || null }))} /></Field>
        </div>
        {d.cycleHint && <p className="sub">El documento menciona «ciclo {d.cycleHint.cycle}: día {d.cycleHint.day}»: la hoja describe un ciclo concreto; la fecha inicial que indiques se aplica al día 1 del primer ciclo documentado.</p>}
      </Card>
      {d.phases.map((p) => (
        <Card key={p.id} title={`Fase: ${p.name}`} sub={p.page ? `página ${p.page}` : ""} actions={<Btn small onClick={() => addLine(p.id)}>+ Fila</Btn>}>
          <div className="form-grid">
            <Field label="Nombre de la fase"><input value={p.name} onChange={(e) => editPhase(p.id, { name: e.target.value })} aria-label="Nombre de la fase" /></Field>
            <Field label={<>Intervalo entre ciclos (días) <St f={p.interval} /></>} hint={p.interval && p.interval.literal ? `Literal del documento: «${p.interval.literal}» (p. ${p.interval.page})` : "No consta en el documento"}><NumInput value={p.interval && p.interval.value} onChange={(v) => editPhase(p.id, { interval: setField(p.interval || {}, v == null ? null : Math.round(v)) })} unit="d" min={1} ariaLabel="Intervalo entre ciclos" /></Field>
            <Field label={<>Nº de ciclos <St f={p.cycles} /></>} hint={p.cycles && p.cycles.literal ? `Literal: «${p.cycles.literal}» (p. ${p.cycles.page})` : "El documento no indica el número de ciclos."}><NumInput value={p.cycles && p.cycles.value} onChange={(v) => editPhase(p.id, { cycles: setField(p.cycles || {}, v == null ? null : Math.round(v)) })} min={1} ariaLabel="Número de ciclos" /></Field>
            {!(p.cycles && p.cycles.value != null) && <>
              <Field label="Horizonte de proyección (ciclos)"><NumInput value={p.horizonCycles} onChange={(v) => editPhase(p.id, { horizonCycles: v == null ? null : Math.round(v), cyclesMode: null })} min={1} ariaLabel="Horizonte de proyección" /></Field>
              <Check checked={p.cyclesMode === "tramo"} onChange={(v) => editPhase(p.id, { cyclesMode: v ? "tramo" : null, horizonCycles: v ? null : p.horizonCycles })}>Trabajar solo con el tramo documentado (1 ciclo)</Check>
            </>}
          </div>
          {p.lines.length === 0 ? <Empty title="Sin filas" /> : <div className="tbl-w"><table className="tbl"><thead><tr><th>Fila</th><th>Clasificación del documento</th><th>Días</th><th>Vía</th><th>Componentes (literal → catálogo)</th><th>En la estimación</th><th /></tr></thead><tbody>
            {p.lines.map((l) => (
              <tr key={l.id} className={cx(l.category === "ambiguo" && l.included == null && "row-warn")}>
                <td className="num-mono">{l.order}<div className="sub">{l.page ? "p. " + l.page : "manual"}</div></td>
                <td><input value={(l.type && l.type.value) || ""} aria-label="Tipo de terapia" onChange={(e) => editLine(p.id, l.id, { type: setField(l.type || {}, e.target.value) })} />
                  <div className="sub"><Chip kind={l.categoryExplicit ? "ok" : l.category === "ambiguo" ? "warn" : "neutral"}>{CAT[l.category]}{l.categoryExplicit ? " · expresa" : ""}</Chip></div>
                  {l.categoryHint && <div className="sub">{l.categoryHint}</div>}
                  <Select value={l.category} ariaLabel="Categoría" onChange={(v) => editLine(p.id, l.id, { category: v, included: v === "principal" ? true : v === "ambiguo" ? null : false })} options={Object.entries(CAT).map(([k, t]) => ({ value: k, label: t }))} /></td>
                <td><input value={l.days && (l.days.literal !== undefined && l.days.value == null ? l.days.literal : (l.days.value || []).join(","))} aria-label="Días de administración" placeholder="1, 8, 15 o 1-5" onChange={(e) => { const lit = e.target.value; const v = parseDaysLiteral(lit); editLine(p.id, l.id, { days: { value: v, literal: lit, page: l.days && l.days.page, status: v ? "corregido" : "sin_resolver" } }); }} /><St f={l.days} /></td>
                <td><input value={(l.route && l.route.value) || ""} aria-label="Vía" onChange={(e) => editLine(p.id, l.id, { route: setField(l.route || {}, e.target.value) })} style={{ width: 70 }} /></td>
                <td>{l.components.map((c) => (
                  <div key={c.id} className="comp">
                    <div><input value={c.nameLiteral} aria-label="Componente (literal)" onChange={(e) => editComp(p.id, l.id, c.id, { nameLiteral: e.target.value })} /> <input value={c.doseLiteral} aria-label="Dosis (literal)" style={{ width: 110 }} onChange={(e) => { const dd = parseDose(e.target.value); editComp(p.id, l.id, c.id, { doseLiteral: e.target.value, doseValue: dd.value, unit: dd.unit, basis: dd.basis }); }} /></div>
                    <div className="sub">{c.role === "diluyente" ? <Chip kind="neutral">Diluyente: no se costea</Chip> : c.basis ? `${fmtNum(c.doseValue, 2)} ${c.unit}` : <Chip kind="crit">Dosis sin resolver</Chip>}{c.page ? ` · p. ${c.page}` : ""}</div>
                    {c.role !== "diluyente" && <>
                      <Select value={c.ingredientId || ""} ariaLabel="Principio activo del catálogo" onChange={(v) => editComp(p.id, l.id, c.id, { ingredientId: v || null })} options={[{ value: "", label: c.match && c.match.options.length > 1 ? "Elige una de las opciones…" : "Sin vincular" }, ...(c.match && c.match.options.length > 1 ? [{ group: "Propuestas", items: c.match.options.map((o) => ({ value: o.id, label: o.name })) }] : []), { group: "Catálogo", items: ings.map((i) => ({ value: i.id, label: i.name })) }]} />
                      {c.ingredientId && normalizeName(ingredientName(S, c.ingredientId)) !== normalizeName(c.nameLiteral) && <Check checked={!!c.saveAlias} onChange={(v) => editComp(p.id, l.id, c.id, { saveAlias: v })}>Guardar «{c.nameLiteral}» como alias</Check>}
                    </>}
                  </div>))}</td>
                <td>{l.category === "ambiguo" && l.included == null ? <div><Chip kind="warn">Por decidir</Chip><div className="actions"><Btn small onClick={() => editLine(p.id, l.id, { included: true })}>Incluir</Btn><Btn small onClick={() => editLine(p.id, l.id, { included: false })}>Excluir</Btn></div></div> : <Check checked={!!l.included} onChange={(v) => editLine(p.id, l.id, { included: v })}>{l.included ? "Incluida" : "No incluida"}</Check>}</td>
                <td>{l.included && <Check checked={!!l.reviewed} onChange={(v) => editLine(p.id, l.id, { reviewed: v }, true)}>Confirmo días, dosis y catálogo</Check>}</td>
              </tr>))}
          </tbody></table></div>}
          <Check checked={!!p.reviewed} onChange={(v) => editPhase(p.id, { reviewed: v }, true)}>Confirmo ciclos e intervalo de esta fase</Check>
        </Card>))}
      <div className="actions"><Btn onClick={addPhase}>+ Fase</Btn></div>
      <Card title="Planificación resultante" sub={plan && plan.startDate ? "Fechas de calendario a partir de la fecha inicial indicada." : "Pauta relativa: días de ciclo, sin fechas de calendario."} flush>
        {cal.length === 0 ? <Empty title="Aún no hay administraciones incluidas" /> : <div className="tbl-w"><table className="tbl"><thead><tr><th>Fase</th><th className="r">Ciclo</th><th className="r">Día</th><th>Fecha</th><th>Fármacos</th></tr></thead><tbody>{cal.slice(0, 80).map((c, i) => <tr key={i}><td>{c.phase}</td><td className="r">{c.cycle}</td><td className="r">{c.day}</td><td>{c.date ? fmtDate(c.date) : "relativa"}</td><td>{c.drugs.join(" + ")}</td></tr>)}{cal.length > 80 && <tr><td colSpan={5} className="muted">… y {cal.length - 80} administraciones más.</td></tr>}</tbody></table></div>}
      </Card>
      <Card title={`Para poder confirmar (${blockers.length} pendiente${blockers.length === 1 ? "" : "s"})`}>
        {issues.length === 0 ? <p>Todo resuelto.</p> : <ul className="issues">{issues.map((i, k) => <li key={k} className={i.severity === "bloqueante" ? "crit" : "warn"}><Chip kind={i.severity === "bloqueante" ? "crit" : "info"}>{i.severity === "bloqueante" ? "Pendiente" : "Aviso"}</Chip> {i.text}</li>)}</ul>}
        {err && <Banner kind="crit">{err}</Banner>}
        <div className="actions"><Btn variant="primary" disabled={blockers.length > 0} onClick={confirm}>Confirmar y guardar plan</Btn></div>
        <p className="sub">Se guarda un único plan y su primera estimación de coste, en una sola operación. La estimación es provisional y puede quedar parcial si faltan precios o presentaciones.</p>
      </Card>
    </div>
  );
}

/* ============================== CATÁLOGO DE MEDICAMENTOS ============================== */
const SRC_CHIP = (s) => (s && s.kind === "cima" ? <Chip kind="ok" title={`nº registro ${s.nregistro || ""} · consultado ${s.consultedAt || ""}`}>CIMA · {(s.consultedAt || "").slice(0, 10)}</Chip> : s && s.kind === "excel" ? <Chip kind="imp">Excel</Chip> : <Chip kind="neutral">Manual</Chip>);
export function CatalogoPage() {
  const { S, set, user, access } = useApp();
  const [tab, setTab] = useState("pa");
  const ref = ensureRef(S.ref);
  const ings = allIngredients(S), pres = allPresentations(S);
  return (
    <div className="page">
      <div className="page-h"><h1>Catálogo de medicamentos</h1></div>
      <Banner kind="info" title="Tres niveles: principio activo → medicamento → presentación.">El origen de cada dato es visible (CIMA, Excel o alta manual). Actualizar desde CIMA nunca sobrescribe tus alias, precios ni acuerdos. El catálogo funciona sin conexión.</Banner>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "pa", label: "Principios activos", badge: ings.length }, { id: "med", label: "Medicamentos", badge: ref.medicines.length }, { id: "pres", label: "Presentaciones", badge: pres.length }, { id: "alias", label: "Alias de Oncofar", badge: ref.aliases.length }, { id: "cima", label: "Buscar en CIMA" }]} />
      {tab === "pa" && <IngredientsTab />}
      {tab === "med" && <MedicinesTab />}
      {tab === "pres" && <PresentationsTab />}
      {tab === "alias" && <AliasTab />}
      {tab === "cima" && <CimaTab onDone={() => setTab("med")} />}
    </div>
  );
}
const catErr = (e) => (e instanceof CatalogError ? e.message : "Error: " + (e.message || e));
function IngredientsTab() {
  const { S, set, user } = useApp();
  const [name, setName] = useState(""); const [err, setErr] = useState(null); const [q, setQ] = useState("");
  const list = allIngredients(S).filter((i) => !q || i.nameNorm.includes(normalizeName(q)));
  const add = () => { try { const r = addIngredient(S.ref, { name }, { user }); set((x) => ({ ...x, ref: r.ref })); setName(""); setErr(null); } catch (e) { setErr(catErr(e)); } };
  return <Card title="Principios activos" actions={<input aria-label="Buscar principio activo" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />}>
    <div className="form-grid"><Field label="Alta manual de principio activo"><input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nuevo principio activo" /></Field><div className="actions"><Btn variant="primary" disabled={!name.trim()} onClick={add}>Añadir</Btn></div></div>
    {err && <Banner kind="warn">{err}</Banner>}
    <div className="tbl-w"><table className="tbl"><thead><tr><th>Principio activo</th><th>Origen</th><th>Identificador oficial</th></tr></thead><tbody>{list.map((i) => <tr key={i.id}><td><b>{i.name}</b></td><td>{SRC_CHIP(i.source)}</td><td className="small">{i.cima ? `CIMA ${i.cima.codigo} (id ${i.cima.id})` : "—"}</td></tr>)}</tbody></table></div></Card>;
}
function MedicinesTab() {
  const { S, set, user, access, schemes } = useApp();
  const ref = ensureRef(S.ref); const [form, setForm] = useState(null); const [err, setErr] = useState(null); const [sel, setSel] = useState(null);
  const ings = allIngredients(S);
  const save = () => { try { const r = addMedicine(S.ref, { name: form.name, ingredients: form.ings.filter((i) => i.ingredientId), nregistro: form.nregistro || undefined }, { user }); set((x) => ({ ...x, ref: r.ref })); setForm(null); setErr(null); } catch (e) { setErr(catErr(e)); } };
  const med = ref.medicines.find((m) => m.id === sel);
  return <>
    <Card title="Medicamentos" actions={<Btn variant="primary" onClick={() => setForm({ name: "", nregistro: "", ings: [{ ingredientId: "", amount: "", unit: "" }] })}>+ Alta manual</Btn>}>
      {ref.medicines.length === 0 ? <Empty title="Sin medicamentos propios">Añádelos a mano o incorpóralos desde CIMA.</Empty> : <div className="tbl-w"><table className="tbl"><thead><tr><th>Medicamento</th><th>Principios activos</th><th>Origen</th><th /></tr></thead><tbody>{ref.medicines.map((m) => <tr key={m.id}><td><b>{m.name}</b><div className="sub">{m.nregistro ? "Nº registro " + m.nregistro : "sin nº de registro"}{m.labtitular ? " · " + m.labtitular : ""}</div></td><td>{m.ingredients.map((i) => ingredientName(S, i.ingredientId) + (i.amount ? ` ${i.amount} ${i.unit}` : "")).join(" + ")}</td><td>{SRC_CHIP(m.source)}</td><td className="r"><Btn small onClick={() => setSel(m.id)}>Ficha</Btn></td></tr>)}</tbody></table></div>}
    </Card>
    {med && <MedicineSheet med={med} onClose={() => setSel(null)} />}
    {form && <Modal title="Alta manual de medicamento" onClose={() => setForm(null)} footer={<><Btn onClick={() => setForm(null)}>Cancelar</Btn><Btn variant="primary" disabled={!form.name.trim() || !form.ings.some((i) => i.ingredientId)} onClick={save}>Crear</Btn></>}>
      <Field label="Nombre del medicamento"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Nombre del medicamento" /></Field>
      <Field label="Nº de registro (opcional)"><input value={form.nregistro} onChange={(e) => setForm({ ...form, nregistro: e.target.value })} /></Field>
      {form.ings.map((row, k) => <div className="form-grid" key={k}><Field label={`Principio activo ${k + 1}`}><Select value={row.ingredientId} ariaLabel={`Principio activo ${k + 1}`} onChange={(v) => setForm({ ...form, ings: form.ings.map((r, j) => (j === k ? { ...r, ingredientId: v } : r)) })} options={[{ value: "", label: "Elige…" }, ...ings.map((i) => ({ value: i.id, label: i.name }))]} /></Field><Field label="Cantidad y unidad (literal)"><input value={row.amount} onChange={(e) => setForm({ ...form, ings: form.ings.map((r, j) => (j === k ? { ...r, amount: e.target.value } : r)) })} /></Field></div>)}
      <Btn small onClick={() => setForm({ ...form, ings: [...form.ings, { ingredientId: "", amount: "", unit: "" }] })}>+ Otro principio activo (combinación)</Btn>
      {err && <Banner kind="warn">{err}</Banner>}
    </Modal>}
  </>;
}
// Ficha del medicamento: presentaciones y medidas de gasto vigentes con su periodo
function MedicineSheet({ med, onClose }) {
  const { S, schemes, access } = useApp();
  const asOf = today();
  const mine = allPresentations(S).filter((p) => p.medicineId === med.id);
  const ags = (S.agreements || []).filter((a) => a.scope.level === "medicamento" ? a.scope.targetId === med.id : a.scope.level === "principio_activo" ? med.ingredients.some((i) => i.ingredientId === a.scope.targetId) : mine.some((p) => p.id === a.scope.targetId));
  const evs = useMemo(() => (access.view && ags.length ? evaluateAgreements(S, { items: spendItems(S, schemes, asOf), asOf, only: ags.map((a) => a.id) }) : []), [S, access.view]);
  return <Modal wide title={med.name} onClose={onClose}>
    <p className="sub">{med.ingredients.map((i) => ingredientName(S, i.ingredientId) + (i.amount ? ` ${i.amount} ${i.unit}` : "")).join(" + ")} · {SRC_CHIP(med.source)}</p>
    <h4>Presentaciones</h4>
    {mine.length === 0 ? <p className="muted">Sin presentaciones.</p> : <ul>{mine.map((p) => <li key={p.id}>{p.label}{p.cn ? ` · CN ${p.cn}` : ""}</li>)}</ul>}
    <h4>Medidas de gasto vigentes</h4>
    {!access.view ? <p className="muted">{access.why}</p> : ags.length === 0 ? <p className="muted">Sin acuerdos que afecten a este medicamento.</p> : evs.filter((e) => e.active).map((e) => <AgreementSummary key={e.agreementId} ev={e} ag={ags.find((a) => a.id === e.agreementId)} />)}
  </Modal>;
}
export function AgreementSummary({ ev, ag }) {
  const per = `${fmtDate(ev.period.from)} – ${fmtDate(ev.period.to)}`;
  return <div className="agr">
    <b>{ag.title}</b> <Chip kind="neutral">{AGREEMENT_TYPES[ag.type]}</Chip> <span className="sub">periodo {per}</span>
    {ev.threshold != null && <div>Techo {fmtCents(ev.threshold)} · gasto computable {fmtCents(ev.computable.cents)}{ev.pct != null && ` (${Math.round(ev.pct * 1000) / 10} % consumido)`}{ev.remaining != null && (ev.remaining >= 0 ? ` · restante ${fmtCents(ev.remaining)}` : <b> · excedido en {fmtCents(-ev.remaining)}</b>)}</div>}
    <div className="sub">Realizado: {ev.realized.cents == null ? "pendiente" : fmtCents(ev.realized.cents)} ({ev.realized.source}) · Proyectado (corte {fmtDate(ev.projected.cutDate)}): {fmtCents(ev.projected.cents)}{ev.projectedClose != null && ` · cierre proyectado ${fmtCents(ev.projectedClose)}`}</div>
    {ev.signals.map((s, i) => <Banner key={i} kind={s.level === "crit" ? "crit" : "warn"}>{s.text}</Banner>)}
  </div>;
}
function PresentationsTab() {
  const { S, set, user } = useApp();
  const ref = ensureRef(S.ref); const all = allPresentations(S); const [form, setForm] = useState(null); const [err, setErr] = useState(null); const [conv, setConv] = useState(null);
  const save = () => { try { const r = addPresentation(S.ref, { medicineId: form.medicineId, label: form.label, cn: form.cn || null, content: form.contentCount ? { count: form.contentCount, unit: form.contentUnit || "vial" } : null, conversion: form.mg > 0 ? { mgPerUnit: form.mg, basis: "manual", verified: !!form.verified } : null, oral: form.oral }, { user }); set((x) => ({ ...x, ref: r.ref })); setForm(null); setErr(null); } catch (e) { setErr(catErr(e)); } };
  const saveConv = () => { try { set((x) => ({ ...x, ref: setConversion(x.ref, conv.id, conv.mg > 0 ? { mgPerUnit: conv.mg, basis: "manual", verified: conv.verified } : null, { user }) })); setConv(null); } catch (e) { setErr(catErr(e)); } };
  return <Card title="Presentaciones comerciales" actions={<Btn variant="primary" disabled={!ref.medicines.length} onClick={() => setForm({ medicineId: ref.medicines.length ? ref.medicines[ref.medicines.length - 1].id : "", label: "", cn: "", contentCount: 1, contentUnit: "vial", mg: null, verified: false, oral: false })}>+ Alta manual</Btn>}>
    {!ref.medicines.length && <p className="sub">Para dar de alta una presentación crea antes el medicamento.</p>}
    <div className="tbl-w"><table className="tbl"><thead><tr><th>Presentación</th><th>CN (texto)</th><th>Contenido</th><th className="r">mg por unidad</th><th>Origen</th><th /></tr></thead><tbody>{all.map((p) => <tr key={p.id}><td><b>{p.label}</b>{p.medicineName && <div className="sub">{p.medicineName}</div>}</td><td className="num-mono">{p.cn || "—"}</td><td>{p.content ? `${p.content.count || ""} ${p.content.unit || ""}${p.content.volume ? " de " + p.content.volume.amount + " " + p.content.volume.unit : ""}` : "—"}</td><td className="r">{p.conversion ? <>{fmtNum(p.conversion.mgPerUnit, 3)} {p.conversion.verified ? <Chip kind="verificado">Comprobada</Chip> : <Chip kind="pendiente">Sin comprobar</Chip>}</> : <Chip kind="warn">Sin equivalencia</Chip>}</td><td>{SRC_CHIP(p.source)}</td><td className="r">{!p.legacy && <Btn small onClick={() => setConv({ id: p.id, mg: p.conversion ? p.conversion.mgPerUnit : null, verified: !!(p.conversion && p.conversion.verified) })}>Equivalencia</Btn>}</td></tr>)}</tbody></table></div>
    {err && <Banner kind="warn">{err}</Banner>}
    {form && <Modal title="Alta manual de presentación" onClose={() => setForm(null)} footer={<><Btn onClick={() => setForm(null)}>Cancelar</Btn><Btn variant="primary" disabled={!form.label.trim()} onClick={save}>Crear</Btn></>}>
      <Field label="Medicamento"><Select value={form.medicineId} onChange={(v) => setForm({ ...form, medicineId: v })} options={ref.medicines.map((m) => ({ value: m.id, label: m.name }))} /></Field>
      <Field label="Descripción"><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} aria-label="Descripción de la presentación" /></Field>
      <Field label="Código nacional" hint="6 o 7 dígitos; se guarda como texto."><input value={form.cn} onChange={(e) => setForm({ ...form, cn: e.target.value })} aria-label="Código nacional" /></Field>
      <Field label="mg de principio activo por unidad (vial/comprimido)"><NumInput value={form.mg} onChange={(v) => setForm({ ...form, mg: v })} unit="mg" min={0} /></Field>
      <Check checked={form.verified} onChange={(v) => setForm({ ...form, verified: v })}>He comprobado esta equivalencia con la ficha técnica</Check>
      <Check checked={form.oral} onChange={(v) => setForm({ ...form, oral: v })}>Forma oral</Check>
    </Modal>}
    {conv && <Modal title="Equivalencia mg por unidad" onClose={() => setConv(null)} footer={<><Btn onClick={() => setConv(null)}>Cancelar</Btn><Btn variant="primary" onClick={saveConv}>Guardar</Btn></>}>
      <Field label="mg por unidad"><NumInput value={conv.mg} onChange={(v) => setConv({ ...conv, mg: v })} unit="mg" min={0} /></Field>
      <Check checked={conv.verified} onChange={(v) => setConv({ ...conv, verified: v })}>Equivalencia comprobada</Check>
      <p className="sub">El coste por mg solo se calcula con una equivalencia comprobada.</p>
    </Modal>}
  </Card>;
}
function AliasTab() {
  const { S, set, user } = useApp();
  const ref = ensureRef(S.ref); const [alias, setAlias] = useState(""); const [ing, setIng] = useState(""); const [err, setErr] = useState(null);
  const ings = allIngredients(S);
  const add = () => { try { set((x) => ({ ...x, ref: confirmAlias(x.ref, alias, ing, { user }) })); setAlias(""); setErr(null); } catch (e) { setErr(catErr(e)); } };
  return <Card title="Alias con los que aparecen en Oncofar" sub="Solo se guardan cuando confirmas la equivalencia (aquí o durante la revisión de una importación).">
    <div className="form-grid"><Field label="Texto tal como aparece en Oncofar"><input value={alias} onChange={(e) => setAlias(e.target.value)} aria-label="Alias" /></Field><Field label="Principio activo"><Select value={ing} onChange={setIng} options={[{ value: "", label: "Elige…" }, ...ings.map((i) => ({ value: i.id, label: i.name }))]} /></Field><div className="actions"><Btn variant="primary" disabled={!alias.trim() || !ing} onClick={add}>Confirmar alias</Btn></div></div>
    {err && <Banner kind="warn">{err}</Banner>}
    {ref.aliases.length === 0 ? <Empty title="Sin alias" /> : <div className="tbl-w"><table className="tbl"><thead><tr><th>Alias</th><th>Principio activo</th><th>Confirmado</th></tr></thead><tbody>{ref.aliases.map((a) => <tr key={a.id}><td>{a.alias}</td><td>{ingredientName(S, a.ingredientId)}</td><td className="small">{fmtDate(a.confirmedAt.slice(0, 10))}{a.confirmedBy ? " · " + a.confirmedBy : ""}</td></tr>)}</tbody></table></div>}
  </Card>;
}
function CimaTab({ onDone }) {
  const { S, set, user } = useApp();
  const [term, setTerm] = useState(""); const [res, setRes] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const [det, setDet] = useState(null); const [pick, setPick] = useState({}); const [page, setPage] = useState(1);
  const cima = useMemo(() => createCima(), []);
  async function search(p = 1) {
    setBusy(true); setErr(null); setDet(null); setPage(p);
    try { setRes(await cima.search(term, { pagina: p })); } catch (e) { setRes(null); setErr(e instanceof CimaError ? e.message : "Error inesperado: " + e.message); } finally { setBusy(false); }
  }
  async function open(nreg) {
    setBusy(true); setErr(null);
    try { const d = await cima.detail({ nregistro: nreg }); if (!d) { setErr("CIMA no devuelve la ficha de ese número de registro."); return; } setDet(d); setPick(Object.fromEntries(d.presentations.map((p) => [p.cn, true]))); } catch (e) { setErr(e instanceof CimaError ? e.message : "Error inesperado"); } finally { setBusy(false); }
  }
  const incorporate = () => { const r = incorporateCima(S.ref, det, Object.keys(pick).filter((k) => pick[k]), { user }); set((x) => ({ ...x, ref: r.ref })); setDet(null); setRes(null); onDone(); };
  return <Card title="Buscar en CIMA (AEMPS, uso humano)" sub="Se envía a CIMA únicamente el término que escribes aquí. Puedes buscar por nombre comercial, principio activo, número de registro o código nacional.">
    <div className="form-grid"><Field label="Término de búsqueda"><input value={term} aria-label="Término de búsqueda en CIMA" onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && term.trim() && search(1)} /></Field><div className="actions"><Btn variant="primary" disabled={!term.trim() || busy} onClick={() => search(1)}>Buscar</Btn></div></div>
    {busy && <p role="status">Consultando CIMA…</p>}
    {err && <Banner kind="warn" title="CIMA no está disponible o no ha respondido.">{err} Puedes seguir trabajando con el catálogo local y el alta manual.</Banner>}
    {res && res.total === 0 && <Banner kind="info" title="Sin resultados en CIMA.">No hay fichas para «{term}». Prueba con el principio activo o el número de registro, o da de alta el medicamento a mano en las pestañas «Principios activos», «Medicamentos» y «Presentaciones».</Banner>}
    {res && res.total > 0 && <>
      <p className="sub">{res.total} ficha(s) encontradas por {res.via}. Página {res.page} de {res.pages}.</p>
      <div className="tbl-w"><table className="tbl"><thead><tr><th>Nombre</th><th>Nº registro</th><th>Laboratorio</th><th>Dosis</th><th>Comercializado</th><th /></tr></thead><tbody>{res.results.map((r) => <tr key={r.nregistro}><td><b>{r.nombre}</b><div className="sub">{r.vtm}</div></td><td className="num-mono">{r.nregistro}</td><td>{r.labtitular}</td><td>{r.dosis}</td><td>{r.comerc ? "Sí" : "No"}</td><td className="r"><Btn small onClick={() => open(r.nregistro)}>Ver ficha</Btn></td></tr>)}</tbody></table></div>
      {res.pages > 1 && <div className="actions"><Btn small disabled={page <= 1} onClick={() => search(page - 1)}>Anterior</Btn><Btn small disabled={page >= res.pages} onClick={() => search(page + 1)}>Siguiente</Btn></div>}
    </>}
    {det && <Modal wide title={`Confirmar ficha: ${det.nombre}`} onClose={() => setDet(null)} footer={<><Btn onClick={() => setDet(null)}>Cancelar</Btn><Btn variant="primary" onClick={incorporate}>Incorporar al catálogo</Btn></>}>
      <p className="sub">Nº registro {det.nregistro} · {det.labtitular} · {det.forma} · consultado {today()} · fuente CIMA</p>
      <h4>Principios activos (literal de CIMA)</h4>
      <ul>{det.ingredients.map((i) => <li key={i.codigo}>{i.nombre} · {i.cantidad} {i.unidad} <span className="muted">(código {i.codigo})</span></li>)}</ul>
      {det.dosis && <p className="sub">Concentración/dosis indicada: {det.dosis}</p>}
      <h4>Presentaciones</h4>
      <div className="tbl-w"><table className="tbl"><thead><tr><th /><th>CN</th><th>Presentación</th><th>Contenido</th><th>Equivalencia propuesta</th></tr></thead><tbody>{det.presentations.map((p) => <tr key={p.cn}><td><input type="checkbox" aria-label={`Incorporar CN ${p.cn}`} checked={!!pick[p.cn]} onChange={(e) => setPick({ ...pick, [p.cn]: e.target.checked })} /></td><td className="num-mono">{p.cn}</td><td>{p.nombre}</td><td>{p.content ? p.content.literal : "no consta"}</td><td>{p.conversion ? <>{fmtNum(p.conversion.mgPerUnit, 3)} mg/unidad <Chip kind="pendiente">Sin comprobar</Chip></> : <span className="muted">no se puede deducir</span>}</td></tr>)}</tbody></table></div>
      <p className="sub">Si el principio activo o la presentación ya existen se enlazan, no se duplican. Tus alias, precios y acuerdos no se modifican.</p>
    </Modal>}
  </Card>;
}
