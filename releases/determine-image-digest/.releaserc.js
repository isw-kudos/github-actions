'use strict';

const scope = 'determine-image-digest';

module.exports = {
  branches: ['main'],
  tagFormat: `${scope}-v\${version}`,
  plugins: [
    // conventionalcommits, not the default angular preset: angular's header
    // pattern cannot parse `type(scope)!:` at all (no type, no scope, no
    // release), and the repo squash-merges with a blank body, so a
    // `BREAKING CHANGE:` footer never reaches main. `!` is the only signal.
    ['@semantic-release/commit-analyzer', {
      preset: 'conventionalcommits',
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
      preset: 'conventionalcommits',
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
