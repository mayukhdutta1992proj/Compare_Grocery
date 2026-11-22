/**
 * Turns pasted text, CSV/TSV rows and spreadsheet rows into shopping-list
 * items ({ query, count }). Pure functions with no React Native imports, so
 * they can be tested with plain Node.
 */

export interface ParsedItem {
  query: string;
  count: number;
}

// Words that mean "how many", not "how big": "2 nos", "3 pcs", "x2".
const COUNT_UNIT = '(?:nos?\\.?|numbers?|pcs?\\.?|pieces?|packs?|packets?|pkts?|units?|qty)';
// Sizes stay part of the item name: "1kg", "500 g", "2 l".
const SIZE_UNIT = /^(?:kg|kgs|g|gm|gms|gram|grams|ml|l|ltr|litre|liter|lb|oz|dozen)\b/i;

const MAX_COUNT = 50;

function clampCount(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_COUNT, Math.round(n));
}

/** Strips list markers like "1.", "-", "*", "•", "☐", "[ ]". */
function stripBullet(line: string): string {
  return line
    .replace(/^\s*(?:[-*•·▪◦☐☑✓✔]|\[\s?[xX ]?\s?\]|\(\s?\))\s*/, '')
    .replace(/^\s*\d{1,3}\s*[.)]\s+/, '')
    .trim();
}

/** Parses one free-text line such as "2 x Amul butter 100g" or "Milk 1l - 3". */
export function parseLine(raw: string): ParsedItem | null {
  let s = stripBullet(raw).replace(/\s+/g, ' ').trim();
  if (!s || s.length < 2) return null;
  // Skip header-ish or total lines.
  if (/^(item|items|product|name|description|qty|quantity|total|subtotal|grocery list|shopping list)s?\s*[:\-]?$/i.test(s)) return null;

  let count = 1;
  let m: RegExpMatchArray | null;

  // Trailing: "milk x2", "milk × 2", "milk * 2"
  if ((m = s.match(new RegExp(`^(.*\\S)\\s*[x×*]\\s*(\\d{1,2})\\s*${COUNT_UNIT}?$`, 'i')))) {
    s = m[1];
    count = +m[2];
  }
  // Trailing: "milk - 2", "milk: 2 pcs", "milk (2)", "milk = 2"
  else if ((m = s.match(new RegExp(`^(.*\\S)\\s*(?:[-–—:=]\\s*|\\(\\s*)(\\d{1,2})\\s*${COUNT_UNIT}?\\s*\\)?$`, 'i')))) {
    s = m[1];
    count = +m[2];
  }
  // Trailing: "eggs 2 packs", "bread 2 nos"
  else if ((m = s.match(new RegExp(`^(.*\\S)\\s+(\\d{1,2})\\s*${COUNT_UNIT}$`, 'i')))) {
    s = m[1];
    count = +m[2];
  }
  // Leading: "2 x milk", "2x milk", "3 pcs bread", "2 milk" (but not "1kg sugar" or "500 g paneer")
  else if ((m = s.match(new RegExp(`^(\\d{1,2})\\s*(?:[x×*]|${COUNT_UNIT})?\\s+(.+)$`, 'i')))) {
    const rest = m[2];
    if (!SIZE_UNIT.test(rest) && /^[a-zऀ-ॿ]/i.test(rest)) {
      s = rest;
      count = +m[1];
    }
  }

  s = s.replace(/[,;:\-–—]+$/, '').trim();
  if (!/[a-zऀ-ॿ]/i.test(s)) return null; // needs at least one letter
  return { query: s, count: clampCount(count) };
}

/** Free text: one item per line (commas also split, unless the line looks like CSV). */
export function parseText(text: string): ParsedItem[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const looksTabular = lines.filter((l) => /\t|;|,/.test(l)).length >= Math.max(2, lines.length * 0.6);
  if (looksTabular) {
    const delim = /\t/.test(text) ? '\t' : /;/.test(text) && !/,/.test(text) ? ';' : ',';
    return parseRows(lines.filter((l) => l.trim()).map((l) => splitCsvLine(l, delim)));
  }
  return mergeDuplicates(
    lines
      .flatMap((l) => (l.includes(',') && !/\d,\d/.test(l) ? l.split(',') : [l]))
      .map(parseLine)
      .filter((x): x is ParsedItem => !!x),
  );
}

/** Minimal CSV splitter that understands double-quoted cells. */
export function splitCsvLine(line: string, delim = ','): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const NAME_HEADER = /^(item|items|item name|product|product name|name|description|particulars|grocery|article)s?$/i;
const QTY_HEADER = /^(qty|qty\.|quantity|count|nos|no\.|no of items|units|pcs|packs|number)$/i;
const SIZE_HEADER = /^(size|weight|pack size|unit|uom|variant)$/i;

/**
 * Rows from a spreadsheet or CSV. Finds the item / quantity / size columns
 * from the header row when there is one, otherwise guesses: the first mostly
 * text column is the item, the first small-integer column is the quantity.
 */
