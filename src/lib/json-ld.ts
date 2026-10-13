/**
 * Safe embedding of JSON-LD in a `<script type="application/ld+json">` block.
 *
 * `JSON.stringify` does not escape `<`, `>`, or `&`. A JSON-LD block is parsed
 * as raw text by the HTML tokenizer before the JSON parser ever sees it, so a
 * string containing `</script>`, or the equivalent `<!--` sequence, which still
 * ends the script element in some parsers, terminates the block early and turns
 * the remainder into live markup. Any value that reaches JSON-LD from a database
 * row, a repo name, or a translation string is therefore a potential injection
 * point into the marketing pages.
 *
 * Escaping the three characters as their JSON-legal `\uXXXX` equivalents keeps
 * the document's meaning identical while making it impossible to close the
 * script element. U+2028/U+2029 are escaped for the same class of reason: they
 * are valid inside a JSON string but are line terminators in JavaScript, so
 * anyone who copy-pastes the payload into a real inline script would break it.
 */
const LINE_SEPARATORS = /[\u2028\u2029]/g;

export function jsonLdScriptContent(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEPARATORS, (c) => (c === "\u2028" ? "\\u2028" : "\\u2029"));
}
