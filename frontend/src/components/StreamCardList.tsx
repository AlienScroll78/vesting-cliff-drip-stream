"use client";
/**
 * StreamCardList — keyboard-navigable listbox for vesting stream cards (#389)
 *
 * Implements the ARIA listbox / option pattern:
 *  - role="listbox" with aria-activedescendant to track keyboard focus
 *  - Arrow Up/Down to move between cards
 *  - Home / End to jump to first / last card
 *  - Enter / Space to activate the focused card (calls onActivate)
 *
 * Usage:
 *   <StreamCardList
 *     streamIds={streams.map(s => s.id)}
 *     activeId={activeId}
 *     onActivate={(id) => openClaimSheet(id)}
 *     ariaLabel="Vesting streams"
 *   >
 *     {streams.map(s => (
 *       <li key={s.id} id={`stream-option-${s.id}`} role="option" ...>
 *         ...card content...
 *       </li>
 *     ))}
 *   </StreamCardList>
 */
import { useCallback, useRef, KeyboardEvent, ReactNode } from "react";

interface StreamCardListProps {
  /** Ordered list of stream ids — determines keyboard navigation order. */
  streamIds: string[];
  /** Id of the currently keyboard-active stream (aria-activedescendant). */
  activeId: string | null;
  /** Called when the user activates a card with Enter or Space. */
  onActivate: (id: string) => void;
  /** Called when the active id should change (arrow navigation). */
  onActiveChange: (id: string) => void;
  /** Accessible label for the listbox container. */
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function StreamCardList({
  streamIds,
  activeId,
  onActivate,
  onActiveChange,
  ariaLabel,
  children,
  className,
  style,
}: StreamCardListProps) {
  const listRef = useRef<HTMLUListElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLUListElement>) => {
      const count = streamIds.length;
      if (count === 0) return;

      const currentIndex = activeId ? streamIds.indexOf(activeId) : -1;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const nextIndex = currentIndex < count - 1 ? currentIndex + 1 : 0;
          const nextId = streamIds[nextIndex];
          if (nextId !== undefined) {
            onActiveChange(nextId);
            // Move DOM focus to the option element so screen readers announce it
            document.getElementById(`stream-option-${nextId}`)?.focus();
          }
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : count - 1;
          const prevId = streamIds[prevIndex];
          if (prevId !== undefined) {
            onActiveChange(prevId);
            document.getElementById(`stream-option-${prevId}`)?.focus();
          }
          break;
        }
        case "Home": {
          e.preventDefault();
          const firstId = streamIds[0];
          if (firstId !== undefined) {
            onActiveChange(firstId);
            document.getElementById(`stream-option-${firstId}`)?.focus();
          }
          break;
        }
        case "End": {
          e.preventDefault();
          const lastId = streamIds[count - 1];
          if (lastId !== undefined) {
            onActiveChange(lastId);
            document.getElementById(`stream-option-${lastId}`)?.focus();
          }
          break;
        }
        case "Enter":
        case " ": {
          e.preventDefault();
          if (activeId !== null) {
            onActivate(activeId);
          }
          break;
        }
        default:
          break;
      }
    },
    [streamIds, activeId, onActivate, onActiveChange],
  );

  return (
    <ul
      ref={listRef}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={activeId ? `stream-option-${activeId}` : undefined}
      onKeyDown={handleKeyDown}
      className={className}
      style={style}
      // The list itself is not in the tab order; individual options are
      tabIndex={-1}
    >
      {children}
    </ul>
  );
}
