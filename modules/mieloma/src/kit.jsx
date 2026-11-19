import React, { useState, useEffect, useRef, useId, useMemo, createContext, useContext } from "react";
import { fmtEUR, fmtNum, parseNumberEs } from "./engine.js";

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);
export const cx = (...a) => a.filter(Boolean).join(" ");

/* ---------- Colores de series: fijos por fármaco (la entidad conserva su color) ---------- */
const SLOT = { dara_iv: 0, dara_sc: 0, isa_iv: 1, isa_sc: 1, bort: 2, carf: 3, lena: 4, pom: 5, bela: 6, tec: 7, elra: 7, talq: 7 };
export const drugSlot = (d) => (d in SLOT ? SLOT[d] : -1);
export const drugColor = (d) => { const s = drugSlot(d); return s >= 0 ? `var(--s${s})` : "var(--sother)"; };
export const GROUP_LABEL = { dara_iv: "Daratumumab", dara_sc: "Daratumumab", isa_iv: "Isatuximab", isa_sc: "Isatuximab", tec: "Biespecíficos", elra: "Biespecíficos", talq: "Biespecíficos" };

/* ---------- Estado de validación ---------- */
const CHIPS = {
  importado: ["Importado del Excel", "chip-imp"], calculado: ["Calculado", "chip-calc"], pendiente: ["Pendiente de validación", "chip-warn"],
  verificado: ["Verificado con fuente y fecha", "chip-ok"], borrador: ["Borrador", "chip-neutral"], ficticio: ["Dato ficticio", "chip-neutral"],
  crit: ["Crítico", "chip-crit"], warn: ["Importante", "chip-warn"], info: ["Informativo", "chip-imp"], archivado: ["Archivado", "chip-neutral"],
  fuera: ["Fuera de ficha técnica", "chip-warn"], nofin: ["Indicación no financiada", "chip-warn"], ok: ["Coincide", "chip-ok"], expl: ["Diferencia explicada", "chip-warn"], rev: ["Revisar", "chip-crit"],
};
export function Chip({ kind, children, title }) {
  const [t, c] = CHIPS[kind] || [kind, "chip-neutral"];
  return <span className={cx("chip", c)} title={title}>{children || t}</span>;
}
export function schemeChips(s) {
  const out = [];
  if (s.archived) out.push(<Chip key="a" kind="archivado" />);
  if (s.status === "verificado") out.push(<Chip key="v" kind="verificado" title={s.verified ? `${s.verified.source} · ${s.verified.date} · ${s.verified.reviewer}` : ""} />);
  else if (s.custom) out.push(<Chip key="b" kind="borrador" />);
  else { out.push(<Chip key="i" kind="importado" />); out.push(<Chip key="p" kind="pendiente" />); }
  if (s.fueraFicha) out.push(<Chip key="f" kind="fuera" />);
  if (s.noFinanciada) out.push(<Chip key="n" kind="nofin" />);
  return out;
}

