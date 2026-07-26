import type { MeasuredProcessEnvironment } from '../credentials.js';
import { runCommand } from './common.js';
import { parseH1SeedRunConfigPath } from './h1SeedConfig.js';
import { runH1SeedWorkflow } from './h1SeedWorkflow.js';

runCommand(() => {
  const runConfigPath = parseH1SeedRunConfigPath(
    process.argv.slice(2),
  );
  const measuredEnvironment: MeasuredProcessEnvironment = {
    ...process.env,
    NODE_ENV: process.env['NODE_ENV'],
    RATE_LIMIT_MAX: process.env['RATE_LIMIT_MAX'],
    DATABASE_URL: process.env['DATABASE_URL'],
    DATABASE_AUTH_URL: process.env['DATABASE_AUTH_URL'],
  };
  return runH1SeedWorkflow(measuredEnvironment, runConfigPath);
});
