# Setup & Installation

**[← Back to main guide](../CLAUDE.md)**

## Prerequisites

- **Node.js:** 18.x or higher (check with `node --version`)
- **npm:** 9.x or higher (included with Node.js)
- **MongoDB:** Local (preferred for dev) or cloud (MongoDB Atlas)
- **Git:** For cloning the repository

## Installation Steps

### 1. Clone Repository
```bash
git clone https://github.com/aliansoftwareteam/AlianHub-Project-Management-System.git
cd AlianHub-Project-Management-System
```

### 2. Install Root Dependencies
This installs backend + frontend + installation UI dependencies:
```bash
npm install
```

**Note:** This may take 2-5 minutes depending on network speed.

### 3. Create Environment File
```bash
# Copy environment template
cp .env.example .env

# Edit .env with your configuration (see Required Variables section)
```

### 4. Start MongoDB
**Option A: Local MongoDB (Recommended for Development)**
```bash
# On Windows (if installed):
mongod

# On macOS (via Homebrew):
brew services start mongodb-community

# On Linux (via apt):
sudo systemctl start mongod
```

Verify connection: `mongosh` or `mongo` should connect to `localhost:27017`

**Option B: MongoDB Atlas (Cloud)**
```bash
# Update .env with your connection string
MONGODB_URL="mongodb+srv://username:password@cluster.mongodb.net/database"
```

### 5. Start Development Server
```bash
npm run nodemon
```

**Expected output:**
```
Server started on port 4000
Database connected to mongodb://localhost:27017
```

Visit `http://localhost:4000` in your browser.

### 6. Access Installation Wizard (First Time)
If this is a fresh instance, you'll see the installation wizard at `http://localhost:4000`. Follow the steps to:
- Create initial company
- Set admin user credentials
- Configure basic settings

---

## npm Scripts Reference

| Command | Purpose |
|---------|---------|
| `npm start` | Run production server (node server.js) |
| `npm run nodemon` | Run dev server with hot-reload |
| `npm run check-version` | Verify app version |
| `npm run basic-install` | Install deps + start (one-shot) |

## Frontend Build

The Vue.js frontend is auto-served during development. For production builds:

```bash
cd frontend
npm install        # (if not already done)
npm run build      # Outputs to frontend/dist/
```

The built files are served from `http://localhost:4000` in production.

## Installation UI Build

The setup wizard (installation/) can also be built separately:

```bash
cd installation
npm install        # (if not already done)
npm run build      # Outputs to installation/dist/
```

---

## Required Environment Variables

Create a `.env` file in the project root with these critical variables:

### Server Configuration
```env
PORT=4000                             # API port
NODE_ENV=development                  # development | production
APP_NAME="AlianHub"
UNDER_MAINTENANCE="false"
```

### Database (REQUIRED)
```env
MONGODB_URL="mongodb://localhost:27017"    # No trailing slash!
```

**Important:**
- Local: `mongodb://localhost:27017`
- Atlas: `mongodb+srv://user:pass@cluster.mongodb.net/database`

### Authentication (REQUIRED)
```env
JWT_SECRET="your_super_secret_string_here"      # Use strong random string
JWT_EXP="24h"                                    # Token expiration
JWT_ALGORITHM="HS256"
```

**Generate JWT_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### URLs
```env
APIURL="http://localhost:4000/"                  # Backend URL (with trailing slash)
WEBURL="http://localhost:4000"                   # Frontend URL (no trailing slash)
```

### Storage (Choose One)

**Option A: Wasabi S3 (Recommended for Production)**
```env
STORAGE_TYPE="wasabi"
WASABI_ACCESS_KEY="your_access_key"
WASABI_SECRET_ACCESS_KEY="your_secret_key"
WASABI_USERID="your_user_id"
WASABIENDPOINT="https://s3.wasabisys.com"
WASABI_REGION="us-east-1"
USERPROFILEBUCKET="your-bucket-name"
IAM_ENDPOINT="https://iam.wasabisys.com"
```

**Option B: Local File System (Development)**
```env
STORAGE_TYPE="server"
```

### Email (Choose One)

**Option A: Nodemailer with SMTP**
```env
NODEMAILER_HOST="smtp.gmail.com"
NODEMAILER_PORT="587"
NODEMAILER_EMAIL="your-email@gmail.com"
NODEMAILER_EMAIL_PASSWORD="your_app_password"    # Use Gmail app password, not account password
```

