import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const SITE_URL = 'https://docs.alianhub.com'
export const REPO_URL = 'https://github.com/aliansoftwareteam/AlianHub-Project-Management-System'

const SITE_NAME = 'AlianHub Docs'
const PRODUCT_SUMMARY = 'AlianHub is free, open-source (AGPL-3.0) project management software that teams run on their own server. It brings tasks, sprints, boards, Gantt charts, docs, chat, automations, time tracking with weekly timesheets, and AI into one workspace.'
const SHARE_IMAGE = {
  url: `${SITE_URL}/og-image.png`,
  width: '1200',
  height: '630',
  alt: 'AlianHub Docs: open-source, self-hosted project management',
}
const FAQ_PAGE = 'help/faq.md'
const DESCRIPTION_MIN = 100
const DESCRIPTION_MAX = 160
const IDS = {
  organization: `${SITE_URL}/#organization`,
  website: `${SITE_URL}/#website`,
  software: `${SITE_URL}/#software`,
}

const routeOf = (relativePath) => relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')
const pageUrl = (relativePath) => `${SITE_URL}/${routeOf(relativePath)}`
const sourceOfLink = (link) => {
  const path = link.replace(/^\//, '').replace(/#.*$/, '')
  return path === '' || path.endsWith('/') ? `${path}index.md` : `${path}.md`
}

const readPage = (srcDir, relativePath) => {
  const file = join(srcDir, relativePath)
  const source = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : ''
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source)
  return match ? { yaml: match[1], body: source.slice(match[0].length) } : { yaml: '', body: source }
}

