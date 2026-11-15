import { memo, useMemo, type ReactNode } from 'react';
import { parseInline, parseMarkdown, type Block, type Inline, type ListBlock } from './markdown.ts';

function spans(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case 'text':
        return n.text;
      case 'code':
        return <code key={i}>{n.text}</code>;
      case 'strong':
        return <strong key={i}>{spans(n.children)}</strong>;
      case 'em':
        return <em key={i}>{spans(n.children)}</em>;
    }
  });
}

const inline = (text: string) => spans(parseInline(text));

function List({ list }: { list: ListBlock }) {
  const items = list.items.map((item, i) => (
    <li key={i}>
      {inline(item.text)}
      {item.sub.map((sub, j) => (
        <List key={j} list={sub} />
      ))}
    </li>
  ));
  return list.ordered ? (
    <ol className="md-list" start={list.start}>
      {items}
    </ol>
  ) : (
    <ul className="md-list">{items}</ul>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'para':
      return <p>{inline(block.text)}</p>;
    // No <h1>-<h6>, whose levels would clash with the page's: ARIA headings placed under the
    // box's own h2, so screen readers still jump between a message's titles.
    case 'heading':
      return (
        <p role="heading" aria-level={Math.min(block.level + 2, 6)} className={block.level === 1 ? 'md-heading md-heading--1' : 'md-heading'}>
          {inline(block.text)}
        </p>
      );
    case 'list':
      return <List list={block} />;
    case 'quote':
      return <blockquote className="md-quote">{inline(block.text)}</blockquote>;
    case 'code':
      return (
        <pre className="md-code">
          <code>{block.text}</code>
        </pre>
      );
    case 'rule':
      return <hr className="md-rule" />;
    case 'table':
      return (
        <table className="md-table">
          <thead>
            <tr>
              {block.header.map((cell, i) => (
                <th key={i} scope="col" style={block.align[i] ? { textAlign: block.align[i] } : undefined}>
                  {inline(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => (
                  <td key={i} style={block.align[i] ? { textAlign: block.align[i] } : undefined}>
                    {inline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

/**
 * A message rendered from its Markdown: React elements only, never raw HTML. Memoized on its
 * text, so the 2 s polling and snapshot updates never re-parse unchanged messages.
 */
export const MessageText = memo(function MessageText({ text }: { text: string }) {
  return useMemo(() => parseMarkdown(text).map((b, i) => <BlockView key={i} block={b} />), [text]);
});
