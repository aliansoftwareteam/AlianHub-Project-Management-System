# Security Patterns & Best Practices

**[← Back to main guide](../CLAUDE.md)**

## Multi-Tenancy Scoping (CRITICAL)

### Rule: Always Include companyId

Every MongoDB query **must** filter by `companyId`. Omitting it is a **data leak vulnerability**.

**✅ Correct: Company-scoped query**
```javascript
const mongoObj = {
  type: SCHEMA_TYPE.PROJECTS,
  data: [{ companyId, _id: projectId }]  // ← Both company AND resource ID
};
const project = await MongoDbCrudOpration(companyId, mongoObj, 'findOne');
```

**❌ WRONG: Missing companyId (data leak!)**
```javascript
// This query returns projects from ANY company
Task.findOne({ taskId: 123 });

// This also leaks data
MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ taskId }] });
```

### Extract companyId Safely

Always get `companyId` from:
- JWT token (decoded by middleware)
- URL params (from authenticated request)
- Request body (with validation)

**Never:**
- Hardcode companyId in code
- Trust user-supplied companyId without validation
- Use different companyId than one in JWT

```javascript
exports.getProject = (req, res, next) => {
  const companyId = req.params.companyId;  // From URL (/api/v2/:companyId/projects/:id)
  
  // Verify user belongs to this company (should be checked by middleware)
  if (req.user.companyId !== companyId) {
    req.errorMessageObject = { message: "Forbidden", statusCode: 403 };
    return next();
  }
  
  // Safe to use now
  const mongoObj = {
    type: SCHEMA_TYPE.PROJECTS,
    data: [{ companyId, _id: projectId }]
  };
  
  MongoDbCrudOpration(companyId, mongoObj, 'findOne');
};
```

---

## Password Security

### Never Store Plain Text Passwords

Use bcrypt to hash passwords:
```javascript
const bcrypt = require('bcrypt');

exports.registerAuth = (req, res, next) => {
  const { password } = req.body;
  
  // Hash password with salt rounds
  const hashedPassword = bcrypt.hashSync(password, 10);  // 10 rounds
  
  // Store hashedPassword in database
  const user = {
    email: req.body.email,
    password: hashedPassword
  };
  
  MongoDbCrudOpration(companyId, mongoObj, 'save');
};
```

### Verify Password on Login
```javascript
exports.loginAuth = (req, res, next) => {
  const { email, password } = req.body;
  
  // Get user from DB
  const user = await MongoDbCrudOpration(..., 'findOne');
  
  // Compare submitted password with stored hash
  const isValid = bcrypt.compareSync(password, user.password);
  
  if (!isValid) {
    req.errorMessageObject = { message: "Invalid credentials" };
    return next();
  }
  
  // Generate JWT only after successful auth
  const token = jwt.sign(
    { userId: user._id, companyId: user.companyId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXP }
  );
  
  res.json({ status: true, data: { token } });
};
```

---

## JWT Token Management

### Strong JWT Secret
Use a strong, random secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store in `.env`:
```env
JWT_SECRET="a1b2c3d4e5f6... (32+ characters, random)"
JWT_ALGORITHM="HS256"  # Use HS256 or RS256 (not MD5, not none)
JWT_EXP="24h"
```

### Token Expiration
```javascript
const token = jwt.sign(
  { userId, companyId, role },
  process.env.JWT_SECRET,
  {
    expiresIn: '24h',           // Short-lived tokens
    algorithm: 'HS256',          // Standard algorithm
    issuer: 'alianhub',          // Identify token source
    audience: 'alianhub-client'  // Identify intended recipient
  }
);
```

### Token Validation
```javascript
const decoded = jwt.verify(token, process.env.JWT_SECRET);

// Check expiration (jwt.verify does this automatically)
// Check audience/issuer match
if (decoded.aud !== 'alianhub-client') {
  throw new Error('Invalid token audience');
}

// Extract user context
const userId = decoded.userId;
const companyId = decoded.companyId;
```

### Token Storage (Client-Side)

**⚠️ Vulnerability Alert:** localStorage is vulnerable to XSS attacks.

**Current approach:** Store JWT in localStorage
```javascript
localStorage.setItem('authToken', token);
```

**Risk:** If attacker injects XSS, they can steal the token.

**Mitigation:**
1. Use HTTPS (prevents man-in-the-middle attacks)
2. Implement CSP (Content Security Policy) headers
3. Sanitize all user input on frontend
4. Use httpOnly cookies (better, but requires backend support)

---

## Input Validation

### Always Validate at API Boundary

Never trust client input. Validate before database operations:

```javascript
exports.createTask = (req, res, next) => {
  const { taskName, priority, dueDate } = req.body;
  
  // Validate required fields
  if (!taskName || taskName.trim().length === 0) {
    req.errorMessageObject = { 
      message: "Task name is required", 
      statusCode: 400 
    };
    return next();
  }
  
  // Validate field types
  if (typeof taskName !== 'string') {
    req.errorMessageObject = { 
      message: "Task name must be a string", 
      statusCode: 400 
    };
    return next();
  }
  
  // Validate length constraints
  if (taskName.length > 255) {
    req.errorMessageObject = { 
      message: "Task name must be less than 255 characters", 
      statusCode: 400 
    };
    return next();
  }
  
  // Validate enum values
  if (priority && !['low', 'medium', 'high'].includes(priority)) {
    req.errorMessageObject = { 
      message: "Invalid priority value", 
      statusCode: 400 
    };
    return next();
  }
  
  // Safe to use now
  const mongoObj = {
    type: SCHEMA_TYPE.TASKS,
    data: [{
      taskName: taskName.trim(),
      priority: priority || 'medium',
      dueDate,
      companyId
    }]
  };
  
  MongoDbCrudOpration(companyId, mongoObj, 'save');
};
```