const frontmatterValue = (yaml, key) => {
  const match = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(yaml)
  return match ? match[1].trim().replace(/^(["'])(.*)\1$/, '$2').replace(/\\"/g, '"') : ''
}

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#123;': '{' }

const toPlainText = (markdown) => markdown
  .replace(/^:::.*$/gm, '')
  .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
  .replace(/\s*\{#[^}]*\}/g, '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/\*\*|__|`/g, '')
  .replace(/&(?:lt|gt|amp|quot|#39|#123);/g, (entity) => ENTITIES[entity])
  .replace(/\s+/g, ' ')
  .trim()

const paragraphs = (body) => {
  const blocks = []
  let lines = []
  let fenced = false
  const flush = () => {
    if (lines.length) blocks.push(lines.join('\n'))
    lines = []
  }
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      flush()
      fenced = !fenced
    } else if (fenced) {
      continue
    } else if (/^#{1,6}\s/.test(line)) {
      flush()
      blocks.push(line)
    } else if (line.trim()) {
      lines.push(line)
    } else {
      flush()
    }
  }
  flush()
  return blocks
}

const NOT_PROSE = /^(?:#|!\[|\||>|<|:::|[-*+]\s|\d+\.\s|\{\{|\$\$)/
const LIST = /^(?:[-*+]|\d+\.)\s/

const shorten = (text) => {
  if (text.length <= DESCRIPTION_MAX) return text
  let sentences = ''
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const longer = sentences ? `${sentences} ${sentence}` : sentence
    if (longer.length > DESCRIPTION_MAX) break
    sentences = longer
  }
  if (sentences.length >= 80) return sentences
  return `${text.slice(0, DESCRIPTION_MAX - 1).replace(/\s+\S*$/, '').replace(/[\s,;:–—-]+$/, '')}…`
}

const describe = (body) => {
  const blocks = paragraphs(body).map((block) => block.trimStart())
  const start = blocks.findIndex((block) => !NOT_PROSE.test(block))
  if (start === -1) return ''
  let text = toPlainText(blocks[start])
  for (const block of blocks.slice(start + 1)) {
    if (text.length >= DESCRIPTION_MIN || (NOT_PROSE.test(block) && !LIST.test(block))) break
    text = `${text} ${toPlainText(block)}`
  }
  return shorten(text)
}

const titleOf = (yaml, body) => {
  const heading = /^# (.+)$/m.exec(body)
  return toPlainText(frontmatterValue(yaml, 'title') || (heading ? heading[1] : ''))
}

const faqEntries = (body) => {
  const entries = []
  let entry = null
  let fenced = false
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced
    const heading = !fenced && /^(#{1,6}) (.+)$/.exec(line)
    if (heading) {
      entry = heading[1] === '###' ? { question: toPlainText(heading[2]), answer: [] } : null
      if (entry) entries.push(entry)
    } else if (entry) {
      entry.answer.push(line)
    }
  }
  return entries
    .map(({ question, answer }) => ({ question, answer: toPlainText(answer.join('\n')) }))
    .filter(({ answer }) => answer)
}

const navLabels = (themeConfig) => {
  const labels = new Map()
  const visit = (items = []) => {
    for (const item of items) {
      if (item.link?.startsWith('/')) labels.set(item.link, item.text)
      visit(item.items)
    }
  }
  visit(themeConfig.nav)
  return labels
}

const breadcrumbTrail = (pageData, { srcDir, site }) => {
  const segments = routeOf(pageData.relativePath).split('/').filter(Boolean)
  const labels = navLabels(site.themeConfig)
  const trail = [{ name: SITE_NAME, url: `${SITE_URL}/` }]
  for (let depth = 1; depth < segments.length; depth++) {
    const dir = `${segments.slice(0, depth).join('/')}/`
    const { yaml, body } = readPage(srcDir, `${dir}index.md`)
    const name = labels.get(`/${dir}`) || titleOf(yaml, body)
    if (name) trail.push({ name, url: `${SITE_URL}/${dir}` })
  }
  trail.push({ name: pageData.title, url: pageUrl(pageData.relativePath) })
  return trail
}

const siteGraph = (siteDescription) => [
  {
    '@type': 'Organization',
    '@id': IDS.organization,
    name: 'Alian Software',
    url: 'https://aliansoftware.net',
    logo: `${SITE_URL}/logo.png`,
    sameAs: ['https://github.com/aliansoftwareteam'],
  },
  {
    '@type': 'SoftwareApplication',
    '@id': IDS.software,
    name: 'AlianHub',
    description: PRODUCT_SUMMARY,
    url: 'https://alianhub.com',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Project management',
    operatingSystem: 'Web',
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
    isAccessibleForFree: true,
    sameAs: [REPO_URL],
    publisher: { '@id': IDS.organization },
  },
  {
    '@type': 'WebSite',
    '@id': IDS.website,
    url: `${SITE_URL}/`,
    name: SITE_NAME,
    description: siteDescription,
    inLanguage: 'en-US',
    publisher: { '@id': IDS.organization },
    about: { '@id': IDS.software },
  },
]

const pageGraph = ({ kind, url, title, description, modified, trail, faq }) => {
  const page = {
    '@type': kind,
    '@id': `${url}#page`,
    url,
    headline: title,
    description,
    inLanguage: 'en-US',
    image: SHARE_IMAGE.url,
    isPartOf: { '@id': IDS.website },
    about: { '@id': IDS.software },
    publisher: { '@id': IDS.organization },
  }
  if (kind === 'TechArticle') page.author = { '@id': IDS.organization }
  if (modified) page.dateModified = modified
  if (faq) {
    page.mainEntity = faq.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    }))
  }
  if (!trail) return [page]
  page.breadcrumb = { '@id': `${url}#breadcrumb` }
  return [page, {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumb`,
    itemListElement: trail.map(({ name, url: item }, index) => ({ '@type': 'ListItem', position: index + 1, name, item })),
  }]
}

const headTags = ({ url, title, description, modified, isHome, graph }) => {
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')
  return [
    ['link', { rel: 'canonical', href: url }],
    ['meta', { property: 'og:type', content: isHome ? 'website' : 'article' }],
    ['meta', { property: 'og:site_name', content: SITE_NAME }],
    ['meta', { property: 'og:locale', content: 'en_US' }],
    ['meta', { property: 'og:url', content: url }],
    ['meta', { property: 'og:title', content: title }],
    ['meta', { property: 'og:description', content: description }],
    ['meta', { property: 'og:image', content: SHARE_IMAGE.url }],
    ['meta', { property: 'og:image:width', content: SHARE_IMAGE.width }],
    ['meta', { property: 'og:image:height', content: SHARE_IMAGE.height }],
    ['meta', { property: 'og:image:alt', content: SHARE_IMAGE.alt }],
    ...(modified ? [['meta', { property: 'article:modified_time', content: modified }]] : []),
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: title }],
    ['meta', { name: 'twitter:description', content: description }],
    ['meta', { name: 'twitter:image', content: SHARE_IMAGE.url }],
    ['meta', { name: 'twitter:image:alt', content: SHARE_IMAGE.alt }],
    ['script', { type: 'application/ld+json' }, jsonLd],
  ]
}

export function transformPageData(pageData, { siteConfig }) {
  const { body } = readPage(siteConfig.srcDir, pageData.relativePath)
  const isHome = pageData.frontmatter.layout === 'home'
  const faq = pageData.relativePath === FAQ_PAGE ? faqEntries(body) : null
  const page = {
    kind: isHome ? 'WebPage' : faq ? 'FAQPage' : 'TechArticle',
    url: pageUrl(pageData.relativePath),
    title: pageData.title,
    description: pageData.frontmatter.description || describe(body) || `${pageData.title}. ${siteConfig.site.description}`,
    modified: pageData.lastUpdated ? new Date(pageData.lastUpdated).toISOString() : '',
    trail: isHome ? null : breadcrumbTrail(pageData, siteConfig),
    faq,
  }
  const graph = [...siteGraph(siteConfig.site.description), ...pageGraph(page)]
  pageData.description = page.description
  pageData.frontmatter.head = [...(pageData.frontmatter.head ?? []), ...headTags({ ...page, isHome, graph })]
}

// VitePress writes its own description meta without escaping quotes; one supplied here replaces it and is escaped.
export const transformHead = ({ description }) => [['meta', { name: 'description', content: description }]]

const absoluteLinks =(markdown, relativePath) => markdown.replace(/\]\(([^)\s]+)\)/g, (match, target) => (
  /^(?:[a-z][a-z+.-]*:|#)/i.test(target) ? match : `](${new URL(target, pageUrl(relativePath)).href})`
))

const llmsSections = ({ srcDir, pages, site }) => {
  const available = new Set(pages)
  const listed = new Set()
  const sections = []
  const collect = (items = [], into) => {
    for (const item of items) {
      const source = item.link?.startsWith('/') && sourceOfLink(item.link)
      if (source && available.has(source) && !listed.has(source)) {
        listed.add(source)
        into.push(source)
      }
      collect(item.items, into)
    }
  }
  for (const groups of Object.values(site.themeConfig.sidebar ?? {})) {
    const sources = []
    collect(groups, sources)
    if (sources.length) sections.push({ label: groups[0].text, sources })
  }
  const unlisted = pages.filter((source) => !listed.has(source) && !/^layout:\s*home/m.test(readPage(srcDir, source).yaml))
  if (unlisted.length) sections.push({ label: 'Other pages', sources: unlisted })
  return sections.map(({ label, sources }) => ({
    label,
    docs: sources.map((relativePath) => {
      const { yaml, body } = readPage(srcDir, relativePath)
      return {
        relativePath,
        url: pageUrl(relativePath),
        title: titleOf(yaml, body),
        description: frontmatterValue(yaml, 'description') || describe(body),
        markdown: absoluteLinks(body.replace(/<!--[\s\S]*?-->\n*/g, ''), relativePath).trim(),
      }
    }),
  }))
}

export function writeLlmsFiles(siteConfig) {
  const { outDir } = siteConfig
  const sections = llmsSections(siteConfig)
  const docs = sections.flatMap(({ docs: sectionDocs }) => sectionDocs)

  for (const doc of docs) {
    const target = join(outDir, doc.relativePath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `${doc.markdown}\n`)
  }

  const optional = [
    `- [Every page in one file](${SITE_URL}/llms-full.txt): the full text of every page listed here`,
    ...(existsSync(join(outDir, 'openapi.json')) ? [`- [OpenAPI description](${SITE_URL}/openapi.json): every REST API path, method, auth and tag`] : []),
    `- [Source code](${REPO_URL}): the AlianHub repository on GitHub`,
    '- [Live demo](https://demo.alianhub.com): try AlianHub with sample data',
  ]
  const index = [
    `# ${SITE_NAME}`,
    '',
    `> ${PRODUCT_SUMMARY}`,
    '',
    'These docs explain how to use AlianHub, install and run it on your own server, connect an AI app to it, and build on its code and REST API. Each link is the Markdown version of a page; drop the `.md` (or `index.md`) for the HTML page.',
    '',
    ...sections.flatMap(({ label, docs: sectionDocs }) => [
      `## ${label}`,
      '',
      ...sectionDocs.map((doc) => `- [${doc.title}](${SITE_URL}/${doc.relativePath})${doc.description ? `: ${doc.description}` : ''}`),
      '',
    ]),
    '## Optional',
    '',
    ...optional,
    '',
  ]
  writeFileSync(join(outDir, 'llms.txt'), index.join('\n'))

  const full = [
    `# ${SITE_NAME}`,
    '',
    `> ${PRODUCT_SUMMARY}`,
    '',
    ...docs.flatMap((doc) => ['---', '', `Source: ${doc.url}`, '', doc.markdown, '']),
  ]
  writeFileSync(join(outDir, 'llms-full.txt'), full.join('\n'))
}
