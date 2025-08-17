/**
 * ESLint configuration for i18n validation
 * 
 * Custom rules to detect hardcoded strings and enforce translation usage
 */

module.exports = {
  plugins: ['i18n-text'],
  rules: {
    // Warn about hardcoded strings in JSX
    'i18n-text/no-hardcoded-strings': ['warn', {
      // Allow these strings without warning
      ignoreAttribute: ['className', 'style', 'id', 'data-testid', 'href', 'src', 'alt'],
      ignoreComponent: ['script', 'style'],
      ignoreProps: {
        'Link': ['to'],
        'Route': ['path'],
        'img': ['alt', 'src'],
        'Button': ['variant', 'size', 'type'],
        'Input': ['type', 'placeholder'],
        'Card': ['className'],
        'div': ['className', 'id']
      },
      // Allow short technical strings
      ignoreMatcher: /^(#|\.|\/|http|data-|aria-|[A-Z_]{2,}|\d+px|auto|none|true|false)$/,
      // Ignore strings shorter than 3 characters
      minLength: 3
    }]
  },
  // Custom rule implementation
  overrides: [
    {
      files: ['**/*.{ts,tsx,js,jsx}'],
      rules: {
        // Simple custom rule using no-restricted-syntax
        'no-restricted-syntax': [
          'warn',
          {
            selector: 'JSXText[value=/^[A-Za-z\\s]{4,}$/]',
            message: 'Hardcoded text detected. Use t("key") for translatable strings.'
          },
          {
            selector: 'Literal[value=/^[A-Za-z\\s]{4,}$/]:has(JSXElement)',
            message: 'Hardcoded string in JSX. Use t("key") for translatable strings.'
          }
        ]
      }
    }
  ]
};