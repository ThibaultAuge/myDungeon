import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, splitRow, type Block, type Inline } from '../src/ui/markdown.ts';

const text = (t: string): Inline => ({ kind: 'text', text: t });
const code = (t: string): Inline => ({ kind: 'code', text: t });
const strong = (...children: Inline[]): Inline => ({ kind: 'strong', children });
const em = (...children: Inline[]): Inline => ({ kind: 'em', children });

const kinds = (blocks: Block[]) => blocks.map((b) => b.kind);

describe('splitRow', () => {
  /**
   * Verifies that leading and trailing pipes are dropped and cells are trimmed
   */
  it('splits a piped row into trimmed cells', () => {
    expect(splitRow('| a | b  |  c |')).toEqual(['a', 'b', 'c']);
  });

  /**
   * Verifies that a row without outer pipes still splits on inner pipes
   */
  it('splits a row without outer pipes', () => {
    expect(splitRow('a | b')).toEqual(['a', 'b']);
  });

  /**
   * Verifies that a pipe inside an inline code span does not split the cell
   */
  it('keeps pipes inside inline code in one cell', () => {
    expect(splitRow('| x | `a|b` |')).toEqual(['x', '`a|b`']);
  });

  /**
   * Verifies that an escaped pipe stays inside its cell with its backslash kept
   */
  it('keeps escaped pipes in the cell', () => {
    expect(splitRow('| a \\| b | c |')).toEqual(['a \\| b', 'c']);
  });

  /**
   * Verifies that a trailing escaped pipe is cell content, not the row's closing pipe
   */
  it('does not strip a trailing escaped pipe', () => {
    expect(splitRow('a | b \\|')).toEqual(['a', 'b \\|']);
  });

  /**
   * Verifies that an unclosed backtick does not swallow the rest of the row
   */
  it('falls back to plain splitting when a backtick is unclosed', () => {
    expect(splitRow('| `a | b |')).toEqual(['`a', 'b']);
  });

  /**
   * Verifies that pipes inside code split when code awareness is turned off
   */
  it('splits inside code when codeAware is false', () => {
    expect(splitRow('| `a|b` |', false)).toEqual(['`a', 'b`']);
  });

  /**
   * Verifies that empty cells are preserved as empty strings
   */
  it('keeps empty cells', () => {
    expect(splitRow('| a || c |')).toEqual(['a', '', 'c']);
  });

  /**
   * Verifies that an empty line yields a single empty cell without throwing
   */
  it('returns one empty cell for an empty line', () => {
    expect(splitRow('')).toEqual(['']);
  });
});

