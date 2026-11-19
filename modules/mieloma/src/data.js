// MieloFarma · datos maestros importados de «Mielola multiple costes 2026.xlsx»
// Nada de lo que hay aquí está verificado con fuente y fecha: todo es "importado del Excel / pendiente de validación".

const R = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const K = (drug, basis, dose, days, x = {}) => ({ drug, basis, dose, days, ...x });
const KT = (drug, basis, dose, total, x = {}) => ({ drug, basis, dose, total, ...x });
const S = (id, name, phase, cycles, len, comps) => ({ id, name, phase, cycles, len, comps });

export const DRUGS = {
  dara_iv: "Daratumumab IV", dara_sc: "Daratumumab SC", isa_iv: "Isatuximab IV", isa_sc: "Isatuximab SC",
  bort: "Bortezomib", carf: "Carfilzomib", bela: "Belantamab", lena: "Lenalidomida", pom: "Pomalidomida",
  tal: "Talidomida", dex: "Dexametasona", pred: "Prednisona", melf: "Melfalán", cyclo: "Ciclofosfamida",
  sel: "Selinexor", tec: "Teclistamab", elra: "Elranatamab", talq: "Talquetamab", ixa: "Ixazomib",
};
export const DRUG_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

/* ---------------- Catálogo (hoja Costes) ---------------- */
const P = (cell, price, extra = {}) => ({ price, from: null, source: `Excel · Costes!${cell}`, type: "No especificado en el Excel", note: "", ...extra });
const E = (id, drug, label, mg, unit, oral, cell, price, extra = {}, hist = {}) => ({
  id, drug, label, mg, unit, oral, route: oral ? "oral" : "parenteral", center: "Centro del Excel (no indicado)", excelCell: `Costes!A${cell.row}`,
  status: "pendiente", history: price == null ? [] : [P(cell.price, price, hist)], archived: false, ...extra,
});
export const CATALOG_INITIAL = [
  E("C02", "bela", "Belantamab 100 mg", 100, "vial", false, { row: 2, price: "C2" }, 5484.16, {}, { note: "Anotación «SIGLO» en Costes!E2: posible origen del precio; sin confirmar." }),
  E("C03", "bort", "Bortezomib 3,5 mg", 3.5, "vial", false, { row: 3, price: "C3" }, 15.49),
  E("C04", "carf", "Carfilzomib 60 mg", 60, "vial", false, { row: 4, price: "C4" }, 578.74),
  E("C05", "cyclo", "Ciclofosfamida 50 mg", 50, "comprimido", true, { row: 5, price: "C5" }, 0.2),
  E("C06", "dara_iv", "Daratumumab IV 400 mg", 400, "vial", false, { row: 6, price: "C6" }, 743.27),
  E("C07", "dara_sc", "Daratumumab SC 1800 mg (dosis fija)", 1800, "vial", false, { row: 7, price: "C7" }, 2147.23),
  E("C08", "dex", "Dexametasona (sin presentación ni precio en el Excel)", null, "comprimido", true, { row: 8, price: "C8" }, null),
  E("C09", "elra", "Elranatamab 44 mg", 44, "vial", false, { row: 9, price: "C9" }, 1246.19),
  E("C10", "isa_iv", "Isatuximab IV 500 mg", 500, "vial", false, { row: 10, price: "C10" }, 925.01),
  E("C11", "isa_sc", "Isatuximab SC 1400 mg (dosis fija)", 1400, "vial", false, { row: 11, price: "C11" }, 1295.02, {}, { from: "2026-10-01", note: "Fecha 01/10/2026 anotada en Costes!E11 sin etiqueta; se toma como inicio de vigencia, pendiente de confirmar." }),
  E("C12", "ixa", "Ixazomib (sin datos en el Excel)", null, "cápsula", true, { row: 12, price: "C12" }, null),
  E("C13", "lena", "Lenalidomida 25 mg", 25, "cápsula", true, { row: 13, price: "C13" }, 0.6),
  E("C14", "lena", "Lenalidomida 20 mg", 20, "cápsula", true, { row: 14, price: "C14" }, 0.6),
  E("C15", "lena", "Lenalidomida 15 mg", 15, "cápsula", true, { row: 15, price: "C15" }, 0.56),
  E("C16", "lena", "Lenalidomida 10 mg", 10, "cápsula", true, { row: 16, price: "C16" }, 0.42),
  E("C17", "melf", "Melfalán 2 mg", 2, "comprimido", true, { row: 17, price: "C17" }, 0.66),
  E("C18", "pom", "Pomalidomida 4 mg", 4, "cápsula", true, { row: 18, price: "C18" }, 15.3),
  E("C19", "pred", "Prednisona 50 mg", 50, "comprimido", true, { row: 19, price: "C19" }, 0.14),
  E("C20", "tal", "Talidomida 100 mg", 100, "cápsula", true, { row: 20, price: "C20" }, 0.65),
  E("C21", "talq", "Talquetamab 40 mg", 40, "vial", false, { row: 21, price: "C21" }, 3043.31),
  E("C22", "tec", "Teclistamab 30 mg", 30, "vial", false, { row: 22, price: "C22" }, 645.51),
  E("C23", "sel", "Selinexor 20 mg", 20, "comprimido", true, { row: 23, price: "C23" }, 140.78),
];

