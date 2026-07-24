import { runCommand } from './common.js';

runCommand(() => {
  throw Object.assign(
    new Error('H2/H3 benchmark execution is not available in the H0 safety-shell commit'),
    { code: 'HARNESS_STAGE_H2_REQUIRED' },
  );
});
