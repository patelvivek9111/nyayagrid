/** Strip provider/stack/database noise before it reaches the lawyer. */
const TECHNICAL_ERROR =
  /(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|SQLSTATE|prisma|drizzle|postgres:\/\/|mongodb:\/\/|TypeError:|ReferenceError:|at Object\.|sk_[a-zA-Z0-9]|whsec_|INTERNAL_ERROR|zod)/i;

export const USER_FACING_GENERIC_ERROR =
  "NyayaGrid could not complete this request. Your case data is unchanged. Try again.";

export const USER_FACING_ASK_ERROR =
  "Nyaya could not complete this question. Your case data is unchanged. Try again.";

export function sanitizeUserFacingError(
  message: string | null | undefined,
  fallback: string = USER_FACING_GENERIC_ERROR,
): string {
  const trimmed = (message ?? "").trim();
  if (!trimmed) return fallback;
  if (TECHNICAL_ERROR.test(trimmed)) return fallback;
  if (trimmed.length > 280) return fallback;
  if (/^Ask failed$/i.test(trimmed)) return USER_FACING_ASK_ERROR;
  if (/^(Failed|Request failed)$/i.test(trimmed)) return fallback;
  if (/^Failed to load\b/i.test(trimmed)) {
    const rest = trimmed.replace(/^Failed to load\s+/i, "").replace(/\.+$/, "").trim();
    return `We couldn't load ${rest || "this page"}. Try again.`;
  }
  if (/^Matter is not in this organization$/i.test(trimmed)) {
    return "That case is not in this firm.";
  }
  if (/^Matter authority not found/i.test(trimmed)) {
    return "That saved authority could not be found.";
  }
  return trimmed;
}
