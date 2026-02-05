import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';

type MarkdownVariant = 'assistant' | 'user';

type MarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; language?: string; code: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'blockquote'; blocks: MarkdownBlock[] }
  | { type: 'hr' };

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n?/g, '\n');
}

function isCodeFenceStart(line: string): { language?: string } | null {
  const match = /^```(.*)$/.exec(line.trim());
  if (!match) return null;
  const language = match[1]?.trim();
  return { language: language || undefined };
}

function isHeading(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})\s+(.*)$/.exec(line);
  if (!match) return null;
  return { level: match[1].length, text: match[2] ?? '' };
}

function isHorizontalRule(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed);
}

function isBlockquote(line: string): boolean {
  return line.trimStart().startsWith('>');
}

function isUnorderedListItem(line: string): { indent: number; text: string } | null {
  const match = /^(\s*)([-+*])\s+(.+)$/.exec(line);
  if (!match) return null;
  return { indent: match[1]?.length ?? 0, text: match[3] ?? '' };
}

function isOrderedListItem(line: string): { indent: number; text: string } | null {
  const match = /^(\s*)(\d+)\.\s+(.+)$/.exec(line);
  if (!match) return null;
  return { indent: match[1]?.length ?? 0, text: match[3] ?? '' };
}

function isStartOfBlock(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isCodeFenceStart(line)) return true;
  if (isHeading(line)) return true;
  if (isHorizontalRule(line)) return true;
  if (isBlockquote(line)) return true;
  if (isUnorderedListItem(line)) return true;
  if (isOrderedListItem(line)) return true;
  return false;
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const src = normalizeNewlines(markdown);
  const lines = src.split('\n');
  const blocks: MarkdownBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Code fence
    const fence = isCodeFenceStart(line);
    if (fence) {
      const language = fence.language;
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !isCodeFenceStart(lines[i] ?? '')) {
        codeLines.push(lines[i] ?? '');
        i += 1;
      }
      // Skip closing fence if present
      if (i < lines.length && isCodeFenceStart(lines[i] ?? '')) i += 1;

      blocks.push({ type: 'code', language, code: codeLines.join('\n') });
      continue;
    }

    // Heading
    const heading = isHeading(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading.level, text: heading.text });
      i += 1;
      continue;
    }

    // HR
    if (isHorizontalRule(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    // Blockquote (recursive)
    if (isBlockquote(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && isBlockquote(lines[i] ?? '')) {
        const raw = lines[i] ?? '';
        const stripped = raw.trimStart().replace(/^>\s?/, '');
        quoteLines.push(stripped);
        i += 1;
      }
      const inner = quoteLines.join('\n');
      blocks.push({ type: 'blockquote', blocks: parseMarkdownBlocks(inner) });
      continue;
    }

    // List
    const unordered = isUnorderedListItem(line);
    const ordered = unordered ? null : isOrderedListItem(line);
    if (unordered || ordered) {
      const orderedList = !!ordered;
      const indent = (unordered ?? ordered)!.indent;

      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        const u = orderedList ? null : isUnorderedListItem(current);
        const o = orderedList ? isOrderedListItem(current) : null;
        const item = (u ?? o);
        if (!item || item.indent !== indent) break;

        i += 1;
        const continuation: string[] = [];
        while (i < lines.length) {
          const next = lines[i] ?? '';
          if (!next.trim()) break;
          if (isStartOfBlock(next) && (isUnorderedListItem(next) || isOrderedListItem(next))) break;
          // Continuation lines must be indented at least 2 spaces beyond marker indent.
          if ((next.match(/^\s*/)?.[0].length ?? 0) <= indent + 1) break;
          continuation.push(next.trim());
          i += 1;
        }

        const text = continuation.length ? `${item.text}\n${continuation.join('\n')}` : item.text;
        items.push(text);

        // Consume optional blank line between items
        while (i < lines.length && !lines[i]?.trim()) i += 1;
      }

      blocks.push({ type: 'list', ordered: orderedList, items });
      continue;
    }

    // Paragraph
    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? '';
      if (!current.trim()) break;
      if (isStartOfBlock(current)) break;
      paragraphLines.push(current);
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join('\n') });
  }

  return blocks;
}

function isSafeLinkHref(href: string): boolean {
  const trimmed = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(trimmed);
}

function extractUrlAt(text: string, startIdx: number): { url: string; length: number } | null {
  const slice = text.slice(startIdx);
  const match = /^(https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/i.exec(slice);
  if (!match) return null;

  let url = match[1] ?? '';
  // Trim common trailing punctuation.
  while (/[),.;!?]$/.test(url)) url = url.slice(0, -1);

  const fullUrl = url.toLowerCase().startsWith('www.') ? `https://${url}` : url;
  if (!isSafeLinkHref(fullUrl)) return null;

  return { url: fullUrl, length: url.length };
}