### Sanitize File Uploads
```javascript
const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;  // 10MB

exports.uploadFile = (req, res, next) => {
  const file = req.files.file;
  
  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    req.errorMessageObject = { message: "File too large" };
    return next();
  }
  
  // Validate file type by extension
  const ext = file.name.split('.').pop().toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    req.errorMessageObject = { message: "File type not allowed" };
    return next();
  }
  
  // Never use user-supplied filename directly
  const safeFilename = `${companyId}_${Date.now()}_${file.name}`;
  
  commonStorage.uploadFile(`uploads/${safeFilename}`, file.data);
};
```

---

## Authorization & Permissions

### Verify User Owns Resource

Before returning/modifying resource, verify user has access:

```javascript
exports.updateProject = (req, res, next) => {
  const { companyId, projectId } = req.params;
  const userId = req.user.userId;
  
  // Step 1: Verify user belongs to company
  if (req.user.companyId !== companyId) {
    req.errorMessageObject = { message: "Unauthorized", statusCode: 403 };
    return next();
  }
  
  // Step 2: Get project and verify user has permission
  const mongoObj = {
    type: SCHEMA_TYPE.PROJECTS,
    data: [{ companyId, _id: projectId }]
  };
  
  MongoDbCrudOpration(companyId, mongoObj, 'findOne')
    .then(project => {
      // Verify user is project owner or team member
      if (project.ownerId !== userId && !project.teamIds.includes(userId)) {
        req.errorMessageObject = { message: "Forbidden", statusCode: 403 };
        return next();
      }
      
      // User has permission, safe to proceed
      // ... update logic
    });
};
```

### Role-Based Access Control (RBAC)

```javascript
const PERMISSIONS = {
  ADMIN: ['create_project', 'delete_project', 'manage_users'],
  MANAGER: ['create_task', 'assign_task', 'view_reports'],
  MEMBER: ['create_task', 'view_task']
};

exports.deleteProject = (req, res, next) => {
  const userRole = req.user.role;  // From JWT
  
  if (!PERMISSIONS[userRole].includes('delete_project')) {
    req.errorMessageObject = { 
      message: "Insufficient permissions", 
      statusCode: 403 
    };
    return next();
  }
  
  // Proceed with deletion
};
```

---

## CORS & Cross-Origin Security

### Configure CORS Properly

```javascript
// index.js or server.js
const cors = require('cors');

app.use(cors({
  origin: process.env.WEBURL,  // Only allow frontend domain
  credentials: true,            // Allow cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

**Never use:** `origin: '*'` (allows any domain)

---

## Audit Logging

### Log Security Events
```javascript
const logger = require('../Config/loggerConfig');

exports.loginAuth = (req, res, next) => {
  const { email } = req.body;
  
  // ... authentication logic
  
  if (isValid) {
    logger.info(`Login successful: ${email} from IP ${req.ip}`);
    res.json({ status: true, data: { token } });
  } else {
    logger.warn(`Login failed: ${email} from IP ${req.ip}`);
    req.errorMessageObject = { message: "Invalid credentials" };
    next();
  }
};
```

### Log Sensitive Operations
```javascript
logger.info(`Deleted project ${projectId} by user ${userId}`, {
  companyId,
  timestamp: new Date(),
  ip: req.ip
});
```

---

## Environment Variable Security

### Never Commit Secrets
```bash
# ❌ WRONG: Committing .env file
git add .env

# ✅ CORRECT: .env is in .gitignore
git status  # Should NOT show .env
```

### Secrets in Production
- Use managed secrets (AWS Secrets Manager, HashiCorp Vault)
- Never hardcode API keys in code
- Rotate secrets regularly
- Audit access to secrets

### Example: Loading Secrets
```javascript
// Config/config.js
module.exports = {
  JWT_SECRET: process.env.JWT_SECRET,  // From .env or Secrets Manager
  WASABI_KEY: process.env.WASABI_ACCESS_KEY,
  DATABASE_URL: process.env.MONGODB_URL
};
```

---

## Rate Limiting

### Prevent Brute Force Attacks
```bash
npm install --save-dev express-rate-limit
```

```javascript
const rateLimit = require('express-rate-limit');

// Limit login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,                     // 5 attempts
  message: 'Too many login attempts, try again later'
});

app.post('/api/v2/auth/login', loginLimiter, loginAuth);
```

---

## HTTPS in Production

### Always Use HTTPS
```bash
# Configure reverse proxy (nginx) with SSL certificates
# Redirect HTTP to HTTPS
# Set secure headers (HSTS, X-Frame-Options, CSP)
```

**Never:** Use HTTP in production (exposes JWT tokens).
