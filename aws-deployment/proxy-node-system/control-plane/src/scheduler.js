const NodeManager = require('./nodeManager');
const BackupManager = require('./backupManager');
const AlertManager = require('./alertManager');
const Analytics = require('./analytics');

class Scheduler {
  constructor() {
    this.nodeManager = new NodeManager();
    this.backupManager = new BackupManager();
    this.alertManager = new AlertManager();
    this.analytics = new Analytics();
    this.jobs = [];
  }

  schedule(name, interval, fn) {
    const job = {
      name,
      interval,
      fn,
      lastRun: null,
      nextRun: Date.now() + interval,
      running: false
    };

    this.jobs.push(job);
    return job;
  }

  async runJob(job) {
    if (job.running) return;
    
    job.running = true;
    job.lastRun = Date.now();
    job.nextRun = Date.now() + job.interval;

    try {
      await job.fn();
    } catch (error) {
      console.error(`Job ${job.name} failed:`, error);
    } finally {
      job.running = false;
    }
  }

  start() {
    console.log('Scheduler started');

    // Run scheduler loop
    setInterval(() => {
      const now = Date.now();
      
      for (const job of this.jobs) {
        if (now >= job.nextRun && !job.running) {
          this.runJob(job);
        }
      }
    }, 1000); // Check every second

    // Schedule default jobs
    this.schedule('node-health-check', 30000, async () => {
      await this.nodeManager.checkNodeHealth();
    });

    this.schedule('alert-check', 60000, async () => {
      await this.alertManager.checkAlerts();
    });

    this.schedule('metrics-collection', 60000, async () => {
      await this.analytics.collectMetrics();
    });

    this.schedule('daily-backup', 86400000, async () => {
      await this.backupManager.createBackup();
    });

    this.schedule('cleanup-old-metrics', 3600000, async () => {
      // Clean up metrics older than 30 days
      // Implementation would clean Redis keys
    });
  }

  getJobs() {
    return this.jobs.map(job => ({
      name: job.name,
      interval: job.interval,
      lastRun: job.lastRun,
      nextRun: job.nextRun,
      running: job.running
    }));
  }
}

module.exports = Scheduler;
