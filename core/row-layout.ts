import { columnWidth, type Column, type Row } from './types';

export const MIN_AUTO_LINES = 4;
export const MAX_AUTO_LINES = 12;

function glyphWidth(character: string) {
  const code = character.codePointAt(0) ?? 0;
  if (/\s/.test(character)) return 4;
  if (code >= 0x2e80 || code >= 0x1f000) return 16;
  return 8;
}

export function wrappedLineCount(text: string, width: number) {
  const available = Math.max(40, width);
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    let lineWidth = 0;
    let paragraphLines = 1;
    for (const character of Array.from(paragraph)) {
      const next = glyphWidth(character);
      if (lineWidth > 0 && lineWidth + next > available) {
        paragraphLines++;
        lineWidth = 0;
      }
      lineWidth += next;
    }
    lines += paragraphLines;
  }
  return Math.max(1, lines);
}

export function autoRowLines(row: Row, columns: Column[]) {
  const resultLines = columns.slice(1).reduce((maximum, column, index) => {
    const cell = row.cells[column.id];
    const text = cell?.preview ?? cell?.value ?? '';
    return Math.max(maximum, wrappedLineCount(text, columnWidth(column, index + 1) - 48));
  }, MIN_AUTO_LINES);
  return Math.max(MIN_AUTO_LINES, Math.min(MAX_AUTO_LINES, resultLines));
}
