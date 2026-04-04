'use strict';

/**
 * htmlParser.js — Convierte HTML producido por contenteditable/execCommand
 * en bloques estructurados consumibles por PDFKit y docx.
 *
 * Soporta: <p> <div> <br> <b> <strong> <i> <em> <u> <a href="…">
 *          <ul> <ol> <li>  (listas básicas)
 * Ignora:  <span> <script> <style> y cualquier otra etiqueta.
 */

const ENT = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ',
  '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

function decode(s) {
  return s.replace(/&(?:\w+|#\d+);/g, m => ENT[m] || m);
}

/**
 * parseHtml(html) → Block[]
 *
 * Block  = { type: 'p' | 'li', segments: Segment[] }
 * Segment = { text, bold, italic, underline, link }
 */
function parseHtml(html) {
  if (!html) return [];

  // Sin etiquetas → texto plano, separar por saltos de línea
  if (!/<[a-zA-Z]/.test(html)) {
    return decode(html).split('\n').map(line => ({
      type: 'p',
      segments: [{ text: line, bold: false, italic: false, underline: false, link: null }],
    }));
  }

  const blocks = [];
  const stack  = []; // contexto de formato inline
  let curType  = null;
  let curSegs  = [];

  const flush = () => {
    if (curType !== null || curSegs.length > 0) {
      blocks.push({ type: curType || 'p', segments: curSegs });
      curType = null;
      curSegs = [];
    }
  };

  const getFmt = () => {
    const f = { bold: false, italic: false, underline: false, link: null };
    for (const s of stack) {
      if (s.bold)      f.bold      = true;
      if (s.italic)    f.italic    = true;
      if (s.underline) f.underline = true;
      if (s.link != null) f.link   = s.link;
    }
    return f;
  };

  const addText = raw => {
    const text = decode(raw);
    if (!text) return;
    if (curType === null) curType = 'p';
    const f    = getFmt();
    const last = curSegs[curSegs.length - 1];
    if (last && last.bold === f.bold && last.italic === f.italic &&
        last.underline === f.underline && last.link === f.link) {
      last.text += text;
    } else {
      curSegs.push({ text, ...f });
    }
  };

  const RE = /<(\/?)([a-zA-Z]\w*)([^>]*?)\/?>|([^<]+)/g;
  let m;
  while ((m = RE.exec(html)) !== null) {
    const [, close, rawTag, attrs, text] = m;
    if (text !== undefined) { addText(text); continue; }

    const tag = rawTag.toLowerCase();

    if (close) {
      if (['p','div','h1','h2','h3','h4','h5','h6','li'].includes(tag)) {
        flush();
      } else {
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].tag === tag) { stack.splice(i, 1); break; }
        }
      }
    } else {
      if (['p','div','h1','h2','h3','h4','h5','h6'].includes(tag)) {
        flush(); curType = 'p';
      } else if (tag === 'li') {
        flush(); curType = 'li';
      } else if (tag === 'br') {
        flush(); curType = 'p';
      } else if (['b','strong'].includes(tag)) {
        stack.push({ tag, bold: true });
      } else if (['i','em'].includes(tag)) {
        stack.push({ tag, italic: true });
      } else if (tag === 'u') {
        stack.push({ tag, underline: true });
      } else if (tag === 'a') {
        const href = (attrs.match(/href="([^"]*)"/) || ['',''])[1];
        stack.push({ tag: 'a', link: href || '' });
        if (curType === null) curType = 'p';
      }
      // ignorar ul, ol, span, script, style, etc.
    }
  }
  flush();

  return blocks.length
    ? blocks
    : [{ type: 'p', segments: [{ text: '', bold: false, italic: false, underline: false, link: null }] }];
}

module.exports = { parseHtml };
