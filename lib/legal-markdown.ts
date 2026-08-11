/**
 * Minimal markdown → HTML for legal/*.md pages.
 * Covers the subset our docs use: headings, paragraphs, bold/italic,
 * code, links, blockquotes, lists, and horizontal rules.
 */
export function renderLegalMarkdown(md: string): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_m, text, href) => `<a href="${href}">${text}</a>`,
      )

  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  const flushList = (buffer: string[], ordered: boolean) => {
    if (buffer.length === 0) return
    const tag = ordered ? 'ol' : 'ul'
    out.push(
      `<${tag}>${buffer.map((li) => `<li>${inline(li)}</li>`).join('')}</${tag}>`,
    )
    buffer.length = 0
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '') {
      i += 1
      continue
    }

    if (trimmed.startsWith('---')) {
      out.push('<hr />')
      i += 1
      continue
    }

    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (headingMatch) {
      const level = headingMatch[1].length
      out.push(`<h${level}>${inline(headingMatch[2])}</h${level}>`)
      i += 1
      continue
    }

    if (trimmed.startsWith('> ')) {
      const block: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        block.push(lines[i].trim().slice(2))
        i += 1
      }
      out.push(`<blockquote>${block.map(inline).join(' ')}</blockquote>`)
      continue
    }

    const orderedMatch = /^\d+\.\s+(.*)$/.exec(trimmed)
    if (orderedMatch) {
      const items: string[] = []
      while (i < lines.length) {
        const t = lines[i].trim()
        const m = /^\d+\.\s+(.*)$/.exec(t)
        if (!m) break
        items.push(m[1])
        i += 1
      }
      flushList(items, true)
      continue
    }

    const bulletMatch = /^[-*]\s+(.*)$/.exec(trimmed)
    if (bulletMatch) {
      const items: string[] = []
      while (i < lines.length) {
        const t = lines[i].trim()
        const m = /^[-*]\s+(.*)$/.exec(t)
        if (!m) break
        items.push(m[1])
        i += 1
      }
      flushList(items, false)
      continue
    }

    const para: string[] = [trimmed]
    i += 1
    while (i < lines.length) {
      const t = lines[i].trim()
      if (
        t === '' ||
        /^#{1,4}\s/.test(t) ||
        /^[-*]\s/.test(t) ||
        /^\d+\.\s/.test(t) ||
        t.startsWith('> ') ||
        t.startsWith('---')
      ) {
        break
      }
      para.push(t)
      i += 1
    }
    out.push(`<p>${inline(para.join(' '))}</p>`)
  }

  return out.join('\n')
}
