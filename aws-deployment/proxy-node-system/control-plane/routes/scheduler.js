const express = require('express');
const router = express.Router();
const Scheduler = require('../src/scheduler');
const AuthMiddleware = require('../src/middleware/auth');

const scheduler = new Scheduler();

// Get scheduled jobs
router.get('/jobs',
  AuthMiddleware,
  async (req, res) => {
    try {
      const jobs = scheduler.getJobs();
      res.json({ success: true, jobs });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Schedule new job
router.post('/jobs',
  AuthMiddleware,
  async (req, res) => {
    try {
      const { name, interval, fn } = req.body;
      const job = scheduler.schedule(name, interval, eval(`(${fn})`));
      res.json({ success: true, job });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
);

module.exports = router;