/* ---------------- Biblioteca de esquemas ---------------- */
const dr = (route, days, x) => (route === "iv" ? K("dara_iv", "mgkg", 16, days, x) : K("dara_sc", "fixed", 1800, days, x));
const drT = (route, total) => (route === "iv" ? KT("dara_iv", "mgkg", 16, total) : KT("dara_sc", "fixed", 1800, total));
const isa = (route, days) => (route === "iv" ? K("isa_iv", "mgkg", 10, days) : K("isa_sc", "fixed", 1400, days));
const isaT = (route, total) => (route === "iv" ? KT("isa_iv", "mgkg", 10, total) : KT("isa_sc", "fixed", 1400, total));
const DEX8 = [1, 2, 8, 9, 15, 16, 22, 23];
const DEX_VRD = [1, 2, 4, 5, 8, 9, 11, 12];
const BORT4 = [1, 4, 8, 11];

const base = { status: "pendiente", verified: null, archived: false, custom: false, notes: [], flags: [] };
const F_DEX = { code: "DEX_SIN_PRECIO", text: "La dexametasona no tiene precio en la hoja Costes: su coste no se incluye (igual que en el Excel)." };
const F_SCHEME_CAL = (t) => ({ code: "CAL_ESQUEMAS", text: t });

function dvrd(route, line, trial, cellMain, exMain, cellM, exR, exDR, flagsExtra = []) {
  const s = route;
  return {
    ...base, id: `${line}-DVRD-${s.toUpperCase()}`, name: `D-VRD ${s.toUpperCase()}`, line, route: s.toUpperCase(), trial,
    source: cellMain, excel: { main: { cell: cellMain, value: exMain }, maint: { R: { cell: cellM, value: exR }, DR: { cell: cellM, value: exDR } } },
    notes: [], flags: [F_DEX, F_SCHEME_CAL("No existe bloque D-VRD en la hoja Esquemas: el calendario se ha ensamblado a partir de VRD (bortezomib, lenalidomida, dexametasona) y D-VTD (daratumumab). Pendiente de validación."), ...flagsExtra],
    segs: [
      S("c12", "C1-2", "induccion", 2, 28, [dr(s, [1, 8, 15, 22]), K("bort", "mgm2", 1.3, BORT4), K("lena", "fixed", 25, R(1, 21)), K("dex", "fixed", 40, [1, 2, 3, 4, 9, 10, 11, 12])]),
      S("c36", "C3-6", "induccion", 4, 28, [dr(s, [1, 15]), K("bort", "mgm2", 1.3, BORT4), K("lena", "fixed", 25, R(1, 21)), K("dex", "fixed", 40, [1, 2, 3, 4, 9, 10, 11, 12])]),
    ],
    maint: [
      { id: "R", label: "Lenalidomida 10 mg (Excel, bloque L–T)", segs: [S("mR", "Mantenimiento R", "mantenimiento", 12, 28, [K("lena", "fixed", 10, R(1, 21))])] },
      { id: "DR", label: `Daratumumab ${s.toUpperCase()} + lenalidomida (Excel, bloque V–AD)`, segs: [S("mDR", "Mantenimiento D-R", "mantenimiento", 12, 28, [dr(s, [1]), K("lena", "fixed", 10, R(1, 21))])] },
    ],
  };
}
function dvtd(route, cellMain, exMain, cellM, exR) {
  const s = route;
  return {
    ...base, id: `1C-DVTD-${s.toUpperCase()}`, name: `D-VTD ${s.toUpperCase()}`, line: "1C", route: s.toUpperCase(), trial: s === "iv" ? "EC Cassiopea (según Excel)" : "",
    source: cellMain, excel: { main: { cell: cellMain, value: exMain }, maint: { R: { cell: cellM, value: exR } } },
    flags: [F_DEX, F_SCHEME_CAL("Talidomida: la hoja de cálculo usa 21 días/ciclo; el calendario D-VTD de Esquemas la marca los 28 días. Se importa el recuento de la hoja de cálculo (21)."),
      ...(s === "sc" ? [{ code: "REF_ROTA", text: "En el Excel, F46 (mg/día de daratumumab SC) apunta a una celda vacía y da 0; el coste no se ve afectado porque usa el precio por dosis." }] : [])],
    segs: [
      S("c12", "C1-2", "induccion", 2, 28, [dr(s, [1, 8, 15, 22]), K("bort", "mgm2", 1.3, [1, 8, 15, 22]), K("tal", "fixed", 100, R(1, 21)), K("dex", "fixed", 40, DEX8)]),
      S("c36", "C3-6", "induccion", 4, 28, [dr(s, [1, 15]), K("bort", "mgm2", 1.3, [1, 8, 15, 22]), K("tal", "fixed", 100, R(1, 21)), K("dex", "fixed", 40, DEX8)]),
    ],
    maint: [{ id: "R", label: "Lenalidomida 10 mg (Excel, bloque L–T)", segs: [S("mR", "Mantenimiento R", "mantenimiento", 12, 28, [K("lena", "fixed", 10, R(1, 21))])] }],
  };
}
function isavrd1c(route, cellMain, exMain, cellM, exR, flags = []) {
  const s = route;
  return {
    ...base, id: `1C-ISAVRD-${s.toUpperCase()}`, name: `Isa-VRD ${s.toUpperCase()}`, line: "1C", route: s.toUpperCase(), trial: "",
    source: cellMain, excel: { main: { cell: cellMain, value: exMain }, maint: { R: { cell: cellM, value: exR } } },
    notes: ["Nota del Excel (1 linea!B64): «Si paciente > 68 Kg mejor SC (a partir de 700 mg)». Criterio sin fuente; no se aplica automáticamente."],
    flags: [F_DEX, F_SCHEME_CAL("Solo se conoce el número total de administraciones de isatuximab (11); el calendario día a día es aproximado."), ...flags],
    segs: [S("ind", "C1-3", "induccion", 3, 42, [isaT(s, 11), K("bort", "mgm2", 1.3, [1, 4, 8, 11, 22, 25, 29, 32]), K("lena", "fixed", 25, R(1, 28)), KT("dex", "fixed", 40, 24)])],
    maint: [{ id: "R", label: "Lenalidomida 10 mg (Excel, bloque L–T)", segs: [S("mR", "Mantenimiento R", "mantenimiento", 12, 28, [K("lena", "fixed", 10, R(1, 21))])] }],
  };
}
function imroz(route, cellMain, exMain, cellM, exM, flags = []) {
  const s = route;
  return {
    ...base, id: `1N-ISAVRD-${s.toUpperCase()}`, name: `Isa-VRD ${s.toUpperCase()}`, line: "1N", route: s.toUpperCase(), trial: "IMROZ (según Excel)",
    source: cellMain, excel: { main: { cell: cellMain, value: exMain }, maint: { IR: { cell: cellM, value: exM } } },
    flags: [F_DEX, F_SCHEME_CAL("Solo se conoce el total de administraciones en inducción (15); calendario aproximado."), ...flags],
    segs: [S("ind", "C1-4", "induccion", 4, 42, [isaT(s, 15), K("bort", "mgm2", 1.3, [1, 4, 8, 11, 22, 25, 29, 32]), K("lena", "fixed", 25, R(1, 28)), KT("dex", "fixed", 40, 32)])],
    maint: [{ id: "IR", label: "Isatuximab + lenalidomida (Excel, bloque L–T)", segs: [S("mIR", "Mantenimiento Isa-R", "mantenimiento", 12, 28, [isa(s, [1, 15]), K("lena", "fixed", 25, R(1, 21)), K("dex", "fixed", 20, DEX8)])] }],
  };
}
function cepheus(route, cellMain, exMain, cellM, exM) {
  const s = route;
  return {
    ...base, id: `1N-DVRD-${s.toUpperCase()}`, name: `D-VRD ${s.toUpperCase()}`, line: "1N", route: s.toUpperCase(), trial: "Cepheus (según Excel)",
    source: cellMain, excel: { main: { cell: cellMain, value: exMain }, maint: { DR: { cell: cellM, value: exM } } },
    flags: [F_DEX, F_SCHEME_CAL("Solo se conoce el total de administraciones de daratumumab en inducción (12); calendario aproximado.")],
    segs: [S("ind", "C1-8", "induccion", 8, 21, [drT(s, 12), K("bort", "mgm2", 1.3, BORT4), K("lena", "fixed", 25, R(1, 14)), K("dex", "fixed", 40, DEX_VRD)])],
    maint: [{ id: "DR", label: "Daratumumab + lenalidomida (Excel, bloque L–T)", segs: [S("mDR", "Mantenimiento D-R", "mantenimiento", 12, 21, [dr(s, [1]), K("lena", "fixed", 25, R(1, 14))])] }],
  };
}
function drd1(route, cellMain, exMain, cellM, exM) {
  const s = route;
  return {
    ...base, id: `1N-DRD-${s.toUpperCase()}`, name: `DRD ${s.toUpperCase()}`, line: "1N", route: s.toUpperCase(), trial: "",
    source: cellMain, excel: { main: { cell: cellMain, value: exMain }, maint: { DR: { cell: cellM, value: exM } } },
    notes: s === "iv" ? ["Nota del Excel: «Seleccionar IV si el paciente pesa <62 Kg por coste-eficiencia». Criterio sin fuente; no se aplica automáticamente. Compara ambas vías en el Comparador."] : [],
    flags: [F_DEX, F_SCHEME_CAL("El Excel indica ciclo de 21 días, pero la fórmula de daratumumab (8+2·(n−2)) y el calendario DRD de Esquemas corresponden a ciclos de 28 días (semanal C1-2, quincenal C3-6). Se importa 28 días; el coste no cambia, el calendario sí.")],
    segs: [
      S("c12", "C1-2", "induccion", 2, 28, [dr(s, [1, 8, 15, 22]), K("lena", "fixed", 25, R(1, 21)), K("dex", "fixed", 20, DEX8)]),
      S("c36", "C3-6", "induccion", 4, 28, [dr(s, [1, 15]), K("lena", "fixed", 25, R(1, 21)), K("dex", "fixed", 20, [1, 2, 15, 16])]),
    ],
    maint: [{ id: "DR", label: "Daratumumab + lenalidomida (Excel, bloque L–T)", segs: [S("mDR", "Mantenimiento D-R", "mantenimiento", 12, 28, [dr(s, [1]), K("lena", "fixed", 25, R(1, 21)), K("dex", "fixed", 20, [1, 2])])] }],
  };
}
function dvmp(route, cellMain, exMain, cellM, exM) {
  const s = route;
  return {
    ...base, id: `1N-DVMP-${s.toUpperCase()}`, name: `D-VMP ${s.toUpperCase()}`, line: "1N", route: s.toUpperCase(), trial: "",
    source: cellMain, excel: { main: { cell: cellMain, value: exMain }, maint: { D: { cell: cellM, value: exM } } },
    notes: s === "iv" ? ["Nota del Excel: «Seleccionar IV si el paciente pesa <62 Kg por coste-eficiencia». Sin fuente; no se aplica automáticamente."] : [],
    flags: [F_DEX,
      F_SCHEME_CAL("Daratumumab: la hoja de cálculo cuenta 24 administraciones; el calendario D-VMP de Esquemas suma 22 (6 en C1 + 2×8). Prednisona: 27 días en la hoja frente a 36 en el calendario (4 d × 9 ciclos). Se importan los recuentos de la hoja de cálculo; calendario aproximado."),
      ...(s === "iv" ? [{ code: "SUMA_EXCEL", text: "En el Excel el total de D-VMP IV (J172) omite el coste de prednisona (J171); en D-VMP SC sí lo incluye. MieloFarma lo incluye en ambos." }] : [])],
    segs: [S("c", "C1-9", "induccion", 9, 42, [
      KT("pred", "mgm2", 60, 27), K("melf", "mgm2", 9, [1, 2, 3, 4]), drT(s, 24),
      { drug: "bort", basis: "mgm2", dose: 1.3, blocks: [[1, 1, [1, 4, 8, 11, 22, 25, 29, 32]], [2, 9, [1, 8, 22, 29]]] },
    ])],
    maint: [{ id: "D", label: "Daratumumab (Excel, bloque L–T)", segs: [S("mD", "Mantenimiento D", "mantenimiento", 12, 28, [dr(s, [1])])] }],
  };
}

