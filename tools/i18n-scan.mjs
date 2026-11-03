// A literal inventory, not a JavaScript parser. Templates are scanned piece by
// piece, including their expressions, so adding English needs a named UI key.
export function sourceLiterals(source) {
  const values = [];
  function string(at) {
    const quote = source[at++];
    let text = '';
    while (at < source.length) {
      if (source[at] === '\\') { text += source.slice(at, at + 2); at += 2; continue; }
      if (source[at] === quote) { values.push(text); return at + 1; }
      if (quote === '`' && source.slice(at, at + 2) === '${') {
        values.push(text); text = ''; at = code(at + 2, true); continue;
      }
      text += source[at++];
    }
    return at;
  }
  function code(at, expression = false) {
    let depth = 1;
    while (at < source.length) {
      if (source.slice(at, at + 2) === '//') {
        const end = source.indexOf('\n', at); at = end < 0 ? source.length : end; continue;
      }
      if (source.slice(at, at + 2) === '/*') { at = source.indexOf('*/', at + 2) + 2; continue; }
      if ('\'"`'.includes(source[at])) { at = string(at); continue; }
      if (source[at] === '/' && /(?:[=(:,!&|?;{]|=>|return)\s*$/.test(source.slice(Math.max(0, at - 15), at))) {
        let end = at + 1, bracket = false;
        for (; end < source.length; end++) {
          if (source[end] === '\\') { end++; continue; }
          if (source[end] === '[') bracket = true;
          if (source[end] === ']') bracket = false;
          if (source[end] === '/' && !bracket) break;
        }
        if (end < source.length) { at = end + 1; continue; }
      }
      if (expression) {
        if (source[at] === '{') depth++;
        if (source[at] === '}' && --depth === 0) return at + 1;
      }
      at++;
    }
    return at;
  }
  code(0);
  return [...new Set(values.filter((value) => /[a-z]/i.test(value)))].sort();
}
