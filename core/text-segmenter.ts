export type TextSplitOptions = {
  delimiters: string;
  splitLines: boolean;
  keepDelimiter: boolean;
};

/** Split text at configurable sentence delimiters while keeping punctuation attached. */
export function splitLongText(text: string, options: TextSplitOptions): string[] {
  const delimiters = new Set([...options.delimiters]);
  const result: string[] = [];
  let piece = '';
  const push = () => {
    const value = piece.trim();
    if (value) result.push(value);
    piece = '';
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '\r' || char === '\n') {
      if (options.splitLines) {
        push();
        if (char === '\r' && text[index + 1] === '\n') index++;
      } else {
        piece += char;
      }
      continue;
    }

    if (delimiters.has(char)) {
      if (options.keepDelimiter) piece += char;
      // Keep punctuation runs such as ?! or …… together with the same sentence.
      while (index + 1 < text.length && delimiters.has(text[index + 1])) {
        index++;
        if (options.keepDelimiter) piece += text[index];
      }
      push();
      continue;
    }
    piece += char;
  }
  push();
  return result;
}
