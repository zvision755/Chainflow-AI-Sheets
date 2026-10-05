export const normalizeResult = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
export const repeatedResult = (text: string, previous: string[]) => previous.some(value => normalizeResult(value) === normalizeResult(text));
