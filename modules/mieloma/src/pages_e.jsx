import React, { useState, useMemo } from "react";
import { fmtDate, fmtNum, toCSV, addDays } from "./engine.js";
import { useApp, Btn, Field, NumInput, Select, Check, Card, Banner, Tabs, Chip, Empty, Modal, Kpi, CopyBtn, cx } from "./kit.jsx";
import { allPresentations, allIngredients, ingredientName, ensureRef } from "./refcatalog.js";
import { versionsFor, resolvePrice, unitPrice, costPerMg, addPriceVersion, PriceError, PURCHASE_UNITS, VAT_MODES, DEFAULT_CONDITION, isCommercialVersion } from "./pricing.js";
import { estimatePlan, costInPeriod, REASONS, policyText } from "./estimate.js";
import { reestimate, currentPlans, chainOf } from "./importflow.js";
import { AGREEMENT_TYPES, SCOPE_LEVELS, FORMULA_KINDS, saveAgreement, validateAgreement, evaluateAgreements, spendItems, periodOf, AgreementError } from "./agreements.js";
import { fmtCents, fmtUnits, UNITS_PER_EUR, ROUNDING_RULE } from "./money.js";
import { ecoSection, ecoCSVRows, estimateCSV, scopeLabel } from "./exportsEco.js";
import { AgreementSummary } from "./pages_d.jsx";

const today = () => new Date().toISOString().slice(0, 10);
const NoAccess = ({ access }) => <div className="page"><Banner kind="warn" title="Sin acceso a condiciones comerciales.">{access.why}</Banner></div>;

/* ============================== COSTES ============================== */
export function CostesPage() {
  const { S, access } = useApp();
  const [tab, setTab] = useState("precios");
  return (
    <div className="page">
      <div className="page-h"><h1>Costes</h1></div>
      <Banner kind="info" title="Precios versionados y estimaciones trazables.">Cada cambio de precio crea una versión con su vigencia y fuente; no se admiten vigencias solapadas. Una estimación guardada conserva el precio, la regla y el resultado de cuando se generó. Redondeo: {ROUNDING_RULE}</Banner>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "precios", label: "Precios por presentación" }, { id: "est", label: "Estimaciones de planes", badge: (S.estimates || []).length }]} />
      {tab === "precios" ? <PricesTab /> : <EstimatesTab />}
    </div>
  );
}

function PricesTab() {
  const { S, set, user, access } = useApp();
  const [q, setQ] = useState(""); const [open, setOpen] = useState(null); const [form, setForm] = useState(null);
  const td = today();
  const rows = allPresentations(S).filter((p) => !q || (p.label + " " + (p.cn || "")).toLowerCase().includes(q.toLowerCase()));
  return <>
    <input aria-label="Buscar presentación" placeholder="Buscar presentación o código nacional…" value={q} onChange={(e) => setQ(e.target.value)} />
    <Card flush><div className="tbl-w"><table className="tbl"><thead><tr><th>Presentación</th><th className="r">Precio vigente hoy</th><th>Unidad de compra</th><th>IVA</th><th className="r">€/mg</th><th>Fuente y vigencia</th><th /></tr></thead><tbody>
      {rows.map((p) => {
        const vs = versionsFor(S, p.id).filter((v) => access.view || !isCommercialVersion(v));
        const v = resolvePrice(vs, td); const up = v ? unitPrice(v) : null; const permg = v && up && up.units ? costPerMg(p, up.units) : null;
        return <React.Fragment key={p.id}>
          <tr className={cx(!v && "row-warn")}><td><b>{p.label}</b><div className="sub">{p.cn ? "CN " + p.cn : p.legacy ? "catálogo del Excel" : "sin CN"}</div></td>
            <td className="r">{v ? <span className="num-mono">{fmtCents(Math.round(v.priceUnits / 100))}</span> : <Chip kind="crit">Sin precio</Chip>}</td>
            <td>{v ? `${v.purchaseUnit}${v.contentPerUnit > 1 ? " de " + v.contentPerUnit : ""}` : "—"}</td>
            <td className="small">{v ? VAT_MODES[v.vat.mode] + (v.vat.rate ? ` (${v.vat.rate * 100} %)` : "") : "—"}</td>
            <td className="r num-mono">{permg != null ? fmtNum(permg, 4) : <span className="muted" title={p.conversion ? "Equivalencia sin comprobar" : "Sin equivalencia"}>—</span>}</td>
            <td className="small">{v ? <>{v.source || "sin fuente"}<div className="sub">desde {v.from ? fmtDate(v.from) : "origen"}{v.to ? " hasta " + fmtDate(v.to) : ""}</div></> : "—"}</td>
            <td className="r"><Btn small onClick={() => setOpen(open === p.id ? null : p.id)}>Historial ({vs.length})</Btn>{access.edit && <> <Btn small onClick={() => setForm({ presId: p.id, label: p.label, price: null, purchaseUnit: "vial", contentPerUnit: 1, vatMode: "sin_iva", vatRate: null, source: "", from: td, to: "", center: "", condition: DEFAULT_CONDITION, priceType: "", note: "", closePrevious: false })}>Nueva versión</Btn></>}</td></tr>
          {open === p.id && <tr><td colSpan={7}><div className="tbl-w"><table className="tbl inner"><thead><tr><th>Desde</th><th>Hasta</th><th className="r">Precio</th><th>Unidad / contenido</th><th>IVA</th><th>Centro</th><th>Condición</th><th>Fuente</th><th>Registrado</th></tr></thead><tbody>{vs.length === 0 ? <tr><td colSpan={9} className="muted">Sin versiones.</td></tr> : vs.slice().sort((a, b) => (a.from || "").localeCompare(b.from || "")).map((x) => <tr key={x.id}><td>{x.from ? fmtDate(x.from) : "origen"}</td><td>{x.to ? fmtDate(x.to) : "abierta"}</td><td className="r">{fmtUnits(x.priceUnits)}</td><td>{x.purchaseUnit} / {x.contentPerUnit}</td><td>{VAT_MODES[x.vat.mode]}</td><td>{x.center || "—"}</td><td>{x.condition}</td><td>{x.source}</td><td className="small">{x.origin === "legacy" ? "Excel / histórico" : (x.by || "—") + " · " + (x.at || "").slice(0, 10)}</td></tr>)}</tbody></table></div></td></tr>}
        </React.Fragment>;
      })}
    </tbody></table></div></Card>
    {form && <PriceVersionForm form={form} onClose={() => setForm(null)} />}
  </>;
}