describe('parseMarkdown — tables', () => {
  /**
   * Verifies that a realistic status table followed by a bold paragraph parses correctly
   */
  it('parses a status table then a paragraph starting with bold text', () => {
    const src = [
      '| Étape | Statut | Notes |',
      '|---|---|---|',
      '| Tests | ⏭ | Que de la configuration, `a|b` |',
      '',
      '**Points non bloquants** : la doc reste à jour.',
    ].join('\n');
    const blocks = parseMarkdown(src);
    expect(blocks).toEqual([
      {
        kind: 'table',
        align: [null, null, null],
        header: ['Étape', 'Statut', 'Notes'],
        rows: [['Tests', '⏭', 'Que de la configuration, `a|b`']],
      },
      { kind: 'para', text: '**Points non bloquants** : la doc reste à jour.' },
    ]);
    const para = blocks[1] as { kind: 'para'; text: string };
    expect(parseInline(para.text)).toEqual([strong(text('Points non bloquants')), text(' : la doc reste à jour.')]);
    const notes = (blocks[0] as { rows: string[][] }).rows[0][2];
    expect(parseInline(notes)).toEqual([text('Que de la configuration, '), code('a|b')]);
  });

  /**
   * Verifies that a pipe-less line right after a table ends it without a blank line
   */
  it('ends the table at the first line without a pipe', () => {
    const src = '| a | b |\n|---|---|\n| 1 | 2 |\n**Points non bloquants** : rien.';
    expect(parseMarkdown(src)).toEqual([
      { kind: 'table', align: [null, null], header: ['a', 'b'], rows: [['1', '2']] },
      { kind: 'para', text: '**Points non bloquants** : rien.' },
    ]);
  });

  /**
   * Verifies that separator colons map to left, center, right and default alignment
   */
  it('reads column alignment from the separator', () => {
    const src = '| a | b | c | d |\n| :--- | :---: | ---: | --- |';
    expect(parseMarkdown(src)).toEqual([
      { kind: 'table', align: ['left', 'center', 'right', null], header: ['a', 'b', 'c', 'd'], rows: [] },
    ]);
  });

  /**
   * Verifies that short rows are padded and long rows truncated to the header width
   */
  it('pads and truncates body rows to the header width', () => {
    const src = '| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |';
    expect(parseMarkdown(src)).toEqual([
      { kind: 'table', align: [null, null], header: ['a', 'b'], rows: [['1', ''], ['1', '2']] },
    ]);
  });

  /**
   * Verifies that a table without outer pipes is still recognised
   */
  it('parses a table without leading or trailing pipes', () => {
    const src = 'a | b\n--- | ---\n1 | 2';
    expect(parseMarkdown(src)).toEqual([
      { kind: 'table', align: [null, null], header: ['a', 'b'], rows: [['1', '2']] },
    ]);
  });

  /**
   * Verifies that a single-column piped table is accepted
   */
  it('parses a one-column table when the separator has pipes', () => {
    expect(parseMarkdown('| a |\n|---|\n| 1 |')).toEqual([
      { kind: 'table', align: [null], header: ['a'], rows: [['1']] },
    ]);
  });

  /**
   * Verifies that escaped pipes do not create extra columns in a table
   */
  it('keeps escaped pipes inside table cells', () => {
    const blocks = parseMarkdown('| expr | v |\n|---|---|\n| a \\| b | 1 |');
    expect(blocks).toEqual([
      { kind: 'table', align: [null, null], header: ['expr', 'v'], rows: [['a \\| b', '1']] },
    ]);
    expect(parseInline('a \\| b')).toEqual([text('a | b')]);
  });

  /**
   * Verifies that a lone --- under a piped line is a rule, not a one-column table
   */
  it('treats a lone --- under a piped line as a rule', () => {
    expect(parseMarkdown('a | b\n---')).toEqual([{ kind: 'para', text: 'a | b' }, { kind: 'rule' }]);
  });

  /**
   * Verifies that a separator with a different column count yields a paragraph
   */
  it('falls back to a paragraph when separator and header widths differ', () => {
    const src = '| a | b |\n|---|\n| 1 | 2 |';
    expect(parseMarkdown(src)).toEqual([{ kind: 'para', text: src }]);
  });

  /**
   * Verifies that a header line with no separator line stays a paragraph
   */
  it('keeps a lone header line as a paragraph', () => {
    expect(parseMarkdown('| a | b |')).toEqual([{ kind: 'para', text: '| a | b |' }]);
  });

  /**
   * Verifies that a table cut inside its separator degrades to a paragraph
   */
  it('handles a table truncated inside the separator', () => {
    expect(parseMarkdown('| a | b |\n|--')).toEqual([{ kind: 'para', text: '| a | b |\n|--' }]);
  });

  /**
   * Verifies that a table cut mid-row keeps the partial row, padded
   */
  it('handles a table truncated mid-row', () => {
    expect(parseMarkdown('| a | b | c |\n|---|---|---|\n| 1 | 2')).toEqual([
      { kind: 'table', align: [null, null, null], header: ['a', 'b', 'c'], rows: [['1', '2', '']] },
    ]);
  });

  /**
   * Verifies that a table cut inside a code span does not swallow the row
   */
  it('handles a row truncated inside an inline code span', () => {
    expect(parseMarkdown('| a | b |\n|---|---|\n| `x | y')).toEqual([
      { kind: 'table', align: [null, null], header: ['a', 'b'], rows: [['`x', 'y']] },
    ]);
  });

  /**
   * Verifies that a table interrupts a preceding paragraph without a blank line
   */
  it('lets a table interrupt a paragraph', () => {
    expect(parseMarkdown('Voici :\n| a | b |\n|---|---|\n| 1 | 2 |')).toEqual([
      { kind: 'para', text: 'Voici :' },
      { kind: 'table', align: [null, null], header: ['a', 'b'], rows: [['1', '2']] },
    ]);
  });
});

