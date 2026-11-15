/**
 * Small Markdown subset for the conversation box: what Claude Code's own chat renders most
 * often (GFM tables, headings, lists, fenced code, quotes, rules, bold, italic, inline code).
 * Pure and dependency-free; the output is plain data turned into React elements, so no
 * transcript text ever reaches the DOM as HTML. Links keep their label only.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string };

export type Align = 'left' | 'center' | 'right' | null;

export interface ListItem {
  text: string;
  /** Nested lists, in order. */
  sub: ListBlock[];
}

export interface ListBlock {
  kind: 'list';
  ordered: boolean;
  start: number;
  items: ListItem[];
}

export type Block =
  | { kind: 'para'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | ListBlock
  | { kind: 'table'; align: Align[]; header: string[]; rows: string[][] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' };

/** Any indent: a fence inside a list item is indented like the item's text. */
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^(\s*)(?:[-*+]|(\d{1,9})[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const SEP_CELL = /^:?-+:?$/;
/** Deepest nesting kept; deeper items join the last list. */
const MAX_DEPTH = 4;
/**
 * Table size limits: rows are padded to the header width, so a few pipes could otherwise
 * expand into hundreds of thousands of cells. Wider tables stay text; longer ones are cut.
 */
const MAX_COLUMNS = 30;
const MAX_CELLS = 3000;
const ESCAPABLE = /[\\`*_|[\]()#>~+.!-]/;

/**
 * Cells of a table row. Pipes inside inline code or escaped as `\|` do not split. With an
 * unclosed backtick the row is split again ignoring code, so one stray tick never swallows it.
 */
export function splitRow(line: string, codeAware = true): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) {
      cur += ch + s[i + 1];
      i++;
    } else if (ch === '`' && codeAware) {
      inCode = !inCode;
      cur += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (inCode) return splitRow(line, false);
  cells.push(cur.trim());
  return cells;
}

function separator(line: string): Align[] | null {
  if (!line.includes('|') && !line.includes('-')) return null;
  const cells = splitRow(line, false);
  if (!cells.every((c) => SEP_CELL.test(c))) return null;
  // A lone "---" is a rule, not a one-column table.
  if (cells.length === 1 && !line.includes('|')) return null;
  return cells.map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
}

function tableAt(lines: string[], i: number): Align[] | null {
  const head = lines[i];
  const next = lines[i + 1];
  if (!head.includes('|') || next === undefined) return null;
  const align = separator(next);
  return align && align.length <= MAX_COLUMNS && align.length === splitRow(head).length ? align : null;
}

function fits(cells: string[], n: number): string[] {
  return cells.length >= n ? cells.slice(0, n) : [...cells, ...Array<string>(n - cells.length).fill('')];
}

function closesFence(line: string, marker: string): boolean {
  const t = line.trim();
  return t.length >= marker.length && [...t].every((ch) => ch === marker[0]);
}

/** Opening fence, or null. A backtick fence never has a backtick after it: "```x``` y" is a code span. */
function fenceOf(line: string): RegExpExecArray | null {
  const m = FENCE.exec(line);
  return m && m[2][0] === '`' && line.slice(m[0].length).includes('`') ? null : m;
}

/** Heading text without its optional closing run of `#` (stripped by hand: a regex would backtrack). */
function headingText(raw: string): string {
  const t = raw.trimEnd();
  let k = t.length;
  while (k > 0 && t[k - 1] === '#') k--;
  return k < t.length && (k === 0 || /\s/.test(t[k - 1])) ? t.slice(0, k).trimEnd() : t;
}

function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i];
  return fenceOf(l) !== null || HEADING.test(l) || RULE.test(l) || QUOTE.test(l) || ITEM.test(l) || tableAt(lines, i) !== null;
}

/** Splits a message into blocks. Never throws; a cut-off message just ends its last block. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = fenceOf(line);
    if (fence) {
      const indent = fence[1];
      const body: string[] = [];
      i++;
      // The fence's own indent is removed from its lines (a block inside a list item).
      while (i < lines.length && !closesFence(lines[i], fence[2])) {
        const l = lines[i++];
        body.push(indent && l.startsWith(indent) ? l.slice(indent.length) : l);
      }
      i++;
      blocks.push({ kind: 'code', lang: fence[3], text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: headingText(heading[2]) });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }

    const align = tableAt(lines, i);
    if (align) {
      const n = align.length;
      const header = fits(splitRow(line), n);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|') && (rows.length + 2) * n <= MAX_CELLS && !startsBlock(lines, i)) {
        rows.push(fits(splitRow(lines[i++]), n));
      }
      blocks.push({ kind: 'table', align, header, rows });
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      let m: RegExpExecArray | null;
      while (i < lines.length && (m = QUOTE.exec(lines[i]))) {
        body.push(m[1]);
        i++;
      }
      blocks.push({ kind: 'quote', text: body.join('\n') });
      continue;
    }

    if (ITEM.test(line)) {
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }

    const body = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) body.push(lines[i++]);
    blocks.push({ kind: 'para', text: body.join('\n') });
  }
  return blocks;
}

function newList(m: RegExpExecArray): ListBlock {
  return { kind: 'list', ordered: m[2] !== undefined, start: m[2] !== undefined ? Number(m[2]) : 1, items: [] };
}

function parseList(lines: string[], from: number): [ListBlock, number] {
  const first = ITEM.exec(lines[from])!;
  const root = newList(first);
  const stack: { indent: number; list: ListBlock }[] = [{ indent: first[1].length, list: root }];
  let last: ListItem | null = null;
  let i = from;
  while (i < lines.length) {
    const l = lines[i];
    const m = ITEM.exec(l);
    if (m && !RULE.test(l)) {
      const indent = m[1].length;
      while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
      const top = stack[stack.length - 1];
      const parent = top.list.items[top.list.items.length - 1];
      if (indent > top.indent && parent && stack.length < MAX_DEPTH) {
        // Under the item of the level we are back to, joining its list if it has one.
        let sub = parent.sub[parent.sub.length - 1];
        if (!sub) {
          sub = newList(m);
          parent.sub.push(sub);
        }
        stack.push({ indent, list: sub });
      }
      last = { text: m[3], sub: [] };
      stack[stack.length - 1].list.items.push(last);
      i++;
    } else if (!l.trim()) {
      // A blank line keeps the list going only when another item follows.
      if (i + 1 < lines.length && ITEM.test(lines[i + 1]) && !RULE.test(lines[i + 1])) i++;
      else break;
    } else if (fenceOf(l)) {
      // A code block in an item: the main loop reads it whole, blank lines included.
      break;
    } else if (/^\s/.test(l) && last) {
      last.text += '\n' + l.trim();
      i++;
    } else break;
  }
  return [root, i];
}

/** Index of the `*` closing an emphasis opened just before `from`, or -1. */
function emphasisEnd(src: string, from: number): number {
  for (let j = from + 1; j < src.length; j++) {
    if (src[j] === '\\') j++;
    else if (src[j] === '`') {
      // A stray backtick (no partner) is literal text, as in parseInline.
      const end = src.indexOf('`', j + 1);
      if (end !== -1) j = end;
    } else if (src[j] === '*' && src[j + 1] === '*' && src[j + 2] !== undefined && src[j + 2] !== '*') j++;
    // Inner `**` pairs belong to a strong span; skipped above unless they end the text.
    else if (src[j] === '*' && src[j - 1] !== ' ' && src[j + 1] !== '*') return j;
  }
  return -1;
}

/** Index of the `**` closing a strong span opened just before `from`, or -1. Skips code spans. */
function strongEnd(src: string, from: number): number {
  for (let j = from; j < src.length - 1; j++) {
    if (src[j] === '\\') j++;
    else if (src[j] === '`') {
      // A stray backtick (no partner) is literal text, as in parseInline.
      const end = src.indexOf('`', j + 1);
      if (end !== -1) j = end;
    } else if (src[j] === '*') {
      let run = 1;
      while (src[j + run] === '*') run++;
      // The closer is the last two stars of the run: in "***x***" the inner one closes an em.
      if (run >= 2 && j > from) return j + run - 2;
      j += run - 1;
    }
  }
  return -1;
}

/** Sticky: matched in place at a `[`, without copying the rest of the text. */
const LINK = /\[([^\]\n]+)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/y;

/** Inline spans of one block's text. Unmatched markers stay as plain text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ kind: 'text', text: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length && ESCAPABLE.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      let n = 1;
      while (src[i + n] === '`') n++;
      const fence = '`'.repeat(n);
      const end = src.indexOf(fence, i + n);
      if (end !== -1) {
        flush();
        const inner = src.slice(i + n, end);
        out.push({ kind: 'code', text: /^ .* $/.test(inner) ? inner.slice(1, -1) : inner });
        i = end + n;
        continue;
      }
      buf += fence;
      i += n;
      continue;
    }
    if (c === '*' && src[i + 1] === '*') {
      const end = strongEnd(src, i + 2);
      if (end !== -1) {
        flush();
        out.push({ kind: 'strong', children: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
      buf += '**';
      i += 2;
      continue;
    }
    if (c === '*' && i + 1 < src.length && !/\s/.test(src[i + 1])) {
      const end = emphasisEnd(src, i + 1);
      if (end !== -1) {
        flush();
        out.push({ kind: 'em', children: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (c === '[') {
      LINK.lastIndex = i;
      const m = LINK.exec(src);
      if (m) {
        flush();
        out.push(...parseInline(m[1]));
        i += m[0].length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}
