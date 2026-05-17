export function redactApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    return "not configured";
  }

  const visible = apiKey.length <= 12 ? apiKey.slice(0, 4) : apiKey.slice(0, 12);
  return `${visible}...redacted`;
}