describe('parseMarkdown — headings, rules, quotes', () => {
  /**
   * Verifies that ATX headings keep their level and text
   */
  it.each<[string, number, string]>([
    ['# Titre', 1, 'Titre'],
    ['### Sous-titre', 3, 'Sous-titre'],
    ['###### Six', 6, 'Six'],
    ['## Fermé ##', 2, 'Fermé'],
    ['# C#', 1, 'C#'],
    ['  ## Indenté', 2, 'Indenté'],
  ])('parses %j as a level %d heading', (src, level, t) => {
    expect(parseMarkdown(src)).toEqual([{ kind: 'heading', level, text: t }]);
  });

  /**
   * Verifies that seven hashes or a missing space do not make a heading
   */
  it.each(['####### Sept', '#Collé'])('keeps %j as a paragraph', (src) => {
    expect(parseMarkdown(src)).toEqual([{ kind: 'para', text: src }]);
  });

  /**
   * Verifies that the common thematic break forms produce a rule
   */
  it.each(['---', '***', '___', '- - -', '* * *', '-----'])('parses %j as a rule', (src) => {
    expect(parseMarkdown(src)).toEqual([{ kind: 'rule' }]);
  });

  /**
   * Verifies that two dashes are not enough for a rule
   */
  it('keeps -- as a paragraph', () => {
    expect(parseMarkdown('--')).toEqual([{ kind: 'para', text: '--' }]);
  });

  /**
   * Verifies that consecutive quote lines join into one quote block
   */
  it('joins consecutive quote lines', () => {
    expect(parseMarkdown('> un\n>deux\n> ')).toEqual([{ kind: 'quote', text: 'un\ndeux\n' }]);
  });

  /**
   * Verifies that a line without > ends the quote
   */
  it('ends a quote at the first line without a marker', () => {
    expect(parseMarkdown('> cité\nnormal')).toEqual([
      { kind: 'quote', text: 'cité' },
      { kind: 'para', text: 'normal' },
    ]);
  });
});

describe('parseMarkdown — fenced code', () => {
  /**
   * Verifies that a backtick fence keeps its language and raw body
   */
  it('parses a backtick fence with a language', () => {
    expect(parseMarkdown('```ts\nconst a = 1;\n  indented\n```')).toEqual([
      { kind: 'code', lang: 'ts', text: 'const a = 1;\n  indented' },
    ]);
  });

  /**
   * Verifies that a tilde fence without a language has an empty lang
   */
  it('parses a tilde fence without a language', () => {
    expect(parseMarkdown('~~~\nx\n~~~')).toEqual([{ kind: 'code', lang: '', text: 'x' }]);
  });

  /**
   * Verifies that Markdown inside a fence is kept literally, not parsed
   */
  it('does not parse blocks inside a fence', () => {
    const body = '# pas un titre\n| a | b |\n|---|---|\n- pas une liste\n\n---';
    expect(parseMarkdown('```\n' + body + '\n```')).toEqual([{ kind: 'code', lang: '', text: body }]);
  });

  /**
   * Verifies that a fence of the other character does not close the block
   */
  it('only closes on the same fence character', () => {
    expect(parseMarkdown('~~~\n```\nx\n~~~')).toEqual([{ kind: 'code', lang: '', text: '```\nx' }]);
  });

  /**
   * Verifies that a longer closing fence closes and a shorter one does not
   */
  it('closes on a fence at least as long as the opener', () => {
    expect(parseMarkdown('````\n```\nx\n`````\nafter')).toEqual([
      { kind: 'code', lang: '', text: '```\nx' },
      { kind: 'para', text: 'after' },
    ]);
  });

  /**
   * Verifies that an unclosed fence (truncated message) runs to the end
   */
  it('runs an unclosed fence to the end of the text', () => {
    expect(parseMarkdown('Avant\n```js\nconst a = 1;\nconst b')).toEqual([
      { kind: 'para', text: 'Avant' },
      { kind: 'code', lang: 'js', text: 'const a = 1;\nconst b' },
    ]);
  });

  /**
   * Verifies that a message ending right on an opening fence gives an empty code block
   */
  it('handles text ending on an opening fence', () => {
    expect(parseMarkdown('```')).toEqual([{ kind: 'code', lang: '', text: '' }]);
  });
});

