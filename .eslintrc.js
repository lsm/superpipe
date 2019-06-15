const path = require('path')

module.exports = {
  env: {
    es6: true,
    node: true,
    browser: true
  },
  // parser: 'babel-eslint',
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: path.join(__dirname, './tsconfig.json'),
    ecmaVersion: 2018,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true, // Allows for the parsing of JSX
      spread: true,
      classes: true,
      modules: true,
      restParams: true,
      impliedStrict: true
    }
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  plugins: ['babel', '@typescript-eslint'],
  rules: {
    'babel/new-cap': 1,
    'babel/camelcase': 0,
    'babel/no-invalid-this': 1,
    'babel/object-curly-spacing': ['error', 'always'],
    'babel/quotes': 0,
    'babel/semi': 0,
    'babel/no-unused-expressions': 1,
    'babel/valid-typeof': 1,
    // indent: ['error', 2, { SwitchCase: 1 }],
    indent: 0,
    '@typescript-eslint/indent': ['error', 2, { SwitchCase: 1 , ignoredNodes: ['JSXElement *']}],
    '@typescript-eslint/camelcase': ['error', { 'properties': 'always' }],
    '@typescript-eslint/explicit-member-accessibility': ['error', { 'accessibility': 'no-public' }],
    '@typescript-eslint/no-parameter-properties': ['error', {'allows': ['private']}],
    '@typescript-eslint/no-var-requires': 0,
    'no-extra-parens': 'error',
    semi: ['error','never'],
    // Array brackets
    'array-bracket-newline': ['error', {'multiline': true}],
    'array-bracket-spacing': ['error', 'always'],
    'array-element-newline': ['error', 'consistent'],
    // Quotes
    quotes: ['error','single'],
    // Curly brackets
    curly: ['error', 'all'],
    'block-spacing': 'error',
    'brace-style': ['error', '1tbs', { 'allowSingleLine': true }],
    'object-curly-spacing': ['error', 'always'],
    'object-curly-newline': ['error', {
        'ObjectExpression': { 'multiline': true, consistent: false },
        'ObjectPattern': { 'multiline': true },
        'ImportDeclaration': { 'multiline': true },
        'ExportDeclaration': { 'multiline': true }
    }],
    // 'object-property-newline': ['error'],
    // Comma
    'comma-dangle': ['error', 'always-multiline'],
    'comma-spacing': ['error', {'before': false, 'after': true}],
    'computed-property-spacing': ['error', 'never'],
    // Linebreak
    'eol-last': ['error', 'always'],
    'linebreak-style': ['error','unix'],
    'function-paren-newline': ['error', 'multiline'],
    'implicit-arrow-linebreak': ['error', 'beside'],
    'lines-between-class-members': ['error', 'always'],
    'newline-per-chained-call': ['error', {'ignoreChainWithDepth': 2}],
    'no-multiple-empty-lines': ['error', {max: 1, maxEOF: 1, maxBOF: 0}],
    // Comments
    'lines-around-comment': ['error', {
      'beforeBlockComment': true,
      'beforeLineComment': false,
      'allowBlockStart': true,
      'allowBlockEnd': true,
      'allowObjectStart': true,
      'allowObjectEnd': true,
      'allowArrayStart': true,
      'allowArrayEnd': true,
      'allowClassStart': true,
      'allowClassEnd': true
    }],
    // 'multiline-comment-style': ['error', 'starred-block'],
    // Spaces & tabs
    'func-call-spacing': ['error', 'never'],
    'key-spacing': ['error', {
        beforeColon: false, afterColon: true, mode: 'strict'
      }
    ],
    'keyword-spacing': ['error', { 'before': true, 'after': true }],
    'no-trailing-spaces': 'error',
    // 'no-mixed-spaces-and-tabs': 'error',
    // Parentheses
    'new-parens': 'error',
    // Branches
    'no-lonely-if': 'error',
    'no-unneeded-ternary': 'error',
    'no-whitespace-before-property': 'error'
  }
}
