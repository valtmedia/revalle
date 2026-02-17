const express = require('express');
const router = express.Router();
const AuthMiddleware = require('../src/middleware/auth');

// These are bound to instances in server.js
let proxyTunnel = null;

router.init = function(tunnel) {
  proxyTunnel = tunnel;
};

// Forward HTTP request through proxy
router.post('/forward',
  AuthMiddleware,
  async (req, res) => {
    try {
      const { url, method, headers, body, auth } = req.body;
      
      if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
      }
      
      const result = await proxyTunnel.forwardHTTP(url, {
        method: method || 'GET',
        headers: headers || {},
        body,
        auth,
        region: req.query.region
      });
      
      res.json({
        success: true,
        result: {
          statusCode: result.statusCode,
          headers: result.headers,
          bodySize: result.size,
          node: result.node
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get active tunnels
router.get('/active',
  AuthMiddleware,
  async (req, res) => {
    try {
      const tunnels = proxyTunnel.getActiveTunnels();
      res.json({ success: true, tunnels, count: tunnels.length });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get tunnel statistics
router.get('/stats',
  AuthMiddleware,
  async (req, res) => {
    try {
      const stats = proxyTunnel.getStats();
      res.json({ success: true, stats });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Close a specific tunnel
router.delete('/:tunnelId',
  AuthMiddleware,
  async (req, res) => {
    try {
      const closed = proxyTunnel.closeTunnel(req.params.tunnelId);
      if (!closed) {
        return res.status(404).json({ success: false, error: 'Tunnel not found' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Close all tunnels
router.post('/close-all',
  AuthMiddleware,
  async (req, res) => {
    try {
      proxyTunnel.closeAllTunnels();
      res.json({ success: true, message: 'All tunnels closed' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

module.exports = router;
