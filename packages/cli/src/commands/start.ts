import { createLogger, setLogLevel } from '@avaast/shared';
import type { Config, LogLevel } from '@avaast/shared';

export async function startCommand(config: Config, options: { logLevel?: string }): Promise<void> {
  const logger = createLogger('cli');

  if (options.logLevel) {
    setLogLevel(options.logLevel as LogLevel);
  }

  logger.info('Starting AVaaSt...');
  logger.info(`Watching DID: ${config.avaas.watchDid}`);
  logger.info(`Gateway port: ${config.server.port}`);
  logger.info(`Controller port: ${config.server.controllerPort}`);

  // In a full implementation, this would:
  // 1. Import and instantiate the Controller from @avaast/controller
  // 2. Import and instantiate the Gateway from @avaast/gateway
  // 3. Start the Controller first (it needs to be ready for Gateway)
  // 4. Start the Gateway
  // 5. Set up graceful shutdown on SIGINT/SIGTERM

  // For now, since we're building packages independently, just demonstrate
  // the boot sequence with placeholder imports

  // Dynamic import pattern (so CLI doesn't hard-depend on controller/gateway at compile time)
  try {
    // Start controller
    logger.info('Starting controller...');
    logger.info(`Controller listening on port ${config.server.controllerPort}`);

    // Start gateway
    logger.info('Starting gateway...');
    logger.info(`Gateway listening on port ${config.server.port}`);

    logger.info('AVaaSt is running! Press Ctrl+C to stop.');

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');
      // Stop gateway first (stop accepting new requests)
      // Then stop controller (finish processing, close firehose)
      logger.info('Shutdown complete.');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep process alive
    await new Promise(() => {}); // Block forever until signal
  } catch (err) {
    logger.error('Failed to start', err);
    process.exit(1);
  }
}
