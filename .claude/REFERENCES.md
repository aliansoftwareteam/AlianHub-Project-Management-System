# External References & Resources

**[← Back to main guide](../CLAUDE.md)**

## Official AlianHub Resources

| Resource | URL | Purpose |
|----------|-----|---------|
| **Official Website** | https://alianhub.com | Project homepage |
| **Documentation** | https://help.alianhub.com | User guides and API docs |
| **Live Demo** | https://demo.alianhub.com | Try the app (read-only) |
| **GitHub Repository** | https://github.com/aliansoftwareteam/AlianHub-Project-Management-System | Source code |
| **Issue Tracker** | https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues | Report bugs, request features |

## Contributing & Community

| Resource | Path | Purpose |
|----------|------|---------|
| **Contributing Guide** | [CONTRIBUTING.md](../../CONTRIBUTING.md) | How to contribute |
| **Discoverability Playbook** | [.claude/DISCOVERABILITY.md](DISCOVERABILITY.md) | Internal — submission targets, launch copy, SEO snippets |
| **Branching Strategy** | [BRANCHING.md](../../BRANCHING.md) | Branch model, PR/hotfix/release workflows |
| **Security Policy** | [SECURITY.md](../../SECURITY.md) | Report security vulnerabilities |
| **Code of Conduct** | [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) | Community standards |
| **License** | [LICENSE](../../LICENSE) | AGPL-3.0 open-source license |
| **Copyright** | [COPYRIGHT](../../COPYRIGHT) | Copyright notice (Alian Software) |

## Technology Documentation

### Backend

| Technology | Docs | Key Features |
|-----------|------|--------------|
| **Node.js** | https://nodejs.org/docs | JavaScript runtime |
| **Express.js** | https://expressjs.com | HTTP server framework |
| **MongoDB** | https://docs.mongodb.com | NoSQL database |
| **Mongoose** | https://mongoosejs.com | MongoDB ODM |
| **Socket.io** | https://socket.io/docs | Real-time events |
| **JWT** | https://jwt.io | Token-based authentication |
| **bcrypt** | https://www.npmjs.com/package/bcrypt | Password hashing |
| **Winston Logger** | https://github.com/winstonjs/winston | Structured logging |

### Frontend

| Technology | Docs | Key Features |
|-----------|------|--------------|
| **Vue.js 3** | https://vuejs.org | UI framework |
| **Vue Router** | https://router.vuejs.org | Client-side routing |
| **Pinia** | https://pinia.vuejs.org | State management (recommended) |
| **Vuex** | https://vuex.vuejs.org | State management (legacy) |
| **vue-i18n** | https://vue-i18n.intlify.dev | Internationalization |
| **Axios** | https://axios-http.com | HTTP client |

### DevOps & Deployment

| Technology | Docs | Key Features |
|-----------|------|--------------|
| **Docker** | https://docs.docker.com | Container orchestration |
| **Docker Compose** | https://docs.docker.com/compose | Multi-service setup |
| **MongoDB Atlas** | https://www.mongodb.com/cloud/atlas | Managed MongoDB |
| **Wasabi** | https://wasabi.com | S3-compatible storage |
| **AWS SDK** | https://docs.aws.amazon.com/sdk-for-javascript | AWS/S3 API |
| **Nodemailer** | https://nodemailer.com | Email delivery |
| **Resend** | https://resend.com | Email API (recommended) |
| **Firebase Admin** | https://firebase.google.com/docs/admin | Push notifications |

## Project Documentation (In This Repo)

### Main Guides
- [CLAUDE.md](../CLAUDE.md) — Project overview & quick start (THIS IS THE ENTRY POINT)
- [README.md](../../README.md) — Installation & setup instructions

### Architecture & Design
- [.claude/ARCHITECTURE.md](ARCHITECTURE.md) — System design & data flow
- [.claude/DESIGN.md](DESIGN.md) — Design philosophy & trade-offs
- [.claude/TECH-STACK.md](TECH-STACK.md) — Technology choices

### Development Guides
- [.claude/CONVENTIONS.md](CONVENTIONS.md) — Code naming & organization rules
- [.claude/FOLDER-STRUCTURE.md](FOLDER-STRUCTURE.md) — Project layout
- [.claude/SETUP.md](SETUP.md) — Installation & configuration
- [.claude/COMMON-TASKS.md](COMMON-TASKS.md) — How-to guides for development

### Best Practices
- [.claude/SECURITY-PATTERNS.md](SECURITY-PATTERNS.md) — Security best practices
- [.claude/ANTI-PATTERNS.md](ANTI-PATTERNS.md) — What NOT to do

### Memory & Context
- [.claude/MEMORY.md](MEMORY.md) — Index of persistent memory files
- [.claude/memory/](./memory/) — Persistent user/project/feedback context

### Historical QA Reports
- [.claude/archives/qa-reports/](./archives/qa-reports/) — QA audit reports & findings

## npm Package Index

