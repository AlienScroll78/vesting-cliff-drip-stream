# CodeQL Alert Suppression

## How Findings Create Security Alerts

CodeQL results are automatically uploaded to the **GitHub Security** tab as code scanning alerts. No extra configuration is needed — the `github/codeql-action/analyze` step handles this.

---

## Suppressing a False Positive

### In-code suppression (Rust)

CodeQL for Rust supports suppression via a specially formatted comment on the same line or the line above the finding:

```rust
let raw = user_input; // lgtm[rust/path-injection]
```

Or using the `@suppress` tag in a block comment:

```rust
// @suppress rust/path-injection - input is validated by parse_address() above
let raw = user_input;
```

### In-code suppression (JavaScript / TypeScript)

```typescript
const result = eval(expr); // lgtm[js/code-injection]
```

### Dismissing via the GitHub Security Tab

1. Navigate to **Security → Code scanning alerts**.
2. Open the alert.
3. Click **Dismiss alert** and select a reason:
   - *False positive* — CodeQL misidentified the pattern.
   - *Won't fix* — accepted risk, documented below.
   - *Used in tests* — only present in test code.
4. Add a mandatory note explaining the decision.

---

## When Suppression Is Acceptable

| Situation | Action |
|-----------|--------|
| Genuine false positive with clear evidence | In-code `// lgtm` + dismiss in UI |
| Test-only code with no production impact | Dismiss as "Used in tests" |
| Third-party generated code outside your control | Dismiss as "Won't fix" with note |
| Real vulnerability, low exploitability, mitigated elsewhere | Requires security lead sign-off |

**Never suppress** a high-severity finding without a written justification and approval.

---

## Approval Requirements

- **Low / medium severity false positives**: PR reviewer approval is sufficient.
- **High severity suppressions**: requires explicit approval from the security lead (add `security-lead` as a required reviewer on the PR).
- All suppressions must reference the CodeQL rule ID (e.g., `rust/uncontrolled-format-string`) in the dismissal note or code comment.
