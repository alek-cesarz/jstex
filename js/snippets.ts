/** Code snippets the details view copies. JSON string literals are valid Python literals. */
export function pythonItemSnippet(selfHref: string): string {
  return `import jstex\n\nitem = jstex.item(${JSON.stringify(selfHref)})`;
}
