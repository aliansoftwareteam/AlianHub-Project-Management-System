import { defineConfig } from 'vitepress'
import { apiSidebar } from './api-sidebar.mjs'
import { REPO_URL as repo, SITE_URL, transformHead, transformPageData, writeLlmsFiles } from './seo.mjs'

const gettingStarted = [
  {
    text: 'Getting started',
    items: [
      { text: 'What is AlianHub?', link: '/getting-started/' },
      { text: 'Quick tour', link: '/getting-started/quick-tour' },
      { text: 'Concepts and glossary', link: '/getting-started/concepts' },
    ],
  },
  {
    text: 'Your first hour',
    collapsed: false,
    items: [
      { text: 'Overview', link: '/getting-started/first-hour/' },
      { text: '1. Sign up and set up', link: '/getting-started/first-hour/sign-up' },
      { text: '2. Your first project', link: '/getting-started/first-hour/first-project' },
      { text: '3. Lists, folders and tasks', link: '/getting-started/first-hour/lists-folders-tasks' },
      { text: '4. Views', link: '/getting-started/first-hour/views' },
      { text: '5. Bring people in', link: '/getting-started/first-hour/people' },
      { text: '6. The Inbox', link: '/getting-started/first-hour/inbox' },
      { text: '7. Log time', link: '/getting-started/first-hour/time' },
      { text: '8. Connect your AI app', link: '/getting-started/first-hour/connect-ai' },
      { text: '9. Where things are', link: '/getting-started/first-hour/where-things-are' },
    ],
  },
]

const userGuide = [
  {
    text: 'User guide',
    items: [{ text: 'Overview', link: '/user-guide/' }],
  },
  {
    text: 'Plan the work',
    items: [
      { text: 'Projects', link: '/user-guide/projects' },
      { text: 'Folders, lists and sprints', link: '/user-guide/lists-and-sprints' },
      { text: 'Tasks', link: '/user-guide/tasks' },
      { text: 'Milestones', link: '/user-guide/milestones' },
      { text: 'Custom fields', link: '/user-guide/custom-fields' },
      { text: 'Rules (automations)', link: '/user-guide/rules' },
      { text: 'Templates', link: '/user-guide/templates' },
    ],
  },
  {
    text: 'Views',
    collapsed: false,
    items: [
      { text: 'Views, filters and saved views', link: '/user-guide/views/' },
      { text: 'List', link: '/user-guide/views/list' },
      { text: 'Board', link: '/user-guide/views/board' },
      { text: 'Table', link: '/user-guide/views/table' },
      { text: 'Calendar', link: '/user-guide/views/calendar' },
      { text: 'Gantt', link: '/user-guide/views/gantt' },
      { text: 'Workload', link: '/user-guide/views/workload' },
      { text: 'Embed and other views', link: '/user-guide/views/embed' },
    ],
  },
  {
    text: 'Work together',
    items: [
      { text: 'Docs and whiteboards', link: '/user-guide/docs-and-whiteboards' },
      { text: 'Chat and the Inbox', link: '/user-guide/chat-and-inbox' },
      { text: 'Notifications', link: '/user-guide/notifications' },
      { text: 'People and roles', link: '/user-guide/people-and-roles' },
      { text: 'Your settings', link: '/user-guide/settings' },
    ],
  },
  {
    text: 'Time and reports',
    items: [
      { text: 'Time and timesheets', link: '/user-guide/time' },
      { text: 'Approvals', link: '/user-guide/approvals' },
      { text: 'Reports and dashboards', link: '/user-guide/reports' },
      { text: 'Desktop time tracker', link: '/user-guide/time-tracker-app' },
    ],
  },
  {
    text: 'AI',
    items: [
      { text: 'Ask AlianHub', link: '/user-guide/ai-ask' },
      { text: 'Agents in AlianHub', link: '/user-guide/agents' },
    ],
  },
  {
    text: 'Connect and move',
    items: [
      { text: 'Integrations', link: '/user-guide/integrations' },
      { text: 'Connectors', link: '/user-guide/connectors' },
      { text: 'Import from ClickUp', link: '/user-guide/import-from-clickup' },
    ],
  },
]

const ai = [
  {
    text: 'Connect your AI',
    items: [
      { text: 'Overview', link: '/ai/' },
      { text: 'Connect your AI app', link: '/ai/connect' },
      { text: 'What it can do', link: '/ai/what-it-can-do' },
      { text: 'Approve in the Inbox', link: '/ai/approve-in-the-inbox' },
      { text: 'Undo a change', link: '/ai/undo' },
      { text: 'Limits and pause', link: '/ai/limits-and-pause' },
      { text: 'What it sees', link: '/ai/what-it-sees' },
      { text: 'Audit log', link: '/ai/audit-log' },
      { text: 'Things to say', link: '/ai/things-to-say' },
      { text: 'Team packs and role agents', link: '/ai/team-packs' },
      { text: 'Let Claude Code build your tasks', link: '/ai/claude-code-developer' },
    ],
  },
  {
    text: 'For builders',
    items: [
      { text: 'MCP server reference', link: '/ai/mcp-server' },
      { text: 'AI platform architecture', link: '/ai/architecture' },
    ],
  },
]

