import { useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { lookupTerm } from "../glossary-tooltips";
import styles from "./GlossaryTerm.module.css";

const GLOSSARY_URL =
  "https://github.com/olarh0170-netizen/vesting-cliff-drip-stream/blob/main/docs/glossary.md";

export interface GlossaryTermProps {
  /** The term key — matches a key or canonical label in the glossary. */
  term: string;
  /** Optional custom display label. Defaults to the term's canonical label. */
  children?: ReactNode;
}

export function GlossaryTerm({ term, children }: GlossaryTermProps) {
  const entry = lookupTerm(term);
  const [isOpen, setIsOpen] = useState(false);
  const tooltipId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);

  if (!entry) return <>{children ?? term}</>;

  function handleBlur(event: FocusEvent<HTMLSpanElement>) {
    if (
      !(event.relatedTarget instanceof Node) ||
      !event.currentTarget.contains(event.relatedTarget)
    ) {
      setIsOpen(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") setIsOpen(false);
  }

  return (
    <span
      ref={wrapperRef}
      className={styles.wrapper}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onFocus={() => setIsOpen(true)}
      onBlur={handleBlur}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
      >
        {children ?? entry.label}
      </button>
      {isOpen && (
        <span id={tooltipId} role="tooltip" className={styles.tooltip}>
          <strong className={styles.label}>{entry.label}</strong>
          <span>{entry.definition}</span>
          <a
            className={styles.link}
            href={`${GLOSSARY_URL}#${entry.anchor}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Learn more
          </a>
        </span>
      )}
    </span>
  );
}

export default GlossaryTerm;
