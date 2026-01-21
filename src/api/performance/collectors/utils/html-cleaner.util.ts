export class HtmlCleanerUtil {
  static cleanHtml(text: string): string {
    if (!text) return '';
    return text
      .replace(/<[^>]*>?/gm, '') // HTML 태그 제거
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim();
  }
}
