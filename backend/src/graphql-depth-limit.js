"use strict";

/**
 * Checks that no selection set in a GraphQL document exceeds maxDepth.
 * Throws a plain Error if the limit is exceeded.
 */
function checkDepth(document, maxDepth) {
  function selectionDepth(selections) {
    let max = 0;
    for (const sel of selections) {
      if (sel.selectionSet) {
        const d = 1 + selectionDepth(sel.selectionSet.selections);
        if (d > max) max = d;
      }
    }
    return max;
  }

  for (const def of document.definitions) {
    if (def.selectionSet) {
      const depth = selectionDepth(def.selectionSet.selections);
      if (depth > maxDepth) {
        throw new Error(`Query depth ${depth} exceeds maximum allowed depth of ${maxDepth}`);
      }
    }
  }
}

module.exports = { checkDepth };
