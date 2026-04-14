module.exports = {
  extends: ['@commitlint/config-conventional'],
  parserPreset: {
    parserOpts: {
      // Allow checkpoint-N.M: message format in addition to conventional commit format.
      // Examples: checkpoint-0.1: desc  |  feat: desc  |  feat(scope): desc
      headerPattern: /^(checkpoint-[\d.]+|[\w-]+)(?:\([\w.-]+\))?!?:\s(.+)$/,
      headerCorrespondence: ['type', 'subject'],
    },
  },
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'checkpoint',
        'checkpoint-0.1',
        'checkpoint-0.2',
        'checkpoint-1.1',
        'checkpoint-1.2',
        'checkpoint-2.1',
        'checkpoint-2.2',
        'checkpoint-2.3',
        'checkpoint-3.1',
        'checkpoint-3.2',
        'checkpoint-3.3',
        'checkpoint-4.1',
        'feat',
        'fix',
        'test',
        'refactor',
        'docs',
        'chore',
        'ci',
      ],
    ],
    'type-case': [0],
    'subject-max-length': [2, 'always', 100],
  },
};