describe('parseMarkdown — lists', () => {
  /**
   * Verifies that dash items form one unordered list starting at 1
   */
  it('parses an unordered list', () => {
    expect(parseMarkdown('- a\n* b\n+ c')).toEqual([
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [
          { text: 'a', sub: [] },
          { text: 'b', sub: [] },
          { text: 'c', sub: [] },
        ],
      },
    ]);
  });

  /**
   * Verifies that an ordered list keeps its starting number, with . or ) markers
   */
  it('parses an ordered list with its start number', () => {
    expect(parseMarkdown('3. trois\n4) quatre')).toEqual([
      {
        kind: 'list',
        ordered: true,
        start: 3,
        items: [
          { text: 'trois', sub: [] },
          { text: 'quatre', sub: [] },
        ],
      },
    ]);
  });

  /**
   * Verifies that indentation nests lists and dedent returns to the parent level
   */
  it('nests items by indentation', () => {
    const [list] = parseMarkdown('- a\n  - b\n    1. c\n- d');
    expect(list).toEqual({
      kind: 'list',
      ordered: false,
      start: 1,
      items: [
        {
          text: 'a',
          sub: [
            {
              kind: 'list',
              ordered: false,
              start: 1,
              items: [
                {
                  text: 'b',
                  sub: [{ kind: 'list', ordered: true, start: 1, items: [{ text: 'c', sub: [] }] }],
                },
              ],
            },
          ],
        },
        { text: 'd', sub: [] },
      ],
    });
  });

  /**
   * Verifies that nesting stops at depth 4 and deeper items join the deepest list
   */
  it('caps nesting at four levels', () => {
    const src = ['- l1', '  - l2', '    - l3', '      - l4', '        - l5'].join('\n');
    const [root] = parseMarkdown(src) as [Extract<Block, { kind: 'list' }>];
    const l2 = root.items[0].sub[0];
    const l3 = l2.items[0].sub[0];
    const l4 = l3.items[0].sub[0];
    expect(root.items.map((x) => x.text)).toEqual(['l1']);
    expect(l2.items.map((x) => x.text)).toEqual(['l2']);
    expect(l3.items.map((x) => x.text)).toEqual(['l3']);
    expect(l4.items.map((x) => x.text)).toEqual(['l4', 'l5']);
    expect(l4.items[0].sub).toEqual([]);
    expect(l4.items[1].sub).toEqual([]);
  });

  /**
   * Verifies that indented continuation lines append to the item text
   */
  it('appends indented continuation lines to the item', () => {
    expect(parseMarkdown('- a\n  suite\n- b')).toEqual([
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [
          { text: 'a\nsuite', sub: [] },
          { text: 'b', sub: [] },
        ],
      },
    ]);
  });

  /**
   * Verifies that one blank line between items keeps a single list
   */
  it('keeps one list across a blank line between items', () => {
    const blocks = parseMarkdown('- a\n\n- b');
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as Extract<Block, { kind: 'list' }>).items.map((x) => x.text)).toEqual(['a', 'b']);
  });

  /**
   * Verifies that a blank line followed by non-item text ends the list
   */
  it('ends the list at a blank line followed by a paragraph', () => {
    expect(kinds(parseMarkdown('- a\n\nTexte'))).toEqual(['list', 'para']);
  });

  /**
   * Verifies that an unindented non-item line ends the list
   */
  it('ends the list at an unindented plain line', () => {
    const blocks = parseMarkdown('- a\nTexte');
    expect(blocks[1]).toEqual({ kind: 'para', text: 'Texte' });
  });

  /**
   * Verifies that a rule written with dashes ends a list instead of becoming an item
   */
  it('ends a list at a - - - rule', () => {
    expect(kinds(parseMarkdown('- a\n- - -\n- b'))).toEqual(['list', 'rule', 'list']);
  });

  /**
   * Verifies that a list item interrupts a paragraph
   */
  it('lets a list interrupt a paragraph', () => {
    expect(kinds(parseMarkdown('Liste :\n- a\n- b'))).toEqual(['para', 'list']);
  });

  /**
   * Verifies that a trailing newline after a list does not throw or add blocks
   */
  it('handles a list at the very end of the text', () => {
    expect(kinds(parseMarkdown('- a\n'))).toEqual(['list']);
  });
});