function renderInlines(text: string, keyPrefix: string, variant: MarkdownVariant, depth = 0): Array<string | JSX.Element> {
  if (depth > 12) return [text];

  const nodes: Array<string | JSX.Element> = [];
  let buffer = '';
  let k = 0;

  const codeClass =
    variant === 'user'
      ? 'font-mono text-[0.85em] bg-primary-foreground/15 px-1 py-0.5 rounded'
      : 'font-mono text-[0.85em] bg-muted/60 px-1 py-0.5 rounded';

  const linkClass =
    variant === 'user'
      ? 'underline underline-offset-2 text-primary-foreground/90 hover:text-primary-foreground'
      : 'text-primary underline underline-offset-2 hover:text-primary/80';

  const flush = () => {
    if (!buffer) return;
    nodes.push(buffer);
    buffer = '';
  };

  const pushEl = (el: JSX.Element) => {
    nodes.push(el);
    k += 1;
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';

    if (ch === '\n') {
      flush();
      pushEl(<br key={`${keyPrefix}-br-${k}`} />);
      i += 1;
      continue;
    }

    // Inline code
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        const code = text.slice(i + 1, end);
        flush();
        pushEl(
          <code key={`${keyPrefix}-code-${k}`} className={codeClass}>
            {code}
          </code>
        );
        i = end + 1;
        continue;
      }
    }

    // Markdown link: [label](href)
    if (ch === '[') {
      const closeBracket = text.indexOf(']', i + 1);
      const openParen = closeBracket !== -1 ? text[closeBracket + 1] : '';
      if (closeBracket !== -1 && openParen === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const label = text.slice(i + 1, closeBracket);
          const href = text.slice(closeBracket + 2, closeParen);
          const safeHref = href.trim();

          flush();
          if (isSafeLinkHref(safeHref)) {
            pushEl(
              <a
                key={`${keyPrefix}-link-${k}`}
                href={safeHref}
                className={linkClass}
                target="_blank"
                rel="noreferrer"
              >
                {renderInlines(label, `${keyPrefix}-link-${k}`, variant, depth + 1)}
              </a>
            );
          } else {
            nodes.push(`[${label}](${href})`);
          }

          i = closeParen + 1;
          continue;
        }
      }
    }

    // Auto-link URLs
    const maybeUrl = extractUrlAt(text, i);
    if (maybeUrl) {
      flush();
      pushEl(
        <a
          key={`${keyPrefix}-autolink-${k}`}
          href={maybeUrl.url}
          className={linkClass}
          target="_blank"
          rel="noreferrer"
        >
          {text.slice(i, i + maybeUrl.length)}
        </a>
      );
      i += maybeUrl.length;
      continue;
    }

    // Strong (**text** or __text__)
    const strongDelim = text.startsWith('**', i) ? '**' : text.startsWith('__', i) ? '__' : null;
    if (strongDelim) {
      const end = text.indexOf(strongDelim, i + strongDelim.length);
      if (end !== -1) {
        const inner = text.slice(i + strongDelim.length, end);
        flush();
        pushEl(
          <strong key={`${keyPrefix}-strong-${k}`}>
            {renderInlines(inner, `${keyPrefix}-strong-${k}`, variant, depth + 1)}
          </strong>
        );
        i = end + strongDelim.length;
        continue;
      }
    }

    // Strikethrough (~~text~~)
    if (text.startsWith('~~', i)) {
      const end = text.indexOf('~~', i + 2);
      if (end !== -1) {
        const inner = text.slice(i + 2, end);
        flush();
        pushEl(
          <del key={`${keyPrefix}-del-${k}`}>
            {renderInlines(inner, `${keyPrefix}-del-${k}`, variant, depth + 1)}
          </del>
        );
        i = end + 2;
        continue;
      }
    }

    // Emphasis (*text*)
    if (ch === '*') {
      // Avoid treating "**" as emphasis.
      if (!text.startsWith('**', i)) {
        const end = text.indexOf('*', i + 1);
        if (end !== -1) {
          const inner = text.slice(i + 1, end);
          flush();
          pushEl(
            <em key={`${keyPrefix}-em-${k}`}>
              {renderInlines(inner, `${keyPrefix}-em-${k}`, variant, depth + 1)}
            </em>
          );
          i = end + 1;
          continue;
        }
      }
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return nodes;
}

