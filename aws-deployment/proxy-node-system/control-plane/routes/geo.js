const express = require('express');
const router = express.Router();
const AuthMiddleware = require('../src/middleware/auth');

let geoRouter = null;

router.init = function(gr) {
  geoRouter = gr;
};

// Route request to best node
router.get('/route',
  async (req, res) => {
    try {
      const { region, country, protocol, compliance } = req.query;
      
      const node = await geoRouter.routeRequest(region, {
        targetCountry: country,
        protocol,
        complianceRequired: compliance
      });
      
      if (!node) {
        return res.status(503).json({ success: false, error: 'No suitable node found' });
      }
      
      res.json({
        success: true,
        node: {
          id: node.id,
          host: node.host,
          port: node.port,
          region: node.region
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get node distribution by region
router.get('/distribution',
  AuthMiddleware,
  async (req, res) => {
    try {
      const distribution = await geoRouter.getNodeDistribution();
      res.json({ success: true, distribution });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Get routing rules
router.get('/rules',
  AuthMiddleware,
  async (req, res) => {
    try {
      const rules = geoRouter.getRules();
      res.json({ success: true, rules });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Add routing rule
router.post('/rules',
  AuthMiddleware,
  async (req, res) => {
    try {
      const rule = geoRouter.addRoutingRule(req.body);
      res.json({ success: true, rule });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
);

// Delete routing rule
router.delete('/rules/:ruleId',
  AuthMiddleware,
  async (req, res) => {
    try {
      const removed = geoRouter.removeRoutingRule(req.params.ruleId);
      if (!removed) {
        return res.status(404).json({ success: false, error: 'Rule not found' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Manage geo-blocking
router.post('/block/:region',
  AuthMiddleware,
  async (req, res) => {
    geoRouter.addGeoBlock(req.params.region);
    res.json({ success: true, message: `Region ${req.params.region} blocked` });
  }
);

router.delete('/block/:region',
  AuthMiddleware,
  async (req, res) => {
    geoRouter.removeGeoBlock(req.params.region);
    res.json({ success: true, message: `Region ${req.params.region} unblocked` });
  }
);

// Get geo stats
router.get('/stats',
  AuthMiddleware,
  async (req, res) => {
    try {
      const stats = geoRouter.getStats();
      res.json({ success: true, stats });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Update latency
router.post('/latency',
  AuthMiddleware,
  async (req, res) => {
    const { sourceRegion, destRegion, latencyMs } = req.body;
    geoRouter.updateLatency(sourceRegion, destRegion, latencyMs);
    res.json({ success: true });
  }
);

module.exports = router;
