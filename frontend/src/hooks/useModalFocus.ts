/**
 * useModalFocus — focus management for modal dialogs (#389)
 *
 * When `isOpen` becomes true:
 *   1. Saves the currently focused element (document.activeElement)
 *   2. Finds the first focusable element inside the modal and focuses it
 *
 * When `isOpen` becomes false:
 *   - Restores focus to `triggerRef` (the element that opened the modal)
 *
 * Usage:
 *   const triggerRef = useRef<HTMLButtonElement>(null);
 *   const { modalRef } = useModalFocus(isOpen, triggerRef);
 *   // ...
 *   <button ref={triggerRef} onClick={() => setOpen(true)}>Open</button>
 *   {isOpen && <div ref={modalRef} role="dialog">...</div>}
 */
import { useEffect, useRef, RefObject } from "react";
import { getFocusableElements } from "@/utils/focusTrap";

export function useModalFocus(
  isOpen: boolean,
  triggerRef: RefObject<HTMLElement | null>,
): { modalRef: RefObject<HTMLDivElement> } {
  const modalRef = useRef<HTMLDivElement>(null);
  // Track the element that was focused before the modal opened
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Save the element that currently has focus before the modal opens
      previousFocusRef.current = document.activeElement;

      // Use a microtask delay so the modal is in the DOM before we try to focus
      const frameId = requestAnimationFrame(() => {
        if (!modalRef.current) return;
        const focusable = getFocusableElements(modalRef.current);
        if (focusable.length > 0) {
          focusable[0]?.focus();
        } else {
          // Fall back to focusing the modal container itself
          modalRef.current.focus();
        }
      });

      return () => cancelAnimationFrame(frameId);
    } else {
      // Modal is closing — restore focus to the trigger element
      if (triggerRef.current && typeof triggerRef.current.focus === "function") {
        // Small delay to avoid focus fighting with any closing animations
        const frameId = requestAnimationFrame(() => {
          triggerRef.current?.focus();
        });
        return () => cancelAnimationFrame(frameId);
      }
    }
  }, [isOpen, triggerRef]);

  return { modalRef };
}