export const SCHEMES_INITIAL = [
  dvrd("iv", "1C", "", "1 linea!J12", 42195.5569828571, "1 linea!T9 / AD10", 105.84, 31501.5648),
  dvrd("sc", "1C", "EC Perseus (según Excel)", "1 linea!J25", 34690.2705828571, "1 linea!T22 / AD23", 105.84, 25872.6),
  dvtd("iv", "1 linea!J38", 42195.5569828571, "1 linea!T35", 105.84),
  dvtd("sc", "1 linea!J50", 34690.2705828571, "1 linea!T47", 105.84),
  isavrd1c("iv", "1 linea!J63", 18215.4841828571, "1 linea!T60", 105.84),
  isavrd1c("sc", "1 linea!J76", 14299.82, "1 linea!T73", 105.84, [{ code: "REF_ROTA", text: "En el Excel la fila de bortezomib de Isa-VRD SC (F73) apunta a una celda vacía y su coste sale 0 €. MieloFarma sí lo calcula." }]),
  imroz("iv", "1 linea!J92", 24829.9847771429, "1 linea!T91", 39223.6224),
  imroz("sc", "1 linea!J105", 19498.1, "1 linea!T104", 31080.48, [{ code: "REF_ROTA", text: "En el Excel, bortezomib (F102) y lenalidomida de mantenimiento (R102→Costes!C26) apuntan a celdas vacías y salen 0 €. MieloFarma los calcula." }]),
  cepheus("iv", "1 linea!J118", 31805.4455771429, "1 linea!T116", 31496.5248),
  cepheus("sc", "1 linea!J131", 26176.4807771429, "1 linea!T128", 25867.56),
  drd1("iv", "1 linea!J149", 41936.5664, "1 linea!T149", 31546.9248),
  drd1("sc", "1 linea!J161", 34431.28, "1 linea!T161", 25917.96),
  dvmp("iv", "1 linea!J172", 63408.2641714286, "1 linea!T168", 31395.7248),
  dvmp("sc", "1 linea!J184", 52158.4345714286, "1 linea!T180", 25766.76),
  {
    ...base, id: "1N-VRD", name: "VRD", line: "1N", route: "SC/oral", trial: "", fueraFicha: true,
    source: "1 linea!J196", excel: { main: { cell: "1 linea!J196", value: 437.720777142857 }, maint: { R: { cell: "1 linea!T195", value: 151.2 } } },
    notes: ["Marcado en el Excel como «Fuera de Ficha Técnica» (6-2)."],
    flags: [F_DEX, F_SCHEME_CAL("El Excel usa ciclo de 21 días con lenalidomida 21 días; ni «VRD» (28 d) ni «VRD Swog» (21 d, lenalidomida 14 d) de Esquemas coinciden exactamente. Se importa el recuento de la hoja de cálculo.")],
    segs: [S("c", "C1-8", "induccion", 8, 21, [K("bort", "mgm2", 1.3, BORT4), K("lena", "fixed", 25, R(1, 21)), K("dex", "fixed", 20, DEX_VRD)])],
    maint: [{ id: "R", label: "Lenalidomida + dexametasona (Excel, bloque L–T)", segs: [S("mR", "Mantenimiento R", "mantenimiento", 12, 28, [K("lena", "fixed", 25, R(1, 21)), K("dex", "fixed", 20, DEX8)])] }],
  },
];

