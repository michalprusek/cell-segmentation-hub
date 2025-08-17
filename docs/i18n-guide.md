# Internationalization (i18n) Guide

This guide explains how to use and maintain the internationalization system in SpheroSeg.

## Overview

SpheroSeg supports 6 languages:
- **English (en)** - Default/fallback language
- **Czech (cs)** - Primary language for Prague-based development
- **Spanish (es)** - International accessibility
- **French (fr)** - EU market support
- **German (de)** - EU market support
- **Chinese (zh)** - Global research community

## Usage in Components

### Basic Usage

```tsx
import { useLanguage } from '@/contexts/LanguageContext';

const MyComponent = () => {
  const { t } = useLanguage();
  
  return (
    <div>
      <h1>{t('common.appName')}</h1>
      <p>{t('dashboard.welcome')}</p>
    </div>
  );
};
```

### With Variables

```tsx
const message = t('toast.project.created', { name: projectName });
const count = t('dashboard.imagesSelected', { count: 5, total: 10 });
```

### Language Switching

```tsx
const { language, setLanguage } = useLanguage();

const handleLanguageChange = (newLang) => {
  setLanguage(newLang); // Automatically saves to localStorage and user profile
};
```

## Translation File Structure

### Organized by Feature Areas

```typescript
export default {
  // Common UI elements
  common: {
    appName: 'SpheroSeg',
    loading: 'Loading...',
    save: 'Save',
    cancel: 'Cancel'
  },
  
  // Dashboard specific
  dashboard: {
    title: 'Dashboard',
    projectGallery: 'Project Gallery'
  },
  
  // Toast messages
  toast: {
    auth: {
      signOutSuccess: 'Signed out successfully'
    },
    project: {
      created: 'Project created successfully',
      deleted: 'Project deleted successfully'
    }
  },
  
  // Error messages
  errors: {
    validation: {
      projectNameRequired: 'Please enter a project name'
    },
    network: {
      connectionLost: 'Connection lost'
    }
  }
};
```

## Adding New Translations

### 1. Add Key to English File First

```typescript
// src/translations/en.ts
export default {
  myNewFeature: {
    title: 'My New Feature',
    description: 'This is a new feature',
    buttons: {
      start: 'Start Process',
      cancel: 'Cancel Process'
    }
  }
};
```

### 2. Add to All Other Language Files

Use the same structure in all language files:
- `cs.ts` - Czech translation
- `es.ts` - Spanish translation
- `fr.ts` - French translation
- `de.ts` - German translation
- `zh.ts` - Chinese translation

### 3. Use in Component

```tsx
const MyNewComponent = () => {
  const { t } = useLanguage();
  
  return (
    <div>
      <h2>{t('myNewFeature.title')}</h2>
      <p>{t('myNewFeature.description')}</p>
      <button>{t('myNewFeature.buttons.start')}</button>
    </div>
  );
};
```

## Validation & Testing

### Automated Validation

```bash
# Check for missing/unused translation keys
npm run i18n:check

# Lint for hardcoded strings (in development)
npm run i18n:lint

# Full i18n validation
npm run i18n:validate
```

### Development Tools

In development mode, missing translation keys are automatically logged:

```typescript
// Missing keys are logged to console
console.warn('[i18n] Missing translation key: "newFeature.title"');

// Access the i18n logger in browser console
window.i18nLogger.printReport();
window.i18nLogger.exportMissingKeys();
```

### Pre-commit Validation

The validation runs automatically before commits to ensure:
- All used translation keys exist
- All language files have consistent keys
- No hardcoded strings in new code

## Best Practices

### ✅ Do

- **Use descriptive key names**: `dashboard.projectGallery` not `dashboard.pg`
- **Group by feature**: Organize keys by component/feature area
- **Use nested structure**: Avoid flat key structures
- **Include context in keys**: `button.save` vs `form.save` vs `toast.saved`
- **Add new keys to ALL language files**: Don't leave translations incomplete
- **Use variables for dynamic content**: `t('message', { name: userName })`

### ❌ Don't

- **Hardcode user-facing text**: Use `t()` function for all user text
- **Use technical terms as keys**: `errors.500` → `errors.serverError`
- **Leave translations incomplete**: All languages should have all keys
- **Use very short keys**: `btn` → `buttons.submit`
- **Put HTML in translations**: Keep formatting in components

### Example: Good vs Bad

```tsx
// ❌ Bad
<div>
  <h1>Project Dashboard</h1>
  <p>You have 5 projects</p>
  <button>Create New</button>
</div>

// ✅ Good
<div>
  <h1>{t('dashboard.title')}</h1>
  <p>{t('dashboard.projectCount', { count: projectCount })}</p>
  <button>{t('projects.createNew')}</button>
</div>
```

## Common Translation Keys

### UI Elements
- `common.loading` - Loading indicators
- `common.save` / `common.cancel` - Form buttons  
- `common.delete` / `common.edit` - Action buttons
- `common.back` / `common.next` - Navigation

### Status Messages
- `toast.*.success` - Success notifications
- `toast.*.failed` - Error notifications
- `errors.validation.*` - Form validation
- `errors.network.*` - Network errors

### Navigation
- `nav.*` - Menu items
- `pages.*.title` - Page titles
- `pages.*.description` - Page descriptions

## Troubleshooting

### Missing Translation Key

```bash
# 1. Check if key exists in English file
grep -r "myKey" src/translations/en.ts

# 2. Add to all language files
# 3. Verify with validation script
npm run i18n:check
```

### Key Exists But Not Working

```bash
# Check for typos in key name
# Verify proper nesting structure
# Check browser console for missing key warnings
```

### Performance Issues

```bash
# Check for unused keys
npm run i18n:check

# Large translation files can be split by feature
# Consider lazy loading for rarely used translations
```

## CI/CD Integration

Add i18n validation to your CI pipeline:

```yaml
# .github/workflows/ci.yml
- name: Validate translations
  run: npm run i18n:validate
```

This ensures translation completeness across all deployments and prevents missing translations from reaching production.