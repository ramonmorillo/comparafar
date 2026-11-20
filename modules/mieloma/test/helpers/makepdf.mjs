// Generador mínimo de PDF SINTÉTICOS para pruebas (texto en posiciones absolutas o página solo-imagen).
// No contiene datos reales de ningún documento de Oncofar ni de pacientes.
// pages: [{ items: [{ x, y, text, size? }] } | { image: true }]. Coordenadas en puntos con origen abajo-izquierda (A4 595×842).
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const latin1 = (s) => Buffer.from(s, "latin1");
export function makePdf(pages) {
  const objs = []; const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null), pagesObj = add(null), font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pageIds = [];
  for (const pg of pages) {
    let content, res = `/Font << /F1 ${font} 0 R >>`;
    if (pg.image) {
      const img = add(`<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 4 >>\nstream\n\u0000ÿÿ\u0000\nendstream`);
      res += ` /XObject << /Im1 ${img} 0 R >>`;
      content = "q 400 0 0 600 50 100 cm /Im1 Do Q";
    } else content = pg.items.map((it) => `BT /F1 ${it.size || 9} Tf ${it.x} ${it.y} Td (${esc(it.text)}) Tj ET`).join("\n");
    const cid = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << ${res} >> /Contents ${cid} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => i + " 0 R").join(" ")}] /Count ${pageIds.length} >>`;
  const parts = [latin1("%PDF-1.4\n")]; const offs = []; let pos = parts[0].length;
  objs.forEach((b, i) => { const s = latin1(`${i + 1} 0 obj\n${b}\nendobj\n`); offs.push(pos); parts.push(s); pos += s.length; });
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  xref += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(latin1(xref));
  return new Uint8Array(Buffer.concat(parts));
}
