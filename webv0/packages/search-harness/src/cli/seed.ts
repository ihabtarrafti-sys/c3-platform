import { runCommand } from './common.js';

runCommand(() => {
  throw Object.assign(
    new Error('H1 corpus seeding is not available in the H0 safety-shell commit'),
    { code: 'HARNESS_STAGE_H1_REQUIRED' },
  );
});
