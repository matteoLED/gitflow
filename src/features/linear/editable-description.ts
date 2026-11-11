const FENCED_CODE = /^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm;
const INLINE_CODE = /`[^`\n]*`/g;
const TABLE_ROW = /^\s*\|.*\|\s*$/m;
/** Real HTML only (`Vec<String>`, `Option<u8>` in prose are generics, not tags). */
const HTML_TAG =
  /<\/?(a|b|blockquote|br|code|details|div|em|h[1-6]|hr|i|iframe|img|kbd|li|ol|p|picture|pre|span|strong|sub|summary|sup|table|tbody|td|th|thead|tr|u|ul|video)(\s[^>]*)?\/?>/;

/**
 * Whether the editor can take a description without losing anything: tables and raw HTML don't
 * survive its Markdown round trip, so such descriptions stay read-only. Code is ignored.
 */
export function editableDescription(markdown: string) {
  const prose = markdown.replace(FENCED_CODE, "").replace(INLINE_CODE, "");
  return !TABLE_ROW.test(prose) && !HTML_TAG.test(prose);
}
