export function getChatImageUrl(sourceUrl: string): string {
  if (!sourceUrl) {
    return sourceUrl;
  }

  try {
    const parsed = new URL(sourceUrl);
    const match = parsed.pathname.match(/\/files\/([^/?#]+)$/);

    if (match?.[1]) {
      return `/api/images/proxy?file=${encodeURIComponent(match[1])}`;
    }

    return sourceUrl;
  } catch {
    return sourceUrl;
  }
}
