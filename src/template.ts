/**
 * Template handling: `{placeholder}` extraction and substitution.
 * `{{` / `}}` escape literal braces.
 */

// match {name} not preceded/followed by another brace
const PLACEHOLDER = /(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g;

export function placeholders(template: string): string[] {
  const seen: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER)) {
    const name = m[1];
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

export function substitute(
  template: string,
  values: Record<string, string>,
): string {
  const out = template.replace(PLACEHOLDER, (full, name: string) =>
    name in values ? values[name] : full,
  );
  return out.replace(/\{\{/g, "{").replace(/\}\}/g, "}");
}
