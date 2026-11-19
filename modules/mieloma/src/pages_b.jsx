import React, { useState, useMemo } from "react";
import { computeScheme, sensitivity, validateScheme, parseDays, daysToString, buildBsAbScheme, currentPrice, parseCSV, parseNumberEs, HORIZONS, fmtEUR, fmtNum, fmtDate, toCSV, DAYS_PER_MONTH } from "./engine.js";
import { LINE_LABEL, DRUGS, BSAB_PRESETS, CART_ITEMS } from "./data.js";
import { useApp, Btn, Field, NumInput, Select, Check, Card, Banner, Tabs, Chip, schemeChips, Kpi, Eur, Dlt, Empty, LineChart, StackBars, Legend, drugColor, CopyBtn, Modal, cx } from "./kit.jsx";
import { calcOpts, buildCompareReport, compareCSV, lineLabel, dn, horizonLabel, patientParams, DATA_VERSION } from "./report.js";
import { today, enginePat, schemeOptions, SchemeDetail } from "./pages_a.jsx";

/* ============================== COMPARADOR ============================== */
export function ComparadorPage() {
  const { S, set, patient, schemes, go } = useApp();
  const c = S.cmp;
  const setC = (patch) => set((x) => ({ ...x, cmp: { ...x.cmp, ...patch } }));
  const items = c.items.filter((it) => schemes.find((s) => s.id === it.schemeId));
  const rep = useMemo(() => buildCompareReport(S, enginePat(patient), { ...c, items }, schemes), [S.catalog, patient, c, schemes]);
  const [tab, setTab] = useState("resumen");
  const setItem = (i, patch) => setC({ items: c.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const add = () => c.items.length < 4 && setC({ items: [...c.items, { schemeId: schemes.find((s) => !c.items.some((i) => i.schemeId === s.id) && !s.archived).id, maint: "none" }] });
  const del = (i) => c.items.length > 2 && setC({ items: c.items.filter((_, j) => j !== i) });
  const cols = rep.cols;
  const best = cols.reduce((m, x, i) => (x.eff < cols[m].eff ? i : m), 0);
  const pat = enginePat(patient);
  const curve = useMemo(() => {
    if (tab !== "peso") return null;
    const ws = []; for (let w = 40; w <= 130; w += 2) ws.push(w);
    const opts = calcOpts({ ...c, maint: "none", cycles: {} });
    const series = cols.map((col, i) => {
      const it = items[i];
      return { name: col.name, color: `var(--s${i})`, points: ws.map((w) => { const r = computeScheme(it.scheme || schemes.find((s) => s.id === it.schemeId), S.catalog, { ...pat, weight: w, scOverride: 0 }, { ...opts, maint: it.maint }); return { x: w, y: r.totals ? r.totals.eff : 0 }; }) };
    });
    let cross = null;
    if (series.length >= 2) { const a = series[0].points, b = series[1].points; for (let i = 1; i < a.length; i++) { const d0 = a[i - 1].y - b[i - 1].y, d1 = a[i].y - b[i].y; if (d0 * d1 < 0) { cross = a[i - 1].x + ((0 - d0) / (d1 - d0)) * 2; break; } } }
    return { series, cross };
  }, [tab, c, items, S.catalog, patient.height, patient.scMethod]);
  const sens = useMemo(() => (tab === "sens" ? items.map((it) => ({ it, s: sensitivity(schemes.find((s) => s.id === it.schemeId), S.catalog, pat, calcOpts({ ...c, maint: it.maint, cycles: {} }), "eff") })) : null), [tab, c, patient, S.catalog]);
  const assumptions = () => `Comparación económica (apoyo; no implica superioridad terapéutica). Paciente ${patient.code}: ${fmtNum(patient.weight, 1)} kg, ${fmtNum(patient.height, 2)} m, SC ${rep.pt.sc ? fmtNum(rep.pt.sc, 3) : "—"} m² (${rep.pt.scSource}). Horizonte: ${rep.horizon}. Aprovechamiento de viales: ${c.reuse} %. Datos importados del Excel, pendientes de validación. Motor v1.0.0 · ${DATA_VERSION}.`;
  return (
    <div className="page">
      <h1>Comparador farmacoeconómico</h1>
      <Banner kind="info" title="Comparación de costes, no de eficacia.">Una diferencia de coste no implica superioridad terapéutica ni equivale a una recomendación. Los esquemas se comparan con las pautas del Excel, sin verificar.</Banner>
      <div className="grid-calc">
        <div className="stack">
          <Card title="Paciente y supuestos">
            <Field label="Paciente (código)"><Select value={patient.code} onChange={(v) => set((x) => ({ ...x, activePatient: v }))} options={S.patients.map((p) => ({ value: p.code, label: `${p.code} · ${fmtNum(p.weight, 0)} kg · ${fmtNum(p.height, 2)} m` }))} /></Field>
            <Field label="Horizonte"><Select value={c.horizon} onChange={(v) => setC({ horizon: v })} options={HORIZONS.map((h) => ({ value: h.id, label: h.label }))} /></Field>
            {c.horizon === "custom" && <Field label="Días"><NumInput value={c.horizonCustom} onChange={(v) => setC({ horizonCustom: v || 1 })} unit="d" min={1} /></Field>}
            <Field label={`Aprovechamiento de viales: ${c.reuse} %`}><input type="range" min="0" max="100" step="5" value={c.reuse} onChange={(e) => setC({ reuse: +e.target.value })} /></Field>
            <Field label="Redondeo de dosis (mg)"><NumInput value={c.roundStep} onChange={(v) => setC({ roundStep: v || 0 })} unit="mg" min={0} /></Field>
            <Check checked={!!c.applyCaps} onChange={(v) => setC({ applyCaps: v })}>Aplicar topes de financiación del Excel</Check>
          </Card>
          <Card title={`Esquemas (${c.items.length}/4)`} actions={c.items.length < 4 ? <Btn small onClick={add}>+ Añadir</Btn> : null}>
            {c.items.map((it, i) => { const sc = schemes.find((s) => s.id === it.schemeId); return (
              <div key={i} className="cmp-item"><span className="swatch" style={{ background: `var(--s${i})` }} aria-hidden="true" />
                <div className="grow"><Select ariaLabel={`Esquema ${i + 1}`} value={it.schemeId} onChange={(v) => setItem(i, { schemeId: v, maint: "none" })} options={schemeOptions(schemes)} />
                  {sc && sc.maint && sc.maint.length > 0 && <Select ariaLabel={`Mantenimiento ${i + 1}`} value={it.maint || "none"} onChange={(v) => setItem(i, { maint: v })} options={[{ value: "none", label: "Sin mantenimiento" }, ...sc.maint.map((m) => ({ value: m.id, label: m.label }))]} />}
                  {sc && <div className="chips">{schemeChips(sc)}</div>}</div>
                {c.items.length > 2 && <Btn small variant="ghost" onClick={() => del(i)} ariaLabel="Quitar">✕</Btn>}</div>); })}
          </Card>
        </div>
        <div className="stack">
          {rep.warn.map((w, i) => <Banner key={i} kind="warn">{w}</Banner>)}
          <div className="cmp-cols" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0,1fr))` }}>
            {cols.map((col, i) => (
              <div key={i} className={cx("cmp-col", i === best && "best")}>
                <div className="cmp-h"><span className="swatch" style={{ background: `var(--s${i})` }} aria-hidden="true" /><b>{col.name}</b></div>
                <div className="kpi-v num-mono">{fmtEUR(col.eff, 0)}</div>
                <div className="kpi-l">tras ajustes</div>
                <div className="sub">Completos {fmtEUR(col.full, 0)} · teórico {fmtEUR(col.theor, 0)}</div>
                <div className="sub">{col.admins} administraciones</div>
                {col.diff != null ? <div><Dlt v={col.diff} pct={col.pct} d={0} /> <span className="sub">vs {cols[0].name}</span></div> : <div className="sub">Esquema de referencia</div>}
                {i === best && cols.length > 1 && <Chip kind="info">Menor coste calculado (no implica mejor opción)</Chip>}
                {col.flags.length > 0 && <Chip kind="pendiente" title={col.flags.map((f) => f.text).join(" | ")}>{col.flags.length} aviso(s)</Chip>}
              </div>))}
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: "resumen", label: "Por fármaco" }, { id: "acum", label: "Coste acumulado" }, { id: "sens", label: "Sensibilidad" }, { id: "peso", label: "Coste según peso" }]} />
          {tab === "resumen" && (
            <Card title="Coste por fármaco (tras ajustes)" flush>
              <div className="tbl-w"><table className="tbl"><thead><tr><th>Fármaco</th>{cols.map((col, i) => <th key={i} className="r"><span className="swatch" style={{ background: `var(--s${i})` }} aria-hidden="true" /> {col.name}</th>)}</tr></thead><tbody>
                {rep.out.byDrug.map((d) => <tr key={d.drug}><td>{dn(d.drug)}</td>{d.vals.map((v, i) => <td key={i} className="r">{v.priced ? <Eur v={v.eff} d={0} /> : <Chip kind="crit">Sin precio</Chip>}{v.admins > 0 && <div className="sub">{v.admins} admin.</div>}</td>)}</tr>)}
              </tbody><tfoot><tr><td>Total</td>{cols.map((col, i) => <td key={i} className="r"><Eur v={col.eff} d={0} /></td>)}</tr>
                <tr><td>Diferencia absoluta vs referencia</td>{cols.map((col, i) => <td key={i} className="r">{col.diff == null ? "—" : <Dlt v={col.diff} d={0} />}</td>)}</tr>
                <tr><td>Diferencia relativa</td>{cols.map((col, i) => <td key={i} className="r">{col.pct == null ? "—" : <span className={cx("num-mono", col.pct > 0.05 ? "dlt-up" : col.pct < -0.05 ? "dlt-dn" : "")}>{(col.pct > 0 ? "+" : "") + fmtNum(col.pct, 1)} %</span>}</td>)}</tr></tfoot></table></div>
            </Card>)}
          {tab === "acum" && (
            <Card title="Coste acumulado en el tiempo" sub="Hasta el horizonte elegido.">
              <Legend items={cols.map((col, i) => ({ label: col.name, color: `var(--s${i})` }))} />
              <LineChart series={cols.map((col, i) => { let a = 0; return { name: col.name, color: `var(--s${i})`, points: col.res.events.map((e) => ({ x: e.day, y: (a += e.eff || 0) })) }; })} xFmt={(x) => `${fmtNum(x / DAYS_PER_MONTH, 1)} m`} yFmt={(y, full) => (full ? fmtEUR(y, 0) : y >= 1000 ? `${fmtNum(y / 1000, 0)} k€` : fmtEUR(y, 0))} xTitle="Meses" yTitle="Coste acumulado" />
            </Card>)}
          {tab === "sens" && sens && (
            <Card title="Sensibilidad de cada esquema (tras ajustes)" flush>
              <div className="tbl-w"><table className="tbl"><thead><tr><th>Variable</th>{sens.map((x, i) => <th key={i} className="r">{x.it.schemeId}</th>)}</tr></thead><tbody>
                {sens[0].s.rows.map((r, k) => <tr key={r.label}><td>{r.label.replace(/\(.*\)/, "").trim()}</td>{sens.map((x, i) => { const row = x.s.rows[k]; return <td key={i} className="r">{row ? <Dlt v={row.diff} pct={row.pct} d={0} /> : "—"}</td>; })}</tr>)}
              </tbody></table></div>
              <p className="sub pad">Las filas de ciclos usan la última fase de cada esquema; si difieren entre esquemas, compara con cuidado.</p>
            </Card>)}
          {tab === "peso" && curve && (
            <Card title="Coste total según peso del paciente" sub="Talla constante; SC recalculada con la fórmula elegida. Útil para reglas del Excel como «IV si < 62 kg / SC si > 68 kg».">
              <Legend items={curve.series.map((s) => ({ label: s.name, color: s.color }))} />
              <LineChart series={curve.series} xFmt={(x) => `${x} kg`} yFmt={(y, full) => (full ? fmtEUR(y, 0) : y >= 1000 ? `${fmtNum(y / 1000, 0)} k€` : fmtEUR(y, 0))} xTitle="Peso (kg)" yTitle="Coste tras ajustes" />
              <p className="sub">{curve.cross ? `Los dos primeros esquemas se igualan en torno a ${fmtNum(curve.cross, 0)} kg (aprox., con la talla y política de viales actuales).` : "Los dos primeros esquemas no se cruzan en el rango 40–130 kg."} Es un punto de equilibrio económico, no un criterio clínico: la regla del Excel permanece como nota, sin validar.</p>
            </Card>)}
          <div className="actions">
            <CopyBtn label="Copiar tabla CSV" getText={() => compareCSV(rep)} />
            <CopyBtn label="Copiar supuestos" getText={assumptions} />
            <Btn onClick={() => { set((x) => ({ ...x, reportSource: "cmp" })); go("informes"); }}>Generar informe</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================== ESQUEMAS ============================== */
const blankScheme = () => ({ id: "USR-" + Date.now().toString(36), name: "Nuevo esquema", line: "1N", route: "", trial: "", source: "Creado en MieloFarma", status: "borrador", segs: [{ id: "s1", name: "Fase 1", phase: "induccion", cycles: 4, len: 28, comps: [{ drug: "bort", basis: "mgm2", dose: 1.3, days: [1, 8, 15] }] }], maint: [], flags: [], notes: [], version: 1, user: true });
const BASES = [{ value: "mgkg", label: "mg/kg" }, { value: "mgm2", label: "mg/m²" }, { value: "fixed", label: "mg fijos" }];

export function EsquemasPage() {
  const { S, set, schemes, go } = useApp();
  const [q, setQ] = useState(""); const [line, setLine] = useState("all"); const [showArch, setShowArch] = useState(false);
  const [sel, setSel] = useState(schemes[0] && schemes[0].id);
  const [edit, setEdit] = useState(null); const [valid, setValid] = useState(null);
  const list = schemes.filter((s) => (showArch || !s.archived) && (line === "all" || s.line === line) && (q.trim() === "" || (s.name + s.trial + s.id).toLowerCase().includes(q.toLowerCase())));
  const scheme = schemes.find((s) => s.id === sel) || list[0];
  const save = (s) => set((x) => ({ ...x, userSchemes: [...(x.userSchemes || []).filter((u) => u.id !== s.id), s], log: [{ ts: Date.now(), what: `Esquema guardado: ${s.name}` }, ...x.log].slice(0, 100) }));
  const patchBase = (s, patch) => set((x) => ({ ...x, userSchemes: [...(x.userSchemes || []).filter((u) => u.id !== s.id), { ...s, ...patch, version: (s.version || 1) + (patch.noBump ? 0 : 1) }] }));
  const dup = (s) => { const n = { ...JSON.parse(JSON.stringify(s)), id: "USR-" + Date.now().toString(36), name: s.name + " (copia)", status: "borrador", verified: null, user: true, version: 1, source: `Copia de ${s.id}` }; save(n); setSel(n.id); };
  const arch = (s) => patchBase(s, { archived: !s.archived });
  const doValidate = (s) => setValid({ id: s.id, reviewer: "", date: today(), source: "" });
  return (
    <div className="page">
      <div className="page-h"><h1>Biblioteca de esquemas</h1><div className="actions"><Btn variant="primary" onClick={() => setEdit(blankScheme())}>+ Nuevo esquema</Btn></div></div>
      <Banner kind="warn" title="Ninguna pauta está verificada.">Los esquemas importados reproducen el Excel (incluidos sus posibles errores). «Verificar» exige revisor, fecha y fuente; hasta entonces permanecen «pendientes de validación».</Banner>
      <div className="grid-side">
        <Card title={`Esquemas (${list.length})`}>
          <div className="stack-s"><input aria-label="Buscar esquema" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select ariaLabel="Línea" value={line} onChange={setLine} options={[{ value: "all", label: "Todas las líneas" }, ...Object.entries(LINE_LABEL).map(([k, l]) => ({ value: k, label: l }))]} />
            <Check checked={showArch} onChange={setShowArch}>Mostrar archivados</Check></div>
          <ul className="plist">{list.map((s) => <li key={s.id}><button className={cx(scheme && s.id === scheme.id && "on")} onClick={() => setSel(s.id)}><b>{s.name}</b><span>{LINE_LABEL[s.line]}{s.archived ? " · archivado" : ""}{s.user ? " · propio" : ""}</span></button></li>)}</ul>
        </Card>
        {scheme ? <div className="stack">
          <Card title={scheme.name} actions={<div className="actions"><Btn small variant="primary" onClick={() => { set((x) => ({ ...x, calc: { ...x.calc, schemeId: scheme.id, maint: "none", cycles: {} } })); go("calculadora"); }}>Calcular</Btn><Btn small onClick={() => dup(scheme)}>Duplicar</Btn>{scheme.user && <Btn small onClick={() => setEdit(JSON.parse(JSON.stringify(scheme)))}>Editar</Btn>}<Btn small onClick={() => doValidate(scheme)}>Verificar…</Btn><Btn small onClick={() => arch(scheme)}>{scheme.archived ? "Desarchivar" : "Archivar"}</Btn></div>}>
            <SchemeDetail scheme={scheme} />
            {!scheme.user && <p className="sub">Los esquemas importados no se editan: duplícalos para modificar una copia y conservar la trazabilidad con el Excel.</p>}
          </Card>
        </div> : <Empty title="Sin esquemas">Ajusta los filtros.</Empty>}
      </div>
      {edit && <SchemeEditor scheme={edit} onClose={() => setEdit(null)} onSave={(s) => { save(s); setSel(s.id); setEdit(null); }} />}
      {valid && <Modal title="Verificar esquema" onClose={() => setValid(null)} footer={<><Btn onClick={() => setValid(null)}>Cancelar</Btn><Btn variant="primary" disabled={!valid.reviewer.trim() || !valid.source.trim() || !valid.date} onClick={() => { const s = schemes.find((x) => x.id === valid.id); patchBase(s, { status: "verificado", verified: { reviewer: valid.reviewer.trim(), date: valid.date, source: valid.source.trim() } }); setValid(null); }}>Marcar como verificado</Btn></>}>
        <p className="sub">Marcar «verificado» declara que una persona ha contrastado esta pauta con una fuente. MieloFarma no lo comprueba.</p>
        <Field label="Revisor/a"><input value={valid.reviewer} onChange={(e) => setValid({ ...valid, reviewer: e.target.value })} /></Field>
        <Field label="Fecha de verificación"><input type="date" value={valid.date} onChange={(e) => setValid({ ...valid, date: e.target.value })} /></Field>
        <Field label="Fuente (ficha técnica, protocolo, guía…) con fecha"><input value={valid.source} onChange={(e) => setValid({ ...valid, source: e.target.value })} /></Field>
      </Modal>}
    </div>
  );
}

function SchemeEditor({ scheme, onClose, onSave }) {
  const { S } = useApp();
  const [s, setS] = useState(scheme);
  const drugs = Object.keys(DRUGS);
  const errs = validateScheme(s, drugs);
  const upSeg = (i, patch) => setS({ ...s, segs: s.segs.map((g, j) => (j === i ? { ...g, ...patch } : g)) });
  const upComp = (i, k, patch) => upSeg(i, { comps: s.segs[i].comps.map((c, j) => (j === k ? { ...c, ...patch } : c)) });
  const [dayTxt, setDayTxt] = useState({});
  return (
    <Modal title="Editor de esquema" onClose={onClose} wide footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn variant="primary" disabled={errs.length > 0} onClick={() => onSave({ ...s, status: "borrador" })}>Guardar</Btn></>}>
      <div className="form-grid">
        <Field label="Nombre"><input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field>
        <Field label="Línea"><Select value={s.line} onChange={(v) => setS({ ...s, line: v })} options={Object.entries(LINE_LABEL).map(([k, l]) => ({ value: k, label: l }))} /></Field>
        <Field label="Vía"><input value={s.route} onChange={(e) => setS({ ...s, route: e.target.value })} /></Field>
        <Field label="Ensayo / referencia (opcional)"><input value={s.trial} onChange={(e) => setS({ ...s, trial: e.target.value })} /></Field>
      </div>
      {s.segs.map((g, i) => (
        <Card key={i} title={`Fase ${i + 1}`} actions={s.segs.length > 1 ? <Btn small onClick={() => setS({ ...s, segs: s.segs.filter((_, j) => j !== i) })}>Quitar fase</Btn> : null}>
          <div className="form-grid">
            <Field label="Nombre"><input value={g.name} onChange={(e) => upSeg(i, { name: e.target.value })} /></Field>
            <Field label="Ciclos"><NumInput value={g.cycles} onChange={(v) => upSeg(i, { cycles: v ? Math.round(v) : 1 })} min={1} unit="ciclos" /></Field>
            <Field label="Duración del ciclo"><NumInput value={g.len} onChange={(v) => upSeg(i, { len: v ? Math.round(v) : 1 })} min={1} unit="días" /></Field>
          </div>
          {g.comps.map((c, k) => { const key = `${i}-${k}`; return (
            <div key={k} className="comp-row">
              <Select ariaLabel="Fármaco" value={c.drug} onChange={(v) => upComp(i, k, { drug: v })} options={drugs.map((d) => ({ value: d, label: DRUGS[d] }))} />
              <NumInput ariaLabel="Dosis" value={c.dose} onChange={(v) => upComp(i, k, { dose: v })} min={0} />
              <Select ariaLabel="Unidad" value={c.basis} onChange={(v) => upComp(i, k, { basis: v })} options={BASES} />
              <input aria-label="Días de administración" placeholder="Días: 1,8,15 o 1-21" value={dayTxt[key] != null ? dayTxt[key] : daysToString(c.days || [])} onChange={(e) => { setDayTxt({ ...dayTxt, [key]: e.target.value }); const d = parseDays(e.target.value); if (d) upComp(i, k, { days: d }); }} />
              <Btn small onClick={() => upSeg(i, { comps: g.comps.filter((_, j) => j !== k) })} ariaLabel="Quitar fármaco">✕</Btn>
            </div>); })}
          <Btn small onClick={() => upSeg(i, { comps: [...g.comps, { drug: "dex", basis: "fixed", dose: 20, days: [1] }] })}>+ Fármaco</Btn>
        </Card>))}
      <Btn onClick={() => setS({ ...s, segs: [...s.segs, { id: "s" + (s.segs.length + 1), name: `Fase ${s.segs.length + 1}`, phase: "continuo", cycles: 1, len: 28, comps: [{ drug: "bort", basis: "mgm2", dose: 1.3, days: [1] }] }] })}>+ Añadir fase</Btn>
      {errs.map((e) => <Banner key={e} kind="crit">{e}</Banner>)}
      {errs.length === 0 && <Banner kind="good">Esquema válido. Se guardará como «borrador»: sin verificar.</Banner>}
    </Modal>
  );
}

/* ============================== PRECIOS ============================== */
const PRICE_TYPES = ["No especificado en el Excel", "Precio de adquisición", "PVL notificado", "Precio de contrato", "Precio de referencia", "Otro (indicar en nota)"];
export function PreciosPage() {
  const { S, set } = useApp();
  const [q, setQ] = useState(""); const [open, setOpen] = useState(null); const [form, setForm] = useState(null); const [newPres, setNewPres] = useState(null); const [imp, setImp] = useState(false);
  const rows = S.catalog.filter((c) => !c.archived && (q.trim() === "" || (c.label + c.drug).toLowerCase().includes(q.toLowerCase())));
  const log = (what) => (x) => ({ ...x, log: [{ ts: Date.now(), what }, ...x.log].slice(0, 100) });
  const addPrice = (id, e) => set((x) => log(`Nuevo precio ${id}: ${e.price} €`)({ ...x, catalog: x.catalog.map((c) => (c.id === id ? { ...c, history: [...c.history, e] } : c)) }));
  const archive = (id) => set((x) => ({ ...x, catalog: x.catalog.map((c) => (c.id === id ? { ...c, archived: true } : c)) }));
  const csvOut = toCSV([["id", "fármaco", "presentación", "mg", "precio", "tipo", "vigente desde", "fuente", "€/mg"], ...S.catalog.filter((c) => !c.archived).map((c) => { const h = c.history[c.history.length - 1]; return [c.id, c.drug, c.label, c.mg == null ? "" : fmtNum(c.mg, 2), h ? fmtNum(h.price, 2) : "", h ? h.type : "", h && h.from ? h.from : "", h ? h.source : "", h && c.mg ? fmtNum(h.price / c.mg, 4) : ""]; })]);
  return (
    <div className="page">
      <div className="page-h"><h1>Catálogo de costes</h1><div className="actions"><Btn onClick={() => setNewPres({ drug: "bort", label: "", mg: null, unit: "vial", oral: false })}>+ Presentación</Btn><Btn onClick={() => setImp(true)}>Importar CSV</Btn><CopyBtn label="Copiar CSV" getText={() => csvOut} /></div></div>
      <Banner kind="info" title="Los precios nunca se sobrescriben.">Cada cambio añade una entrada al historial con tipo, vigencia y fuente. Los precios del Excel no indican tipo (adquisición, PVL, contrato…): quedan como «No especificado» hasta que lo confirmes.</Banner>
      <input aria-label="Buscar presentación" placeholder="Buscar fármaco o presentación…" value={q} onChange={(e) => setQ(e.target.value)} />
      <Card flush>
        <div className="tbl-w"><table className="tbl"><thead><tr><th>Presentación</th><th className="r">mg</th><th className="r">Precio vigente</th><th className="r">€/mg</th><th>Tipo</th><th>Estado</th><th /></tr></thead><tbody>
          {rows.map((c) => { const h = c.history[c.history.length - 1]; const p = currentPrice(c); const future = c.history.find((x) => x.from && x.from > today()); return (
            <React.Fragment key={c.id}>
              <tr className={cx(!p && "row-warn")}><td><b>{c.label}</b><div className="sub">{c.id} · {c.excelCell}</div></td><td className="r num-mono">{c.mg ? fmtNum(c.mg, 2) : "—"}</td><td className="r">{p ? <Eur v={p} /> : <Chip kind="crit">Sin precio</Chip>}</td><td className="r num-mono">{p && c.mg ? fmtNum(p / c.mg, 4) : "—"}</td><td className="small">{h ? h.type : "—"}{future && <Chip kind="info">Cambio futuro {fmtDate(future.from)}</Chip>}</td><td>{c.status === "verificado" ? <Chip kind="verificado" /> : <Chip kind="pendiente" />}</td>
                <td className="r"><Btn small onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Cerrar" : "Historial"}</Btn> <Btn small onClick={() => setForm({ id: c.id, price: p || "", type: PRICE_TYPES[0], from: today(), source: "", note: "" })}>Nuevo precio</Btn></td></tr>
              {open === c.id && <tr><td colSpan={7}><div className="tbl-w"><table className="tbl inner"><thead><tr><th>Vigente desde</th><th className="r">Precio</th><th>Tipo</th><th>Fuente</th><th>Nota</th></tr></thead><tbody>{c.history.length === 0 ? <tr><td colSpan={5} className="muted">Sin historial.</td></tr> : c.history.map((e, i) => <tr key={i}><td>{e.from ? fmtDate(e.from) : "sin fecha"}</td><td className="r"><Eur v={e.price} /></td><td>{e.type}</td><td>{e.source}</td><td>{e.note}</td></tr>)}</tbody></table></div><div className="row-end"><Btn small onClick={() => archive(c.id)}>Archivar presentación</Btn></div></td></tr>}
            </React.Fragment>); })}
        </tbody></table></div>
      </Card>
      {form && <PriceForm form={form} onClose={() => setForm(null)} onSave={(e) => { addPrice(form.id, e); setForm(null); }} />}
      {newPres && <PresForm f={newPres} onClose={() => setNewPres(null)} onSave={(p) => { set((x) => log(`Nueva presentación ${p.id}`)({ ...x, catalog: [...x.catalog, p] })); setNewPres(null); }} />}
      {imp && <ImportCSV onClose={() => setImp(false)} />}
    </div>
  );
}
function PriceForm({ form, onClose, onSave }) {
  const [f, setF] = useState(form);
  const n = typeof f.price === "number" ? f.price : parseNumberEs(f.price);
  const ok = n > 0 && f.from && f.source.trim();
  return (
    <Modal title="Nuevo precio" onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn variant="primary" disabled={!ok} onClick={() => onSave({ price: n, type: f.type, from: f.from, source: f.source.trim(), note: f.note, added: today() })}>Añadir al historial</Btn></>}>
      <Field label="Precio (€ por envase)"><NumInput value={typeof f.price === "number" ? f.price : null} onChange={(v) => setF({ ...f, price: v })} unit="€" min={0} /></Field>
      <Field label="Tipo de precio"><Select value={f.type} onChange={(v) => setF({ ...f, type: v })} options={PRICE_TYPES.map((t) => ({ value: t, label: t }))} /></Field>
      <Field label="Vigente desde"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
      <Field label="Fuente (obligatoria)" hint="Contrato, resolución, albarán… con referencia."><input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></Field>
      <Field label="Nota"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
    </Modal>
  );
}
function PresForm({ f: init, onClose, onSave }) {
  const [f, setF] = useState(init);
  const ok = f.label.trim() && f.mg > 0;
  return (
    <Modal title="Nueva presentación" onClose={onClose} footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn variant="primary" disabled={!ok} onClick={() => onSave({ id: "U" + Date.now().toString(36), drug: f.drug, label: f.label.trim(), mg: f.mg, unit: f.unit, oral: f.oral, route: f.oral ? "oral" : "parenteral", center: "Centro (indicar)", excelCell: "Creada en MieloFarma", status: "pendiente", history: [], archived: false })}>Crear (sin precio)</Btn></>}>
      <Field label="Fármaco"><Select value={f.drug} onChange={(v) => setF({ ...f, drug: v })} options={Object.entries(DRUGS).map(([k, l]) => ({ value: k, label: l }))} /></Field>
      <Field label="Descripción (p. ej. «Bortezomib 1 mg vial»)"><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
      <Field label="mg por envase"><NumInput value={f.mg} onChange={(v) => setF({ ...f, mg: v })} unit="mg" min={0} /></Field>
      <Field label="Unidad"><Select value={f.unit} onChange={(v) => setF({ ...f, unit: v })} options={["vial", "comprimido", "cápsula", "jeringa"].map((u) => ({ value: u, label: u }))} /></Field>
      <Check checked={f.oral} onChange={(v) => setF({ ...f, oral: v })}>Forma oral (sin desperdicio parenteral)</Check>
      <p className="sub">Se crea sin precio: añádelo después con fuente y vigencia.</p>
    </Modal>
  );
}
function ImportCSV({ onClose }) {
  const { S, set } = useApp();
  const [txt, setTxt] = useState("id;precio;tipo;vigente_desde;fuente\n");
  const parsed = useMemo(() => {
    const rows = parseCSV(txt); if (rows.length < 2) return { items: [], errs: [] };
    const h = rows[0].map((x) => x.trim().toLowerCase()); const ix = (n) => h.indexOf(n);
    const items = [], errs = [];
    rows.slice(1).forEach((r, i) => {
      const id = (r[ix("id")] || "").trim(); const price = parseNumberEs(r[ix("precio")] || ""); const from = (r[ix("vigente_desde")] || "").trim(); const source = (r[ix("fuente")] || "").trim(); const type = (r[ix("tipo")] || "").trim() || PRICE_TYPES[0];
      const ln = `Fila ${i + 2}`;
      if (!S.catalog.some((c) => c.id === id)) errs.push(`${ln}: id «${id}» no existe en el catálogo.`);
      else if (!(price > 0)) errs.push(`${ln}: precio no válido.`);
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) errs.push(`${ln}: fecha debe ser AAAA-MM-DD.`);
      else if (!source) errs.push(`${ln}: falta la fuente.`);
      else items.push({ id, e: { price, type, from, source, note: "Importado por CSV", added: today() } });
    });
    return { items, errs };
  }, [txt, S.catalog]);
  const file = (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => setTxt(String(r.result)); r.readAsText(f); };
  return (
    <Modal title="Importar precios (CSV)" onClose={onClose} wide footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn variant="primary" disabled={!parsed.items.length || parsed.errs.length > 0} onClick={() => { set((x) => ({ ...x, catalog: x.catalog.map((c) => { const add = parsed.items.filter((i) => i.id === c.id).map((i) => i.e); return add.length ? { ...c, history: [...c.history, ...add] } : c; }), log: [{ ts: Date.now(), what: `Importados ${parsed.items.length} precios por CSV` }, ...x.log] })); onClose(); }}>Importar {parsed.items.length} precio(s)</Btn></>}>
      <p className="sub">Columnas: <code>id;precio;tipo;vigente_desde;fuente</code>. Los ids son los del catálogo (C02…). No se sobrescribe nada: cada fila añade una entrada al historial. Si hay errores no se importa nada.</p>
      <input type="file" accept=".csv,.txt" onChange={file} aria-label="Cargar archivo CSV" />
      <textarea className="mono-area" rows={8} value={txt} onChange={(e) => setTxt(e.target.value)} aria-label="Contenido CSV" />
      {parsed.errs.map((e) => <Banner key={e} kind="crit">{e}</Banner>)}
      {parsed.items.length > 0 && parsed.errs.length === 0 && <Banner kind="good">{parsed.items.length} fila(s) válida(s).</Banner>}
    </Modal>
  );
}

/* ============================== TERAPIAS AVANZADAS ============================== */
export function AvanzadasPage() {
  const { S, set, patient } = useApp();
  const A = S.adv;
  const setA = (patch) => set((x) => ({ ...x, adv: { ...x.adv, ...patch } }));
  const [tab, setTab] = useState("bsab");
  const preset = BSAB_PRESETS[A.drug];
  const cfg = A.cfg[A.drug] || { stepUp: preset.stepUp, weekly: preset.weekly, biweekly: preset.biweekly };
  const setCfg = (patch) => setA({ cfg: { ...A.cfg, [A.drug]: { ...cfg, ...patch } } });
  const scheme = useMemo(() => ({ ...buildBsAbScheme({ drug: A.drug, name: preset.name, ...cfg, stepUp: A.stepUp ? cfg.stepUp : [], biweekly: A.mode === "biweekly" ? cfg.biweekly : null, weekly: A.mode === "biweekly" ? { ...cfg.weekly, weeks: A.weeksBefore } : cfg.weekly }), maint: [] }), [A, cfg]);
  const pat = enginePat(patient);
  const res = useMemo(() => computeScheme(scheme, S.catalog, pat, { reuse: A.reuse / 100, horizon: A.months ? Math.round(A.months * DAYS_PER_MONTH) : "all", includeMaint: true }), [scheme, S.catalog, patient, A.reuse, A.months]);
  const t = res.totals;
  const inst = A.inst; const instTotal = Object.values(inst).reduce((s, v) => s + (v || 0), 0);
  const upSU = (i, patch) => setCfg({ stepUp: cfg.stepUp.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const noPrice = t && res.lines.some((l) => !l.priced);
  return (
    <div className="page">
      <h1>3ª línea y terapias avanzadas</h1>
      <Banner kind="warn" title="Solo se calcula el coste del medicamento.">Los costes de administración, hospitalización, ingreso, manejo de toxicidad y citaféresis no están en el Excel y se dejan vacíos: introdúcelos tú, siempre por separado del coste del fármaco.</Banner>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "bsab", label: "Biespecíficos (step-up)" }, { id: "cart", label: "CAR-T" }]} />
      {tab === "bsab" && <div className="grid-calc">
        <div className="stack">
          <Card title="Configuración">
            <Field label="Biespecífico"><Select value={A.drug} onChange={(v) => setA({ drug: v })} options={Object.entries(BSAB_PRESETS).map(([k, p]) => ({ value: k, label: p.name }))} /></Field>
            <p className="sub">{preset.unitNote}. Pauta del Excel (sin verificar). <b>El Excel no incluye el step-up en sus totales</b> (hallazgo BS-01); aquí se calcula y se puede desactivar.</p>
            <Check checked={A.stepUp} onChange={(v) => setA({ stepUp: v })}>Incluir escalones de step-up</Check>
            <div className="tbl-w"><table className="tbl"><thead><tr><th>Día</th><th className="r">Dosis</th><th>Unidad</th></tr></thead><tbody>
              {cfg.stepUp.map((s, i) => <tr key={i}><td><NumInput ariaLabel="Día" value={s.day} onChange={(v) => upSU(i, { day: v ? Math.round(v) : 1 })} min={1} /></td><td><NumInput ariaLabel="Dosis" value={s.dose} onChange={(v) => upSU(i, { dose: v })} min={0} /></td><td>{s.basis === "mgkg" ? "mg/kg" : "mg"}</td></tr>)}
            </tbody></table></div>
            <div className="form-grid">
              <Field label="Dosis de mantenimiento"><NumInput value={cfg.weekly.dose} onChange={(v) => setCfg({ weekly: { ...cfg.weekly, dose: v } })} unit={cfg.weekly.basis === "mgkg" ? "mg/kg" : "mg"} min={0} /></Field>
              <Field label="Semanas en pauta semanal"><NumInput value={A.mode === "biweekly" ? A.weeksBefore : cfg.weekly.weeks} onChange={(v) => (A.mode === "biweekly" ? setA({ weeksBefore: Math.round(v || 0) }) : setCfg({ weekly: { ...cfg.weekly, weeks: Math.round(v || 0) } }))} min={0} unit="sem" /></Field>
            </div>
            <Field label="Intervalo de mantenimiento"><Select value={A.mode} onChange={(v) => setA({ mode: v })} options={[{ value: "weekly", label: "Semanal" }, { value: "biweekly", label: "Pasa a quincenal tras las semanas indicadas" }]} /></Field>
            {A.mode === "biweekly" && <Field label="Dosis quincenales"><NumInput value={cfg.biweekly ? cfg.biweekly.doses : 0} onChange={(v) => setCfg({ biweekly: { ...(cfg.biweekly || { dose: cfg.weekly.dose, basis: cfg.weekly.basis }), doses: Math.round(v || 0) } })} min={0} unit="dosis" /></Field>}
            <Field label="Horizonte (meses; 0 = pauta completa)"><NumInput value={A.months} onChange={(v) => setA({ months: v || 0 })} min={0} unit="m" /></Field>
            <Field label={`Aprovechamiento de viales: ${A.reuse} %`}><input type="range" min="0" max="100" step="5" value={A.reuse} onChange={(e) => setA({ reuse: +e.target.value })} /></Field>
          </Card>
          <Card title="Costes institucionales (aportados por ti)" sub="Vacíos por defecto. No proceden del Excel.">
            {[["adm", "Administración / hospital de día"], ["ing", "Ingreso por step-up"], ["tox", "Manejo de toxicidad"], ["otros", "Otros"]].map(([k, l]) => <Field key={k} label={l}><NumInput value={inst[k]} onChange={(v) => setA({ inst: { ...inst, [k]: v } })} unit="€" min={0} /></Field>)}
          </Card>
        </div>
        <div className="stack">
          {noPrice && <Banner kind="crit">Falta el precio de {preset.name} en el catálogo: el total no es fiable.</Banner>}
          {preset.caps && <Banner kind="info" title="Topes del Excel.">{preset.caps}</Banner>}
          <div className="kpis"><Kpi label="Medicamento (tras ajustes)" value={fmtEUR(t ? t.eff : null, 0)} strong /><Kpi label="Envases completos" value={fmtEUR(t ? t.full : null, 0)} /><Kpi label="Teórico" value={fmtEUR(t ? t.theor : null, 0)} /><Kpi label="Administraciones" value={t ? t.admins : "—"} sub={`${res.durationDays || 0} d`} /></div>
          <Card title="Resumen separado">
            <div className="tbl-w"><table className="tbl"><tbody>
              <tr><td>Coste del medicamento (tras ajustes)</td><td className="r"><Eur v={t ? t.eff : 0} d={0} /></td></tr>
              <tr><td>Costes institucionales introducidos</td><td className="r">{instTotal ? <Eur v={instTotal} d={0} /> : <span className="muted">no introducidos</span>}</td></tr>
              <tr className="tot"><td>Total (medicamento + institucional)</td><td className="r"><Eur v={(t ? t.eff : 0) + instTotal} d={0} /></td></tr>
            </tbody></table></div>
            {preset.excel && <p className="sub">Referencia del Excel (sin step-up): {preset.excel.rc ? `${fmtEUR(preset.excel.rc.value, 0)} (${preset.excel.rc.cell}, en R/C) · ` : ""}{preset.excel.norc ? `${fmtEUR(preset.excel.norc.value, 0)} (${preset.excel.norc.cell}, no R/C)` : ""}. Los importes no son comparables 1:1: el Excel mezcla métodos por vial y por mg (BS-02).</p>}
          </Card>
          <Card title="Escenarios guardados" actions={<Btn small onClick={() => setA({ scen: [{ id: Date.now(), name: `${preset.name} · ${A.mode === "weekly" ? "semanal" : "quincenal"} · ${A.months || "completo"} m`, eff: t ? t.eff : 0, inst: instTotal, step: A.stepUp }, ...A.scen].slice(0, 8) })}>Guardar escenario</Btn>}>
            {A.scen.length === 0 ? <Empty title="Sin escenarios">Guarda configuraciones para compararlas.</Empty> : <div className="tbl-w"><table className="tbl"><thead><tr><th>Escenario</th><th className="r">Medicamento</th><th className="r">Institucional</th></tr></thead><tbody>{A.scen.map((s) => <tr key={s.id}><td>{s.name}</td><td className="r"><Eur v={s.eff} d={0} /></td><td className="r">{s.inst ? <Eur v={s.inst} d={0} /> : "—"}</td></tr>)}</tbody></table></div>}
          </Card>
        </div>
      </div>}
      {tab === "cart" && <Card title="CAR-T (importes históricos del Excel)" sub="Solo el precio del producto. Son datos históricos pendientes de validar; no se recalculan.">
        <div className="tbl-w"><table className="tbl"><thead><tr><th>Producto</th><th className="r">Importe</th><th>Origen</th></tr></thead><tbody>{CART_ITEMS.map((c) => <tr key={c.id}><td>{c.name}</td><td className="r"><Eur v={c.price} d={0} /></td><td>{c.source}</td></tr>)}</tbody></table></div>
        <Banner kind="warn">No se incluyen citaféresis, terapia puente, linfodepleción, ingreso ni manejo de CRS/ICANS: no están en el Excel.</Banner>
        <div className="form-grid">{[["car_pro", "Producto CAR-T actualizado"], ["car_adm", "Hospitalización / ingreso"], ["car_apf", "Aféresis y logística"], ["car_tox", "Manejo de toxicidad"]].map(([k, l]) => <Field key={k} label={l}><NumInput value={inst[k]} onChange={(v) => setA({ inst: { ...inst, [k]: v } })} unit="€" min={0} /></Field>)}</div>
        <p className="sub">Total institucional introducido: <b>{fmtEUR(["car_pro", "car_adm", "car_apf", "car_tox"].reduce((s, k) => s + (inst[k] || 0), 0), 0)}</b>. Mostrado aparte, nunca mezclado con el histórico del Excel.</p>
      </Card>}
    </div>
  );
}
