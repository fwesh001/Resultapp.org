import type { ReactNode } from "react";
import type { LegalBlock, LegalSection as LegalSectionData } from "@/lib/legal/types";

/**
 * Splits a string on `**bold**` markers and returns React nodes.
 * Legal copy uses `**` for defined terms and emphasis, so the document
 * payloads stay plain text and this stays the only place markers are parsed.
 */
function renderInline(text: string): ReactNode[] {
  const parts = text.split("**");
  return parts.map((part, index) =>
    // Odd indices sit between a pair of `**` markers.
    index % 2 === 1 ? (
      <strong key={index} className="font-semibold text-purple-100">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

function Block({ block }: { block: LegalBlock }) {
  switch (block.kind) {
    case "h3":
      return (
        <h3 className="mt-7 text-base font-semibold tracking-tight text-white">
          {renderInline(block.text)}
        </h3>
      );

    case "p":
      return (
        <p className="mt-4 text-sm leading-7 text-purple-200/65">
          {renderInline(block.text)}
        </p>
      );

    case "note":
      return (
        <div className="mt-5 rounded-2xl border border-purple-500/20 bg-purple-900/10 p-5 backdrop-blur">
          <p className="text-sm leading-7 text-purple-200/75">{renderInline(block.text)}</p>
        </div>
      );

    case "ul":
      return (
        <ul className="mt-4 space-y-2.5">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-3 text-sm leading-7 text-purple-200/65">
              <span
                aria-hidden="true"
                className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-500"
              />
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );

    case "ol":
      return (
        <ol className="mt-4 space-y-2.5">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-3 text-sm leading-7 text-purple-200/65">
              <span
                aria-hidden="true"
                className="mt-1 shrink-0 font-mono text-xs font-semibold text-purple-400/80"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );

    case "table":
      return (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-purple-500/15 bg-purple-900/10">
          <table className="w-full min-w-[36rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-purple-500/15">
                {block.head.map((cell, index) => (
                  <th
                    key={index}
                    scope="col"
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-purple-300/80"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="border-b border-purple-500/10 last:border-0 even:bg-purple-950/20"
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="px-4 py-3 align-top text-sm leading-6 text-purple-200/65"
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/**
 * Renders one numbered section of a legal document. The <h2> carries the
 * section id so the table of contents in LegalDocument can link to it.
 */
export function LegalSection({ section }: { section: LegalSectionData }) {
  return (
    <section id={section.id} className="scroll-mt-24">
      <h2 className="text-xl font-bold tracking-tight text-white md:text-2xl">
        {section.heading}
      </h2>
      <div className="mt-1">
        {section.blocks.map((block, index) => (
          <Block key={index} block={block} />
        ))}
      </div>
    </section>
  );
}
