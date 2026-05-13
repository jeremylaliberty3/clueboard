export const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;

export function validateUsername(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Username is required.";
  if (trimmed.length < 3) return "Username must be at least 3 characters.";
  if (trimmed.length > 20) return "Username must be at most 20 characters.";
  if (!USERNAME_RE.test(trimmed)) {
    return "Use 3–20 letters, digits, or underscores. Must start with a letter.";
  }
  return null;
}
