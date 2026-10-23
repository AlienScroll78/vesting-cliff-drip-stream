"use strict";

/**
 * Issue #553 — GraphQL depth and complexity limits.
 *
 * checkDepth(document, maxDepth)
 *   Verifies that no selection set exceeds maxDepth levels of nesting.
 *   Throws a plain Error on violation.
 *
 * checkComplexity(document, schema, maxComplexity)
 *   Computes a cost score for the query:
 *     - Each scalar/object field:  +1
 *     - Each list field:           +n  (where n = LIST_MULTIPLIER, default 10)
 *   Throws a plain Error when the total cost exceeds maxComplexity.
 *
 * validateQuery(document, schema, { maxDepth, maxComplexity })
 *   Convenience wrapper that runs both checks and logs rejected queries at
 *   the warn level before re-throwing.
 */

const LIST_MULTIPLIER = 10;

// ── Depth check ───────────────────────────────────────────────────────────────

/**
 * Recursively measures the maximum selection depth of a parsed GraphQL document.
 *
 * @param {import('graphql').DocumentNode} document
 * @param {number} maxDepth
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
        throw new Error(
          `Query depth ${depth} exceeds maximum allowed depth of ${maxDepth}`
        );
      }
    }
  }
}

// ── Complexity check ──────────────────────────────────────────────────────────

/**
 * Computes the complexity score of a parsed GraphQL document.
 *
 * Cost model:
 *   - Every field selection:  +1
 *   - If the field's return type is a list (detected via schema): ×LIST_MULTIPLIER
 *
 * Passing `schema` is optional; without it every field is treated as cost 1.
 *
 * @param {import('graphql').DocumentNode} document
 * @param {import('graphql').GraphQLSchema | null | undefined} schema
 * @param {number} maxComplexity
 * @returns {number} The computed complexity score (for logging/testing)
 */
function checkComplexity(document, schema, maxComplexity) {
  let totalCost = 0;

  /**
   * Walk selections and accumulate cost.
   *
   * @param {readonly import('graphql').SelectionNode[]} selections
   * @param {import('graphql').GraphQLOutputType | null | undefined} parentType
   */
  function walkSelections(selections, parentType) {
    for (const sel of selections) {
      if (sel.kind !== "Field") continue; // skip InlineFragment / FragmentSpread

      // Resolve the field definition from the schema (if available)
      let fieldType = null;
      if (schema && parentType) {
        const typeName = unwrapTypeName(parentType);
        const typeObj = schema.getType(typeName);
        if (typeObj && "getFields" in typeObj) {
          const field = typeObj.getFields()[sel.name.value];
          if (field) fieldType = field.type;
        }
      }

      const isList = fieldType ? isListType(fieldType) : false;
      const cost = isList ? LIST_MULTIPLIER : 1;
      totalCost += cost;

      if (sel.selectionSet) {
        walkSelections(sel.selectionSet.selections, fieldType);
      }
    }
  }

  for (const def of document.definitions) {
    if (def.kind !== "OperationDefinition" && def.kind !== "FragmentDefinition") {
      continue;
    }

    // Determine the root type for operation definitions
    let rootType = null;
    if (schema && def.kind === "OperationDefinition") {
      if (def.operation === "query") rootType = schema.getQueryType();
      else if (def.operation === "mutation") rootType = schema.getMutationType();
      else if (def.operation === "subscription") rootType = schema.getSubscriptionType();
    }

    if (def.selectionSet) {
      walkSelections(def.selectionSet.selections, rootType);
    }
  }

  if (totalCost > maxComplexity) {
    throw new Error(
      `Query complexity ${totalCost} exceeds maximum allowed complexity of ${maxComplexity}`
    );
  }

  return totalCost;
}

// ── Convenience validator ─────────────────────────────────────────────────────

/**
 * Runs both depth and complexity checks. Logs rejected queries at warn level.
 *
 * @param {import('graphql').DocumentNode} document
 * @param {import('graphql').GraphQLSchema | null | undefined} schema
 * @param {{ maxDepth?: number; maxComplexity?: number; query?: string }} opts
 */
function validateQuery(document, schema, opts = {}) {
  const maxDepth = opts.maxDepth ?? 5;
  const maxComplexity = opts.maxComplexity ?? 100;

  try {
    checkDepth(document, maxDepth);
  } catch (err) {
    console.warn("[graphql] Query rejected — depth limit exceeded:", {
      query: opts.query ?? "(unprovided)",
      message: err.message,
    });
    throw err;
  }

  let cost;
  try {
    cost = checkComplexity(document, schema, maxComplexity);
  } catch (err) {
    console.warn("[graphql] Query rejected — complexity limit exceeded:", {
      query: opts.query ?? "(unprovided)",
      message: err.message,
      cost,
    });
    throw err;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Unwraps NonNull / List wrappers and returns the named type string.
 *
 * @param {import('graphql').GraphQLOutputType} type
 * @returns {string}
 */
function unwrapTypeName(type) {
  if (!type) return "";
  if (typeof type.ofType !== "undefined") return unwrapTypeName(type.ofType);
  return type.name ?? "";
}

/**
 * Returns true if `type` is (or wraps) a GraphQL List type.
 *
 * @param {import('graphql').GraphQLOutputType} type
 * @returns {boolean}
 */
function isListType(type) {
  if (!type) return false;
  if (type.constructor && type.constructor.name === "GraphQLList") return true;
  if (type.ofType) return isListType(type.ofType);
  return false;
}

module.exports = { checkDepth, checkComplexity, validateQuery };