/* ---------- Controles ---------- */
export function Btn({ variant = "ghost", small, icon, children, ariaLabel, ...p }) {
  return <button type="button" aria-label={ariaLabel} {...p} className={cx("btn", `btn-${variant}`, small && "btn-sm", p.className)}>{children}</button>;
}
export function Field({ label, hint, children, wide }) {
  const id = useId();
  const child = React.Children.only(children);
  return (
    <div className={cx("field", wide && "field-wide")}>
      <label htmlFor={id}>{label}</label>
      {React.cloneElement(child, { id })}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
export function NumInput({ value, onChange, unit, min, max, placeholder, id, ariaLabel }) {
  const [txt, setTxt] = useState(value == null || isNaN(value) ? "" : String(value).replace(".", ","));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current && !(value == null && last.current == null)) { setTxt(value == null || isNaN(value) ? "" : String(value).replace(".", ",")); last.current = value; }
  }, [value]);
  const inv = txt !== "" && (isNaN(parseNumberEs(txt)) || (min != null && parseNumberEs(txt) < min) || (max != null && parseNumberEs(txt) > max));
  return (
    <div className={cx("num", inv && "num-bad")}>
      <input id={id} aria-label={ariaLabel} inputMode="decimal" value={txt} placeholder={placeholder} aria-invalid={inv || undefined}
        onChange={(e) => { const t = e.target.value; setTxt(t); const n = t === "" ? null : parseNumberEs(t); const v = n == null || isNaN(n) ? null : n; last.current = v; onChange(v); }} />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
}
export function Select({ value, onChange, options, id, ariaLabel }) {
  return (
    <select id={id} aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (o.group ? <optgroup key={o.group} label={o.group}>{o.items.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}</optgroup> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}
export function Check({ checked, onChange, children }) {
  const id = useId();
  return <label className="check" htmlFor={id}><input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>{children}</span></label>;
}
export function Card({ title, sub, actions, children, className, flush }) {
  return (
    <section className={cx("card", className)}>
      {(title || actions) && <header className="card-h"><div><h3>{title}</h3>{sub && <p className="sub">{sub}</p>}</div><div className="card-a">{actions}</div></header>}
      <div className={cx("card-b", flush && "flush")}>{children}</div>
    </section>
  );
}
export function Banner({ kind = "info", title, children }) {
  return <div className={cx("banner", `banner-${kind}`)} role={kind === "crit" ? "alert" : undefined}>{title && <strong>{title} </strong>}{children}</div>;
}
export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t.id} role="tab" aria-selected={value === t.id} className={cx("tab", value === t.id && "on")} onClick={() => onChange(t.id)}>{t.label}{t.badge != null && <span className="tab-badge">{t.badge}</span>}</button>)}
    </div>
  );
}
export function Modal({ title, onClose, children, wide, footer }) {
  useEffect(() => { const h = (e) => e.key === "Escape" && onClose(); document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h); }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx("modal", wide && "modal-wide")} role="dialog" aria-modal="true" aria-label={title}>
        <header><h3>{title}</h3><button className="x" aria-label="Cerrar" onClick={onClose}>×</button></header>
        <div className="modal-b">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}
export function CopyBtn({ getText, label = "Copiar", variant = "ghost", small }) {
  const [state, setState] = useState("idle");
  const [fallback, setFallback] = useState(null);
  const run = async () => {
    const text = getText();
    try { await navigator.clipboard.writeText(text); setState("ok"); setTimeout(() => setState("idle"), 1800); }
    catch (e) { setFallback(text); }
  };
  return (
    <>
      <Btn variant={variant} small={small} onClick={run}>{state === "ok" ? "Copiado ✓" : label}</Btn>
      {fallback != null && (
        <Modal title="Copia manual" onClose={() => setFallback(null)}>
          <p className="sub">El visor ha bloqueado el portapapeles. Selecciona el texto y cópialo (Ctrl/Cmd + C).</p>
          <textarea className="ta-copy" readOnly value={fallback} onFocus={(e) => e.target.select()} rows={14} />
        </Modal>
      )}
    </>
  );
}
export function Empty({ title, children, action }) {
  return <div className="empty"><strong>{title}</strong><p>{children}</p>{action}</div>;
}
export function Kpi({ label, value, sub, strong, tone }) {
  return <div className={cx("kpi", strong && "kpi-strong", tone && `kpi-${tone}`)}><div className="kpi-l">{label}</div><div className="kpi-v num-mono">{value}</div>{sub && <div className="kpi-s">{sub}</div>}</div>;
}
export const Eur = ({ v, d = 2 }) => <span className="num-mono">{fmtEUR(v, d)}</span>;
export const Dlt = ({ v, pct, d = 2 }) => {
  if (v == null || isNaN(v)) return <span className="muted">—</span>;
  const cls = Math.abs(v) < 0.005 ? "" : v > 0 ? "dlt-up" : "dlt-dn";
  return <span className={cx("num-mono", cls)}>{(v > 0 ? "+" : "") + fmtEUR(v, d)}{pct != null && <span className="pct"> ({(pct > 0 ? "+" : "") + fmtNum(pct, 1)} %)</span>}</span>;
};

/* ---------- Gráficos (SVG sin librerías) ---------- */
export function Legend({ items }) {
  return <ul className="legend">{items.map((i) => <li key={i.label}><span className="sw" style={{ background: i.color }} />{i.label}</li>)}</ul>;
}

