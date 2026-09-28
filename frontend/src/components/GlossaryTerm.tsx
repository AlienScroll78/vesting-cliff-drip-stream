import React from 'react';
import { Tooltip } from './Tooltip';
import { lookupTerm } from '../glossary-tooltips';

const DOCS_BASE = 'docs/glossary.md';

export interface GlossaryTermProps {
  /** The term key — must match a key in GLOSSARY (case-insensitive) */
  term: string;
  /** Optional custom display label. Defaults to the term's canonical label. */
  children?: React.ReactNode;
}

/**
 * GlossaryTerm
 *
 * Wraps any technical term and surfaces its definition as an accessible tooltip.
 * The tooltip body includes the definition and a link to docs/glossary.md.
 *
 * Usage:
 *   <GlossaryTerm term="cliff" />
 *   <GlossaryTerm term="ledger">current ledger</GlossaryTerm>
 */
export function GlossaryTerm({ term, children }: GlossaryTermProps) {
  const entry = lookupTerm(term);

  // If no glossary entry exists, render children (or term) without tooltip
  if (!entry) {
    return <>{children ?? term}</>;
  }

  const tooltipContent = (
    <span>
      <strong style={{ display: 'block', marginBottom: '0.25rem' }}>
        {entry.label}
      </strong>
      {entry.definition}
      <a
        href={`${DOCS_BASE}#${entry.anchor}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'block',
          marginTop: '0.4rem',
          fontSize: '0.78rem',
          color: '#7eb8f7',
          pointerEvents: 'auto',
        }}
        // Stop tooltip hide on link click
        onMouseDown={(e) => e.stopPropagation()}
      >
        Learn more →
      </a>
    </span>
  );

  return (
    <Tooltip content={tooltipContent}>
      {children ?? entry.label}
    </Tooltip>
  );
}

export default GlossaryTerm;