export function parseRows(rows: unknown[][]): ParsedItem[] {
  const clean = rows
    .map((r) => (r ?? []).map((c) => (c === null || c === undefined ? '' : String(c).trim())))
    .filter((r) => r.some((c) => c));
  if (!clean.length) return [];

  let nameCol = -1;
  let qtyCol = -1;
  let sizeCol = -1;
  let start = 0;

  // Header can be in the first few rows (titles above tables are common).
  for (let h = 0; h < Math.min(5, clean.length); h++) {
    const r = clean[h];
    const n = r.findIndex((c) => NAME_HEADER.test(c));
    if (n >= 0) {
      nameCol = n;
      qtyCol = r.findIndex((c) => QTY_HEADER.test(c));
      sizeCol = r.findIndex((c) => SIZE_HEADER.test(c));
      start = h + 1;
      break;
    }
  }

  if (nameCol < 0) {
    const width = Math.max(...clean.map((r) => r.length));
    const textScore = (i: number) => clean.filter((r) => /[a-z]/i.test(r[i] ?? '')).length;
    const intScore = (i: number) => clean.filter((r) => /^\d{1,2}(\.0+)?$/.test(r[i] ?? '')).length;
    for (let i = 0; i < width; i++) {
      if (nameCol < 0 && textScore(i) >= clean.length * 0.5) nameCol = i;
    }
    for (let i = 0; i < width; i++) {
      if (i !== nameCol && qtyCol < 0 && intScore(i) >= clean.length * 0.5) qtyCol = i;
    }
    if (nameCol < 0) nameCol = 0;
  }

  const items: ParsedItem[] = [];
  for (const r of clean.slice(start)) {
    const name = r[nameCol] ?? '';
    if (!name) continue;
    const size = sizeCol >= 0 ? r[sizeCol] ?? '' : '';
    const qtyCell = qtyCol >= 0 ? r[qtyCol] ?? '' : '';
    const fromName = parseLine(size ? `${name} ${size}` : name);
    if (!fromName) continue;
    const q = parseFloat(qtyCell.replace(/[^\d.]/g, ''));
    items.push({ query: fromName.query, count: qtyCell && !isNaN(q) ? clampCount(q) : fromName.count });
  }
  return mergeDuplicates(items);
}

/**
 * Text read from a photo by OCR is noisier than typed text: it can include
 * prices, totals, dates, phone numbers, stray symbols and "|" for "l". This
 * cleans each line, then parses it like typed text.
 */
export function cleanOcrText(text: string): string {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) =>
      l
        .replace(/[|]/g, 'l') // "1|" -> "1l"
        .replace(/[“”"_~^`]+/g, ' ')
        // Trailing prices: "₹45", "Rs. 45.00", "45/-", "INR 120"
        .replace(/\s*(?:₹|rs\.?|inr)\s*\d[\d,]*(?:\.\d+)?\s*(?:\/-)?\s*$/i, '')
        .replace(/\s+\d[\d,]*\s*\/-\s*$/, '')
        // A bare trailing price: 3+ digits ("310") or with paise ("28.00"). Short numbers like "Eggs 12" stay.
        .replace(/(\S)\s+(?:\d{3,}|\d+\.\d{2})\s*$/, '$1')
        // OCR often reads "1l" as "11" or "1I" right before a count: "oil 11x2" -> "oil 1l x2"
        .replace(/\b1[1I](?=\s*[x×]\s*\d)/g, '1l ')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    )
    .filter((l) => {
      if (l.length < 3) return false;
      if ((l.match(/[a-zऀ-ॿ]/gi) ?? []).length < 2) return false; // mostly symbols or numbers
      if (/\b(total|sub ?total|grand total|amount|balance|gst|cgst|sgst|invoice|bill no|thank you|date|time)\b/i.test(l)) return false;
      if (/\d{2}[/.-]\d{2}[/.-]\d{2,4}/.test(l)) return false; // dates
      if (/\b\d{10}\b|\+91/.test(l)) return false; // phone numbers
      return true;
    })
    .join('\n');
}

export function parseOcrText(text: string): ParsedItem[] {
  return parseText(cleanOcrText(text));
}

/** "Milk" twice becomes one line with the counts added. */
export function mergeDuplicates(items: ParsedItem[]): ParsedItem[] {
  const map = new Map<string, ParsedItem>();
  for (const it of items) {
    const k = it.query.toLowerCase();
    const cur = map.get(k);
    if (cur) cur.count = clampCount(cur.count + it.count);
    else map.set(k, { ...it });
  }
  return [...map.values()];
}

/** Turns AI answers ({ name, size, quantity }) into list items, merging duplicates. */
export function modelItemsToParsed(items: { name: string; size?: string; quantity: number }[]): ParsedItem[] {
  return mergeDuplicates(
    items
      .map((it) => {
        const base = parseLine([it.name, it.size].filter(Boolean).join(' '));
        return base ? { query: base.query, count: clampCount(it.quantity || 1) } : null;
      })
      .filter((x): x is ParsedItem => !!x),
  );
}

/**
 * Pulls a list out of whatever JSON-ish text the model returned: plain JSON,
 * JSON inside ``` fences, a bare array, or slightly different field names.
 */
export function itemsFromModelText(text: string): ParsedItem[] | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const candidates = [cleaned];
  const firstObj = cleaned.indexOf('{');
  const firstArr = cleaned.indexOf('[');
  if (firstObj >= 0) candidates.push(cleaned.slice(firstObj, cleaned.lastIndexOf('}') + 1));
  if (firstArr >= 0) candidates.push(cleaned.slice(firstArr, cleaned.lastIndexOf(']') + 1));

  for (const c of candidates) {
    let data: any;
    try {
      data = JSON.parse(c);
    } catch {
      continue;
    }
    const arr: any[] | undefined = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
        ? data.items
        : (Object.values(data ?? {}).find((v) => Array.isArray(v)) as any[] | undefined);
    if (!arr) continue;
    const list = arr
      .map((it: any) => {
        if (typeof it === 'string') return { name: it, size: '', quantity: 1 };
        const name = String(it?.name ?? it?.item ?? it?.product ?? it?.title ?? '').trim();
        const size = String(it?.size ?? it?.weight ?? it?.unit ?? '').trim();
        const q = parseFloat(String(it?.quantity ?? it?.qty ?? it?.count ?? 1));
        return { name, size, quantity: Number.isFinite(q) && q > 0 ? q : 1 };
      })
      .filter((it) => it.name);
    return modelItemsToParsed(list);
  }
  return null;
}

