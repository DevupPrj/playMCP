export class TextMatcherUtil {
  static isTitleMatched(query: string, resultTitle: string): boolean {
    if (!query || !resultTitle) return false;
    const normalize = (s: string) =>
      s.replace(/[\s\[\]\(\)\-\.]/g, '').toLowerCase();
    return normalize(resultTitle).includes(normalize(query));
  }
}