describe('parseMarkdown — paragraphs and general', () => {
  /**
   * Verifies that consecutive lines join with newlines into one paragraph
   */
  it('joins paragraph lines with newlines', () => {
    expect(parseMarkdown('un\ndeux')).toEqual([{ kind: 'para', text: 'un\ndeux' }]);
  });

  /**
   * Verifies that a blank line separates paragraphs
   */
  it('splits paragraphs on blank lines', () => {
    expect(parseMarkdown('un\n\n\ndeux')).toEqual([
      { kind: 'para', text: 'un' },
      { kind: 'para', text: 'deux' },
    ]);
  });

  /**
   * Verifies that block starts interrupt a paragraph without a blank line
   */
  it.each([
    ['# h', 'heading'],
    ['> q', 'quote'],
    ['```', 'code'],
    ['***', 'rule'],
    ['1. x', 'list'],
  ])('lets %j interrupt a paragraph', (line, kind) => {
    expect(kinds(parseMarkdown('texte\n' + line))).toEqual(['para', kind]);
  });

  /**
   * Verifies that CRLF and CR line endings are normalised
   */
  it('normalises Windows and old Mac line endings', () => {
    expect(parseMarkdown('a\r\nb\rc')).toEqual([{ kind: 'para', text: 'a\nb\nc' }]);
  });

  /**
   * Verifies that empty or whitespace-only text yields no blocks
   */
  it.each(['', '   ', '\n\n  \n'])('returns no blocks for %j', (src) => {
    expect(parseMarkdown(src)).toEqual([]);
  });

  /**
   * Verifies that arithmetic with spaced stars stays a plain paragraph
   */
  it('keeps 2 * 3 * 4 as a paragraph', () => {
    expect(parseMarkdown('2 * 3 * 4')).toEqual([{ kind: 'para', text: '2 * 3 * 4' }]);
  });

  /**
   * Verifies that a full realistic agent report parses into the expected block sequence
   */
  it('parses a realistic agent summary', () => {
    const src = [
      '## Résumé',
      '',
      '| Étape | Statut | Notes |',
      '|---|---|---|',
      '| Tests | ⏭ | Que de la configuration, `a|b` |',
      '| Revue | ✅ | RAS |',
      '',
      '**Points non bloquants** : `README.md` à relire.',
      '- un',
      '- deux',
      '',
      '---',
      '',
      '```bash',
      'npm test',
      '```',
    ].join('\n');
    const blocks = parseMarkdown(src);
    expect(kinds(blocks)).toEqual(['heading', 'table', 'para', 'list', 'rule', 'code']);
    expect((blocks[1] as Extract<Block, { kind: 'table' }>).rows).toEqual([
      ['Tests', '⏭', 'Que de la configuration, `a|b`'],
      ['Revue', '✅', 'RAS'],
    ]);
    expect(blocks[5]).toEqual({ kind: 'code', lang: 'bash', text: 'npm test' });
  });
});

