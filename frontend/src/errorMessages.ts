/**
 * Re-export shim â€” issue #821 moved the canonical mapping to
 * `src/lib/errorMessages.ts` so it can carry all 26 `VestingError` codes
 * plus their i18n keys.
 *
 * Existing imports (`@/errorMessages`) keep working unchanged.
 */
export {
  VESTING_ERROR_CODES,
  errorMessages,
  getErrorInfo,
  getErrorMessage,
  getErrorName,
  isKnownErrorCode,
} from "./lib/errorMessages";
export type { ErrorInfo, ErrorCategory, VestingErrorName } from "./lib/errorMessages";

