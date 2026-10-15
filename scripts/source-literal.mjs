// Reads a plain object literal (strings, numbers, arrays, nested objects; no calls)
// assigned to `const NAME` in a TypeScript source, so the site can reuse the
// product's own translations instead of copying them by hand.
export function sourceLiteral(source, name) {
  const at = source.search(new RegExp(`const ${name}\\b[^=]*=\\s*\\{`));
  if (at < 0) throw new Error(`${name} not found`);
  const start = source.indexOf("{", source.indexOf("=", at));
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      const literal = source.slice(start, i + 1);
      if (/\$\{|\(\s*\)|=>/.test(literal.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""'))) throw new Error(`${name} is not a plain literal`);
      return new Function(`return (${literal});`)();
    }
  }
  throw new Error(`${name}: unbalanced braces`);
}
