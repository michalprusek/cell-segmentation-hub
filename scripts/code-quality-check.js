#!/usr/bin/env node

/**
 * Advanced Code Quality Checker
 * Performs deep analysis of code quality metrics
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Colors for terminal output
const colors = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

// Load quality configuration
const config = JSON.parse(fs.readFileSync('.code-quality.json', 'utf8'));

class CodeQualityChecker {
  constructor() {
    this.issues = [];
    this.warnings = [];
    this.stats = {
      filesAnalyzed: 0,
      totalLines: 0,
      complexFunctions: 0,
      largeFiles: 0,
      duplicateCode: 0,
      securityIssues: 0,
    };
  }

  log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
  }

  /**
   * Check function complexity using AST analysis
   */
  checkComplexity(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // Simple cyclomatic complexity check (count if/for/while/switch/catch)
    const complexityKeywords = /\b(if|for|while|switch|catch|&&|\|\||\?)\b/g;
    const matches = content.match(complexityKeywords);
    const complexity = matches ? matches.length : 0;

    if (complexity > config.rules.complexity.maxCyclomaticComplexity) {
      this.issues.push({
        file: filePath,
        type: 'complexity',
        message: `High cyclomatic complexity: ${complexity}`,
        severity: 'high',
      });
      this.stats.complexFunctions++;
    }

    // Check function length
    const functionPattern =
      /function\s+\w+\s*\([^)]*\)\s*{|const\s+\w+\s*=\s*\([^)]*\)\s*=>\s*{/g;
    let match;
    while ((match = functionPattern.exec(content)) !== null) {
      const startLine = content.substring(0, match.index).split('\n').length;
      const functionEnd = this.findMatchingBrace(content, match.index);
      const endLine = content.substring(0, functionEnd).split('\n').length;
      const functionLength = endLine - startLine;

      if (functionLength > config.rules.complexity.maxLinesPerFunction) {
        this.warnings.push({
          file: filePath,
          line: startLine,
          type: 'length',
          message: `Function too long: ${functionLength} lines`,
        });
      }
    }

    // Check file length
    if (lines.length > config.rules.complexity.maxLinesPerFile) {
      this.warnings.push({
        file: filePath,
        type: 'file-length',
        message: `File too long: ${lines.length} lines`,
      });
      this.stats.largeFiles++;
    }

    this.stats.totalLines += lines.length;
  }

  /**
   * Find matching closing brace
   */
  findMatchingBrace(content, startIndex) {
    let braceCount = 0;
    let inString = false;
    let stringChar = null;

    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];
      const prevChar = i > 0 ? content[i - 1] : '';

      // Handle strings
      if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = null;
        }
      }

      if (!inString) {
        if (char === '{') braceCount++;
        if (char === '}') {
          braceCount--;
          if (braceCount === 0) return i;
        }
      }
    }
    return content.length;
  }

  /**
   * Check for security issues
   */
  checkSecurity(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const securityPatterns = [
      { pattern: /eval\s*\(/g, issue: 'Use of eval()' },
      { pattern: /innerHTML\s*=/g, issue: 'Direct innerHTML manipulation' },
      {
        pattern: /dangerouslySetInnerHTML/g,
        issue: 'Use of dangerouslySetInnerHTML',
      },
      { pattern: /document\.write/g, issue: 'Use of document.write' },
      { pattern: /new\s+Function\s*\(/g, issue: 'Dynamic function creation' },
      {
        pattern: /localStorage\.(setItem|getItem)\([^)]*password/gi,
        issue: 'Password in localStorage',
      },
      { pattern: /btoa\([^)]*password/gi, issue: 'Base64 encoded password' },
      {
        pattern: /\$\{.*\}.*<script/gi,
        issue: 'Potential XSS in template literal',
      },
    ];

    securityPatterns.forEach(({ pattern, issue }) => {
      const matches = content.match(pattern);
      if (matches) {
        this.issues.push({
          file: filePath,
          type: 'security',
          message: issue,
          severity: 'critical',
          occurrences: matches.length,
        });
        this.stats.securityIssues++;
      }
    });
  }

  /**
   * Check for React best practices
   */
  checkReactPatterns(filePath) {
    if (!filePath.endsWith('.tsx') && !filePath.endsWith('.jsx')) return;

    const content = fs.readFileSync(filePath, 'utf8');

    // Check for array index as key
    if (/key=\{.*index.*\}/g.test(content)) {
      this.warnings.push({
        file: filePath,
        type: 'react',
        message: 'Using array index as React key',
      });
    }

    // Check for missing memo on expensive components
    const componentPattern =
      /export\s+(?:default\s+)?function\s+(\w+)|export\s+(?:default\s+)?const\s+(\w+)\s*=/g;
    let match;
    while ((match = componentPattern.exec(content)) !== null) {
      const componentName = match[1] || match[2];
      if (
        componentName &&
        componentName[0] === componentName[0].toUpperCase()
      ) {
        // It's likely a component
        if (
          !content.includes(`memo(${componentName})`) &&
          !content.includes(`React.memo(${componentName})`)
        ) {
          // Check if it has expensive operations
          const componentStart = match.index;
          const componentEnd = this.findMatchingBrace(content, componentStart);
          const componentBody = content.substring(componentStart, componentEnd);

          if (
            /\.map\(|\.filter\(|\.reduce\(|useMemo|useCallback/.test(
              componentBody
            )
          ) {
            this.warnings.push({
              file: filePath,
              type: 'performance',
              message: `Component ${componentName} might benefit from React.memo`,
            });
          }
        }
      }
    }
  }

  /**
   * Check for code duplication
   */
  checkDuplication(files) {
    const codeBlocks = new Map();

    files.forEach(file => {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');

      // Check for duplicate blocks (minimum 5 lines)
      for (let i = 0; i < lines.length - 5; i++) {
        const block = lines
          .slice(i, i + 5)
          .join('\n')
          .trim();
        if (block.length > 100) {
          // Significant block
          if (codeBlocks.has(block)) {
            const existing = codeBlocks.get(block);
            if (existing.file !== file) {
              this.warnings.push({
                type: 'duplication',
                message: `Duplicate code found`,
                files: [existing.file, file],
                lines: [existing.line, i + 1],
              });
              this.stats.duplicateCode++;
            }
          } else {
            codeBlocks.set(block, { file, line: i + 1 });
          }
        }
      }
    });
  }

  /**
   * Check import statements
   */
  checkImports(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const importPattern =
      /import\s+(?:{[^}]+}|[\w*]+)(?:\s*,\s*{[^}]+})?\s+from\s+['"]([^'"]+)['"]/g;
    const imports = [];
    let match;

    while ((match = importPattern.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Check for duplicate imports
    const duplicates = imports.filter(
      (item, index) => imports.indexOf(item) !== index
    );
    if (duplicates.length > 0) {
      this.issues.push({
        file: filePath,
        type: 'imports',
        message: `Duplicate imports: ${duplicates.join(', ')}`,
        severity: 'low',
      });
    }

    // Check for circular dependencies (simplified check)
    if (
      imports.some(imp => imp.includes('../') && imp.split('../').length > 3)
    ) {
      this.warnings.push({
        file: filePath,
        type: 'imports',
        message:
          'Deep relative imports detected (possible circular dependency risk)',
      });
    }
  }

  /**
   * Analyze all files
   */
  async analyzeFiles() {
    const srcDir = path.join(process.cwd(), 'src');
    const files = this.getFiles(srcDir, ['.ts', '.tsx', '.js', '.jsx']);

    this.log(`\n🔍 Analyzing ${files.length} files...`, 'cyan');

    files.forEach(file => {
      this.stats.filesAnalyzed++;
      this.checkComplexity(file);
      this.checkSecurity(file);
      this.checkReactPatterns(file);
      this.checkImports(file);
    });

    // Check for duplication across files
    this.checkDuplication(files);

    return this.generateReport();
  }

  /**
   * Get all files recursively
   */
  getFiles(dir, extensions) {
    const files = [];

    const walkDir = currentPath => {
      const entries = fs.readdirSync(currentPath);

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry);
        const stat = fs.statSync(fullPath);

        if (
          stat.isDirectory() &&
          !entry.startsWith('.') &&
          entry !== 'node_modules'
        ) {
          walkDir(fullPath);
        } else if (
          stat.isFile() &&
          extensions.some(ext => entry.endsWith(ext))
        ) {
          files.push(fullPath);
        }
      }
    };

    if (fs.existsSync(dir)) {
      walkDir(dir);
    }

    return files;
  }

  /**
   * Generate quality report
   */
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      stats: this.stats,
      issues: this.issues,
      warnings: this.warnings,
      score: this.calculateScore(),
    };

    // Console output
    this.log('\n📊 Code Quality Report', 'blue');
    this.log('━'.repeat(50), 'blue');

    this.log(`\n📈 Statistics:`, 'cyan');
    this.log(`  Files analyzed: ${this.stats.filesAnalyzed}`);
    this.log(`  Total lines: ${this.stats.totalLines}`);
    this.log(`  Complex functions: ${this.stats.complexFunctions}`);
    this.log(`  Large files: ${this.stats.largeFiles}`);
    this.log(`  Duplicate code blocks: ${this.stats.duplicateCode}`);
    this.log(`  Security issues: ${this.stats.securityIssues}`);

    if (this.issues.length > 0) {
      this.log(`\n❌ Critical Issues (${this.issues.length}):`, 'red');
      this.issues.slice(0, 10).forEach(issue => {
        this.log(`  • ${issue.file}`, 'red');
        this.log(`    ${issue.message}`, 'yellow');
      });
      if (this.issues.length > 10) {
        this.log(`  ... and ${this.issues.length - 10} more`, 'yellow');
      }
    }

    if (this.warnings.length > 0) {
      this.log(`\n⚠️  Warnings (${this.warnings.length}):`, 'yellow');
      this.warnings.slice(0, 5).forEach(warning => {
        this.log(`  • ${warning.file || warning.message}`, 'yellow');
        if (warning.file && warning.message) {
          this.log(`    ${warning.message}`, 'cyan');
        }
      });
      if (this.warnings.length > 5) {
        this.log(`  ... and ${this.warnings.length - 5} more`, 'yellow');
      }
    }

    const score = report.score;
    const scoreColor = score >= 90 ? 'green' : score >= 70 ? 'yellow' : 'red';
    const grade =
      score >= 90
        ? 'A'
        : score >= 80
          ? 'B'
          : score >= 70
            ? 'C'
            : score >= 60
              ? 'D'
              : 'F';

    this.log(`\n🎯 Quality Score: ${score}/100 (Grade: ${grade})`, scoreColor);

    // Save detailed report
    fs.writeFileSync(
      'code-quality-report.json',
      JSON.stringify(report, null, 2)
    );
    this.log('\n📄 Detailed report saved to code-quality-report.json', 'green');

    return report;
  }

  /**
   * Calculate overall quality score
   */
  calculateScore() {
    let score = 100;

    // Deduct points for issues
    score -= this.issues.filter(i => i.severity === 'critical').length * 10;
    score -= this.issues.filter(i => i.severity === 'high').length * 5;
    score -= this.issues.filter(i => i.severity === 'medium').length * 3;
    score -= this.issues.filter(i => i.severity === 'low').length * 1;

    // Deduct points for warnings
    score -= this.warnings.length * 0.5;

    // Deduct points for stats
    score -= this.stats.complexFunctions * 2;
    score -= this.stats.largeFiles * 1;
    score -= this.stats.duplicateCode * 1;
    score -= this.stats.securityIssues * 5;

    return Math.max(0, Math.min(100, Math.round(score)));
  }
}

// Run the checker
const checker = new CodeQualityChecker();
checker
  .analyzeFiles()
  .then(report => {
    // Exit with error if score is too low
    if (report.score < 60) {
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('Error running quality check:', error);
    process.exit(1);
  });