export function LineChart({ series, height = 250, xFmt, yFmt, xTitle, yTitle, markers }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const W = 760, H = height, m = { l: 74, r: 18, t: 14, b: 38 };
  const xs = series.flatMap((s) => s.points.map((p) => p.x)), ys = series.flatMap((s) => s.points.map((p) => p.y));
  if (!xs.length) return <Empty title="Sin datos">No hay administraciones en este horizonte.</Empty>;
  const xmin = 0, xmax = Math.max(...xs, 1), ymax = Math.max(...ys, 1) * 1.06;
  const X = (x) => m.l + ((x - xmin) / (xmax - xmin || 1)) * (W - m.l - m.r), Y = (y) => H - m.b - (y / ymax) * (H - m.t - m.b);
  const ticks = (max, n) => { const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p, nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10, step = nf * p; const out = []; for (let v = 0; v <= max + 1e-9; v += step) out.push(v); return out; };
  const yt = ticks(ymax, 4), xt = ticks(xmax, 6);
  const step = (pts) => { let d = ""; pts.forEach((p, i) => { d += i === 0 ? `M${X(p.x)},${Y(0)} L${X(p.x)},${Y(p.y)}` : ` L${X(p.x)},${Y(pts[i - 1].y)} L${X(p.x)},${Y(p.y)}`; }); return d; };
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    const xv = ((px - m.l) / (W - m.l - m.r)) * (xmax - xmin) + xmin; setHover(Math.max(0, Math.min(xmax, xv)));
  };
  const valAt = (s, x) => { let v = 0; for (const p of s.points) { if (p.x <= x) v = p.y; else break; } return v; };
  return (
    <div className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={yTitle || "Gráfico"} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {yt.map((v) => <g key={v}><line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className="grid" /><text x={m.l - 8} y={Y(v) + 4} textAnchor="end" className="ax">{yFmt(v)}</text></g>)}
        {xt.map((v) => <text key={v} x={X(v)} y={H - m.b + 18} textAnchor="middle" className="ax">{xFmt(v)}</text>)}
        {xTitle && <text x={(m.l + W - m.r) / 2} y={H - 4} textAnchor="middle" className="ax-t">{xTitle}</text>}
        {markers && markers.map((mk, i) => <g key={i}><line x1={X(mk.x)} x2={X(mk.x)} y1={m.t} y2={H - m.b} className="mk" /><text x={X(mk.x) + 4} y={m.t + 10} className="ax">{mk.label}</text></g>)}
        {series.map((s, i) => (
          <g key={s.name}>
            {series.length === 1 && <path d={step(s.points) + ` L${X(s.points[s.points.length - 1].x)},${Y(0)} Z`} fill={s.color} opacity="0.12" />}
            <path d={step(s.points)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeDasharray={s.dash || undefined} />
            {s.points.length > 0 && <circle cx={X(s.points[s.points.length - 1].x)} cy={Y(s.points[s.points.length - 1].y)} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" />}
          </g>
        ))}
        {hover != null && <g><line x1={X(hover)} x2={X(hover)} y1={m.t} y2={H - m.b} className="cross" />{series.map((s) => <circle key={s.name} cx={X(hover)} cy={Y(valAt(s, hover))} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" />)}</g>}
      </svg>
      {hover != null && (
        <div className="tip" style={{ left: `${Math.min(78, Math.max(2, (X(hover) / W) * 100))}%` }}>
          <b>{xFmt(hover)}</b>
          {series.map((s) => <div key={s.name}><span className="sw" style={{ background: s.color }} />{s.name}: <span className="num-mono">{yFmt(valAt(s, hover), true)}</span></div>)}
        </div>
      )}
    </div>
  );
}

export function StackBars({ rows, max, fmt, labelWidth = 150 }) {
  const mx = max || Math.max(...rows.map((r) => r.segments.reduce((s, x) => s + x.value, 0)), 1);
  const [tip, setTip] = useState(null);
  return (
    <div className="sbars">
      {rows.map((r) => {
        const tot = r.segments.reduce((s, x) => s + x.value, 0);
        return (
          <div className="sbar" key={r.label}>
            <div className="sbar-l" style={{ width: labelWidth }} title={r.label}>{r.label}</div>
            <div className="sbar-t">
              {r.segments.filter((s) => s.value > 0).map((s) => (
                <span key={s.key} className="seg" style={{ width: `${(s.value / mx) * 100}%`, background: s.color }}
                  onMouseEnter={() => setTip(`${r.label} · ${s.label}: ${fmt(s.value)}`)} onMouseLeave={() => setTip(null)} title={`${s.label}: ${fmt(s.value)}`} />
              ))}
            </div>
            <div className="sbar-v num-mono">{fmt(tot)}</div>
          </div>
        );
      })}
      {tip && <div className="sbar-tip" aria-hidden="true">{tip}</div>}
    </div>
  );
}

export function useDebounced(v, ms = 150) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }
