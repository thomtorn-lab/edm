import { formatDescription, previewBlockCount, type DescriptionBlock, type DescriptionInline } from "@/lib/descriptionFormat";
import ShowMore from "./ShowMore";

/**
 * The event page's About text (About-text formatting work package,
 * 2026-10-15). Renders the block list from src/lib/descriptionFormat.ts with
 * plain React elements only — source text is always escaped by React, never
 * injected as HTML, and the only links are validated http(s) URLs that were
 * already in the description.
 *
 * Typography stays inside the page's existing scale: body text keeps the
 * previous text-sm/leading-relaxed/text-text-secondary treatment, headings
 * differ by weight and colour rather than size, and line length is capped
 * (max-w-prose) so long bios stay readable on desktop. overflow-wrap:anywhere
 * keeps a long unbroken token (a URL the source truncated, an email address)
 * from forcing horizontal scroll on mobile.
 */
export default function EventDescription({ text, headingHints }: { text: string; headingHints?: readonly string[] }) {
  const blocks = formatDescription(text, { headingHints });
  if (blocks.length === 0) return null;
  const render = (from: number, to: number) =>
    blocks.slice(from, to).map((block, i) => <Block key={from + i} block={block} previous={blocks[from + i - 1]} isFirst={from + i === 0} />);
  // Long texts fold behind "Show more" (src/components/ShowMore.tsx); the
  // folded part is still rendered into the HTML. Short texts show in full.
  const split = previewBlockCount(blocks);
  return (
    <div className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
      {split === null ? render(0, blocks.length) : <ShowMore preview={render(0, split)} rest={render(split, blocks.length)} />}
    </div>
  );
}

function Block({ block, previous, isFirst }: { block: DescriptionBlock; previous?: DescriptionBlock; isFirst: boolean }) {
  if (block.type === "heading") {
    // A section title directly followed by an entry heading (e.g. "Lineup"
    // then "☆ BK [he/him]") sits close to it; any heading after body text
    // gets clear separation from the section above.
    const spacing = isFirst ? "" : previous?.type === "heading" ? "mt-2" : "mt-6";
    if (block.level === "section") {
      return (
        <h3 className={`${spacing} text-[11px] font-semibold uppercase tracking-wide text-text-secondary-strong`}>
          <Inline tokens={block.content} />
        </h3>
      );
    }
    return (
      <h4 className={`${spacing} font-semibold text-text-primary`}>
        <Inline tokens={block.content} />
      </h4>
    );
  }
  // Body directly under its heading stays attached to it.
  const spacing = isFirst ? "" : previous?.type === "heading" ? "mt-1" : "mt-3";
  return (
    <p className={spacing}>
      {block.lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          <Inline tokens={line} />
        </span>
      ))}
    </p>
  );
}

function Inline({ tokens }: { tokens: DescriptionInline[] }) {
  return (
    <>
      {tokens.map((t, i) =>
        t.type === "text" ? (
          <span key={i}>{t.text}</span>
        ) : (
          <a
            key={i}
            href={t.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="text-text-secondary-strong underline decoration-border-strong decoration-1 underline-offset-2 transition-colors hover:text-text-primary hover:decoration-current focus-visible:text-text-primary focus-visible:decoration-current"
          >
            {t.label}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ),
      )}
    </>
  );
}
