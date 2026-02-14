#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from './config-loader.js';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { validateCommand } from './commands/validate.js';

const program = new Command();

program
  .name('avaast')
  .description('AVaaSt - App View as a Service(t) for AT Protocol')
  .version('0.0.1');

program
  .command('start')
  .description('Start the AVaaSt gateway and controller')
  .option('-c, --config <path>', 'Path to config file')
  .option('-l, --log-level <level>', 'Log level (debug, info, warn, error)', 'info')
  .action(async (options) => {
    const config = loadConfig(options.config);
    await startCommand(config, { logLevel: options.logLevel });
  });

program
  .command('status')
  .description('Check the status of a running AVaaSt instance')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    const config = loadConfig(options.config);
    await statusCommand(config);
  });

program
  .command('validate')
  .description('Validate the configuration file')
  .option('-c, --config <path>', 'Path to config file')
  .action((options) => {
    validateCommand(options.config);
  });

program.parse();