**Option B: Resend HTTP API (Recommended for Cloud)**
```env
RESEND_API_KEY="re_xxxxxxxxxxxxxxxxxx"
RESEND_FROM_EMAIL="noreply@yourdomain.com"
```

### Firebase (Optional — for Push Notifications)
```env
SERVICE_FILE="../firebase-adminsdk.json"
APIKEY="..."
PROJECTID="..."
STORAGEBUCKET="..."
MESSAGINGSENDERID="..."
APPID="..."
```

**Get Firebase credentials:** Firebase Console → Project Settings → Service Accounts

### Other Configuration
```env
NOOFPRESETCOMPANY=10                  # Number of demo companies in wizard
PRECOMPANYKEY="your_preset_key"
ERRORRECIVEREMAIL="admin@yourdomain.com"

# Optional: AI integration
AI_API_KEY="..."
AI_MODEL="..."
```

---

## Verify Installation

### Check Backend
```bash
# GET /api/v2/auth/ping
curl http://localhost:4000/api/v2/auth/ping
# Expected: {"status":true}
```

### Check Database Connection
```bash
# Visit admin panel
curl http://localhost:4000/api/v2/admin/status
```

### Check Frontend Assets
Visit `http://localhost:4000` and verify UI loads without 404 errors.

---

## Troubleshooting

### MongoDB Connection Error
```
Error: connect ECONNREFUSED 127.0.0.1:27017
```

**Solution:**
1. Ensure MongoDB is running: `mongosh` or `mongo`
2. Check MONGODB_URL in .env matches your setup
3. If using Atlas, verify IP whitelist includes your IP

### Port 4000 Already in Use
```bash
# Find process using port 4000
netstat -ano | findstr :4000  # Windows
lsof -i :4000                 # macOS/Linux

# Kill process (replace PID)
taskkill /PID <PID> /F        # Windows
kill -9 <PID>                 # macOS/Linux

# Or use different port in .env
PORT=5000
```

### Dependencies Not Installed
```bash
# Clear npm cache
npm cache clean --force

# Reinstall
rm -rf node_modules package-lock.json
npm install
```

### Frontend Not Showing
1. Ensure `npm run build` was run in `frontend/` folder
2. Check for 404 errors in browser DevTools Network tab
3. Verify WEBURL in .env matches browser URL

### JWT_SECRET is Too Short
⚠️ This will cause token validation errors.

```bash
# Generate secure secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Update .env
JWT_SECRET="<paste_generated_value>"

# Restart server
```

---

## Production Deployment

### Key Steps

1. **Use strong JWT_SECRET** (32+ characters, random)
2. **Use cloud MongoDB** (MongoDB Atlas recommended)
3. **Use HTTPS** (reverse proxy with SSL)
4. **Use Wasabi or AWS S3** for file storage
5. **Set NODE_ENV=production**
6. **Use managed email** (Resend recommended)
7. **Enable Firebase** for push notifications
8. **Configure CORS** in index.js to whitelist your domain

### Example Production .env
```env
NODE_ENV=production
PORT=4000
MONGODB_URL="mongodb+srv://user:pass@cluster.mongodb.net/database"
JWT_SECRET="<strong_random_string>"
APIURL="https://api.yourdomain.com/"
WEBURL="https://yourdomain.com"
STORAGE_TYPE="wasabi"
WASABI_ACCESS_KEY="..."
STORAGE_TYPE=wasabi
# ... other production config
```

### Docker Deployment
```bash
# Build image
docker build -t alianhub:latest .

# Run container
docker run -p 4000:4000 \
  -e MONGODB_URL="mongodb://mongo:27017" \
  -e JWT_SECRET="your_secret" \
  alianhub:latest

# Using docker-compose
docker-compose up -d
```

See `docker-compose.yml` for multi-service setup (app + MongoDB).

---

## Development Workflow

### Hot-Reload Development
```bash
npm run nodemon
# Server restarts on file changes in Modules/, Config/, etc.
```

### Frontend Changes
```bash
# Changes in frontend/src/ auto-rebuild (if webpack dev server running)
# Otherwise, run:
cd frontend && npm run build
```

### Run Specific Module Tests (When Added)
```bash
npm test -- Modules/Task/
```

### Check Linting
```bash
# (Linter not configured yet — recommended: ESLint)
npm install --save-dev eslint
```
