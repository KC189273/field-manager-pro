/** Escape user-provided text for safe embedding in HTML emails */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Escape and convert newlines to <br> for HTML emails */
export function escapeHtmlBr(str: string): string {
  return escapeHtml(str).replace(/\n/g, '<br>')
}
