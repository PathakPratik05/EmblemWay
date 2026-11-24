/** Parses a settings form: numbers stay numbers, checkboxes become booleans. */
export function parseSettingsForm(formData: FormData, booleanKeys: string[]): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const [k, v] of formData.entries()) {
    if (k === 'section' || k.startsWith('$')) continue;
    if (booleanKeys.includes(k)) continue;
    const n = Number(v);
    if (v !== '' && Number.isFinite(n)) out[k] = n;
  }
  for (const k of booleanKeys) out[k] = formData.get(k) === 'on';
  return out;
}
