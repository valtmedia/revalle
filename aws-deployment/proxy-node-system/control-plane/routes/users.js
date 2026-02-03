const express = require('express');
const router = express.Router();
const UserManager = require('../src/userManager');
const validator = require('../src/middleware/validator');
const AuthMiddleware = require('../src/middleware/auth');
const { rateLimitMiddleware } = require('../src/middleware/rateLimit');

const userManager = new UserManager();

// Create user
router.post('/',
  AuthMiddleware,
  validator.validateUserCreation,
  rateLimitMiddleware(10, 60),
  async (req, res) => {
    try {
      const user = await userManager.createUser(req.body);
      res.json({ success: true, user });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
);

// Get all users
router.get('/',
  AuthMiddleware,
  validator.validatePagination,
  async (req, res) => {
    try {
      const users = await userManager.getAllUsers();
      const { page = 1, limit = 20 } = req.pagination;
      const start = (page - 1) * limit;
      const end = start + limit;

      res.json({
        success: true,
        users: users.slice(start, end),
        pagination: {
          page,
          limit,
          total: users.length,
          pages: Math.ceil(users.length / limit)
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get user by ID
router.get('/:id',
  AuthMiddleware,
  async (req, res) => {
    try {
      const user = await userManager.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      res.json({ success: true, user: { ...user, password: undefined } });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Update user
router.put('/:id',
  AuthMiddleware,
  async (req, res) => {
    try {
      const user = await userManager.updateUser(req.params.id, req.body);
      res.json({ success: true, user });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
);

// Delete user
router.delete('/:id',
  AuthMiddleware,
  async (req, res) => {
    try {
      await userManager.deleteUser(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Authenticate
router.post('/auth',
  rateLimitMiddleware(5, 300), // 5 attempts per 5 minutes
  async (req, res) => {
    try {
      const { username, password } = req.body;
      const result = await userManager.authenticate(username, password);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(401).json({ success: false, error: error.message });
    }
  }
);

// Get user usage
router.get('/:id/usage',
  AuthMiddleware,
  async (req, res) => {
    try {
      const user = await userManager.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      res.json({
        success: true,
        usage: user.usage,
        quota: user.quota,
        remaining: {
          requests: Math.max(0, user.quota.requests - user.usage.requests),
          bandwidth: Math.max(0, user.quota.bandwidth - user.usage.bandwidth)
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Reset user quota
router.post('/:id/reset-quota',
  AuthMiddleware,
  async (req, res) => {
    try {
      const user = await userManager.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      user.usage.requests = 0;
      user.usage.bandwidth = 0;
      user.usage.resetAt = userManager.getNextResetDate(user.quota.period);

      await userManager.updateUser(req.params.id, { usage: user.usage });
      res.json({ success: true, usage: user.usage });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

module.exports = router;