/* ---- Segunda línea ---- */
const capBela = [{ drug: "bela", perYear: 50000, note: "Máximo 50.000 € por paciente y año (nota del Excel, 2 linea!M12/N68). Acuerdo sin fuente ni fecha: histórico pendiente de validación." }];
const L2 = [
  {
    ...base, id: "2-BELAPD", name: "Bela-Pd", line: "2", route: "IV", trial: "DREAMM-8 (según Excel)", source: "2 linea!J12", caps: capBela,
    excel: { main: { cell: "2 linea!J12", value: 116785.42272 } },
    flags: [F_DEX, { code: "TOPE", text: "El Excel añade un tope de 50.000 €/paciente/año (K8, K12 = 53.855,60 €). Actívalo con «aplicar topes» en la calculadora; está desactivado por defecto." }],
    segs: [
      S("c1", "C1", "induccion", 1, 28, [K("bela", "mgkg", 2.5, [1]), K("pom", "fixed", 4, R(1, 21)), K("dex", "fixed", 20, DEX8)]),
      S("c2", "C2-12", "continuo", 11, 28, [K("bela", "mgkg", 1.9, [1]), K("pom", "fixed", 4, R(1, 21)), K("dex", "fixed", 20, DEX8)]),
    ], maint: [],
  },
  {
    ...base, id: "2-ISAKD-IV", name: "Isa-Kd IV", line: "2", route: "IV", trial: "IKEMA (según Excel)", source: "2 linea!J25",
    excel: { main: { cell: "2 linea!J25", value: 112228.6748 } },
    flags: [F_DEX, { code: "CONST", text: "El Excel contiene un «coste ciclo» tecleado (I25 = 8.520,97) que no se usa en el total. MieloFarma lo recalcula." }],
    segs: [
      S("c1", "C1", "induccion", 1, 28, [K("isa_iv", "mgkg", 10, [1, 8, 15, 22]), K("carf", "mgm2", 20, [1, 2]), K("carf", "mgm2", 56, [8, 9, 15, 16]), K("dex", "fixed", 40, [1, 2, 8, 9, 15, 16, 22])]),
      S("c2", "C2-12", "continuo", 11, 28, [K("isa_iv", "mgkg", 10, [1, 15]), K("carf", "mgm2", 56, [1, 2, 8, 9, 15, 16]), K("dex", "fixed", 40, [1, 2, 8, 9, 15, 16])]),
    ], maint: [],
  },
  {
    ...base, id: "2-ISAKD-SC", name: "Isa-Kd SC", line: "2", route: "SC", trial: "IKEMA (según Excel)", source: "2 linea!J38",
    excel: { main: { cell: "2 linea!J38", value: 103570.7372 } },
    flags: [F_DEX],
    segs: [
      S("c1", "C1", "induccion", 1, 28, [K("isa_sc", "fixed", 1400, [1, 8, 15, 22]), K("carf", "mgm2", 20, [1, 2]), K("carf", "mgm2", 56, [8, 9, 15, 16]), K("dex", "fixed", 40, [1, 2, 8, 9, 15, 16, 22])]),
      S("c2", "C2-12", "continuo", 11, 28, [K("isa_sc", "fixed", 1400, [1, 15]), K("carf", "mgm2", 56, [1, 2, 8, 9, 15, 16]), K("dex", "fixed", 40, [1, 2, 8, 9, 15, 16])]),
    ], maint: [],
  },
  {
    ...base, id: "2-CILTA", name: "Cilta-cel (CAR-T)", line: "2", route: "Proceso único", trial: "CARTITUDE-4 (según Excel)", source: "2 linea!J42",
    excel: { main: { cell: "2 linea!J42", value: 367708.33 } },
    notes: ["Importe tecleado en el Excel sin fuente ni fecha (histórico). Solo precio del medicamento; no incluye aféresis, linfodepleción, hospitalización ni seguimiento."],
    flags: [{ code: "HISTORICO", text: "Coste histórico del Excel, pendiente de validación. No representa el coste total del proceso asistencial." }],
    segs: [S("c", "Infusión", "induccion", 1, 28, [{ fixed: { label: "Cilta-cel (precio histórico del Excel)", amount: 367708.33 } }])], maint: [],
  },
  {
    ...base, id: "2-PVD", name: "PVd", line: "2", route: "SC/oral", trial: "", source: "2 linea!J53",
    excel: { main: { cell: "2 linea!J53", value: 2050.52077714286 }, maint: { M: { cell: "2 linea!T53", value: 2823.09058285714 } } },
    flags: [F_DEX],
    segs: [S("c", "C1-8", "induccion", 8, 21, [K("bort", "mgm2", 1.3, BORT4), K("pom", "fixed", 4, R(1, 14)), K("dex", "fixed", 20, DEX_VRD)])],
    maint: [{ id: "M", label: "Mantenimiento PVd (Excel, bloque L–T; calendario «PVD a partir C9»)", segs: [S("m", "C9+ (12 ciclos, mediana del Excel)", "mantenimiento", 12, 28, [K("bort", "mgm2", 1.3, [1, 8]), K("pom", "fixed", 4, R(1, 14)), K("dex", "fixed", 20, [1, 2, 8, 9])])] }],
  },
  {
    ...base, id: "2-BELAVD", name: "Bela-Vd", line: "2", route: "IV", trial: "DREAMM-7 (según Excel)", source: "2 linea!J68", caps: capBela,
    excel: { main: { cell: "2 linea!J68", value: 96858.1367771429 } },
    flags: [F_DEX, { code: "DOSIS_INCONS", text: "Inconsistencia interna: Bela-Pd usa 2,5 mg/kg el C1 y 1,9 mg/kg después, pero Bela-Vd usa 2,5 mg/kg en los 8 ciclos. Se importa tal cual; verificar con ficha técnica vigente." }, { code: "TOPE", text: "Tope de 50.000 €/paciente/año anotado en el Excel (K65). Opcional, desactivado por defecto." }],
    segs: [S("c", "C1-8", "induccion", 8, 21, [K("bela", "mgkg", 2.5, [1]), K("bort", "mgm2", 1.3, BORT4), K("dex", "fixed", 20, DEX_VRD)])], maint: [],
  },
  {
    ...base, id: "2-SELVD", name: "Sel-Vd", line: "2", route: "oral/SC", trial: "BOSTON (según Excel)", source: "2 linea!J80",
    excel: { main: { cell: "2 linea!J80", value: 28492.9207771429 } },
    flags: [F_DEX],
    segs: [S("c", "C1-8", "induccion", 8, 35, [K("sel", "fixed", 100, [1, 8, 15, 22, 29]), K("bort", "mgm2", 1.3, [1, 8, 15, 22]), K("dex", "fixed", 20, DEX8)])], maint: [],
  },
  ...["sc", "iv"].map((s) => ({
    ...base, id: `2-DVD-${s.toUpperCase()}`, name: `DVd ${s.toUpperCase()}`, line: "2", route: s.toUpperCase(), trial: "", source: s === "sc" ? "2 linea!J92" : "2 linea!J105",
    excel: { main: { cell: s === "sc" ? "2 linea!J92" : "2 linea!J105", value: s === "sc" ? 28250.9107771429 : 34348.9559771429 }, maint: { D: { cell: s === "sc" ? "2 linea!T89" : "2 linea!T102", value: s === "sc" ? 25766.76 : 31395.7248 } } },
    flags: [F_DEX, F_SCHEME_CAL("Daratumumab: la hoja cuenta 13 administraciones; el calendario DVD de Esquemas da 14 (3×3 + 5×1). Bortezomib: 4 dosis/ciclo en la hoja frente a 3 (días 1, 8, 15) en el calendario. Se importan los recuentos de la hoja de cálculo."),
      ...(s === "sc" ? [{ code: "ROTULO", text: "En el Excel el rótulo de daratumumab SC muestra «16 Kg» pero la cantidad es 1800 mg fijos." }] : [])],
    segs: [S("c", "C1-8", "induccion", 8, 21, [drT(s, 13), K("bort", "mgm2", 1.3, BORT4), K("dex", "fixed", 40, DEX_VRD)])],
    maint: [{ id: "D", label: `Daratumumab ${s.toUpperCase()} (Excel, bloque L–T)`, segs: [S("mD", "Mantenimiento D", "mantenimiento", 12, 28, [dr(s, [1])])] }],
  })),
  ...["iv", "sc"].map((s) => ({
    ...base, id: `2-ISAPD-${s.toUpperCase()}`, name: `Isa-Pd ${s.toUpperCase()}`, line: "2", route: s.toUpperCase(), trial: "", source: s === "iv" ? "2 linea!J117" : "2 linea!J129",
    excel: { main: { cell: s === "iv" ? "2 linea!J117" : "2 linea!J129", value: s === "iv" ? 31874.7168 : 25880.76 } },
    flags: [F_DEX, F_SCHEME_CAL("El Excel usa ciclo de 21 días (8 ciclos) y la fórmula 4+2·(n−1) de isatuximab; el calendario Isa-PD de Esquemas es de 28 días. Se importa 28 días; el coste no cambia."),
      ...(s === "sc" ? [{ code: "REF_ROTA", text: "En el Excel, F126 apunta a una celda vacía y G126 a Costes!D20 (talidomida); el total usa el precio por dosis y no se altera." }] : [])],
    segs: [
      S("c1", "C1", "induccion", 1, 28, [isa(s, [1, 8, 15, 22]), K("pom", "fixed", 4, R(1, 21)), K("dex", "fixed", 20, [1, 8, 15, 22])]),
      S("c2", "C2-8", "induccion", 7, 28, [isa(s, [1, 15]), K("pom", "fixed", 4, R(1, 21)), K("dex", "fixed", 20, [1, 15])]),
    ], maint: [],
  })),
  {
    ...base, id: "2-KD", name: "Kd", line: "2", route: "IV", trial: "", source: "2 linea!J141",
    excel: { main: { cell: "2 linea!J141", value: 8856.5637456 } },
    flags: [F_DEX, { code: "REF_ERR", text: "ERROR del Excel: el coste/mg de carfilzomib apunta a Costes!D10 (isatuximab IV, 1,85 €/mg) en vez de D4 (carfilzomib, 9,65 €/mg). El total del Excel está infravalorado; MieloFarma usa el precio correcto." }],
    segs: [
      S("c1", "C1", "induccion", 1, 28, [K("carf", "mgm2", 20, [1, 2]), K("carf", "mgm2", 56, [8, 9, 15, 16]), K("dex", "fixed", 40, [1, 2, 8, 9, 15, 16, 22])]),
      S("c2", "C2-8", "induccion", 7, 28, [K("carf", "mgm2", 56, [1, 2, 8, 9, 15, 16]), K("dex", "fixed", 40, [1, 2, 8, 9, 15, 16])]),
    ], maint: [],
  },
  {
    ...base, id: "2-VD", name: "Vd", line: "2", route: "SC", trial: "", source: "2 linea!J153",
    excel: { main: { cell: "2 linea!J153", value: 336.920777142857 } }, flags: [F_DEX],
    segs: [S("c", "C1-8", "induccion", 8, 21, [K("bort", "mgm2", 1.3, BORT4), K("dex", "fixed", 40, DEX_VRD)])], maint: [],
  },
  {
    ...base, id: "2-KRD", name: "KRd", line: "2", route: "IV/oral", trial: "", source: "2 linea!J170",
    excel: { main: { cell: "2 linea!J170", value: 6657.0831504 }, maint: { M: { cell: "2 linea!T169", value: 9947.8792 } } },
    flags: [F_DEX, { code: "REF_ERR", text: "ERROR del Excel: carfilzomib 56 mg/m² del bloque principal usa Costes!D10 (isatuximab) en lugar de D4. El bloque de «ciclos 13-18» sí usa D4." },
      F_SCHEME_CAL("El Excel costea los ciclos 1-6 y «13-18» (con 5 ciclos y 2 días de carfilzomib/ciclo); el calendario Krd C13-18 marca 6 ciclos y 4 días/ciclo (1, 2, 8, 9). Los ciclos 7-12 («Max 12») no se costean. Se importa el recuento de la hoja.")],
    segs: [
      S("c1", "C1", "induccion", 1, 28, [K("carf", "mgm2", 20, [1, 2]), K("carf", "mgm2", 56, [8, 9, 15, 16]), K("lena", "fixed", 25, R(1, 21)), K("dex", "fixed", 40, [1, 2, 8, 9, 15, 16, 22])]),
      S("c2", "C2-6", "induccion", 5, 28, [K("carf", "mgm2", 56, [1, 2, 8, 9, 15, 16]), K("lena", "fixed", 25, R(1, 21)), K("dex", "fixed", 40, [1, 2, 8, 9, 15, 16, 22])]),
    ],
    maint: [{ id: "M", label: "Ciclos «13-18» (Excel, bloque L–T: 5 ciclos)", segs: [S("m", "C13-18", "mantenimiento", 5, 28, [K("carf", "mgm2", 56, [1, 2]), K("lena", "fixed", 25, R(1, 21)), K("dex", "fixed", 40, DEX8)])] }],
  },
  ...["iv", "sc"].map((s) => ({
    ...base, id: `2-DRD-${s.toUpperCase()}`, name: `DRD ${s.toUpperCase()}`, line: "2", route: s.toUpperCase(), trial: "", noFinanciada: true, source: s === "iv" ? "2 linea!J181" : "2 linea!J193",
    excel: { main: { cell: s === "iv" ? "2 linea!J181" : "2 linea!J193", value: s === "iv" ? 36703.9456 : 30364.3105828571 }, maint: { DR: { cell: s === "iv" ? "2 linea!T181" : "2 linea!T192", value: s === "iv" ? 31546.9248 : 25917.96 } } },
    notes: ["Marcado en el Excel como «Indicación NO FINANCIADA»."],
    flags: [F_DEX, F_SCHEME_CAL("Daratumumab: 14 administraciones en esta hoja frente a 16 en DRD de primera línea (8+2·(6−2)). Se importa 14; calendario aproximado."),
      ...(s === "sc" ? [{ code: "LAYOUT", text: "En el Excel las etiquetas del bloque DRD SC están desplazadas una fila (el 6 figura bajo «Esquema»). Valores recuperados; ciclos = 6, duración = 21 d." }, { code: "FILA_EXTRA", text: "El Excel incluye una fila de bortezomib (4 dosis/ciclo, J190) en DRD SC que no existe en DRD IV. Por incoherencia se ha excluido; pendiente de validar si es un resto copiado de otro esquema." }] : [])],
    segs: s === "sc"
      ? [S("c", "C1-6", "induccion", 6, 21, [drT(s, 14), K("lena", "fixed", 25, R(1, 14)), K("dex", "fixed", 20, DEX_VRD)])]
      : [S("c", "C1-6", "induccion", 6, 21, [drT(s, 14), K("lena", "fixed", 25, R(1, 21)), K("dex", "fixed", 20, DEX_VRD)])],
    maint: [{ id: "DR", label: `Daratumumab ${s.toUpperCase()} + lenalidomida (Excel, bloque L–T)`, segs: [S("mDR", "Mantenimiento D-R", "mantenimiento", 12, 28, [dr(s, [1]), K("lena", "fixed", 25, R(1, 21)), K("dex", "fixed", 20, DEX8)])] }],
  })),
  {
    ...base, id: "2-RD", name: "Rd", line: "2", route: "oral", trial: "", source: "2 linea!J205",
    excel: { main: { cell: "2 linea!J205", value: 75.6 } }, flags: [F_DEX],
    segs: [S("c", "C1-6", "induccion", 6, 21, [K("lena", "fixed", 25, R(1, 21)), K("dex", "fixed", 20, DEX_VRD)])], maint: [],
  },
];

