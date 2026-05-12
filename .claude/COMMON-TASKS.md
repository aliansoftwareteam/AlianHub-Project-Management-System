# Common Development Tasks

**[← Back to main guide](../CLAUDE.md)**

## Adding a New Feature Module

### Step 1: Create Folder Structure
```bash
mkdir -p Modules/NewFeature/controller
mkdir -p Modules/NewFeature/helpers
```

### Step 2: Create Schema (if needed)
File: `Modules/NewFeature/schema.js`
```javascript
const mongoose = require('mongoose');

const newFeatureSchema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  companyId: mongoose.Schema.Types.ObjectId,  // ← CRITICAL: Always include
  name: String,
  description: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('newfeatures', newFeatureSchema);
```

### Step 3: Add Collection Definition
File: `Config/collections.js`
```javascript
const dbCollections = {
  // ... existing
  NEWFEATURE: 'newfeatures'
};

const SCHEMA_TYPE = {
  // ... existing
  NEWFEATURE: 'NEWFEATURE'
};
```

### Step 4: Create Controller
File: `Modules/NewFeature/controller/getNewFeature.js`
```javascript
const { MongoDbCrudOpration } = require('../../../middlewares/mongoConnector');
const { SCHEMA_TYPE } = require('../../../Config/collections');

exports.getNewFeature = (req, res, next) => {
  try {
    const { companyId, featureId } = req.params;
    
    // Validation
    if (!featureId) {
      req.errorMessageObject = { message: "Feature ID required", statusCode: 400 };
      return next();
    }
    
    // Database query
    const mongoObj = {
      type: SCHEMA_TYPE.NEWFEATURE,
      data: [{ _id: featureId }]
    };
    
    MongoDbCrudOpration(companyId, mongoObj, 'findOne')
      .then(feature => {
        if (!feature) {
          req.errorMessageObject = { message: "Feature not found", statusCode: 404 };
          return next();
        }
        
        res.status(200).json({
          status: true,
          statusText: "Feature retrieved successfully",
          data: feature
        });
      })
      .catch(error => {
        req.errorMessageObject = { message: error.message, statusCode: 500 };
        next();
      });
  } catch (error) {
    req.errorMessageObject = { message: error.message };
    next();
  }
};
```

### Step 5: Create Routes
File: `Modules/NewFeature/routes.js`
```javascript
const { getNewFeature } = require('./controller/getNewFeature');
const { createNewFeature } = require('./controller/createNewFeature');

exports.init = (app) => {
  app.get('/api/v2/newfeature/:featureId', getNewFeature);
  app.post('/api/v2/newfeature/create', createNewFeature);
  // Add more routes as needed
};
```

### Step 6: Register Routes in Server
File: `index.js` (or `server.js`)
```javascript
// ... existing route registrations
const newFeatureRoutes = require('./Modules/NewFeature/routes.js');
newFeatureRoutes.init(app);
```

### Step 7: Test the Endpoint
```bash
# Dev server already running
curl -X POST http://localhost:4000/api/v2/newfeature/create \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","description":"Test feature"}'
```

---

## Adding a New API Route to Existing Module

### Quick Steps
1. Create controller file: `Modules/Task/controller/newAction.js`
2. Add export in routes.js: `app.post('/api/v2/tasks/newaction', ctrl.newAction);`
3. Test: `curl http://localhost:4000/api/v2/tasks/newaction`

**Example:**
```javascript
// Modules/Task/controller/duplicateTask.js
exports.duplicateTask = (req, res, next) => {
  try {
    const { companyId, taskId } = req.params;
    
    const mongoObj = {
      type: SCHEMA_TYPE.TASKS,
      data: [{ _id: taskId }]
    };
    
    MongoDbCrudOpration(companyId, mongoObj, 'findOne')
      .then(originalTask => {
        const newTask = {
          ...originalTask,
          _id: new mongoose.Types.ObjectId(),
          name: `${originalTask.name} (Copy)`,
          createdAt: new Date()
        };
        
        // Save duplicate
        const mongoObjCreate = {
          type: SCHEMA_TYPE.TASKS,
          data: [newTask]
        };
        
        return MongoDbCrudOpration(companyId, mongoObjCreate, 'save');
      })
      .then(savedTask => {
        // Emit real-time event
        require('../event/socketEventEmitter').emitEvent('TASK_DUPLICATED', {
          originalTaskId: taskId,
          newTaskId: savedTask._id
        });
        
        res.status(200).json({
          status: true,
          statusText: "Task duplicated successfully",
          data: savedTask
        });
      })
      .catch(error => {
        req.errorMessageObject = { message: error.message };
        next();
      });
  } catch (error) {
    req.errorMessageObject = { message: error.message };
    next();
  }
};
```

---

## Adding Real-Time Events (Socket.io)

### Emit an Event After Mutation
```javascript
// After updating a project
MongoDbCrudOpration(companyId, mongoObj, 'update')
  .then(project => {
    // Emit event for all connected clients
    require('../event/socketEventEmitter').emitEvent('PROJECT_UPDATED', {
      projectId: project._id,
      projectName: project.name,
      changes: updatedFields
    });
    
    res.json({ status: true, data: project });
  });
```

