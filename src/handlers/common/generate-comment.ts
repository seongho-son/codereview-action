export function generateComment(authorName: string, comment: string) {
  return `${authorName}: ${comment.trim()}`;
}