/* ---- Tercera línea (esquemas convencionales) ---- */
function as3(s, newId, cellMain, exMain, cellM, exM, mk) {
  const c = JSON.parse(JSON.stringify(s));
  c.id = newId; c.line = "3"; c.source = cellMain; c.noFinanciada = false;
  c.excel = { main: { cell: cellMain, value: exMain } };
  if (cellM) { const k = Object.keys(s.excel.maint)[0]; c.excel.maint = { [k]: { cell: cellM, value: exM } }; }
  c.notes = (c.notes || []).filter((n) => !n.includes("NO FINANCIADA"));
  c.flags = [...c.flags, { code: "DUP", text: "Esquema duplicado de segunda línea en la hoja «3 linea» del Excel (misma estructura)." }];
  return c;
}
const get2 = (id) => L2.find((x) => x.id === id);
const L3 = [
  as3(get2("2-PVD"), "3-PVD", "3 linea!J65", 2050.52077714286, "3 linea!T65", 2823.09058285714),
  {
    ...base, id: "3-POCYDEX", name: "Pocydex", line: "3", route: "oral", trial: "", source: "3 linea!J78",
    excel: { main: { cell: "3 linea!J78", value: 2570.4 } },
    flags: [F_DEX, { code: "OMITIDO", text: "ERROR del Excel: el coste de ciclofosfamida no se calcula (J75 vacío) y por eso el total solo incluye pomalidomida. MieloFarma lo incluye." }, F_SCHEME_CAL("Solo se conoce el recuento (4 días/ciclo); el calendario es aproximado.")],
    segs: [S("c", "C1-8", "induccion", 8, 21, [KT("cyclo", "mgm2", 300, 32), K("pom", "fixed", 4, R(1, 21)), K("dex", "fixed", 20, DEX_VRD)])], maint: [],
  },
  {
    ...base, id: "3-ISAPD", name: "Isa-Pd IV", line: "3", route: "IV", trial: "", source: "3 linea!J91",
    excel: { main: { cell: "3 linea!J91", value: 46184.0576 } },
    flags: [F_DEX, { code: "DUP_DISTINTO", text: "Mismo esquema que «Isa-Pd IV» de 2ª línea pero con 12 ciclos de 28 d (2ª línea: 8 ciclos de 21 d). Inconsistencia a validar." }],
    segs: [
      S("c1", "C1", "induccion", 1, 28, [K("isa_iv", "mgkg", 10, [1, 8, 15, 22]), K("pom", "fixed", 4, R(1, 21)), K("dex", "fixed", 20, [1, 8, 15, 22])]),
      S("c2", "C2-12", "continuo", 11, 28, [K("isa_iv", "mgkg", 10, [1, 15]), K("pom", "fixed", 4, R(1, 21)), K("dex", "fixed", 20, [1, 15])]),
    ], maint: [],
  },
  as3(get2("2-ISAKD-IV"), "3-ISAKD", "3 linea!J105", 112228.6748),
  {
    ...base, id: "3-PD", name: "Pd", line: "3", route: "oral", trial: "", source: "3 linea!J117",
    excel: { main: { cell: "3 linea!J117", value: 2570.4 } }, flags: [F_DEX],
    segs: [S("c", "C1-8", "induccion", 8, 21, [K("pom", "fixed", 4, R(1, 21)), K("dex", "fixed", 20, DEX_VRD)])], maint: [],
  },
  as3(get2("2-DRD-IV"), "3-DRD-IV", "3 linea!J130", 36703.9456, "3 linea!T130", 31546.9248),
  as3(get2("2-DRD-SC"), "3-DRD-SC", "3 linea!J142", 30364.3105828571, "3 linea!T142", 25917.96),
];