function CodeBlock({ code, language, variant }: { code: string; language?: string; variant: MarkdownVariant }) {
  const [copied, setCopied] = useState(false);
  const headerText = language?.trim() || 'code';

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // noop
    }
  };

  return (
    <div
      className={cn(
        'rounded-md border overflow-hidden min-w-0',
        variant === 'user' ? 'border-primary-foreground/20 bg-primary-foreground/10' : 'border-border bg-muted/30'
      )}
    >
      <div className={cn('flex items-center justify-between gap-2 px-2 py-1 text-[11px]', variant === 'user' ? 'text-primary-foreground/90' : 'text-muted-foreground')}>
        <span className="font-mono truncate">{headerText}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('h-6 w-6', variant === 'user' ? 'hover:bg-primary-foreground/15' : 'hover:bg-muted')}
          onClick={onCopy}
          aria-label="Copy code"
          title="Copy code"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </Button>
      </div>
      <pre className="m-0 p-2 text-xs overflow-x-auto">
        <code className={cn('font-mono whitespace-pre', variant === 'user' ? 'text-primary-foreground' : 'text-foreground')}>
          {code}
        </code>
      </pre>
    </div>
  );
}

export function ChatMarkdown({ content, className, variant = 'assistant' }: { content: string; className?: string; variant?: MarkdownVariant }) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  const renderBlock = (block: MarkdownBlock, key: string): JSX.Element => {
    switch (block.type) {
      case 'heading': {
        const Tag = block.level <= 2 ? 'h3' : 'h4';
        const sizeClass = block.level === 1 ? 'text-base' : block.level === 2 ? 'text-sm' : 'text-sm';
        return (
          <Tag key={key} className={cn('font-semibold', sizeClass)}>
            {renderInlines(block.text, key, variant)}
          </Tag>
        );
      }
      case 'paragraph':
        return (
          <p key={key} className="whitespace-pre-wrap">
            {renderInlines(block.text, key, variant)}
          </p>
        );
      case 'code':
        return <CodeBlock key={key} code={block.code} language={block.language} variant={variant} />;
      case 'list': {
        const ListTag = block.ordered ? 'ol' : 'ul';
        return (
          <ListTag
            key={key}
            className={cn(
              'pl-5 space-y-1',
              block.ordered ? 'list-decimal' : 'list-disc',
              variant === 'user' ? 'marker:text-primary-foreground/70' : 'marker:text-muted-foreground'
            )}
          >
            {block.items.map((item, itemIdx) => (
              <li key={`${key}-li-${itemIdx}`} className="whitespace-pre-wrap">
                {renderInlines(item, `${key}-li-${itemIdx}`, variant)}
              </li>
            ))}
          </ListTag>
        );
      }
      case 'blockquote':
        return (
          <blockquote
            key={key}
            className={cn(
              'border-l-2 pl-3 italic space-y-3',
              variant === 'user' ? 'border-primary-foreground/40 text-primary-foreground/90' : 'border-border text-muted-foreground'
            )}
          >
            {block.blocks.map((inner, innerIdx) => renderBlock(inner, `${key}-q-${innerIdx}`))}
          </blockquote>
        );
      case 'hr':
        return <hr key={key} className={variant === 'user' ? 'border-primary-foreground/20' : 'border-border'} />;
    }
  };

  return (
    <div className={cn('text-sm leading-relaxed break-words space-y-3', className)}>
      {blocks.map((block, idx) => renderBlock(block, `md-${idx}`))}
    </div>
  );
}
