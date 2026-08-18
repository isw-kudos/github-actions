'use strict';

const scope = 'claude-code-review';

module.exports = {
  branches: ['main'],
  tagFormat: `${scope}-v\${version}`,
  plugins: [
    ['@semantic-release/commit-analyzer', {
      releaseRules: [
        // Catch-all must come FIRST: commit-analyzer lets a later-matching
        // rule override an earlier one, and `release: false` outranks
        // everything — placed last it suppresses all releases.
        { release: false },
        { breaking: true, scope, release: 'major' },
        { type: 'feat',  scope, release: 'minor' },
        { type: 'fix',   scope, release: 'patch' },
        { type: 'perf',  scope, release: 'patch' },
        { type: 'chore', scope, release: 'patch' },
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