export const SCHEMES_ALL = [...SCHEMES_INITIAL, ...L2, ...L3];
export const LINE_LABEL = { "1C": "1ª línea · candidatos a trasplante", "1N": "1ª línea · no candidatos", "2": "2ª línea", "3": "3ª línea" };

/* ---------------- Terapias avanzadas (hoja 3 linea, bloques CAR-T y biespecíficos) ---------------- */
export const BSAB_PRESETS = {
  tec: { name: "Teclistamab", drug: "tec", unitNote: "Dosis en mg/kg", stepUp: [{ day: 1, dose: 0.06, basis: "mgkg" }, { day: 3, dose: 0.3, basis: "mgkg" }, { day: 5, dose: 1.5, basis: "mgkg" }], weekly: { dose: 1.5, basis: "mgkg", weeks: 23 }, biweekly: { dose: 1.5, basis: "mgkg", doses: 12 },
    excel: { rc: { cell: "3 linea!J21", value: 102894.304 }, norc: { cell: "3 linea!K21", value: 136977.232 } }, caps: "Topes anotados en el Excel: 79.154 €/paciente/año 1 (N21) y 52.447 € año 2 (N22). Sin fuente." },
  elra: { name: "Elranatamab", drug: "elra", unitNote: "Dosis fijas en mg", stepUp: [{ day: 1, dose: 12, basis: "fixed" }, { day: 4, dose: 32, basis: "fixed" }], weekly: { dose: 76, basis: "fixed", weeks: 23 }, biweekly: { dose: 76, basis: "fixed", doses: 12 },
    excel: { rc: { cell: "3 linea!J36", value: 76584.04 }, norc: { cell: "3 linea!K36", value: 102414.16 } }, caps: "" },
  talq: { name: "Talquetamab", drug: "talq", unitNote: "Dosis en mg/kg", stepUp: [{ day: 1, dose: 0.01, basis: "mgkg" }, { day: 4, dose: 0.06, basis: "mgkg" }, { day: 7, dose: 0.4, basis: "mgkg" }], weekly: { dose: 0.4, basis: "mgkg", weeks: 47 }, biweekly: { dose: 0.8, basis: "mgkg", doses: 0 },
    excel: { rc: null, norc: { cell: "3 linea!K51", value: 129018.08414 } }, caps: "" },
};
export const CART_ITEMS = [
  { id: "cilta", name: "Cilta-cel (CARTITUDE-4)", price: 367708.33, source: "Excel · 2 linea!J42 y 3 linea!J4" },
  { id: "ide", name: "Ide-cel (KARMMA-4)", price: 318000, source: "Excel · 3 linea!J7" },
];

