/**
 * Notification Scheduler
 * Runs scheduled email checks every hour using setInterval.
 * Also runs once at startup (after a short delay to let the DB pool warm up).
 */
const { runScheduledChecks } = require('../services/notifier');

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function startScheduler() {
  // Initial run after 30 seconds (let server fully start)
  setTimeout(async () => {
    console.log('[scheduler] Running initial notification checks...');
    await runScheduledChecks();
  }, 30_000);

  // Recurring run every hour
  setInterval(async () => {
    console.log('[scheduler] Running scheduled notification checks...');
    await runScheduledChecks();
  }, INTERVAL_MS);

  console.log('[scheduler] Notification scheduler started (interval: 1h)');
}

module.exports = { startScheduler };
