#!/usr/bin/env node

/**
 * i18n Translation Key Validator
 *
 * This script validates the completeness and consistency of translation keys
 * across all language files and detects potential issues.
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

// Configuration
const TRANSLATIONS_DIR = './src/translations';
const SRC_DIR = './src';
const LANGUAGES = ['en', 'cs', 'es', 'fr', 'de', 'zh'];

/**
 * Load and parse a translation file using TypeScript AST parser
 */
function loadTranslations(langCode) {
  try {
    const filePath = path.join(TRANSLATIONS_DIR, `${langCode}.ts`);
    const content = fs.readFileSync(filePath, 'utf8');

    // Parse TypeScript file using AST
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    // Find the export default statement
    let exportObject = null;
    
    function visit(node) {
      if (ts.isExportAssignment(node) && node.isExportEquals === false) {
        // Found export default
        if (ts.isObjectLiteralExpression(node.expression)) {
          exportObject = parseObjectLiteral(node.expression);
        }
      }
      ts.forEachChild(node, visit);
    }
    
    visit(sourceFile);

    if (!exportObject) {
      throw new Error(`Cannot parse ${langCode}.ts - no export default object found`);
    }

    return exportObject;
  } catch (error) {
    console.error(`Error loading ${langCode} translations:`, error.message);
    return {};
  }
}

/**
 * Parse TypeScript object literal expression to JavaScript object
 */
function parseObjectLiteral(node) {
  const result = {};
  
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property)) {
      let key;
      
      // Get property name
      if (ts.isIdentifier(property.name)) {
        key = property.name.text;
      } else if (ts.isStringLiteral(property.name)) {
        key = property.name.text;
      } else {
        continue; // Skip computed properties
      }
      
      // Get property value
      if (ts.isStringLiteral(property.initializer)) {
        result[key] = property.initializer.text;
      } else if (ts.isObjectLiteralExpression(property.initializer)) {
        result[key] = parseObjectLiteral(property.initializer);
      } else if (ts.isNoSubstitutionTemplateLiteral(property.initializer)) {
        result[key] = property.initializer.text;
      }
      // Skip other types (functions, computed values, etc.)
    }
  }
  
  return result;
}

/**
 * Flatten nested object to dot notation
 */
function flattenKeys(obj, prefix = '') {
  const flattened = {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const newKey = prefix ? `${prefix}.${key}` : key;

      if (
        typeof obj[key] === 'object' &&
        obj[key] !== null &&
        !Array.isArray(obj[key])
      ) {
        Object.assign(flattened, flattenKeys(obj[key], newKey));
      } else {
        flattened[newKey] = obj[key];
      }
    }
  }

  return flattened;
}

/**
 * Extract translation keys used in source code
 */
function extractUsedKeys() {
  const usedKeys = new Set();

  function scanDirectory(dir) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (
        stat.isDirectory() &&
        !file.startsWith('.') &&
        file !== 'node_modules'
      ) {
        scanDirectory(filePath);
      } else if (file.match(/\.(tsx?|jsx?)$/)) {
        scanFile(filePath);
      }
    }
  }

  function scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');

      // Match t('key') and t("key") patterns
      const matches = content.match(/\bt\(\s*['"`]([^'"`]+)['"`]\s*\)/g);

      if (matches) {
        matches.forEach(match => {
          const keyMatch = match.match(/\bt\(\s*['"`]([^'"`]+)['"`]\s*\)/);
          if (keyMatch) {
            usedKeys.add(keyMatch[1]);
          }
        });
      }
    } catch (error) {
      console.error(`Error scanning ${filePath}:`, error.message);
    }
  }

  scanDirectory(SRC_DIR);
  return Array.from(usedKeys);
}

/**
 * Main validation function
 */