function PriceVersionForm({ form, onClose }) {
  const { S, set, user, access } = useApp();
  const [f, setF] = useState(form); const [err, setErr] = useState(null);
  const commercial = f.condition !== DEFAULT_CONDITION || !!f.center.trim();
  const input = () => ({ presId: f.presId, price: f.price, purchaseUnit: f.purchaseUnit, contentPerUnit: f.contentPerUnit, vat: { mode: f.vatMode, rate: f.vatMode === "no_especificado" ? null : f.vatRate }, source: f.source, from: f.from, to: f.to || null, center: f.center.trim(), condition: (f.condition || DEFAULT_CONDITION).trim() || DEFAULT_CONDITION, priceType: f.priceType, note: f.note });
  const save = () => {
    try {
      addPriceVersion(S, input(), { closePrevious: f.closePrevious, user }); // valida y detecta solapes antes de tocar el estado
      set((x) => { try { const r = addPriceVersion(x, input(), { closePrevious: f.closePrevious, user }); return { ...x, priceVersions: r.priceVersions, catalog: r.catalog, log: [{ ts: Date.now(), what: `Nueva versión de precio ${f.label}: ${f.price} € desde ${f.from}${commercial ? " (condición diferenciada)" : ""}`, by: user || null }, ...(x.log || [])].slice(0, 100) }; } catch (e) { return x; } });
      onClose();
    } catch (e) { setErr(e instanceof PriceError ? e.message : "No se pudo guardar: " + e.message); if (e instanceof PriceError && e.code === "overlap") setF((q) => ({ ...q, _overlap: true })); }
  };
  return <Modal title={`Nueva versión de precio · ${f.label}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn variant="primary" onClick={save}>Guardar versión</Btn></>}>
    <div className="form-grid">
      <Field label="Precio (€ por unidad de compra)"><NumInput value={f.price} onChange={(v) => setF({ ...f, price: v })} unit="€" min={0} ariaLabel="Precio" /></Field>
      <Field label="Unidad de compra"><Select value={f.purchaseUnit} onChange={(v) => setF({ ...f, purchaseUnit: v })} options={PURCHASE_UNITS.map((u) => ({ value: u, label: u }))} ariaLabel="Unidad de compra" /></Field>
      <Field label="Contenido por unidad de compra" hint="Viales o unidades por envase (1 si el precio es por vial)."><NumInput value={f.contentPerUnit} onChange={(v) => setF({ ...f, contentPerUnit: v == null ? null : Math.round(v) })} min={1} ariaLabel="Contenido por unidad de compra" /></Field>
      <Field label="Tratamiento del IVA"><Select value={f.vatMode} onChange={(v) => setF({ ...f, vatMode: v })} options={Object.entries(VAT_MODES).map(([k, t]) => ({ value: k, label: t }))} ariaLabel="Tratamiento del IVA" /></Field>
      {f.vatMode !== "no_especificado" && <Field label="Tipo de IVA (0,10 = 10 %)"><NumInput value={f.vatRate} onChange={(v) => setF({ ...f, vatRate: v })} min={0} max={1} ariaLabel="Tipo de IVA" /></Field>}
      <Field label="Entra en vigor"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="Entrada en vigor" /></Field>
      <Field label="Fin de vigencia (opcional)"><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Fin de vigencia" /></Field>
      <Field label="Fuente (obligatoria)"><input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} aria-label="Fuente del precio" /></Field>
      <Field label="Tipo de precio"><input value={f.priceType} onChange={(e) => setF({ ...f, priceType: e.target.value })} placeholder="adquisición, contrato…" /></Field>
      <Field label="Centro (opcional)" hint="Déjalo vacío para el precio general."><input value={f.center} onChange={(e) => setF({ ...f, center: e.target.value })} aria-label="Centro" /></Field>
      <Field label="Condición de compra" hint="«general» salvo acuerdo específico."><input value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} aria-label="Condición de compra" /></Field>
    </div>
    {commercial && <Banner kind="warn" title="Condición comercial diferenciada.">Solo la verán los roles con acceso a condiciones comerciales, y no se refleja en el historial general de precios.</Banner>}
    {err && <Banner kind="crit">{err}</Banner>}
    {f._overlap && <Check checked={f.closePrevious} onChange={(v) => setF({ ...f, closePrevious: v })}>Cerrar la vigencia anterior el día previo a la nueva</Check>}
  </Modal>;
}

function EstimatesTab() {
  const { S, set, user, access, schemes } = useApp();
  const plans = S.importedPlans || [];
  const [planId, setPlanId] = useState((plans[plans.length - 1] || {}).id);
  const plan = plans.find((p) => p.id === planId) || plans[plans.length - 1];
  const ests = plan ? (S.estimates || []).filter((e) => e.planId === plan.id).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  const [estId, setEstId] = useState(null); const [open, setOpen] = useState(false); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [form, setForm] = useState(null);
  const est = ests.find((e) => e.id === estId) || ests[0];
  const eco = useMemo(() => ecoSection(S, schemes, { access }), [S.agreements, S.spendEntries, S.plans, S.estimates, access]);
  if (!plans.length) return <Empty title="Todavía no hay planes importados">Importa una planificación desde «Importar desde Oncofar» para ver aquí su estimación.</Empty>;
  const per = est && from && to && est.calendar.mode === "fecha" ? costInPeriod(est, from, to) : null;
  const generate = () => { const e = reestimate(S, plan.id, { user, est: { patient: S.patients.find((p) => p.code === form.patient) || null, policy: form.policy, reuse: form.reuse / 100, vat: form.vat, refDate: form.refDate } }); set((x) => ({ ...x, ...e.patch })); setEstId(e.estimate.id); setForm(null); };
  return <>
    <div className="form-grid"><Field label="Plan"><Select value={plan.id} onChange={(v) => { setPlanId(v); setEstId(null); }} options={plans.map((p) => ({ value: p.id, label: `${p.name} · revisión ${p.revision}${p.context ? " · " + p.context : ""}` }))} ariaLabel="Plan" /></Field>
      <div className="actions"><Btn variant="primary" onClick={() => setForm({ patient: plan.context || "", policy: "vial", reuse: 0, vat: "sin_iva", refDate: today() })}>Recalcular (nueva estimación)</Btn></div></div>
    {est && <>
      <Card title="Estimación" sub={`Generada el ${est.createdAt.slice(0, 16).replace("T", " ")}${est.createdBy ? " por " + est.createdBy : ""} · motor ${est.engine}`} actions={<CopyBtn label="Copiar CSV" getText={() => estimateCSV(est, plan, eco)} />}>
        <Banner kind={est.total.incomplete ? "warn" : "info"} title={est.total.incomplete ? "Total parcial: hay líneas sin valorar." : "Estimación completa."}>Es una estimación a partir del calendario del plan, no gasto realizado. Regla: {est.rule.text}. IVA: {est.rule.vat === "con_iva" ? "con IVA" : "sin IVA"}. {est.calendar.mode === "fecha" ? `Calendario desde ${fmtDate(est.calendar.startDate)}.` : `Pauta relativa: precios a fecha ${fmtDate(est.calendar.refDate)}.`}</Banner>
        <div className="kpis"><Kpi label={est.total.incomplete ? "Total parcial" : "Total"} value={fmtCents(est.total.cents)} strong /><Kpi label="Administraciones valoradas" value={`${est.total.pricedAdmins} / ${est.total.admins}`} tone={est.total.incomplete ? "warn" : undefined} /><Kpi label="Líneas pendientes" value={est.total.pendingLines.length} tone={est.total.pendingLines.length ? "warn" : undefined} /></div>
        {est.total.pendingLines.length > 0 && <div className="tbl-w"><table className="tbl"><thead><tr><th>Línea pendiente</th><th>Fase</th><th>Motivo</th></tr></thead><tbody>{est.total.pendingLines.map((l, i) => <tr key={i} className="row-warn"><td><b>{l.label}</b></td><td>{l.phase}</td><td>{l.reasons.map((r) => REASONS[r] || (r === "LINEA_POR_REVISAR" ? "Fila sin clasificar por decidir" : r)).join("; ")}</td></tr>)}</tbody></table></div>}
        {est.warnings.map((w, i) => <Banner key={i} kind={w.level === "crit" ? "crit" : w.level === "warn" ? "warn" : "info"}>{w.text}</Banner>)}
        <h4>Por fase y ciclo</h4>
        <div className="tbl-w"><table className="tbl"><thead><tr><th>Fase</th><th className="r">Ciclo</th><th className="r">Administraciones</th><th className="r">Importe</th><th>Estado</th></tr></thead><tbody>{est.byCycle.map((c) => <tr key={c.key}><td>{c.phase}</td><td className="r">{c.cycle}</td><td className="r">{c.admins}</td><td className="r">{fmtCents(c.cents)}</td><td>{c.incomplete ? <Chip kind="warn">{c.incomplete} sin valorar · parcial</Chip> : <Chip kind="ok">Completo</Chip>}</td></tr>)}</tbody></table></div>
        {est.calendar.mode === "fecha" && <div className="form-grid"><Field label="Coste del periodo: desde"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Periodo desde" /></Field><Field label="hasta"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Periodo hasta" /></Field>{per && <Kpi label={per.incomplete ? "Periodo (parcial)" : "Periodo"} value={fmtCents(per.cents)} sub={`${per.admins} administraciones`} tone={per.incomplete ? "warn" : undefined} />}</div>}
        <Btn small onClick={() => setOpen(!open)}>{open ? "Ocultar" : "Ver"} cómo se ha obtenido cada administración</Btn>
        {open && <div className="tbl-w"><table className="tbl"><thead><tr><th>Fecha / día</th><th>Fármaco</th><th className="r">Dosis</th><th>Presentaciones y precio aplicado</th><th className="r">Importe</th></tr></thead><tbody>{est.administrations.map((a) => <tr key={a.id} className={cx(a.status !== "ok" && "row-warn")}><td>{a.date ? fmtDate(a.date) : `ciclo ${a.cycle} · día ${a.day}`}</td><td>{a.label}</td><td className="r">{a.doseMg == null ? "—" : fmtNum(a.doseMg, 1) + " mg"}</td><td className="small">{a.status === "ok" ? a.items.map((i) => `${i.n}× ${i.label} a ${fmtUnits(i.unitPriceUnits)} (${i.priceSource}; desde ${i.priceFrom ? fmtDate(i.priceFrom) : "origen"})`).join(" + ") + (a.waste > 0.01 ? ` · sobrante ${fmtNum(a.waste, 1)} mg` : "") : a.reasons.map((r) => REASONS[r]).join("; ")}</td><td className="r">{a.status === "ok" ? fmtCents(a.cents) : <Chip kind="crit">Sin valorar</Chip>}</td></tr>)}</tbody></table></div>}
      </Card>
      <Card title="Historial de estimaciones" sub="Cada una conserva el precio, la regla y el resultado de su momento."><ul className="plist">{ests.map((e) => <li key={e.id}><button className={cx(est && e.id === est.id && "on")} onClick={() => setEstId(e.id)}><b>{e.createdAt.slice(0, 16).replace("T", " ")}</b><span>{fmtCents(e.total.cents)}{e.total.incomplete ? " (parcial)" : ""} · {e.createdBy || "sin usuario"} · {e.rule.policy === "vial" ? "envases completos" : "con aprovechamiento"}</span></button></li>)}</ul></Card>
    </>}
    {form && <Modal title="Nueva estimación" onClose={() => setForm(null)} footer={<><Btn onClick={() => setForm(null)}>Cancelar</Btn><Btn variant="primary" onClick={generate}>Calcular y guardar</Btn></>}>
      <Field label="Paciente (para dosis por m² o kg)"><Select value={form.patient} onChange={(v) => setForm({ ...form, patient: v })} options={[{ value: "", label: "Sin paciente" }, ...S.patients.map((p) => ({ value: p.code, label: p.code }))]} ariaLabel="Paciente" /></Field>
      <Field label="Regla de envases"><Select value={form.policy} onChange={(v) => setForm({ ...form, policy: v })} options={[{ value: "vial", label: "Envases completos, sin aprovechamiento" }, { value: "aprovechamiento", label: "Envases completos con aprovechamiento explícito" }]} ariaLabel="Regla de envases" /></Field>
      {form.policy === "aprovechamiento" && <Field label="Aprovechamiento del sobrante parenteral (%)"><NumInput value={form.reuse} onChange={(v) => setForm({ ...form, reuse: v || 0 })} unit="%" min={0} max={100} ariaLabel="Aprovechamiento" /></Field>}
      <Field label="Tratamiento de IVA"><Select value={form.vat} onChange={(v) => setForm({ ...form, vat: v })} options={[{ value: "sin_iva", label: "Sin IVA" }, { value: "con_iva", label: "Con IVA" }]} ariaLabel="IVA" /></Field>
      <Field label="Fecha de precios si el plan no tiene fecha inicial"><input type="date" value={form.refDate} onChange={(e) => setForm({ ...form, refDate: e.target.value })} /></Field>
      <p className="sub">Se guarda una estimación nueva; las anteriores no cambian.</p>
    </Modal>}
  </>;
}

/* ============================== ACUERDOS DE GASTO ============================== */
const emptyForm = () => ({ type: "techo", title: "", level: "principio_activo", targetId: "", center: "", indication: "", population: "", periodKind: "natural", year: new Date().getFullYear(), from: "", to: "", effFrom: today(), effTo: "", source: "", owner: "", thresholdEur: null, formulaKind: "", pct: null, over: null, fixedEur: null, when: "siempre", tiers: "", order: null, base: "", settlement: "" });
function toAgreement(f, id) {
  const cents = (v) => (v == null ? null : Math.round(v * 100));
  let formula = null;
  if (f.formulaKind === "pct") formula = { kind: "pct", pct: f.pct == null ? null : f.pct / 100, over: cents(f.over) || 0 };
  if (f.formulaKind === "fijo") formula = { kind: "fijo", amountCents: cents(f.fixedEur), when: f.when };
  if (f.formulaKind === "tramos") formula = { kind: "tramos", tiers: f.tiers.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [a, b, c] = l.split(";").map((x) => x.trim()); const n = (x) => Number(String(x).replace(",", ".")); return { from: Math.round(n(a) * 100), to: b === "" || b == null ? null : Math.round(n(b) * 100), pct: n(c) / 100 }; }) };
  return { ...(id ? { id } : {}), type: f.type, title: f.title, scope: { level: f.level, targetId: f.targetId, center: f.center, indication: f.indication, population: f.population }, period: f.periodKind === "natural" ? { kind: "natural", year: f.year } : { kind: "custom", from: f.from, to: f.to },
    effective: { from: f.effFrom, to: f.effTo || null }, source: f.source, owner: f.owner, threshold: f.type === "techo" ? { amountCents: cents(f.thresholdEur) } : null, formula, order: f.order == null ? null : Math.round(f.order), base: f.base || null, settlement: f.settlement };
}
const fromAgreement = (a) => ({ type: a.type, title: a.title, level: a.scope.level, targetId: a.scope.targetId, center: a.scope.center || "", indication: a.scope.indication || "", population: a.scope.population || "", periodKind: a.period.kind, year: a.period.year || new Date().getFullYear(), from: a.period.from || "", to: a.period.to || "", effFrom: a.effective.from, effTo: a.effective.to || "", source: a.source, owner: a.owner, thresholdEur: a.threshold ? a.threshold.amountCents / 100 : null,
  formulaKind: a.formula ? a.formula.kind : "", pct: a.formula && a.formula.kind === "pct" ? a.formula.pct * 100 : null, over: a.formula && a.formula.over ? a.formula.over / 100 : null, fixedEur: a.formula && a.formula.kind === "fijo" ? a.formula.amountCents / 100 : null, when: (a.formula && a.formula.when) || "siempre",
  tiers: a.formula && a.formula.kind === "tramos" ? a.formula.tiers.map((t) => `${t.from / 100};${t.to == null ? "" : t.to / 100};${t.pct * 100}`).join("\n") : "", order: a.order == null ? null : a.order, base: a.base || "", settlement: a.settlement || "" });

export function AcuerdosPage() {
  const { S, set, user, access, schemes } = useApp();
  const [asOf, setAsOf] = useState(today()); const [form, setForm] = useState(null); const [edit, setEdit] = useState(null); const [err, setErr] = useState(null); const [hist, setHist] = useState(null); const [entry, setEntry] = useState(null);
  const ags = S.agreements || [];
  const { evs, items } = useMemo(() => { if (!access.view) return { evs: [], items: [] }; const it = spendItems(S, schemes, asOf); return { items: it, evs: evaluateAgreements(S, { items: it, asOf }) }; }, [S.agreements, S.spendEntries, S.plans, S.estimates, S.importedPlans, S.ref, S.catalog, S.patients, asOf, access.view]);
  const eco = useMemo(() => ecoSection(S, schemes, { access, asOf }), [S.agreements, S.spendEntries, S.plans, S.estimates, access, asOf]);
  if (!access.view) return <NoAccess access={access} />;
  const targets = (level) => level === "principio_activo" ? allIngredients(S).map((i) => ({ value: i.id, label: i.name })) : level === "medicamento" ? ensureRef(S.ref).medicines.map((m) => ({ value: m.id, label: m.name })) : allPresentations(S).map((p) => ({ value: p.id, label: p.label }));
  const save = () => { try { const a = toAgreement(form, edit); set((x) => ({ ...x, agreements: saveAgreement(x.agreements || [], a, { user }), log: [{ ts: Date.now(), what: `${edit ? "Modificado" : "Nuevo"} acuerdo «${a.title}»`, by: user || null }, ...(x.log || [])].slice(0, 100) })); setForm(null); setEdit(null); setErr(null); } catch (e) { setErr(e instanceof AgreementError ? e.message : "Datos no válidos: " + e.message); } };
  const active = evs.filter((e) => e.active);
  const csv = () => toCSV(ecoCSVRows(eco));
  return (
    <div className="page">
      <div className="page-h"><h1>Acuerdos de gasto</h1><div className="actions">{eco && <CopyBtn label="Copiar CSV económico" getText={csv} />}{access.edit && <Btn variant="primary" onClick={() => { setEdit(null); setForm(emptyForm()); }}>+ Nuevo acuerdo</Btn>}</div></div>
      <Banner kind="warn" title="Condiciones comerciales confidenciales.">{access.why}. Solo se muestran y exportan con acceso. Distingue siempre: gasto <b>realizado</b>, gasto <b>proyectado</b> (estimación por calendario), importe <b>computable</b> para el acuerdo y ajustes o devoluciones <b>efectivamente registrados</b>.</Banner>
      <div className="form-grid"><Field label="Fecha de corte"><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="Fecha de corte" /></Field></div>
      <div className="kpis"><Kpi label="Acuerdos vigentes" value={active.length} /><Kpi label="Techos superados" value={active.filter((e) => e.exceeded).length} tone={active.some((e) => e.exceeded) ? "warn" : undefined} /><Kpi label="Ajustes pendientes" value={active.filter((e) => e.adjustment.status === "pendiente").length} tone={active.some((e) => e.adjustment.status === "pendiente") ? "warn" : undefined} /><Kpi label="Incidencias" value={active.reduce((s, e) => s + e.incidents.length, 0)} /></div>
      {ags.length === 0 ? <Empty title="Sin acuerdos registrados">Registra techos de gasto, descuentos, devoluciones, acuerdos por volumen u otras medidas.</Empty> : evs.map((ev) => { const ag = ags.find((a) => a.id === ev.agreementId); return (
        <Card key={ev.agreementId} title={ag.title} sub={`${AGREEMENT_TYPES[ag.type]} · ${scopeLabel(S, ag)} · v${ag.version}`} actions={<>{!ev.active && <Chip kind="neutral">No vigente a esta fecha</Chip>}{access.edit && <Btn small onClick={() => { setEdit(ag.id); setForm(fromAgreement(ag)); }}>Editar</Btn>}<Btn small onClick={() => setHist(ag)}>Histórico ({ag.history.length})</Btn>{access.edit && <Btn small onClick={() => setEntry({ kind: "devolucion", agreementId: ag.id, amountEur: null, asOf: today(), source: "", scope: ag.scope })}>Registrar ajuste</Btn>}</>}>
          <AgreementSummary ev={ev} ag={ag} />
          <div className="sub">Responsable: {ag.owner} · fuente: {ag.source} · vigencia {fmtDate(ag.effective.from)}{ag.effective.to ? " – " + fmtDate(ag.effective.to) : ""}{ag.settlement ? " · liquidación: " + ag.settlement : ""}</div>
          <div>{ev.adjustment.status === "calculado" ? <>Ajuste calculado: <b>{fmtCents(ev.adjustment.cents)}</b> <span className="sub">({ev.adjustment.reason})</span></> : ev.adjustment.status === "pendiente" ? <Chip kind="warn">Ajuste pendiente</Chip> : null} {ev.adjustment.status === "pendiente" && <span className="sub">{ev.adjustment.reason}</span>}</div>
          <div className="sub">Ajustes/devoluciones registrados: {ev.registeredAdjustments.entries.length ? fmtCents(ev.registeredAdjustments.cents) : "ninguno"}</div>
          {ev.realized.cents == null && <Banner kind="info" title="Gasto realizado pendiente.">{ev.realized.detail} <Btn small onClick={() => setEntry({ kind: "realizado", scope: ag.scope, from: periodOf(ag).from, to: periodOf(ag).to, asOf: today(), amountEur: null, source: "" })}>Registrar acumulado fechado</Btn></Banner>}
          {ev.incidents.map((i, k) => <Banner key={k} kind="warn" title={i.code === "ACUERDOS_COINCIDENTES" ? "Acuerdos coincidentes." : i.code === "SIN_REGISTRO" ? "Ejecución sin registrar." : "Incidencia."}>{i.text}</Banner>)}
        </Card>); })}
      <Card title="Gasto realizado y ajustes registrados" sub="Acumulados contables fechados con su procedencia. El gasto realizado de la agenda se usa si no hay acumulado." actions={access.edit && <Btn small onClick={() => setEntry({ kind: "realizado", scope: { level: "principio_activo", targetId: "" }, from: `${new Date().getFullYear()}-01-01`, to: `${new Date().getFullYear()}-12-31`, asOf: today(), amountEur: null, source: "" })}>+ Acumulado</Btn>}>
        {(S.spendEntries || []).length === 0 ? <Empty title="Sin registros" /> : <div className="tbl-w"><table className="tbl"><thead><tr><th>Tipo</th><th>Ámbito</th><th>Periodo</th><th>A fecha</th><th className="r">Importe</th><th>Procedencia</th><th>Registrado por</th></tr></thead><tbody>{S.spendEntries.map((e) => <tr key={e.id}><td>{e.kind === "realizado" ? "Gasto realizado (acumulado)" : e.kind === "devolucion" ? "Devolución registrada" : "Ajuste registrado"}</td><td>{e.scope && e.scope.targetId ? scopeLabel(S, { scope: e.scope }) : "—"}</td><td>{e.from ? `${fmtDate(e.from)} – ${fmtDate(e.to)}` : "—"}</td><td>{fmtDate(e.asOf)}</td><td className="r">{fmtCents(e.amountCents)}</td><td>{e.source}</td><td className="small">{e.by || "—"} {e.at ? "· " + e.at.slice(0, 10) : ""}</td></tr>)}</tbody></table></div>}
      </Card>
      {form && <Modal wide title={edit ? "Editar acuerdo" : "Nuevo acuerdo"} onClose={() => { setForm(null); setErr(null); }} footer={<><Btn onClick={() => { setForm(null); setErr(null); }}>Cancelar</Btn><Btn variant="primary" onClick={save}>Guardar</Btn></>}>
        <div className="form-grid">
          <Field label="Tipo de medida"><Select value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={Object.entries(AGREEMENT_TYPES).map(([k, t]) => ({ value: k, label: t }))} ariaLabel="Tipo de medida" /></Field>
          <Field label="Título"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Título" /></Field>
          <Field label="Aplica a"><Select value={form.level} onChange={(v) => setForm({ ...form, level: v, targetId: "" })} options={Object.entries(SCOPE_LEVELS).map(([k, t]) => ({ value: k, label: t }))} ariaLabel="Nivel de alcance" /></Field>
          <Field label="Elemento"><Select value={form.targetId} onChange={(v) => setForm({ ...form, targetId: v })} options={[{ value: "", label: "Elige…" }, ...targets(form.level)]} ariaLabel="Elemento" /></Field>
          <Field label="Centro (opcional)"><input value={form.center} onChange={(e) => setForm({ ...form, center: e.target.value })} /></Field>
          <Field label="Indicación (opcional)"><input value={form.indication} onChange={(e) => setForm({ ...form, indication: e.target.value })} /></Field>
          <Field label="Población (opcional)"><input value={form.population} onChange={(e) => setForm({ ...form, population: e.target.value })} /></Field>
          <Field label="Periodo"><Select value={form.periodKind} onChange={(v) => setForm({ ...form, periodKind: v })} options={[{ value: "natural", label: "Ejercicio natural" }, { value: "custom", label: "Fechas propias" }]} ariaLabel="Periodo" /></Field>
          {form.periodKind === "natural" ? <Field label="Ejercicio"><NumInput value={form.year} onChange={(v) => setForm({ ...form, year: v == null ? null : Math.round(v) })} ariaLabel="Ejercicio" /></Field> : <><Field label="Inicio del periodo"><input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} aria-label="Inicio del periodo" /></Field><Field label="Cierre del periodo"><input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} aria-label="Cierre del periodo" /></Field></>}
          <Field label="Entra en vigor"><input type="date" value={form.effFrom} onChange={(e) => setForm({ ...form, effFrom: e.target.value })} aria-label="Entrada en vigor" /></Field>
          <Field label="Fin de vigencia (opcional)"><input type="date" value={form.effTo} onChange={(e) => setForm({ ...form, effTo: e.target.value })} /></Field>
          <Field label="Fuente (contrato, resolución…)"><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} aria-label="Fuente" /></Field>
          <Field label="Responsable"><input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} aria-label="Responsable" /></Field>
          {form.type === "techo" && <Field label="Techo de gasto (€)"><NumInput value={form.thresholdEur} onChange={(v) => setForm({ ...form, thresholdEur: v })} unit="€" min={0} ariaLabel="Techo de gasto" /></Field>}
          <Field label="Fórmula de ajuste (opcional)" hint="Sin fórmula configurada el ajuste queda pendiente."><Select value={form.formulaKind} onChange={(v) => setForm({ ...form, formulaKind: v })} options={[{ value: "", label: "Sin fórmula" }, ...Object.entries(FORMULA_KINDS).map(([k, t]) => ({ value: k, label: t }))]} ariaLabel="Fórmula" /></Field>
          {form.formulaKind === "pct" && <><Field label="Porcentaje (%)"><NumInput value={form.pct} onChange={(v) => setForm({ ...form, pct: v })} unit="%" min={0} max={100} ariaLabel="Porcentaje" /></Field><Field label="Solo sobre lo que exceda (€)"><NumInput value={form.over} onChange={(v) => setForm({ ...form, over: v })} unit="€" min={0} /></Field></>}
          {form.formulaKind === "fijo" && <><Field label="Importe fijo (€)"><NumInput value={form.fixedEur} onChange={(v) => setForm({ ...form, fixedEur: v })} unit="€" min={0} /></Field><Field label="Cuándo"><Select value={form.when} onChange={(v) => setForm({ ...form, when: v })} options={[{ value: "siempre", label: "Siempre" }, { value: "techo_superado", label: "Si se supera el techo" }]} /></Field></>}
          {form.formulaKind === "tramos" && <Field wide label="Tramos (uno por línea: desde €; hasta € (vacío = sin tope); %)"><textarea rows={3} value={form.tiers} onChange={(e) => setForm({ ...form, tiers: e.target.value })} aria-label="Tramos" /></Field>}
          <Field label="Orden de aplicación (si coincide con otros)"><NumInput value={form.order} onChange={(v) => setForm({ ...form, order: v })} min={1} /></Field>
          <Field label="Base de aplicación"><Select value={form.base} onChange={(v) => setForm({ ...form, base: v })} options={[{ value: "", label: "Sin definir" }, { value: "bruto", label: "Gasto bruto" }, { value: "neto", label: "Gasto neto de ajustes previos" }]} /></Field>
          <Field label="Mecanismo de liquidación"><input value={form.settlement} onChange={(e) => setForm({ ...form, settlement: e.target.value })} aria-label="Mecanismo de liquidación" /></Field>
        </div>
        {err && <Banner kind="crit">{err}</Banner>}
      </Modal>}
      {hist && <Modal title={`Histórico · ${hist.title}`} onClose={() => setHist(null)}>
        <p className="sub">Versión actual {hist.version}{hist.modifiedBy ? ` · modificada por ${hist.modifiedBy} el ${(hist.modifiedAt || "").slice(0, 10)}` : ` · creada por ${hist.createdBy || "—"} el ${(hist.createdAt || "").slice(0, 10)}`}</p>
        {hist.history.length === 0 ? <p className="muted">Sin versiones anteriores.</p> : hist.history.slice().reverse().map((h) => <div key={h.version} className="agr"><b>Versión {h.version}</b> · sustituida el {(h.replacedAt || "").slice(0, 10)}{h.replacedBy ? " por " + h.replacedBy : ""}<div className="sub">{h.title} · umbral {h.threshold ? fmtCents(h.threshold.amountCents) : "—"} · fuente {h.source} · responsable {h.owner}</div></div>)}
      </Modal>}
      {entry && <EntryForm entry={entry} ags={ags} S={S} onClose={() => setEntry(null)} />}
    </div>
  );
}
function EntryForm({ entry, ags, S, onClose }) {
  const { set, user } = useApp(); const [f, setF] = useState(entry); const [err, setErr] = useState(null);
  const ing = allIngredients(S), meds = ensureRef(S.ref).medicines, prs = allPresentations(S);
  const opts = f.scope.level === "medicamento" ? meds.map((m) => ({ value: m.id, label: m.name })) : f.scope.level === "presentacion" ? prs.map((p) => ({ value: p.id, label: p.label })) : ing.map((i) => ({ value: i.id, label: i.name }));
  const save = () => {
    if (!(f.amountEur > 0)) return setErr("Indica un importe mayor que 0.");
    if (!f.source.trim()) return setErr("La procedencia es obligatoria.");
    if (f.kind === "realizado" && (!f.scope.targetId || !f.from || !f.to)) return setErr("Indica el ámbito y el periodo del acumulado.");
    set((x) => ({ ...x, spendEntries: [...(x.spendEntries || []), { id: "SE-" + Date.now().toString(36), kind: f.kind, agreementId: f.agreementId || null, scope: f.scope, from: f.from || null, to: f.to || null, asOf: f.asOf, amountCents: Math.round(f.amountEur * 100), source: f.source.trim(), by: user || null, at: new Date().toISOString() }], log: [{ ts: Date.now(), what: `Registro de ${f.kind} (${f.amountEur} €)`, by: user || null }, ...(x.log || [])].slice(0, 100) })); onClose();
  };
  return <Modal title={f.kind === "realizado" ? "Acumulado de gasto realizado" : "Ajuste o devolución registrada"} onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn variant="primary" onClick={save}>Guardar</Btn></>}>
    {f.kind === "realizado" ? <>
      <Field label="Ámbito"><Select value={f.scope.level} onChange={(v) => setF({ ...f, scope: { level: v, targetId: "" } })} options={Object.entries(SCOPE_LEVELS).map(([k, t]) => ({ value: k, label: t }))} ariaLabel="Nivel" /></Field>
      <Field label="Elemento"><Select value={f.scope.targetId} onChange={(v) => setF({ ...f, scope: { ...f.scope, targetId: v } })} options={[{ value: "", label: "Elige…" }, ...opts]} ariaLabel="Elemento del acumulado" /></Field>
      <div className="form-grid"><Field label="Periodo desde"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="hasta"><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field></div>
    </> : <Field label="Tipo"><Select value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: "devolucion", label: "Devolución" }, { value: "ajuste", label: "Otro ajuste" }]} /></Field>}
    <Field label="Importe acumulado / registrado (€)"><NumInput value={f.amountEur} onChange={(v) => setF({ ...f, amountEur: v })} unit="€" min={0} ariaLabel="Importe" /></Field>
    <Field label="A fecha"><input type="date" value={f.asOf} onChange={(e) => setF({ ...f, asOf: e.target.value })} aria-label="A fecha" /></Field>
    <Field label="Procedencia (informe contable, abono, etc.)"><input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} aria-label="Procedencia" /></Field>
    {err && <Banner kind="crit">{err}</Banner>}
  </Modal>;
}
