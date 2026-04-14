const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ═══════════════════════════════════════════════
// 1. EXPORT MEETING MINUTES TO WORD
// ═══════════════════════════════════════════════
router.get('/:projectId/minutes/:minuteId/export-word', async (req, res) => {
  try {
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
            HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
            Header, Footer, PageNumber, LevelFormat, ImageRun } = require('docx');

    // Load data
    const [minutes] = await pool.execute('SELECT * FROM meeting_minutes WHERE id=? AND project_id=?', [req.params.minuteId, req.params.projectId]);
    if (minutes.length === 0) return res.status(404).json({ error: 'Acta no encontrada' });
    const m = minutes[0];

    const [project] = await pool.execute('SELECT name, code, contract_number FROM projects WHERE id=?', [req.params.projectId]);
    const p = project[0] || {};

    // Load completed digital signatures (if any)
    let digitalSigners = [];
    try {
      const [sigReqs] = await pool.execute(
        "SELECT id FROM signature_requests WHERE minute_id=? AND status='completed' ORDER BY completed_at DESC LIMIT 1",
        [m.id]
      );
      if (sigReqs.length) {
        const [sigRows] = await pool.execute(
          "SELECT signer_name,signer_role,signer_email,signature_image,signed_at,ip_address FROM signature_signers WHERE request_id=? AND status='signed' ORDER BY sign_order",
          [sigReqs[0].id]
        );
        digitalSigners = sigRows;
      }
    } catch { /* signatures table may not exist in older installs */ }

    // Safe JSON parse (mysql2 auto-parses JSON columns → may already be arrays)
    function safeJSON(v) {
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') return v;
      if (!v) return [];
      if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
      return [];
    }

    const attendees = safeJSON(m.attendees);
    const agreements = safeJSON(m.agreements);
    const commitments = safeJSON(m.action_items);

    const border = { style: BorderStyle.SINGLE, size: 1, color: "999999" };
    const borders = { top: border, bottom: border, left: border, right: border };
    const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };
    const headerShading = { fill: "1B3A5C", type: ShadingType.CLEAR };
    const altShading = { fill: "F0F4F8", type: ShadingType.CLEAR };

    const doc = new Document({
      styles: {
        default: { document: { run: { font: "Arial", size: 22 } } },
        paragraphStyles: [
          { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
            run: { size: 28, bold: true, font: "Arial", color: "1B3A5C" },
            paragraph: { spacing: { before: 300, after: 200 } } },
          { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
            run: { size: 24, bold: true, font: "Arial", color: "2E5A88" },
            paragraph: { spacing: { before: 200, after: 120 } } },
        ]
      },
      numbering: {
        config: [{
          reference: "bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
        }]
      },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 }
          }
        },
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: `${p.code || ''} — SGIP-IA`, font: "Arial", size: 16, color: "999999", italics: true })]
            })]
          })
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "Página ", font: "Arial", size: 16, color: "999999" }),
                new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: "999999" }),
              ]
            })]
          })
        },
        children: [
          // Title
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [
            new TextRun({ text: "ACTA DE REUNIÓN", bold: true, size: 36, font: "Arial", color: "1B3A5C" })
          ]}),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [
            new TextRun({ text: p.name || 'Proyecto', size: 24, font: "Arial", color: "555555" })
          ]}),

          // Info table
          new Table({
            width: { size: 10080, type: WidthType.DXA },
            columnWidths: [3000, 7080],
            rows: [
              infoRow("Número de acta", m.minute_number || `ACTA-${m.id}`, borders, cellMargins),
              infoRow("Fecha", m.meeting_date ? new Date(m.meeting_date).toLocaleDateString('es-CO', { year:'numeric', month:'long', day:'numeric' }) : 'N/A', borders, cellMargins),
              infoRow("Hora inicio", m.start_time || 'N/A', borders, cellMargins),
              infoRow("Hora fin", m.end_time || 'N/A', borders, cellMargins),
              infoRow("Lugar", m.location || 'N/A', borders, cellMargins),
              infoRow("Tipo de reunión", (m.meeting_type || '').replace(/_/g, ' '), borders, cellMargins),
              infoRow("Contrato", p.contract_number || 'N/A', borders, cellMargins),
            ]
          }),

          new Paragraph({ spacing: { before: 300 } }),

          // Attendees
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("1. ASISTENTES")] }),
          ...(attendees.length > 0 ? [
            new Table({
              width: { size: 10080, type: WidthType.DXA },
              columnWidths: [3500, 3500, 3080],
              rows: [
                new TableRow({ children: ['Nombre', 'Cargo/Entidad', 'Rol'].map(h =>
                  new TableCell({ borders, shading: headerShading, margins: cellMargins, width: { size: 3360, type: WidthType.DXA },
                    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: "FFFFFF", size: 20 })] })]
                  })
                )}),
                ...attendees.map((a, i) => new TableRow({ children: [
                  textCell(a.name || a, borders, cellMargins, i % 2 === 1 ? altShading : null),
                  textCell(a.entity || a.cargo || '', borders, cellMargins, i % 2 === 1 ? altShading : null),
                  textCell(a.role || '', borders, cellMargins, i % 2 === 1 ? altShading : null),
                ]}))
              ]
            })
          ] : [new Paragraph({ children: [new TextRun({ text: "No se registraron asistentes.", italics: true, color: "888888" })] })]),

          new Paragraph({ spacing: { before: 200 } }),

          // Topics / Agenda
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("2. TEMAS TRATADOS")] }),
          ...(m.agenda ? m.agenda.split('\n').filter(l => l.trim()).map(line =>
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ text: line.trim(), size: 22 })] })
          ) : [new Paragraph({ children: [new TextRun({ text: "Sin temas registrados.", italics: true, color: "888888" })] })]),

          new Paragraph({ spacing: { before: 200 } }),

          // Discussion
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("3. DESARROLLO DE LA REUNIÓN")] }),
          ...(m.discussions ? m.discussions.split('\n').filter(l => l.trim()).map(line =>
            new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: line.trim(), size: 22 })] })
          ) : [new Paragraph({ children: [new TextRun({ text: "Sin registro de desarrollo.", italics: true, color: "888888" })] })]),

          new Paragraph({ spacing: { before: 200 } }),

          // Acuerdos
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("4. ACUERDOS")] }),
          ...(agreements.length > 0 ? agreements.map(a =>
            new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ text: typeof a === 'string' ? a : (a.description || JSON.stringify(a)), size: 22 })] })
          ) : [new Paragraph({ children: [new TextRun({ text: "Sin acuerdos registrados.", italics: true, color: "888888" })] })]),

          new Paragraph({ spacing: { before: 200 } }),

          // Commitments
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("5. COMPROMISOS")] }),
          ...(commitments.length > 0 ? [
            new Table({
              width: { size: 10080, type: WidthType.DXA },
              columnWidths: [4000, 2500, 2000, 1580],
              rows: [
                new TableRow({ children: ['Compromiso', 'Responsable', 'Fecha límite', 'Estado'].map(h =>
                  new TableCell({ borders, shading: headerShading, margins: cellMargins, width: { size: 2520, type: WidthType.DXA },
                    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: "FFFFFF", size: 20 })] })]
                  })
                )}),
                ...commitments.map((c, i) => new TableRow({ children: [
                  textCell(c.task || c.description || c.compromiso || '', borders, cellMargins, i % 2 === 1 ? altShading : null),
                  textCell(c.responsible || c.responsable || '', borders, cellMargins, i % 2 === 1 ? altShading : null),
                  textCell(c.due_date || c.fecha || '', borders, cellMargins, i % 2 === 1 ? altShading : null),
                  textCell(c.status || c.estado || 'Pendiente', borders, cellMargins, i % 2 === 1 ? altShading : null),
                ]}))
              ]
            })
          ] : [new Paragraph({ children: [new TextRun({ text: "Sin compromisos registrados.", italics: true, color: "888888" })] })]),

          // Next meeting
          ...(m.next_meeting_date ? [
            new Paragraph({ spacing: { before: 300 } }),
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("6. PRÓXIMA REUNIÓN")] }),
            new Paragraph({ children: [new TextRun({ text: `Fecha: ${new Date(m.next_meeting_date).toLocaleDateString('es-CO')}`, size: 22 })] }),
          ] : []),

          // ── Signatures section ───────────────────────────────────────
          new Paragraph({ spacing: { before: 500 } }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [
            new TextRun(digitalSigners.length
              ? `${m.next_meeting_date ? '7' : '6'}. FIRMAS DIGITALES`
              : `${m.next_meeting_date ? '7' : '6'}. FIRMAS`)
          ]}),
          ...(digitalSigners.length > 0
            ? [
                new Paragraph({ spacing: { after: 200 }, children: [
                  new TextRun({ text: 'Documento firmado electrónicamente con validez legal conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012 de Colombia.', size: 18, italics: true, color: '444444' })
                ]}),
                new Table({
                  width: { size: 10080, type: WidthType.DXA },
                  columnWidths: Array(Math.min(digitalSigners.length, 3)).fill(Math.floor(10080 / Math.min(digitalSigners.length, 3))),
                  rows: (() => {
                    const rows = [];
                    // Row 1: signature images
                    rows.push(new TableRow({
                      children: digitalSigners.slice(0, 3).map(s => {
                        const imgChildren = [];
                        if (s.signature_image) {
                          try {
                            const b64 = s.signature_image.replace(/^data:image\/\w+;base64,/, '');
                            imgChildren.push(new ImageRun({ data: Buffer.from(b64, 'base64'), transformation: { width: 180, height: 70 }, type: 'png' }));
                          } catch { imgChildren.push(new TextRun({ text: '[firma]', italics: true, color: '999999' })); }
                        }
                        return new TableCell({
                          borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: '1B3A5C' }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                          margins: { top: 80, bottom: 80, left: 120, right: 120 },
                          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 100 }, children: imgChildren.length ? imgChildren : [new TextRun({ text: ' ', size: 22 })] })]
                        });
                      })
                    }));
                    // Row 2: name, role, date, IP
                    rows.push(new TableRow({
                      children: digitalSigners.slice(0, 3).map(s => new TableCell({
                        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                        margins: { top: 60, bottom: 60, left: 120, right: 120 },
                        children: [
                          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s.signer_name, bold: true, size: 20 })] }),
                          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s.signer_role || 'Firmante', size: 18, color: '555555' })] }),
                          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s.signed_at ? new Date(s.signed_at).toLocaleString('es-CO') : '', size: 16, color: '888888' })] }),
                          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s.ip_address ? `IP: ${s.ip_address}` : '', size: 14, color: 'aaaaaa' })] }),
                        ]
                      }))
                    }));
                    return rows;
                  })()
                }),
              ]
            : [
                new Paragraph({ spacing: { before: 400 } }),
                new Table({
                  width: { size: 10080, type: WidthType.DXA },
                  columnWidths: [3360, 3360, 3360],
                  rows: [
                    new TableRow({ children: ['Elaboró', 'Revisó', 'Aprobó'].map(() =>
                      new TableCell({
                        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.SINGLE, size: 2, color: '000000' }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                        margins: { top: 200, bottom: 60, left: 100, right: 100 },
                        children: [new Paragraph({ children: [new TextRun({ text: ' ', size: 22 })] })]
                      })
                    )}),
                    new TableRow({ children: ['Elaboró', 'Revisó', 'Aprobó'].map(label =>
                      new TableCell({
                        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                        margins: { top: 60, bottom: 60, left: 100, right: 100 },
                        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: label, size: 18, color: '888888', bold: true })] })]
                      })
                    )})
                  ]
                }),
              ]
          ),
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `Acta_${m.minute_number || m.id}_${p.code || 'proyecto'}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Export minute Word error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════
// 2. EXPORT AI-GENERATED DOCUMENT TO WORD
// ═══════════════════════════════════════════════
router.post('/:projectId/export-word', async (req, res) => {
  try {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
            BorderStyle, Header, Footer, PageNumber, LevelFormat } = require('docx');

    const { title, content } = req.body;
    if (!content) return res.status(400).json({ error: 'Contenido requerido' });

    const [project] = await pool.execute('SELECT name, code FROM projects WHERE id=?', [req.params.projectId]);
    const p = project[0] || {};

    // Parse markdown-like content into docx paragraphs
    const children = parseContentToDocx(content, { Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat });

    const doc = new Document({
      styles: {
        default: { document: { run: { font: "Arial", size: 22 } } },
        paragraphStyles: [
          { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
            run: { size: 28, bold: true, font: "Arial", color: "1B3A5C" },
            paragraph: { spacing: { before: 300, after: 200 }, outlineLevel: 0 } },
          { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
            run: { size: 24, bold: true, font: "Arial", color: "2E5A88" },
            paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 } },
          { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
            run: { size: 22, bold: true, font: "Arial", color: "3D6FA5" },
            paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
        ]
      },
      numbering: {
        config: [
          { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
          { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        ]
      },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 }
          }
        },
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: `${p.code || ''} — SGIP-IA`, font: "Arial", size: 16, color: "999999", italics: true })]
            })]
          })
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "Página ", font: "Arial", size: 16, color: "999999" }),
                new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: "999999" }),
              ]
            })]
          })
        },
        children: [
          // Title
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [
            new TextRun({ text: title || 'Documento generado por IA', bold: true, size: 36, font: "Arial", color: "1B3A5C" })
          ]}),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [
            new TextRun({ text: p.name || '', size: 22, color: "555555" })
          ]}),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [
            new TextRun({ text: `Generado el ${new Date().toLocaleDateString('es-CO', { year:'numeric', month:'long', day:'numeric' })}`, size: 18, color: "888888", italics: true })
          ]}),
          // Content
          ...children,
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `${(title || 'documento').replace(/[^a-zA-Z0-9áéíóúñ ]/gi, '').substring(0, 50)}_${p.code || ''}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Export AI Word error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════
// 3. EXPORT BUDGET TO EXCEL
// ═══════════════════════════════════════════════
router.get('/:projectId/budget/export-excel', async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const pid = req.params.projectId;

    const [project] = await pool.execute('SELECT * FROM projects WHERE id=?', [pid]);
    if (project.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const p = project[0];

    // Load budget data
    const [income] = await pool.execute('SELECT * FROM budget_income WHERE project_id=? ORDER BY sort_order', [pid]);
    const [payroll] = await pool.execute('SELECT * FROM budget_payroll WHERE project_id=? ORDER BY sort_order', [pid]);
    const [contractors] = await pool.execute('SELECT * FROM budget_contractors WHERE project_id=? ORDER BY sort_order', [pid]);
    const [expenses] = await pool.execute('SELECT * FROM budget_expenses WHERE project_id=? ORDER BY category, label', [pid]);

    let payments = [];
    try { const [pay] = await pool.execute('SELECT * FROM payments WHERE project_id=? ORDER BY payment_date', [pid]); payments = pay; } catch {}

    const wb = new ExcelJS.Workbook();
    wb.creator = 'SGIP-IA';
    wb.created = new Date();

    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A5C' } };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Arial' };
    const bodyFont = { size: 10, name: 'Arial' };
    const currencyFmt = '"$"#,##0';
    const pctFmt = '0.0%';

    // Income total — source of truth: budget_income_schedule (pagos reales)
    let scheduleRows = [];
    try { const [sr] = await pool.execute('SELECT valor_con_iva FROM budget_income_schedule WHERE project_id=? ORDER BY sort_order', [pid]); scheduleRows = sr; } catch {}
    const totalIncome = scheduleRows.length > 0
      ? scheduleRows.reduce((s,r)=>s+parseFloat(r.valor_con_iva||0),0)
      : income.reduce((s, i) => s + parseFloat(i.value || 0), 0); // fallback if no schedule
    const totalPayroll = payroll.reduce((s, i) => s + parseFloat(i.costo_total || 0), 0);
    const totalContractors = contractors.reduce((s, i) => s + parseFloat(i.costo_total || 0), 0);
    const totalExpenses = expenses.reduce((s, i) => s + parseFloat(i.valor_total || 0), 0);
    const totalEgresos = totalPayroll + totalContractors + totalExpenses;
    const margen = totalIncome - totalEgresos;

    // ── Sheet 1: Resumen ──
    const ws1 = wb.addWorksheet('Resumen', { properties: { tabColor: { argb: '1B3A5C' } } });
    ws1.columns = [{ width: 30 }, { width: 25 }];
    ws1.addRow(['RESUMEN PRESUPUESTAL']).font = { bold: true, size: 14, name: 'Arial', color: { argb: 'FF1B3A5C' } };
    ws1.addRow([]);
    ws1.addRow(['Proyecto', p.name]);
    ws1.addRow(['Código', p.code]);
    ws1.addRow(['Contrato', p.contract_number || 'N/A']);
    ws1.addRow(['Valor del contrato', parseFloat(p.contract_value || 0)]); ws1.getCell('B6').numFmt = currencyFmt;
    ws1.addRow([]);
    ws1.addRow(['Total Ingresos', totalIncome]); ws1.getCell('B8').numFmt = currencyFmt;
    ws1.addRow(['Nómina', totalPayroll]); ws1.getCell('B9').numFmt = currencyFmt;
    ws1.addRow(['Contratistas', totalContractors]); ws1.getCell('B10').numFmt = currencyFmt;
    ws1.addRow(['Gastos operativos', totalExpenses]); ws1.getCell('B11').numFmt = currencyFmt;
    ws1.addRow(['Total Egresos', totalEgresos]); ws1.getCell('B12').numFmt = currencyFmt;
    ws1.getRow(12).font = { bold: true, size: 11, name: 'Arial' };
    ws1.addRow(['Margen', margen]); ws1.getCell('B13').numFmt = currencyFmt;
    ws1.getRow(13).font = { bold: true, size: 11, name: 'Arial', color: { argb: margen >= 0 ? 'FF27AE60' : 'FFE74C3C' } };
    ws1.addRow([]);
    ws1.addRow(['Fecha de exportación', new Date().toLocaleDateString('es-CO')]);

    // ── Sheet 2: Ingresos ──
    const ws2 = wb.addWorksheet('Ingresos', { properties: { tabColor: { argb: '27AE60' } } });
    ws2.columns = [{ width: 35 }, { width: 20 }, { width: 30 }];
    ws2.addRow(['Concepto', 'Valor', 'Notas']);
    ws2.getRow(1).eachCell(c => { c.fill = headerFill; c.font = headerFont; c.alignment = { horizontal: 'center' }; });
    income.forEach((item, i) => {
      const row = ws2.addRow([item.label, parseFloat(item.value || 0), item.notes || '']);
      row.eachCell(c => { c.font = bodyFont; });
      row.getCell(2).numFmt = currencyFmt;
      if (i % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } }; });
    });
    const incTotalRow = ws2.addRow(['TOTAL', totalIncome, '']);
    incTotalRow.eachCell(c => { c.font = { ...bodyFont, bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF0' } }; });
    incTotalRow.getCell(2).numFmt = currencyFmt;

    // ── Sheet 3: Nómina ──
    const ws3 = wb.addWorksheet('Nómina', { properties: { tabColor: { argb: '3498DB' } } });
    ws3.columns = [{ width: 25 }, { width: 8 }, { width: 15 }, { width: 12 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 15 }];
    ws3.addRow(['Cargo', 'Cant.', 'Salario Base', 'Aux. Transp.', 'Mes Ini', 'Mes Fin', 'Meses', 'Costo Total']);
    ws3.getRow(1).eachCell(c => { c.fill = headerFill; c.font = headerFont; c.alignment = { horizontal: 'center' }; });
    payroll.forEach((item, i) => {
      const row = ws3.addRow([
        item.cargo, item.cantidad, parseFloat(item.salario_base || 0), parseFloat(item.aux_transporte || 0),
        item.mes_inicio, item.mes_fin, item.meses || '', parseFloat(item.costo_total || 0)
      ]);
      row.eachCell(c => { c.font = bodyFont; });
      row.getCell(3).numFmt = currencyFmt;
      row.getCell(4).numFmt = currencyFmt;
      row.getCell(8).numFmt = currencyFmt;
      if (i % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } }; });
    });
    const payTotalRow = ws3.addRow(['TOTAL', '', '', '', '', '', '', totalPayroll]);
    payTotalRow.eachCell(c => { c.font = { ...bodyFont, bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF0' } }; });
    payTotalRow.getCell(8).numFmt = currencyFmt;

    // ── Sheet 4: Contratistas ──
    const ws4 = wb.addWorksheet('Contratistas', { properties: { tabColor: { argb: 'E67E22' } } });
    ws4.columns = [{ width: 25 }, { width: 20 }, { width: 8 }, { width: 15 }, { width: 8 }, { width: 8 }, { width: 15 }];
    ws4.addRow(['Cargo/Rol', 'Tipo Contrato', 'Cant.', 'Valor Unit.', 'Mes Ini', 'Mes Fin', 'Costo Total']);
    ws4.getRow(1).eachCell(c => { c.fill = headerFill; c.font = headerFont; c.alignment = { horizontal: 'center' }; });
    contractors.forEach((item, i) => {
      const row = ws4.addRow([
        item.cargo, item.tipo_contrato || '', item.cantidad, parseFloat(item.valor_unitario || 0),
        item.mes_inicio, item.mes_fin, parseFloat(item.costo_total || 0)
      ]);
      row.eachCell(c => { c.font = bodyFont; });
      row.getCell(4).numFmt = currencyFmt;
      row.getCell(7).numFmt = currencyFmt;
      if (i % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } }; });
    });
    const conTotalRow = ws4.addRow(['TOTAL', '', '', '', '', '', totalContractors]);
    conTotalRow.eachCell(c => { c.font = { ...bodyFont, bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF0' } }; });
    conTotalRow.getCell(7).numFmt = currencyFmt;

    // ── Sheet 5: Gastos Operativos ──
    const ws5 = wb.addWorksheet('Gastos Operativos', { properties: { tabColor: { argb: 'E74C3C' } } });
    ws5.columns = [{ width: 22 }, { width: 30 }, { width: 15 }, { width: 8 }, { width: 15 }];
    ws5.addRow(['Categoría', 'Concepto', 'Valor Unitario', 'Meses', 'Valor Total']);
    ws5.getRow(1).eachCell(c => { c.fill = headerFill; c.font = headerFont; c.alignment = { horizontal: 'center' }; });
    expenses.forEach((item, i) => {
      const row = ws5.addRow([
        item.category || '', item.label, parseFloat(item.valor_unitario || 0),
        item.meses || '', parseFloat(item.valor_total || 0)
      ]);
      row.eachCell(c => { c.font = bodyFont; });
      row.getCell(3).numFmt = currencyFmt;
      row.getCell(5).numFmt = currencyFmt;
      if (i % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } }; });
    });
    const expTotalRow = ws5.addRow(['', 'TOTAL', '', '', totalExpenses]);
    expTotalRow.eachCell(c => { c.font = { ...bodyFont, bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF0' } }; });
    expTotalRow.getCell(5).numFmt = currencyFmt;

    // ── Sheet 6: Pagos (if any) ──
    if (payments.length > 0) {
      const ws6 = wb.addWorksheet('Pagos', { properties: { tabColor: { argb: '8E44AD' } } });
      ws6.columns = [{ width: 10 }, { width: 15 }, { width: 35 }, { width: 18 }, { width: 20 }, { width: 15 }];
      ws6.addRow(['# Pago', 'Fecha', 'Concepto', 'Monto', 'Factura', 'Estado']);
      ws6.getRow(1).eachCell(c => { c.fill = headerFill; c.font = headerFont; c.alignment = { horizontal: 'center' }; });
      payments.forEach((pay, i) => {
        const row = ws6.addRow([
          pay.payment_number || i + 1,
          pay.payment_date ? new Date(pay.payment_date).toLocaleDateString('es-CO') : '',
          pay.concept || '', parseFloat(pay.amount || 0),
          pay.invoice_number || '', pay.status || ''
        ]);
        row.eachCell(c => { c.font = bodyFont; });
        row.getCell(4).numFmt = currencyFmt;
        if (i % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } }; });
      });
    }

    // ── Sheet: Estado de Resultados (PUC) ──
    let pucAccounts = [], deductions = [];
    try { const [r] = await pool.execute('SELECT * FROM budget_puc_accounts WHERE project_id=? ORDER BY sort_order,cuenta', [pid]); pucAccounts = r; } catch {}
    try { const [r] = await pool.execute('SELECT * FROM budget_deductions WHERE project_id=? ORDER BY sort_order', [pid]); deductions = r; } catch {}

    const wsER = wb.addWorksheet('Estado de Resultados', { properties: { tabColor: { argb: '1B3A5C' } } });
    wsER.columns = [{ width: 8 }, { width: 35 }, { width: 22 }];
    
    const titleFont = { bold: true, size: 12, name: 'Arial', color: { argb: 'FF1B3A5C' } };
    const subtotalFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF0' } };
    const resultFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    const greenFont = { bold: true, size: 11, name: 'Arial', color: { argb: 'FF27AE60' } };
    const redFont = { bold: true, size: 11, name: 'Arial', color: { argb: 'FFE74C3C' } };

    wsER.addRow(['', 'ESTADO DE RESULTADOS DEL PROYECTO', '']).font = titleFont;
    wsER.addRow(['', p.name || '', '']);
    wsER.addRow(['', `Código: ${p.code || ''}`, '']);
    wsER.addRow([]);

    wsER.addRow(['Nº Cuenta', 'Nombre', 'Total']).eachCell(c => { c.fill = headerFill; c.font = headerFont; c.alignment = { horizontal: 'center' }; });

    // Ingresos
    const ingresosSinIva = income.filter(r => !r.es_iva && !r.es_total_con_iva && r.tipo === 'ingreso').reduce((s, r) => s + parseFloat(r.value||0), 0);
    const ivaTotal = income.filter(r => r.es_iva).reduce((s, r) => s + parseFloat(r.value||0), 0);
    const totalConIva = ingresosSinIva + ivaTotal;

    const r4 = wsER.addRow(['4', 'INGRESOS', totalConIva]);
    r4.font = { bold: true, size: 11, name: 'Arial' }; r4.getCell(3).numFmt = currencyFmt; r4.eachCell(c => { c.fill = subtotalFill; });
    const r41 = wsER.addRow(['41', 'Operacionales', totalConIva]);
    r41.font = { bold: true, size: 10, name: 'Arial' }; r41.getCell(3).numFmt = currencyFmt;

    // Gastos
    const totalPayrollAll = parseFloat(payroll.reduce((s,i)=>s+parseFloat(i.costo_total||0),0));
    const totalContractorsAll = parseFloat(contractors.reduce((s,i)=>s+parseFloat(i.costo_total||0),0));
    const totalExpensesAll = parseFloat(expenses.reduce((s,i)=>s+parseFloat(i.valor_total||0),0));
    const totalPucOnly = pucAccounts.filter(a=>a.cuenta.startsWith('5')&&!a.es_subtotal).reduce((s,a)=>s+parseFloat(a.valor||0),0);
    const totalGastos = totalPucOnly + totalPayrollAll + totalContractorsAll + totalExpensesAll;

    wsER.addRow([]);
    const r5 = wsER.addRow(['5', 'GASTOS', totalGastos]);
    r5.font = { bold: true, size: 11, name: 'Arial' }; r5.getCell(3).numFmt = currencyFmt; r5.eachCell(c => { c.fill = subtotalFill; });

    // PUC sub-accounts
    for (const a of pucAccounts) {
      if (a.cuenta === '4' || a.cuenta === '41' || a.cuenta === '5') continue;
      const val = parseFloat(a.valor || 0);
      const row = wsER.addRow([a.cuenta, a.nombre, val]);
      row.getCell(3).numFmt = currencyFmt;
      row.eachCell(c => { c.font = bodyFont; });
      if (a.es_subtotal) { row.font = { bold: true, size: 10, name: 'Arial' }; row.eachCell(c => { c.fill = subtotalFill; }); }
    }

    // Extra from budget tables
    if (totalPayrollAll > 0) { const r = wsER.addRow(['', 'Nómina (detalle en hoja)', totalPayrollAll]); r.getCell(3).numFmt = currencyFmt; r.font = bodyFont; }
    if (totalContractorsAll > 0) { const r = wsER.addRow(['', 'Contratistas (detalle en hoja)', totalContractorsAll]); r.getCell(3).numFmt = currencyFmt; r.font = bodyFont; }
    if (totalExpensesAll > 0) { const r = wsER.addRow(['', 'Gastos operativos (detalle en hoja)', totalExpensesAll]); r.getCell(3).numFmt = currencyFmt; r.font = bodyFont; }

    // Ganancia Contable
    wsER.addRow([]);
    const gc = totalConIva - totalGastos;
    const rGC = wsER.addRow(['UC', 'GANANCIA CONTABLE (4-5)', gc]);
    rGC.font = gc >= 0 ? greenFont : redFont; rGC.getCell(3).numFmt = currencyFmt; rGC.eachCell(c => { c.fill = resultFill; });

    // Deductions
    const retDed = deductions.filter(d => d.tipo === 'retencion');
    const afDed = deductions.filter(d => d.tipo === 'activo_fijo');
    const gncDed = deductions.filter(d => d.tipo === 'gnc');
    const retTotal = retDed.reduce((s,d) => s + parseFloat(d.valor||0), 0);
    const afTotal = afDed.reduce((s,d) => s + parseFloat(d.valor||0), 0);
    const gncTotal = gncDed.reduce((s,d) => s + parseFloat(d.valor||0), 0);

    for (const d of retDed) { const r = wsER.addRow(['R', d.nombre, parseFloat(d.valor||0)]); r.getCell(3).numFmt = currencyFmt; r.font = bodyFont; }
    for (const d of afDed) { const r = wsER.addRow(['AF', d.nombre, parseFloat(d.valor||0)]); r.getCell(3).numFmt = currencyFmt; r.font = bodyFont; }

    const gd = gc - retTotal - afTotal;
    wsER.addRow([]);
    const rGD = wsER.addRow(['UD', 'GANANCIA DISTRIBUIBLE (4-5-R-AF)', gd]);
    rGD.font = gd >= 0 ? greenFont : redFont; rGD.getCell(3).numFmt = currencyFmt; rGD.eachCell(c => { c.fill = resultFill; });

    for (const d of gncDed) { const r = wsER.addRow(['GNC', d.nombre, parseFloat(d.valor||0)]); r.getCell(3).numFmt = currencyFmt; r.font = bodyFont; }

    const gr = gd - gncTotal;
    const rGR = wsER.addRow(['UR', 'GANANCIA REAL (4-5-GNC)', gr]);
    rGR.font = gr >= 0 ? greenFont : redFont; rGR.getCell(3).numFmt = currencyFmt; rGR.eachCell(c => { c.fill = { type:'pattern',pattern:'solid',fgColor:{argb:'FF00FF00'} }; });

    // Percentages
    wsER.addRow([]);
    wsER.addRow(['', 'GANANCIA CONTABLE (4-5)', totalConIva > 0 ? `${(gc/totalConIva*100).toFixed(2)}%` : '0%']);
    wsER.addRow(['', 'GANANCIA DISTRIBUIBLE (4-5-R-AF)', totalConIva > 0 ? `${(gd/totalConIva*100).toFixed(2)}%` : '0%']);
    wsER.addRow(['', 'GANANCIA REAL (4-5-GNC)', totalConIva > 0 ? `${(gr/totalConIva*100).toFixed(2)}%` : '0%']);

    const buffer = await wb.xlsx.writeBuffer();
    const filename = `Presupuesto_${p.code || 'proyecto'}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Export budget Excel error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══ HELPERS ═══

function infoRow(label, value, borders, margins) {
  const { TableRow, TableCell, Paragraph, TextRun, WidthType, ShadingType } = require('docx');
  return new TableRow({ children: [
    new TableCell({ borders, margins, width: { size: 3000, type: WidthType.DXA },
      shading: { fill: "E8ECF0", type: ShadingType.CLEAR },
      children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: "Arial", color: "333333" })] })]
    }),
    new TableCell({ borders, margins, width: { size: 7080, type: WidthType.DXA },
      children: [new Paragraph({ children: [new TextRun({ text: value || '', size: 20, font: "Arial" })] })]
    }),
  ]});
}

function textCell(text, borders, margins, shading) {
  const { TableCell, Paragraph, TextRun, WidthType } = require('docx');
  const opts = { borders, margins, width: { size: 2520, type: WidthType.DXA },
    children: [new Paragraph({ children: [new TextRun({ text: text || '', size: 20, font: "Arial" })] })] };
  if (shading) opts.shading = shading;
  return new TableCell(opts);
}

function parseContentToDocx(content, { Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat }) {
  const children = [];
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { children.push(new Paragraph({ spacing: { after: 80 } })); continue; }

    // Headers
    if (trimmed.startsWith('#### ')) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(trimmed.slice(5))] }));
    } else if (trimmed.startsWith('### ')) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(trimmed.slice(4))] }));
    } else if (trimmed.startsWith('## ')) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(trimmed.slice(3))] }));
    } else if (trimmed.startsWith('# ')) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(trimmed.slice(2))] }));
    }
    // Horizontal rule
    else if (trimmed === '---') {
      children.push(new Paragraph({ border: { bottom: { style: require('docx').BorderStyle.SINGLE, size: 1, color: "CCCCCC" } }, spacing: { after: 200 } }));
    }
    // Bullet points
    else if (/^[-–•]\s/.test(trimmed)) {
      children.push(new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: parseBoldItalic(trimmed.replace(/^[-–•]\s/, ''), TextRun)
      }));
    }
    // Numbered list
    else if (/^\d+\.\s/.test(trimmed)) {
      children.push(new Paragraph({
        numbering: { reference: "numbers", level: 0 },
        children: parseBoldItalic(trimmed.replace(/^\d+\.\s/, ''), TextRun)
      }));
    }
    // Normal paragraph
    else {
      children.push(new Paragraph({ spacing: { after: 100 }, children: parseBoldItalic(trimmed, TextRun) }));
    }
  }
  return children;
}

function parseBoldItalic(text, TextRun) {
  const runs = [];
  const parts = text.split(/(\*\*.*?\*\*)/g);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true, size: 22, font: "Arial" }));
    } else {
      runs.push(new TextRun({ text: part, size: 22, font: "Arial" }));
    }
  }
  return runs;
}

// ═══════════════════════════════════════════════
// 4. EXPORT LIQUIDATION TO WORD (Professional)
// ═══════════════════════════════════════════════
router.get('/:projectId/liquidation/export-word', async (req, res) => {
  try {
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
            HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
            Header, Footer, PageNumber, LevelFormat, PageBreak } = require('docx');

    const pid = req.params.projectId;
    const [liq] = await pool.execute('SELECT * FROM liquidation_records WHERE project_id=?', [pid]);
    if (!liq.length) return res.status(404).json({ error: 'No hay acta de liquidación' });
    const l = liq[0];

    const [proj] = await pool.execute('SELECT name, code, contract_number, client_name, start_date, estimated_end_date, contract_value FROM projects WHERE id=?', [pid]);
    const p = proj[0] || {};

    // Colors
    const DARK = '1B3A5C';
    const ACCENT = '2E75B6';
    const LIGHT = 'E8F0FE';
    const WHITE = 'FFFFFF';
    const GRAY = 'F8F9FA';

    const border = { style: BorderStyle.SINGLE, size: 1, color: 'B0B8C4' };
    const borders = { top: border, bottom: border, left: border, right: border };
    const noBorder = { style: BorderStyle.NONE, size: 0 };
    const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
    const cm = { top: 60, bottom: 60, left: 120, right: 120 };

    const fmtM = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);
    const fmtD = d => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
    const fmtPct = v => `${parseFloat(v || 0).toFixed(1)}%`;

    // Helper: label-value row for info table
    function infoRow(label, value, opts = {}) {
      return new TableRow({ children: [
        new TableCell({ borders: noBorders, width: { size: 3200, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 120, right: 40 },
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, font: 'Arial', color: '555555' })] })] }),
        new TableCell({ borders: noBorders, width: { size: 6160, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 40, right: 120 },
          shading: opts.highlight ? { fill: LIGHT, type: ShadingType.CLEAR } : undefined,
          children: [new Paragraph({ children: [new TextRun({ text: String(value || '—'), size: 20, font: 'Arial', bold: opts.bold, color: opts.color || '222222' })] })] }),
      ]});
    }

    // Helper: financial table row
    function finRow(label, value, opts = {}) {
      return new TableRow({ children: [
        new TableCell({ borders, width: { size: 5460, type: WidthType.DXA }, margins: cm,
          shading: opts.header ? { fill: DARK, type: ShadingType.CLEAR } : opts.highlight ? { fill: LIGHT, type: ShadingType.CLEAR } : opts.alt ? { fill: GRAY, type: ShadingType.CLEAR } : undefined,
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: opts.header || opts.highlight, size: opts.header ? 19 : 20, font: 'Arial', color: opts.header ? WHITE : '222222' })] })] }),
        new TableCell({ borders, width: { size: 3900, type: WidthType.DXA }, margins: cm,
          shading: opts.header ? { fill: DARK, type: ShadingType.CLEAR } : opts.highlight ? { fill: LIGHT, type: ShadingType.CLEAR } : opts.alt ? { fill: GRAY, type: ShadingType.CLEAR } : undefined,
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: opts.header ? value : fmtM(value), bold: opts.header || opts.highlight, size: opts.header ? 19 : 20, font: 'Arial', color: opts.header ? WHITE : opts.highlight ? ACCENT : '222222' })] })] }),
      ]});
    }

    // Header image
    let headerImg = null;
    const imgPath = path.join(__dirname, '../../templates/acta_header.png');
    if (fs.existsSync(imgPath)) {
      headerImg = new ImageRun({ data: fs.readFileSync(imgPath), transformation: { width: 600, height: 192 }, type: 'png' });
    }

    // Balance info
    const balance = parseFloat(l.balance_amount) || 0;
    const balFavor = l.balance_in_favor_of === 'contratista' ? 'A favor del CONTRATISTA' : l.balance_in_favor_of === 'entidad' ? 'A favor de la ENTIDAD' : 'EN EQUILIBRIO';

    const statusText = l.status === 'firmada' ? 'FIRMADA' : l.status === 'archivada' ? 'ARCHIVADA' : 'BORRADOR';

    const doc = new Document({
      styles: {
        default: { document: { run: { font: 'Arial', size: 20 } } },
        paragraphStyles: [
          { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 28, bold: true, font: 'Arial', color: DARK },
            paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 0 } },
          { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 24, bold: true, font: 'Arial', color: ACCENT },
            paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
        ]
      },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 },
          },
        },
        headers: {
          default: new Header({ children: [
            ...(headerImg ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [headerImg] })] : []),
          ]}),
        },
        footers: {
          default: new Footer({ children: [
            new Paragraph({ alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 8 } },
              children: [
                new TextRun({ text: `Acta de Liquidación — ${p.name || 'Proyecto'} — `, size: 16, color: '888888', font: 'Arial' }),
                new TextRun({ text: `Estado: ${statusText}`, size: 16, color: '888888', font: 'Arial', bold: true }),
                new TextRun({ text: '   |   Página ', size: 16, color: '888888', font: 'Arial' }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888', font: 'Arial' }),
                new TextRun({ text: ' de ', size: 16, color: '888888', font: 'Arial' }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '888888', font: 'Arial' }),
              ],
            }),
          ]}),
        },
        children: [
          // ── TITLE ──
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [
            new TextRun({ text: 'ACTA DE LIQUIDACIÓN', bold: true, size: 32, font: 'Arial', color: DARK }),
          ]}),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [
            new TextRun({ text: `${l.liquidation_type === 'bilateral' ? 'BILATERAL' : l.liquidation_type === 'unilateral' ? 'UNILATERAL' : 'JUDICIAL'} DEL CONTRATO`, size: 22, font: 'Arial', color: ACCENT }),
          ]}),

          // ── 1. INFO GENERAL ──
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('1. INFORMACIÓN GENERAL')] }),
          new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [3200, 6160], rows: [
            infoRow('Contrato No.', p.contract_number || p.code),
            infoRow('Proyecto', p.name),
            infoRow('Entidad contratante', p.client_name || '—'),
            infoRow('Tipo de liquidación', l.liquidation_type === 'bilateral' ? 'Bilateral' : l.liquidation_type === 'unilateral' ? 'Unilateral' : 'Judicial'),
            infoRow('Fecha de liquidación', fmtD(l.liquidation_date)),
            infoRow('Estado', statusText, { bold: true, color: l.status === 'firmada' ? '16a34a' : ACCENT }),
          ]}),

          new Paragraph({ spacing: { before: 200 } }),

          // ── 2. PLAZOS Y EJECUCIÓN ──
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('2. PLAZOS Y EJECUCIÓN')] }),
          new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [3200, 6160], rows: [
            infoRow('Fecha inicio original', fmtD(l.original_start_date)),
            infoRow('Fecha fin original', fmtD(l.original_end_date)),
            infoRow('Fecha fin real', fmtD(l.actual_end_date)),
            infoRow('Días de adición', String(l.total_additions_days || 0)),
            infoRow('Días de suspensión', String(l.total_suspension_days || 0)),
            infoRow('Ejecución física', fmtPct(l.physical_completion_pct), { highlight: true, bold: true }),
          ]}),

          new Paragraph({ spacing: { before: 200 } }),

          // ── 3. BALANCE FINANCIERO ──
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('3. BALANCE FINANCIERO')] }),
          new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [5460, 3900], rows: [
            finRow('Concepto', 'Valor', { header: true }),
            finRow('Valor original del contrato', l.original_value),
            finRow('Valor adiciones', l.additions_value, { alt: true }),
            finRow('Valor final del contrato', l.final_contract_value, { highlight: true }),
            finRow('Total pagado', l.total_paid),
            finRow('Retenciones acumuladas', l.total_retained, { alt: true }),
            finRow('Liberación de retenciones', l.retention_release),
          ]}),

          new Paragraph({ spacing: { before: 120 } }),

          // Saldo box
          new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360], rows: [
            new TableRow({ children: [
              new TableCell({ borders, width: { size: 9360, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 200, right: 200 },
                shading: { fill: balance > 0 ? 'FEF3C7' : balance < 0 ? 'FEE2E2' : 'D1FAE5', type: ShadingType.CLEAR },
                children: [
                  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: 'SALDO DE LIQUIDACIÓN', bold: true, size: 20, font: 'Arial', color: '555555' })] }),
                  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: fmtM(balance), bold: true, size: 30, font: 'Arial', color: DARK })] }),
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: balFavor, size: 18, font: 'Arial', color: '666666', italics: true })] }),
                ],
              }),
            ]}),
          ]}),

          new Paragraph({ spacing: { before: 200 } }),

          // ── 4. OBLIGACIONES Y OBSERVACIONES ──
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('4. OBLIGACIONES PENDIENTES Y OBSERVACIONES')] }),

          ...(l.pending_obligations ? [
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Obligaciones pendientes')] }),
            ...l.pending_obligations.split('\n').filter(s => s.trim()).map(line =>
              new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: line.trim(), size: 20, font: 'Arial' })] })
            ),
          ] : []),

          ...(l.contractor_observations ? [
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Observaciones del contratista')] }),
            ...l.contractor_observations.split('\n').filter(s => s.trim()).map(line =>
              new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: line.trim(), size: 20, font: 'Arial' })] })
            ),
          ] : []),

          ...(l.entity_observations ? [
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Observaciones de la entidad')] }),
            ...l.entity_observations.split('\n').filter(s => s.trim()).map(line =>
              new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: line.trim(), size: 20, font: 'Arial' })] })
            ),
          ] : []),

          new Paragraph({ spacing: { before: 300 } }),

          // ── 5. FIRMAS ──
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('5. FIRMAS')] }),
          new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'Las partes firman la presente acta de liquidación en señal de conformidad con su contenido:', size: 20, font: 'Arial', color: '555555' })] }),

          new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [4680, 4680], rows: [
            new TableRow({ children: [
              new TableCell({ borders: noBorders, width: { size: 4680, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 120, right: 120 },
                children: [
                  new Paragraph({ spacing: { before: 400 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '333333' } }, children: [] }),
                  new Paragraph({ spacing: { before: 60 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: l.signed_by_contractor || 'Por el Contratista', bold: true, size: 20, font: 'Arial' })] }),
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'CONTRATISTA', size: 16, font: 'Arial', color: '888888' })] }),
                ],
              }),
              new TableCell({ borders: noBorders, width: { size: 4680, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 120, right: 120 },
                children: [
                  new Paragraph({ spacing: { before: 400 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '333333' } }, children: [] }),
                  new Paragraph({ spacing: { before: 60 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: l.signed_by_entity || 'Por la Entidad', bold: true, size: 20, font: 'Arial' })] }),
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'ENTIDAD CONTRATANTE', size: 16, font: 'Arial', color: '888888' })] }),
                ],
              }),
            ]}),
          ]}),

          new Paragraph({ spacing: { before: 300 }, alignment: AlignmentType.CENTER, children: [
            new TextRun({ text: `Fecha de generación: ${new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })}`, size: 16, font: 'Arial', color: 'AAAAAA', italics: true }),
          ]}),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `Liquidacion_${p.code || pid}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Liquidation export error:', err);
    res.status(500).json({ error: err.message || 'Error exportando liquidación' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// EXPORT OBLIGATIONS TO EXCEL
// ═══════════════════════════════════════════════════════════════════
router.get('/:projectId/obligations/export-excel', async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const pid = req.params.projectId;

    // ── Load project + obligations ──
    const [[project]] = await pool.execute(
      `SELECT p.code, p.name, p.client_name, p.client_nit, p.contract_number,
              p.contract_value, p.start_date, p.execution_term, p.execution_term_unit,
              p.status, p.priority, u.full_name as director_name
       FROM projects p LEFT JOIN users u ON p.director_id = u.id WHERE p.id = ?`, [pid]
    );
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const [obligations] = await pool.execute(`
      SELECT o.*,
        u.full_name  as responsible_name,
        d.file_name  as source_document_name,
        CASE
          WHEN o.status IN ('cumplida','no_aplica')                                                 THEN 'ok'
          WHEN o.due_date IS NOT NULL AND o.due_date < CURDATE()                                    THEN 'overdue'
          WHEN o.due_date IS NOT NULL AND o.due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)         THEN 'urgent'
          WHEN o.due_date IS NOT NULL AND o.due_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)        THEN 'upcoming'
          ELSE 'normal'
        END as alert_level,
        CASE
          WHEN o.due_date IS NOT NULL THEN DATEDIFF(o.due_date, CURDATE())
          ELSE NULL
        END as days_remaining
      FROM obligations o
      LEFT JOIN users u ON o.responsible_user_id = u.id
      LEFT JOIN documents d ON o.source_document_id = d.id
      WHERE o.project_id = ?
      ORDER BY
        FIELD(o.status, 'vencida','pendiente','en_curso','cumplida','no_aplica'),
        o.risk_level = 'alto' DESC,
        o.due_date ASC,
        o.created_at DESC
    `, [pid]);

    // ── Stats ──
    const total    = obligations.length;
    const byStatus = { pendiente:0, en_curso:0, cumplida:0, vencida:0, no_aplica:0 };
    const byRisk   = { alto:0, medio:0, bajo:0 };
    const byType   = { hacer:0, entregar:0, no_hacer:0, condicion:0 };
    let overdue=0, dueWeek=0;
    const now = new Date(); now.setHours(0,0,0,0);
    const week = new Date(now); week.setDate(week.getDate()+7);

    for (const o of obligations) {
      if (byStatus[o.status] !== undefined) byStatus[o.status]++;
      if (byRisk[o.risk_level] !== undefined) byRisk[o.risk_level]++;
      if (byType[o.obligation_type] !== undefined) byType[o.obligation_type]++;
      if (o.due_date) {
        const d = new Date(o.due_date); d.setHours(0,0,0,0);
        if (d < now && !['cumplida','no_aplica'].includes(o.status)) overdue++;
        if (d >= now && d <= week && !['cumplida','no_aplica'].includes(o.status)) dueWeek++;
      }
    }

    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
    const fmtCOP  = (v) => v != null ? new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v) : '—';

    // ── Colour palette ──
    const C = {
      INDIGO:   '3730A3', INDIGO_L: 'E0E7FF',
      VIOLET:   '6D28D9', VIOLET_L: 'EDE9FE',
      RED:      'B91C1C', RED_L:    'FEE2E2',
      AMBER:    'B45309', AMBER_L:  'FEF3C7',
      EMERALD:  '065F46', EMERALD_L:'D1FAE5',
      BLUE:     '1E40AF', BLUE_L:   'DBEAFE',
      GRAY:     '475569', GRAY_L:   'F8FAFC',
      SLATE:    '1E293B', WHITE:    'FFFFFF',
    };

    const border = (c='CBD5E1') => ({
      top:    {style:'thin', color:{argb:'FF'+c}},
      bottom: {style:'thin', color:{argb:'FF'+c}},
      left:   {style:'thin', color:{argb:'FF'+c}},
      right:  {style:'thin', color:{argb:'FF'+c}},
    });
    const borderMed = (c='64748B') => ({
      top:    {style:'medium', color:{argb:'FF'+c}},
      bottom: {style:'medium', color:{argb:'FF'+c}},
      left:   {style:'medium', color:{argb:'FF'+c}},
      right:  {style:'medium', color:{argb:'FF'+c}},
    });

    const sty = (cell, {bold=false,italic=false,sz=10,color=C.SLATE,bg=null,
      align='left',valign='middle',wrap=false,numFmt=null,borders=null}={}) => {
      cell.font      = {name:'Calibri',size:sz,bold,italic,color:{argb:'FF'+color}};
      if (bg) cell.fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF'+bg}};
      cell.alignment = {horizontal:align,vertical:valign,wrapText:wrap};
      if (numFmt) cell.numFmt = numFmt;
      cell.border    = borders || border();
    };

    // ── Label helpers ──
    const statusLabel = {pendiente:'Pendiente',en_curso:'En curso',cumplida:'Cumplida',vencida:'Vencida',no_aplica:'No aplica'};
    const riskLabel   = {alto:'Alto',medio:'Medio',bajo:'Bajo'};
    const typeLabel   = {hacer:'Hacer',entregar:'Entregar',no_hacer:'No hacer',condicion:'Condición'};
    const periodLabel = {unica:'Única',diaria:'Diaria',semanal:'Semanal',quincenal:'Quincenal',mensual:'Mensual',bimestral:'Bimestral',trimestral:'Trimestral',semestral:'Semestral',anual:'Anual',al_cierre:'Al cierre'};

    const statusColor = {
      pendiente: {bg:C.BLUE_L,   col:C.BLUE},
      en_curso:  {bg:C.AMBER_L,  col:C.AMBER},
      cumplida:  {bg:C.EMERALD_L,col:C.EMERALD},
      vencida:   {bg:C.RED_L,    col:C.RED},
      no_aplica: {bg:C.GRAY_L,   col:C.GRAY},
    };
    const riskColor = {
      alto:  {bg:C.RED_L,    col:C.RED},
      medio: {bg:C.AMBER_L,  col:C.AMBER},
      bajo:  {bg:C.EMERALD_L,col:C.EMERALD},
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'SGIP-IA';
    wb.created = new Date();

    // ══════════════════════════════════════════════════════════════════
    // HOJA 1: RESUMEN
    // ══════════════════════════════════════════════════════════════════
    const ws1 = wb.addWorksheet('Resumen', {views:[{showGridLines:false}]});
    ws1.columns = [
      {width:22},{width:18},{width:18},{width:18},{width:18},{width:18},
    ];

    // Título principal
    ws1.mergeCells('A1:F1');
    const tit = ws1.getCell('A1');
    tit.value = `INFORME DE OBLIGACIONES — ${(project.code||'').toUpperCase()}`;
    sty(tit, {bold:true,sz:16,color:C.WHITE,bg:C.INDIGO,align:'center',borders:borderMed(C.INDIGO)});
    ws1.getRow(1).height = 34;

    // Subtítulo nombre proyecto
    ws1.mergeCells('A2:F2');
    const sub = ws1.getCell('A2');
    sub.value = project.name || '';
    sty(sub, {bold:true,sz:12,color:'C7D2FE',bg:C.INDIGO,align:'center',borders:borderMed(C.INDIGO)});
    ws1.getRow(2).height = 22;

    // Info proyecto
    ws1.mergeCells('A3:F3');
    const inf = ws1.getCell('A3');
    inf.value = `Cliente: ${project.client_name||'—'}   |   Contrato N.° ${project.contract_number||'—'}   |   Valor: ${fmtCOP(project.contract_value)}   |   GP: ${project.director_name||'—'}`;
    sty(inf, {sz:9,italic:true,color:'A5B4FC',bg:C.INDIGO,align:'center',borders:borderMed(C.INDIGO)});
    ws1.getRow(3).height = 16;

    // Separador
    ws1.mergeCells('A4:F4');
    ws1.getCell('A4').fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF'+C.GRAY_L}};
    ws1.getRow(4).height = 8;

    // KPI cards (fila 5 = totales por estado, fila 6 = riesgos + urgentes)
    const kpiData5 = [
      {label:'TOTAL OBLIGACIONES', val:total,                bg:C.INDIGO_L, col:C.INDIGO},
      {label:'PENDIENTES',          val:byStatus.pendiente,  bg:C.BLUE_L,   col:C.BLUE},
      {label:'EN CURSO',            val:byStatus.en_curso,   bg:C.AMBER_L,  col:C.AMBER},
      {label:'CUMPLIDAS',           val:byStatus.cumplida,   bg:C.EMERALD_L,col:C.EMERALD},
      {label:'VENCIDAS',            val:byStatus.vencida,    bg:C.RED_L,    col:C.RED},
      {label:'NO APLICA',           val:byStatus.no_aplica,  bg:C.GRAY_L,   col:C.GRAY},
    ];
    const cols5 = ['A','B','C','D','E','F'];
    kpiData5.forEach(({label,val,bg,col},i) => {
      const cell = ws1.getCell(`${cols5[i]}5`);
      cell.value = {richText:[
        {text:`${label}\n`, font:{name:'Calibri',size:8,bold:true,color:{argb:'FF'+col}}},
        {text:`${val}`,     font:{name:'Calibri',size:22,bold:true,color:{argb:'FF'+col}}},
      ]};
      sty(cell, {bg,align:'center',wrap:true,valign:'middle',borders:borderMed(col)});
    });
    ws1.getRow(5).height = 52;

    // Fila 6: Riesgo alto/medio/bajo + vencidas + próx 7 días + tipos
    const kpiData6 = [
      {label:'RIESGO ALTO',   val:byRisk.alto,     bg:C.RED_L,    col:C.RED},
      {label:'RIESGO MEDIO',  val:byRisk.medio,    bg:C.AMBER_L,  col:C.AMBER},
      {label:'RIESGO BAJO',   val:byRisk.bajo,     bg:C.EMERALD_L,col:C.EMERALD},
      {label:'VENCIDAS HOY',  val:overdue,         bg:C.RED_L,    col:C.RED},
      {label:'PRÓX. 7 DÍAS',  val:dueWeek,         bg:'FFF7ED',   col:'C2410C'},
      {label:'HACER / ENTREGAR', val:`${byType.hacer} / ${byType.entregar}`, bg:C.INDIGO_L, col:C.INDIGO},
    ];
    kpiData6.forEach(({label,val,bg,col},i) => {
      const cell = ws1.getCell(`${cols5[i]}6`);
      cell.value = {richText:[
        {text:`${label}\n`, font:{name:'Calibri',size:8,bold:true,color:{argb:'FF'+col}}},
        {text:`${val}`,     font:{name:'Calibri',size:18,bold:true,color:{argb:'FF'+col}}},
      ]};
      sty(cell, {bg,align:'center',wrap:true,valign:'middle',borders:borderMed(col)});
    });
    ws1.getRow(6).height = 44;

    // Separador
    ws1.mergeCells('A7:F7');
    ws1.getCell('A7').fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF'+C.GRAY_L}};
    ws1.getRow(7).height = 8;

    // Tabla resumen por tipo × estado
    const typeRows = [
      {key:'hacer',     label:'Hacer'},
      {key:'entregar',  label:'Entregar'},
      {key:'no_hacer',  label:'No hacer'},
      {key:'condicion', label:'Condición'},
    ];
    const statCols = ['pendiente','en_curso','cumplida','vencida','no_aplica'];

    // Header tabla resumen
    const hdrs = ['TIPO', 'PENDIENTE','EN CURSO','CUMPLIDA','VENCIDA','TOTAL'];
    hdrs.forEach((h,i) => {
      const c = ws1.getRow(8).getCell(i+1);
      c.value = h;
      sty(c, {bold:true,sz:10,color:C.WHITE,bg:C.INDIGO,align:'center',borders:borderMed()});
    });
    ws1.getRow(8).height = 20;

    for (const {key, label} of typeRows) {
      const r = ws1.addRow([]);
      r.height = 18;
      const typeObls = obligations.filter(o=>o.obligation_type===key);
      const vals = [
        typeObls.filter(o=>o.status==='pendiente').length,
        typeObls.filter(o=>o.status==='en_curso').length,
        typeObls.filter(o=>o.status==='cumplida').length,
        typeObls.filter(o=>o.status==='vencida').length,
        typeObls.length,
      ];
      const c1 = r.getCell(1); c1.value = label;
      sty(c1, {bold:true,sz:10,color:C.INDIGO,bg:C.INDIGO_L,align:'left'});
      [[1,C.BLUE_L,C.BLUE],[2,C.AMBER_L,C.AMBER],[3,C.EMERALD_L,C.EMERALD],[4,C.RED_L,C.RED],[5,C.GRAY_L,C.SLATE]].forEach(([idx,bg,col]) => {
        const c = r.getCell(idx+1); c.value = vals[idx-1];
        sty(c, {sz:10,color:col,bg,align:'center'});
      });
    }

    // Total row tabla resumen
    const totR = ws1.addRow([]);
    totR.height = 22;
    const totVals = [byStatus.pendiente, byStatus.en_curso, byStatus.cumplida, byStatus.vencida, total];
    const c1t = totR.getCell(1); c1t.value = 'TOTAL';
    sty(c1t, {bold:true,sz:11,color:C.WHITE,bg:C.INDIGO,align:'center',borders:borderMed()});
    [[1,C.BLUE,C.WHITE],[2,C.AMBER,C.WHITE],[3,C.EMERALD,C.WHITE],[4,C.RED,C.WHITE],[5,'0F172A',C.WHITE]].forEach(([idx,bg,col]) => {
      const c = totR.getCell(idx+1); c.value = totVals[idx-1];
      sty(c, {bold:true,sz:11,color:col,bg,align:'center',borders:borderMed()});
    });

    // Fecha generación
    ws1.addRow([]);
    const fecR1 = ws1.addRow([]);
    ws1.mergeCells(`A${fecR1.number}:F${fecR1.number}`);
    fecR1.getCell(1).value = `Generado el ${new Date().toLocaleDateString('es-CO',{weekday:'long',year:'numeric',month:'long',day:'numeric'})} — SGIP-IA`;
    sty(fecR1.getCell(1), {sz:8,italic:true,color:'94A3B8',align:'right',bg:C.GRAY_L,borders:border('E2E8F0')});
    fecR1.height = 14;

    // ══════════════════════════════════════════════════════════════════
    // HOJA 2: TODAS LAS OBLIGACIONES
    // ══════════════════════════════════════════════════════════════════
    const ws2 = wb.addWorksheet('Obligaciones', {views:[{showGridLines:false,state:'frozen',ySplit:4}]});
    ws2.columns = [
      {key:'code',         width:22},
      {key:'type',         width:14},
      {key:'description',  width:52},
      {key:'status',       width:14},
      {key:'risk',         width:12},
      {key:'periodicity',  width:14},
      {key:'due_date',     width:14},
      {key:'days',         width:12},
      {key:'responsible',  width:22},
      {key:'source_doc',   width:28},
      {key:'clause',       width:16},
      {key:'notes',        width:36},
      {key:'created',      width:14},
    ];

    // Encabezado
    ws2.mergeCells('A1:M1');
    sty(ws2.getCell('A1'), {bold:true,sz:15,color:C.WHITE,bg:C.INDIGO,align:'center',borders:borderMed(C.INDIGO)});
    ws2.getCell('A1').value = `OBLIGACIONES DEL PROYECTO — ${(project.code||'').toUpperCase()}`;
    ws2.getRow(1).height = 30;

    ws2.mergeCells('A2:M2');
    sty(ws2.getCell('A2'), {bold:true,sz:11,color:'C7D2FE',bg:C.INDIGO,align:'center',borders:borderMed(C.INDIGO)});
    ws2.getCell('A2').value = project.name || '';
    ws2.getRow(2).height = 20;

    ws2.mergeCells('A3:M3');
    sty(ws2.getCell('A3'), {sz:8,italic:true,color:'A5B4FC',bg:C.INDIGO,align:'center',borders:borderMed(C.INDIGO)});
    ws2.getCell('A3').value = `${total} obligaciones registradas   |   Vencidas: ${byStatus.vencida}   |   Riesgo alto: ${byRisk.alto}   |   Generado: ${new Date().toLocaleDateString('es-CO')}`;
    ws2.getRow(3).height = 14;

    // Encabezados columnas
    const hdrs2 = ['CÓDIGO','TIPO','DESCRIPCIÓN','ESTADO','RIESGO','PERIODICIDAD','FECHA LÍMITE','DÍAS REST.','RESPONSABLE','DOC. FUENTE','CLÁUSULA','NOTAS','CREADA'];
    hdrs2.forEach((h,i) => {
      const c = ws2.getRow(4).getCell(i+1);
      c.value = h;
      sty(c, {bold:true,sz:10,color:C.WHITE,bg:C.VIOLET,align:'center',borders:borderMed(C.VIOLET)});
    });
    ws2.getRow(4).height = 20;

    // Filas de obligaciones
    for (const o of obligations) {
      const row = ws2.addRow([]);
      row.height = 30;

      const sc = statusColor[o.status] || {bg:C.GRAY_L,col:C.GRAY};
      const rc = riskColor[o.risk_level] || {bg:C.GRAY_L,col:C.GRAY};

      // días restantes — color
      const daysLeft = o.days_remaining != null ? parseInt(o.days_remaining) : null;
      const daysBg   = daysLeft == null ? C.GRAY_L : daysLeft < 0 ? C.RED_L : daysLeft <= 7 ? C.AMBER_L : C.GRAY_L;
      const daysCol  = daysLeft == null ? C.GRAY    : daysLeft < 0 ? C.RED   : daysLeft <= 7 ? C.AMBER   : C.SLATE;
      const daysVal  = daysLeft == null ? '—' : daysLeft < 0 ? `${Math.abs(daysLeft)}d venc.` : `${daysLeft}d`;

      const cells = [
        {v: o.code||'—',                                              bg:C.INDIGO_L, col:C.INDIGO, bold:true,  al:'center'},
        {v: typeLabel[o.obligation_type]||o.obligation_type||'—',     bg:C.GRAY_L,   col:C.SLATE,  bold:false, al:'center'},
        {v: o.description||'—',                                       bg:C.WHITE,    col:C.SLATE,  bold:false, al:'left', wrap:true},
        {v: statusLabel[o.status]||o.status||'—',                     bg:sc.bg,      col:sc.col,   bold:true,  al:'center'},
        {v: riskLabel[o.risk_level]||o.risk_level||'—',               bg:rc.bg,      col:rc.col,   bold:true,  al:'center'},
        {v: periodLabel[o.periodicity]||o.periodicity||'Única',        bg:C.GRAY_L,   col:C.SLATE,  bold:false, al:'center'},
        {v: fmtDate(o.due_date),                                       bg:o.due_date?C.WHITE:C.GRAY_L, col:o.due_date?C.SLATE:C.GRAY, bold:false, al:'center'},
        {v: daysVal,                                                   bg:daysBg,     col:daysCol,  bold:daysLeft!=null&&daysLeft<=7, al:'center'},
        {v: o.responsible_name||o.responsible_role||'—',               bg:C.GRAY_L,   col:C.SLATE,  bold:false, al:'left'},
        {v: o.source_document_name||'—',                               bg:C.GRAY_L,   col:C.SLATE,  bold:false, al:'left'},
        {v: o.source_clause||'—',                                      bg:C.GRAY_L,   col:C.SLATE,  bold:false, al:'center'},
        {v: o.notes||'—',                                              bg:C.WHITE,    col:C.GRAY,   bold:false, al:'left', wrap:true},
        {v: fmtDate(o.created_at),                                     bg:C.GRAY_L,   col:C.SLATE,  bold:false, al:'center'},
      ];

      cells.forEach(({v,bg,col,bold,al,wrap},i) => {
        const c = row.getCell(i+1);
        c.value = v;
        sty(c, {sz:9,color:col,bg,align:al,bold,wrap:!!wrap,valign:'middle'});
      });
    }

    // Fecha generación hoja 2
    ws2.addRow([]);
    const fecR2 = ws2.addRow([]);
    ws2.mergeCells(`A${fecR2.number}:M${fecR2.number}`);
    fecR2.getCell(1).value = `Generado el ${new Date().toLocaleDateString('es-CO',{weekday:'long',year:'numeric',month:'long',day:'numeric'})} — SGIP-IA`;
    sty(fecR2.getCell(1), {sz:8,italic:true,color:'94A3B8',align:'right',bg:C.GRAY_L,borders:border('E2E8F0')});
    fecR2.height = 14;

    // ── Send response ──
    const filename = `Obligaciones_${project.code||pid}_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Obligations export error:', err);
    res.status(500).json({ error: err.message || 'Error exportando obligaciones' });
  }
});

module.exports = router;