describe('parseMarkdown — robustness on truncated input', () => {
  const sample = [
    '# Titre **gras',
    '',
    '| Étape | Statut | Notes |',
    '|:---|:---:|---:|',
    '| Tests | ⏭ | `a|b` et \\| échappé |',
    '',
    '> cité *em*',
    '- un',
    '  - deux `code`',
    '    1. trois',
    '',
    '- quatre [lien](http://x "t")',
    '***',
    '```ts',
    'const x = `y`;',
    '```',
    '**Points non bloquants** : snake_case, 2 * 3 * 4.',
  ].join('\n');

  const inlineTexts = (blocks: Block[]): string[] =>
    blocks.flatMap((b): string[] => {
      switch (b.kind) {
        case 'para':
        case 'heading':
        case 'quote':
        case 'code':
          return [b.text];
        case 'table':
          return [...b.header, ...b.rows.flat()];
        case 'list': {
          const walk = (l: Extract<Block, { kind: 'list' }>): string[] =>
            l.items.flatMap((it) => [it.text, ...it.sub.flatMap(walk)]);
          return walk(b);
        }
        default:
          return [];
      }
    });

  /**
   * Verifies that every prefix of a realistic message parses without throwing
   */
  it('never throws on any prefix of a realistic message', () => {
    for (let n = 0; n <= sample.length; n++) {
      const cut = sample.slice(0, n);
      expect(() => {
        const blocks = parseMarkdown(cut);
        for (const t of inlineTexts(blocks)) parseInline(t);
        for (const line of cut.split('\n')) splitRow(line);
      }, `prefix of length ${n}`).not.toThrow();
    }
  });

  /**
   * Verifies that inline parsing never drops characters of unmatched markers
   */
  it('keeps every character of truncated inline text', () => {
    const flat = (xs: Inline[]): string =>
      xs.map((x) => (x.kind === 'text' || x.kind === 'code' ? x.text : flat(x.children))).join('');
    for (const cut of ['**gras', '*em', '`code', '``a`', '[lien](http', 'a **b *c', 'x \\']) {
      expect(flat(parseInline(cut))).toBe(cut);
    }
  });
});

