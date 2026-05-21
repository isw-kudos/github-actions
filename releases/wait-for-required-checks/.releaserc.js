'use strict';

const scope = 'wait-for-required-checks';

module.exports = {
  branches: ['main'],
  tagFormat: `${scope}-v\${version}`,
  plugins: [
    ['@semantic-release/commit-analyzer', {
      releaseRules: [
        { breaking: true, scope, release: 'major' },
        { type: 'feat',  scope, release: 'minor' },
        { type: 'fix',   scope, release: 'patch' },
        { type: 'perf',  scope, release: 'patch' },
        { type: 'chore', scope, release: 'patch' },
        { release: false },
      ],
    }],
    ['@semantic-release/release-notes-generator', {
      writerOpts: {
        transform: (commit) => {
          if (commit.scope !== scope) return false;
          return commit;
        },
      },
    }],
    ['@semantic-release/github', {
      successComment: false,
      failComment: false,
    }],
  ],
};
