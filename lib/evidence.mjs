const WORD = /[\p{L}\p{N}]/u;

export function containsQuote(source, quote) {
  if (typeof source !== 'string' || !quote) return false;
  for (let index = source.indexOf(quote); index !== -1; index = source.indexOf(quote, index + 1)) {
    const prefix = WORD.test(quote[0]) && index > 0 && WORD.test(source[index - 1]);
    const end = index + quote.length;
    const suffix = WORD.test(quote.at(-1)) && end < source.length && WORD.test(source[end]);
    if (!prefix && !suffix) return true;
  }
  return false;
}
