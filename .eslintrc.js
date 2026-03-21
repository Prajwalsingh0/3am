module.exports = {
    env: {
        node: true,
        es2021: true,
        jest: true
    },
    extends: [
        'airbnb-base'
    ],
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    },
    rules: {
        'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
        'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
        'comma-dangle': ['error', 'never'],
        'max-len': ['warn', { code: 120 }],
        'no-underscore-dangle': ['error', { allow: ['_id', '__v'] }],
        'consistent-return': 'off',
        'no-param-reassign': ['error', { props: false }],
        'prefer-destructuring': ['error', { object: true, array: false }]
    }
};
