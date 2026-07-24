import { runCommand } from './common.js';

runCommand(() => {
  throw Object.assign(
    new Error('H3 report generation is not available in the H0 safety-shell commit'),
    { code: 'HARNESS_STAGE_H3_REQUIRED' },
  );
});
