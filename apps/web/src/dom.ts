/** DOM helpers — crown-clash.html L656-657, the only two that stayed client-side. */
export const $ = <T extends Element = HTMLElement>(s: string, r?: ParentNode): T | null =>
  (r || document).querySelector(s) as T | null;

export const $$ = <T extends Element = HTMLElement>(s: string, r?: ParentNode): T[] =>
  Array.from((r || document).querySelectorAll(s)) as T[];

/**
 * Non-null query. The prototype's pointer handlers were peppered with null guards because
 * `$()` could return null mid-teardown; screens that own their markup use this instead and
 * fail loudly in development rather than silently doing nothing.
 */
export function must<T extends Element = HTMLElement>(s: string, r?: ParentNode): T {
  const el = $<T>(s, r);
  if (!el) throw new Error(`expected element ${s} to exist`);
  return el;
}