### Listen for Events on Frontend (Vue.js)
```javascript
// In Vue component
import { io } from 'socket.io-client';

export default {
  setup() {
    const socket = io(window.location.origin);
    
    socket.on('PROJECT_UPDATED', (data) => {
      console.log('Project updated:', data);
      // Update local state, refresh UI
      store.commit('updateProject', data.projectId);
    });
    
    return { socket };
  }
};
```

---

## Working with File Uploads (Wasabi vs Local)

### Upload File
```javascript
const commonStorage = require('../common-storage/common.js');

exports.uploadFile = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const file = req.files.file;  // From multipart form
    
    const filePath = `${companyId}/files/${file.name}`;
    
    // Upload (works with Wasabi or local FS)
    await commonStorage.uploadFile(filePath, file.data);
    
    res.json({ status: true, data: { filePath } });
  } catch (error) {
    req.errorMessageObject = { message: error.message };
    next();
  }
};
```

### Generate Presigned URL (Temporary Access)
```javascript
const commonStorage = require('../common-storage/common.js');

const presignedUrl = await commonStorage.getPresignedUrl(filePath, 3600);  // 1 hour
res.json({ url: presignedUrl });
```

### Delete File
```javascript
await commonStorage.deleteFile(filePath);
```

---

## Cache Invalidation After Mutations

### Clear Specific Cache Key
```javascript
const { removeCache } = require('../utils/cacheHelper');

exports.updateProject = (req, res, next) => {
  const { projectId } = req.params;
  
  MongoDbCrudOpration(companyId, mongoObj, 'update')
    .then(project => {
      // Clear cache for this project
      removeCache(`project:${projectId}`);
      removeCache(`projectList:${companyId}`);  // Also clear list
      
      res.json({ status: true, data: project });
    });
};
```

---

## Adding Tests (When Test Framework Added)

### Install Jest & Supertest
```bash
npm install --save-dev jest supertest @testing-library/vue
```

### Example API Test
File: `tests/api/projects.test.js`
```javascript
const request = require('supertest');
const app = require('../../index.js');

describe('Projects API', () => {
  let validToken;
  let companyId;
  
  beforeAll(async () => {
    // Setup: login and get token
    const res = await request(app)
      .post('/api/v2/auth/login')
      .send({ email: 'test@example.com', password: 'password' });
    
    validToken = res.body.data.token;
    companyId = res.body.data.user.companyId;
  });
  
  test('GET /api/v2/projects should list projects', async () => {
    const res = await request(app)
      .get(`/api/v2/projects/${companyId}`)
      .set('Authorization', `Bearer ${validToken}`);
    
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
  
  test('POST /api/v2/projects/create should create project', async () => {
    const res = await request(app)
      .post(`/api/v2/projects/${companyId}/create`)
      .set('Authorization', `Bearer ${validToken}`)
      .send({ name: 'Test Project' });
    
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('_id');
    expect(res.body.data.name).toBe('Test Project');
  });
});
```

### Run Tests
```bash
npm test
npm test -- --watch          # Watch mode
npm test -- --coverage       # Coverage report
```

---

## Integrating with AI Features

### Call AI Service
```javascript
const aiModule = require('../Modules/AI/controller/generate');

exports.summarizeProject = (req, res, next) => {
  const { projectId } = req.params;
  
  // Get project description
  const mongoObj = {
    type: SCHEMA_TYPE.PROJECTS,
    data: [{ _id: projectId }]
  };
  
  MongoDbCrudOpration(companyId, mongoObj, 'findOne')
    .then(project => {
      // Call AI to summarize
      return aiModule.generateSummary(project.description);
    })
    .then(summary => {
      res.json({ status: true, data: { summary } });
    })
    .catch(error => {
      req.errorMessageObject = { message: error.message };
      next();
    });
};
```

---

## Adding Email Notifications

### Send Email
```javascript
const nodemailer = require('nodemailer');

exports.sendTaskNotification = async (userId, taskName) => {
  const transporter = nodemailer.createTransport({
    host: process.env.NODEMAILER_HOST,
    port: process.env.NODEMAILER_PORT,
    auth: {
      user: process.env.NODEMAILER_EMAIL,
      pass: process.env.NODEMAILER_EMAIL_PASSWORD
    }
  });
  
  await transporter.sendMail({
    to: userEmail,
    subject: `Task Updated: ${taskName}`,
    html: `<p>Your task <strong>${taskName}</strong> has been updated.</p>`
  });
};
```

---

## Debugging Common Issues

### MongoDB Query Not Returning Data
1. Verify `companyId` is correct
2. Ensure `SCHEMA_TYPE` enum exists in Config/collections.js
3. Check MongoDB connection in logs
4. Verify data actually exists in database

### Socket.io Events Not Broadcasting
1. Ensure event name matches listener name (case-sensitive)
2. Verify Socket.io connection established (`socket` object exists)
3. Check browser console for errors
4. Verify event emitted after mutation

### Frontend Not Showing Data
1. Check API response in browser DevTools Network tab
2. Verify JWT token not expired
3. Check Vuex/Pinia store for state updates
4. Verify component re-renders when state changes

### File Upload Failing
1. Verify STORAGE_TYPE in .env matches configured backend
2. Check Wasabi credentials if using cloud storage
3. Ensure local filesystem has write permissions
4. Verify file size under MAX_FILE_SIZE limit