### Production Dependencies (package.json)

```
express                     4.21.2      HTTP framework
mongoose                    8.17.2      MongoDB ODM
socket.io                   4.8.1       Real-time events
jsonwebtoken                -           JWT tokens
bcrypt                      5.1.1       Password hashing
winston                     3.17.0      Logging
node-cache                  5.1.2       In-memory cache
node-schedule               2.1.1       Cron jobs
luxon                       3.5.0       Date/time handling
sharp                       0.32.6      Image processing
@aws-sdk/client-s3          3.864.0     S3 API
archiver                    7.0.1       ZIP file creation
nodemailer                  6.9.16      Email (SMTP)
firebase-admin              -           Push notifications
vue                         (frontend)  UI framework
axios                       (frontend)  HTTP client
```

See [package.json](../../package.json) for complete list and exact versions.

## Deployment Platforms (Recommended)

| Platform | Use Case | Link |
|----------|----------|------|
| **Render** | Managed Node.js hosting | https://render.com |
| **Railway** | Docker deployment | https://railway.app |
| **Heroku** | Simple deployments (deprecated) | https://heroku.com |
| **AWS Elastic Beanstalk** | Scalable deployments | https://aws.amazon.com/elasticbeanstalk |
| **DigitalOcean App Platform** | Managed containers | https://www.digitalocean.com/products/app-platform |

## Database Hosting

| Platform | Pros | Link |
|----------|------|------|
| **MongoDB Atlas** | Managed, free tier, reliable | https://www.mongodb.com/cloud/atlas |
| **AWS DocumentDB** | AWS ecosystem, compatibility | https://aws.amazon.com/documentdb |
| **Azure Cosmos DB** | Microsoft ecosystem | https://azure.microsoft.com/cosmosdb |

## File Storage

| Platform | Use Case | Link |
|----------|----------|------|
| **Wasabi** | S3-compatible, cheap | https://wasabi.com |
| **AWS S3** | Reliable, expensive | https://aws.amazon.com/s3 |
| **DigitalOcean Spaces** | S3-compatible, affordable | https://www.digitalocean.com/products/spaces |
| **MinIO** | Self-hosted S3 alternative | https://min.io |

## Performance & Monitoring

| Tool | Purpose | Link |
|------|---------|------|
| **New Relic** | APM & monitoring | https://newrelic.com |
| **Datadog** | Infrastructure monitoring | https://www.datadoghq.com |
| **Sentry** | Error tracking | https://sentry.io |
| **LogRocket** | Frontend error tracking | https://logrocket.com |
| **GitHub Actions** | CI/CD pipelines | https://github.com/features/actions |

## Learning Resources

### Node.js & Express
- [Node.js Documentation](https://nodejs.org/docs/latest)
- [Express.js Documentation](https://expressjs.com)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)

### MongoDB
- [MongoDB University](https://university.mongodb.com) — Free courses
- [MongoDB Data Modeling](https://docs.mongodb.com/manual/core/data-modeling-introduction)

### Vue.js
- [Vue.js Guide](https://vuejs.org/guide/introduction.html)
- [Vue 3 Composition API](https://vuejs.org/guide/extras/composition-api-faq.html)

### Real-Time Architecture
- [Socket.io Guide](https://socket.io/docs/v4/)
- [WebSocket vs Server-Sent Events](https://www.html5rocks.com/en/tutorials/eventsource/basics)

### Security
- [OWASP Top 10](https://owasp.org/www-project-top-ten)
- [Node.js Security Checklist](https://blog.risingstack.com/node-js-security-checklist)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)

## Quick Links

| Shortcut | What's There |
|----------|-------------|
| `Config/` | Configuration files |
| `Modules/` | Feature modules |
| `frontend/` | Vue.js app |
| `Modules/auth/` | Authentication logic |
| `event/socketEventEmitter.js` | Real-time events |
| `common-storage/` | File upload abstraction |
| `.env.example` | Environment template |

## Getting Help

### Ask a Question
1. **Search docs:** https://help.alianhub.com
2. **GitHub Issues:** https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues
3. **This documentation:** Read CONVENTIONS.md, COMMON-TASKS.md

### Report a Bug
1. Check existing issues: https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues
2. Create new issue with:
   - Detailed reproduction steps
   - Expected vs actual behavior
   - Environment (Node.js version, MongoDB version, etc.)
3. Include error logs (check `log/error.log`)

### Request a Feature
1. Open GitHub issue with label `enhancement`
2. Describe use case and expected behavior
3. Link to any related issues

### Report Security Issue
**Do NOT open public GitHub issue for security bugs.**

Follow [SECURITY.md](../../SECURITY.md) for responsible disclosure process.

## Community

| Channel | For What |
|---------|----------|
| **GitHub Issues** | Bug reports, feature requests |
| **GitHub Discussions** | Questions, ideas, discussions |
| **Contributing** | See [CONTRIBUTING.md](../../CONTRIBUTING.md) |