describe('parseInline', () => {
  /**
   * Verifies that plain text is one text node and empty text yields nothing
   */
  it('returns plain text as a single node', () => {
    expect(parseInline('bonjour')).toEqual([text('bonjour')]);
    expect(parseInline('')).toEqual([]);
  });

  /**
   * Verifies that code spans become code nodes with surrounding text kept
   */
  it('parses code spans', () => {
    expect(parseInline('voir `npm test` ici')).toEqual([text('voir '), code('npm test'), text(' ici')]);
  });

  /**
   * Verifies that a double-backtick span may contain a single backtick
   */
  it('parses multi-backtick code spans', () => {
    expect(parseInline('``a ` b``')).toEqual([code('a ` b')]);
  });

  /**
   * Verifies that one padding space on each side of a code span is stripped
   */
  it('strips one space of padding in code spans', () => {
    expect(parseInline('` x `')).toEqual([code('x')]);
  });

  /**
   * Verifies that markers inside a code span are not interpreted
   */
  it('does not parse emphasis or escapes inside code', () => {
    expect(parseInline('`**x** \\*`')).toEqual([code('**x** \\*')]);
  });

  /**
   * Verifies that an unclosed backtick stays literal text
   */
  it('keeps an unclosed backtick as text', () => {
    expect(parseInline('a `b')).toEqual([text('a `b')]);
  });

  /**
   * Verifies that **text** becomes a strong node
   */
  it('parses strong', () => {
    expect(parseInline('**gras** fin')).toEqual([strong(text('gras')), text(' fin')]);
  });

  /**
   * Verifies that *text* becomes an em node
   */
  it('parses emphasis', () => {
    expect(parseInline('un *mot* ici')).toEqual([text('un '), em(text('mot')), text(' ici')]);
  });

  /**
   * Verifies that emphasis nested inside strong is parsed recursively
   */
  it('parses emphasis inside strong', () => {
    expect(parseInline('**a *b* c**')).toEqual([strong(text('a '), em(text('b')), text(' c'))]);
  });

  /**
   * Verifies that a ** inside a code span does not close a strong span
   */
  it('skips code spans when looking for the strong closer', () => {
    expect(parseInline('**a `**` b**')).toEqual([strong(text('a '), code('**'), text(' b'))]);
  });

  /**
   * Verifies that code spans inside strong are parsed as code
   */
  it('parses code inside strong', () => {
    expect(parseInline('**voir `x`**')).toEqual([strong(text('voir '), code('x'))]);
  });

  /**
   * Verifies that underscores are never emphasis, so identifiers stay intact
   */
  it.each(['snake_case', '__init__', 'mon_fichier_test.ts', '_pas_em_'])('keeps %j literal', (src) => {
    expect(parseInline(src)).toEqual([text(src)]);
  });

  /**
   * Verifies that stars surrounded by spaces stay literal (arithmetic)
   */
  it.each(['2 * 3 * 4', 'a ** b', '* a*', 'a *b *'])('keeps %j literal', (src) => {
    expect(parseInline(src)).toEqual([text(src)]);
  });

  /**
   * Verifies that unmatched emphasis markers stay as text
   */
  it.each(['**ouvert', '*ouvert', 'fin*'])('keeps unmatched %j literal', (src) => {
    expect(parseInline(src)).toEqual([text(src)]);
  });

  /**
   * Verifies that a stray backtick inside an emphasis is literal and does not cancel it
   */
  it('keeps an emphasis around a stray backtick', () => {
    expect(parseInline('*a `b*')).toEqual([em(text('a `b'))]);
  });

  /**
   * Verifies that links keep only their label, with inline markup parsed
   */
  it('keeps only the label of links', () => {
    expect(parseInline('voir [la doc](https://example.com/x) ok')).toEqual([text('voir '), text('la doc'), text(' ok')]);
    expect(parseInline('[**b**](u "titre")')).toEqual([strong(text('b'))]);
  });

  /**
   * Verifies that bracket text that is not a link stays literal
   */
  it.each(['[pas un lien]', '[a] (u)', '[](u)'])('keeps %j literal', (src) => {
    expect(parseInline(src)).toEqual([text(src)]);
  });

  /**
   * Verifies that backslash escapes produce the literal marker character
   */
  it('applies backslash escapes', () => {
    expect(parseInline('\\*pas em\\* \\`x\\` a\\|b \\\\')).toEqual([text('*pas em* `x` a|b \\')]);
  });

  /**
   * Verifies that a backslash before a non-escapable char or at the end stays
   */
  it('keeps backslashes that escape nothing', () => {
    expect(parseInline('C:\\dossier')).toEqual([text('C:\\dossier')]);
    expect(parseInline('fin\\')).toEqual([text('fin\\')]);
  });

  /**
   * Verifies that an escaped star inside strong does not close it early
   */
  it('ignores escaped stars when looking for the strong closer', () => {
    expect(parseInline('**a \\** b**')).toEqual([strong(text('a ** b'))]);
  });
});

