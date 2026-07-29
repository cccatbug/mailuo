export function shouldLoadBrowserAddress(
  requested: string,
  current: string | null,
  declared: string | null
): boolean {
  return requested !== current && requested !== declared;
}
