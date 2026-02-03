const express = require('express');
const router = express.Router();
const BackupManager = require('../src/backupManager');
const AuthMiddleware = require('../src/middleware/auth');

const backupManager = new BackupManager();

// Create backup
router.post('/create',
  AuthMiddleware,
  async (req, res) => {
    try {
      const backup = await backupManager.createBackup();
      res.json({ success: true, backup });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// List backups
router.get('/list',
  AuthMiddleware,
  async (req, res) => {
    try {
      const backups = await backupManager.listBackups();
      res.json({ success: true, backups });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Restore backup
router.post('/restore',
  AuthMiddleware,
  async (req, res) => {
    try {
      const { filename } = req.body;
      if (!filename) {
        return res.status(400).json({
          success: false,
          error: 'Filename is required'
        });
      }

      const result = await backupManager.restoreBackup(filename);
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Delete backup
router.delete('/:filename',
  AuthMiddleware,
  async (req, res) => {
    try {
      const result = await backupManager.deleteBackup(req.params.filename);
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

module.exports = router;