describe('markdown — regressions', () => {
  /**
   * Verifies that a strong span nested in an emphasis stays inside it
   */
  it('nests strong inside em', () => {
    expect(parseInline('*a **b** c*')).toEqual([em(text('a '), strong(text('b')), text(' c'))]);
    expect(parseInline('*voir **ceci***')).toEqual([em(text('voir '), strong(text('ceci')))]);
  });

  /**
   * Verifies that a line starting with a triple-backtick code span is not a fence
   */
  it('does not open a fence on a triple-backtick code span', () => {
    const blocks = parseMarkdown('```x``` suite\nautre ligne');
    expect(blocks).toEqual([{ kind: 'para', text: '```x``` suite\nautre ligne' }]);
    expect(parseInline('```x``` suite')).toEqual([code('x'), text(' suite')]);
  });

  /**
   * Verifies that dedenting between two nesting levels gives a sibling, not a deeper child
   */
  it('keeps a half-dedented item as a sibling of the nested one', () => {
    const [list] = parseMarkdown('- a\n    - b\n  - c') as [Extract<Block, { kind: 'list' }>];
    expect(list.items).toHaveLength(1);
    expect(list.items[0].sub).toHaveLength(1);
    expect(list.items[0].sub[0].items.map((i) => i.text)).toEqual(['b', 'c']);
    expect(list.items[0].sub[0].items[0].sub).toEqual([]);
  });
});

describe('markdown — audit fixes', () => {
  /**
   * Verifies that a fenced block inside a list item, blank line included, stays one code block
   * and does not flip the fences that follow
   */
  it('reads a fenced block inside a list item whole', () => {
    const src = '- step\n  ```bash\n  npm i\n\n  npm test\n  ```\n\nDone';
    const blocks = parseMarkdown(src);
    expect(kinds(blocks)).toEqual(['list', 'code', 'para']);
    expect(blocks[1]).toEqual({ kind: 'code', lang: 'bash', text: 'npm i\n\nnpm test' });
    expect(blocks[2]).toEqual({ kind: 'para', text: 'Done' });
  });

  /**
   * Verifies that bold-italic and an em closing a strong span leave no stray star
   */
  it('closes strong on the last two stars of a run', () => {
    expect(parseInline('***x***')).toEqual([strong(em(text('x')))]);
    expect(parseInline('**voir *ceci***')).toEqual([strong(text('voir '), em(text('ceci')))]);
  });

  /**
   * Verifies that a stray backtick inside bold does not cancel the bold
   */
  it('keeps bold around a stray backtick', () => {
    expect(parseInline('**don`t**')).toEqual([strong(text('don`t'))]);
  });

  /**
   * Verifies that a closing run of # is stripped and an attached # is kept
   */
  it('strips only a separated closing run of #', () => {
    expect(parseMarkdown('## Titre ##')).toEqual([{ kind: 'heading', level: 2, text: 'Titre' }]);
    expect(parseMarkdown('# C#')).toEqual([{ kind: 'heading', level: 1, text: 'C#' }]);
  });

  /**
   * Verifies that a table wider than the column cap stays text and a long one is cut
   */
  it('caps table size', () => {
    const wide = `${'|a'.repeat(31)}|\n${'|-'.repeat(31)}|`;
    expect(kinds(parseMarkdown(wide))).not.toContain('table');
    const long = `| a | b |\n|---|---|\n${'| x | y |\n'.repeat(5000)}`;
    const table = parseMarkdown(long)[0] as Extract<Block, { kind: 'table' }>;
    expect(table.kind).toBe('table');
    expect((table.rows.length + 1) * 2).toBeLessThanOrEqual(3000);
  });

  /**
   * Verifies that a list line ends a table even when it contains a pipe
   */
  it('ends a table at another block', () => {
    const blocks = parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n- item | x');
    expect(kinds(blocks)).toEqual(['table', 'list']);
  });

  /**
   * Verifies that a link found mid-text keeps its label (sticky matching)
   */
  it('keeps link labels anywhere in the text', () => {
    expect(parseInline('voir [a](u) et [b](v)')).toEqual([text('voir '), text('a'), text(' et '), text('b')]);
  });
});