function validateTranslations() {
  console.log('🔍 Validating translation keys...\n');

  // Load all translations
  const translations = {};
  const flatTranslations = {};

  for (const lang of LANGUAGES) {
    translations[lang] = loadTranslations(lang);
    flatTranslations[lang] = flattenKeys(translations[lang]);
  }

  // Get used keys from source code
  const usedKeys = extractUsedKeys();
  console.log(
    `📊 Found ${usedKeys.length} translation keys used in source code\n`
  );

  // Get all available keys (from English as reference)
  const availableKeys = Object.keys(flatTranslations.en || {});
  console.log(
    `📚 Found ${availableKeys.length} keys in English translation file\n`
  );

  let hasErrors = false;

  // Check for missing keys in source code
  console.log('🔍 Checking for missing translations in source code:');
  // Filter out template strings (dynamic keys with ${})
  const missingInCode = usedKeys.filter(
    key => !availableKeys.includes(key) && !key.includes('${')
  );

  if (missingInCode.length > 0) {
    hasErrors = true;
    console.log('❌ Missing translation keys:');
    missingInCode.forEach(key => console.log(`   - ${key}`));
  } else {
    console.log('✅ All used keys have translations defined');
  }

  // Report template strings separately (not as errors)
  const templateKeys = usedKeys.filter(key => key.includes('${'));
  if (templateKeys.length > 0) {
    console.log(
      'ℹ️  Template string keys (dynamic, cannot be validated statically):'
    );
    templateKeys.forEach(key => console.log(`   - ${key}`));
  }
  console.log();

  // Check for unused keys
  console.log('🔍 Checking for unused translation keys:');
  const unusedKeys = availableKeys.filter(key => !usedKeys.includes(key));

  if (unusedKeys.length > 0) {
    console.log(`⚠️  Found ${unusedKeys.length} unused translation keys:`);
    unusedKeys.slice(0, 10).forEach(key => console.log(`   - ${key}`));
    if (unusedKeys.length > 10) {
      console.log(`   ... and ${unusedKeys.length - 10} more`);
    }
  } else {
    console.log('✅ All translation keys are being used');
  }
  console.log();

  // Check consistency across languages
  console.log('🔍 Checking translation completeness across languages:');

  for (const lang of LANGUAGES) {
    if (lang === 'en') continue; // Skip English (reference)

    const langKeys = Object.keys(flatTranslations[lang] || {});
    const missingKeys = availableKeys.filter(key => !langKeys.includes(key));
    const extraKeys = langKeys.filter(key => !availableKeys.includes(key));

    if (missingKeys.length > 0 || extraKeys.length > 0) {
      hasErrors = true;
      console.log(`❌ ${lang.toUpperCase()}: Issues found`);

      if (missingKeys.length > 0) {
        console.log(`   Missing ${missingKeys.length} keys:`);
        missingKeys.slice(0, 5).forEach(key => console.log(`     - ${key}`));
        if (missingKeys.length > 5) {
          console.log(`     ... and ${missingKeys.length - 5} more`);
        }
      }

      if (extraKeys.length > 0) {
        console.log(`   Extra ${extraKeys.length} keys:`);
        extraKeys.slice(0, 5).forEach(key => console.log(`     - ${key}`));
        if (extraKeys.length > 5) {
          console.log(`     ... and ${extraKeys.length - 5} more`);
        }
      }
    } else {
      console.log(
        `✅ ${lang.toUpperCase()}: Complete (${langKeys.length} keys)`
      );
    }
  }

  console.log('\n📋 Summary:');
  console.log(`   - Languages: ${LANGUAGES.length}`);
  console.log(`   - Total keys (EN): ${availableKeys.length}`);
  console.log(`   - Used in code: ${usedKeys.length}`);
  console.log(`   - Missing from code: ${missingInCode.length}`);
  console.log(`   - Template keys: ${templateKeys.length}`);
  console.log(`   - Unused: ${unusedKeys.length}`);

  if (hasErrors) {
    console.log('\n❌ Validation failed! Please fix the issues above.');
    process.exit(1);
  } else {
    console.log('\n✅ All translation validations passed!');
  }
}

// Run validation
validateTranslations();