const admin = [
  {
    text: 'Admin guide',
    items: [{ text: 'Overview', link: '/admin/' }],
  },
  {
    text: 'Install',
    items: [
      { text: 'Requirements', link: '/admin/requirements' },
      { text: 'Install with Docker', link: '/admin/install-docker' },
      { text: 'Install on a server (Node + MongoDB)', link: '/admin/install-manual' },
      { text: 'First run', link: '/admin/first-run' },
      { text: 'HTTPS and reverse proxy', link: '/admin/https' },
    ],
  },
  {
    text: 'Configure',
    items: [
      { text: 'The Instance console', link: '/admin/instance-console' },
      { text: 'Environment variables', link: '/admin/env-reference' },
      { text: 'File storage', link: '/admin/storage' },
      { text: 'Mail', link: '/admin/mail' },
      { text: 'Sign-in: OAuth, SSO and SCIM', link: '/admin/sso-oauth' },
      { text: 'AI providers', link: '/admin/ai-providers' },
      { text: 'Connectors', link: '/admin/connectors' },
      { text: 'Security', link: '/admin/security' },
    ],
  },
  {
    text: 'Operate',
    items: [
      { text: 'Upgrades', link: '/admin/upgrades' },
      { text: 'Backup and restore', link: '/admin/backups' },
      { text: 'Logs and monitoring', link: '/admin/monitoring' },
      { text: 'Troubleshooting', link: '/admin/troubleshooting' },
    ],
  },
]

const developer = [
  {
    text: 'Developer guide',
    items: [{ text: 'Overview', link: '/developer/' }],
  },
  {
    text: 'Understand',
    items: [
      { text: 'Architecture', link: '/developer/architecture' },
      { text: 'Module layout', link: '/developer/module-layout' },
      { text: 'Multi-tenancy and data access', link: '/developer/multi-tenancy' },
      { text: 'Real-time (Socket.io) events', link: '/developer/socket-events' },
      { text: 'Frontend', link: '/developer/frontend' },
    ],
  },
  {
    text: 'Build',
    items: [
      { text: 'Local setup', link: '/developer/local-setup' },
      { text: 'Writing a module', link: '/developer/writing-a-module' },
      { text: 'Agent actions and MCP tools', link: '/developer/agent-actions' },
      { text: 'Conventions', link: '/developer/conventions' },
      { text: 'Translations (i18n)', link: '/developer/i18n' },
      { text: 'Design tokens and styles', link: '/developer/design-tokens' },
      { text: 'Testing', link: '/developer/testing' },
    ],
  },
  {
    text: 'Ship',
    items: [
      { text: 'Contributing', link: '/developer/contributing' },
      { text: 'Branches, versions and releases', link: '/developer/releases' },
    ],
  },
]

export default defineConfig({
  title: 'AlianHub Docs',
  description: 'Documentation for AlianHub, the open-source, self-hosted project management system.',
  lang: 'en-US',
  cleanUrls: true,
  srcExclude: ['STYLE.md', 'README.md'],
  vite: { build: { chunkSizeWarningLimit: 2000 } },
  lastUpdated: true,
  sitemap: { hostname: SITE_URL },
  transformPageData,
  transformHead,
  buildEnd: writeLlmsFiles,
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/favicon.png' }],
    ['meta', { name: 'theme-color', content: '#2F3990' }],
  ],
  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'AlianHub Docs',
    nav: [
      { text: 'Get started', link: '/getting-started/', activeMatch: '/getting-started/' },
      { text: 'User guide', link: '/user-guide/', activeMatch: '/user-guide/' },
      { text: 'Connect your AI', link: '/ai/', activeMatch: '/ai/' },
      { text: 'Admin', link: '/admin/', activeMatch: '/admin/' },
      { text: 'Developers', link: '/developer/', activeMatch: '/developer/' },
      { text: 'API', link: '/api/', activeMatch: '/api/' },
      {
        text: 'More',
        items: [
          { text: 'FAQ', link: '/help/faq' },
          { text: 'Troubleshooting', link: '/help/troubleshooting' },
          { text: 'Changelog', link: '/help/changelog' },
        ],
      },
      { text: 'Try the live demo', link: 'https://demo.alianhub.com' },
    ],
    sidebar: {
      '/getting-started/': gettingStarted,
      '/user-guide/': userGuide,
      '/ai/': ai,
      '/admin/': admin,
      '/developer/': developer,
      '/api/': apiSidebar,
      '/help/': [
        {
          text: 'Help',
          items: [
            { text: 'FAQ', link: '/help/faq' },
            { text: 'Troubleshooting', link: '/help/troubleshooting' },
            { text: 'Changelog', link: '/help/changelog' },
            { text: 'Getting help', link: '/help/support' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: {
      pattern: `${repo}/edit/main/docs-site/:path`,
      text: 'Edit this page on GitHub',
    },
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    footer: {
      message: 'Released under the AGPL-3.0 licence.',
      copyright: '© Alian Software',
    },
  },
})