/* ---------------- Pacientes ficticios ---------------- */
export const PATIENTS_DEMO = [
  { code: "DEMO-001", age: 68, weight: 88, height: 1.6, scMethod: "mosteller", scOverride: 0, line: "1N", transplant: "no candidato", renal: "", comorb: "Caso ficticio que reproduce Peso 88 kg / Talla 1,60 m del Excel", prior: [], goal: "Comparar Isa-VRD, D-VRD y DRD", visits: [{ date: "2026-11-02", weight: 88, height: 1.6, note: "Visita basal (ficticia)" }] },
  { code: "DEMO-002", age: 61, weight: 62, height: 1.68, scMethod: "mosteller", scOverride: 0, line: "1C", transplant: "candidato", renal: "", comorb: "Caso ficticio con peso < 62 kg", prior: [], goal: "Vía IV vs SC", visits: [{ date: "2026-11-05", weight: 62, height: 1.68, note: "Visita basal (ficticia)" }] },
  { code: "DEMO-003", age: 72, weight: 76, height: 1.72, scMethod: "mosteller", scOverride: 0, line: "2", transplant: "no candidato", renal: "", comorb: "Caso ficticio refractario a lenalidomida", prior: ["Lenalidomida (refractario)", "Bortezomib"], goal: "Plan de 2ª línea", visits: [{ date: "2026-11-09", weight: 76, height: 1.72, note: "Visita basal (ficticia)" }] },
];

export const CONFIG_DEFAULT = { center: "Servicio de Farmacia · Centro de demostración", header: "MieloFarma · Informe de cálculo farmacoterapéutico", author: "", reviewer: "", footer: "Documento de apoyo. Los resultados económicos no implican superioridad terapéutica ni recomendación clínica." };
