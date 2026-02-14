import { loadConfig } from '../config-loader.js';

export function validateCommand(configPath?: string): void {
  try {
    const config = loadConfig(configPath);
    console.log('Configuration is valid!');
    console.log('');
    console.log('Settings:');
    console.log(`  Watch DID:        ${config.avaast.watchDid}`);
    console.log(`  Watch rkey:       ${config.avaast.watchRkey}`);
    console.log(`  PDS endpoint:     ${config.avaast.pdsEndpoint ?? '(auto-resolve)'}`);
    console.log(`  Gateway port:     ${config.server.port}`);
    console.log(`  Controller port:  ${config.server.controllerPort}`);
    console.log(`  Hostname:         ${config.server.hostname ?? '(none)'}`);
    console.log(`  Max processes:    ${config.execution.maxFunctionProcesses}`);
    console.log(`  Function timeout: ${config.execution.functionTimeout}ms`);
    console.log(`  Memory limit:     ${config.execution.functionMemoryLimit}MB`);
  } catch (err) {
    console.error('Configuration validation failed!');
    if (err instanceof Error) {
      console.error(err.message);
    }
    process.exit(1);
  }
}
