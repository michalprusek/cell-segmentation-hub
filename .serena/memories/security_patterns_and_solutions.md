# Security Patterns and Solutions

## Credential Management Patterns

### Pattern: Environment Variable References

**Problem**: Hardcoded credentials in configuration files
**Solution**: Use environment variable substitution

```yaml
# docker-compose.yml
environment:
  - SMTP_USER=${SMTP_USER}
  - SMTP_PASS=${SMTP_PASS}
```

**Files to Check**: docker-compose\*.yml, .env files, configuration files

### Pattern: Example Files for Secure Templates

**Problem**: Need to document configuration without exposing secrets
**Solution**: Create .example files with placeholders

```bash
# .env.green.example
SMTP_USER=your-email@example.com
SMTP_PASS=your-smtp-password
```

**Implementation**: Always gitignore actual config, commit only examples

### Pattern: Python Interpreter Consistency

**Problem**: Docker images with multiple Python versions cause package conflicts
**Solution**: Use explicit interpreter for all operations

```dockerfile
RUN python3.11 -m pip install --no-cache-dir package
```

**Applies to**: All Dockerfiles with Python installations

## Path Resolution Patterns

### Pattern: Dynamic Project Root Discovery

**Problem**: Scripts break when run from different locations
**Solution**: Use pathlib for intelligent path resolution

```python
from pathlib import Path
project_root = Path(__file__).resolve().parent.parent / "backend" / "segmentation"
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))
```

**Use cases**: All Python scripts that import project modules

### Pattern: Environment-Aware Path Selection

**Problem**: Different paths in Docker vs local development
**Solution**: Check environment and adapt

```python
base_path = "/app" if os.path.exists("/app") else str(Path(__file__).resolve().parent.parent)
```

**Applies to**: Scripts that need to work in multiple environments

## GPU Configuration Patterns

### Pattern: Modern Docker Compose GPU Support

**Problem**: Legacy "runtime: nvidia" deprecated
**Solution**: Use device_requests

```yaml
device_requests:
  - driver: nvidia
    count: 1
    capabilities: [gpu]
```

**Note**: Remove Swarm-specific deploy.resources.devices

## Error Handling Patterns

### Pattern: Defensive Property Access

**Problem**: Missing properties cause runtime errors
**Solution**: Use .get() with defaults

```python
processing_info = result.get('processing_info')
batch_size = processing_info.get('batch_size', 'unknown') if processing_info else 'unknown'
```

**Use cases**: Processing external data, API responses

### Pattern: Division by Zero Protection

**Problem**: Throughput calculations fail with zero time
**Solution**: Guard against zero values

```python
if inference_time > 0 and batch_size > 0:
    throughput = batch_size / inference_time
else:
    throughput = 0
    time_per_img = float('inf')
```

**Applies to**: All mathematical calculations

### Pattern: CUDA Operation Guards

**Problem**: CUDA calls fail on CPU-only systems
**Solution**: Check availability before use

```python
if torch.cuda.is_available():
    torch.cuda.synchronize()
```

**Use cases**: All CUDA-specific operations

## Configuration Patterns

### Pattern: Typed Environment Variable Parsing

**Problem**: String environment variables need type conversion
**Solution**: Parse with validation and fallbacks

```typescript
const timeout = parseInt(process.env.TIMEOUT || '60000', 10) || 60000;
```

**Note**: Always provide radix (10) and fallback value

### Pattern: Debug Flag Control

**Problem**: Sensitive information in logs
**Solution**: Explicit debug flag control

```typescript
logger: process.env.SMTP_DEBUG === 'true',
debug: process.env.SMTP_DEBUG === 'true'
```

**Default**: Always default to false for security

## TypeScript Patterns

### Pattern: Proper Promise Typing

**Problem**: Untyped Promises lose type safety
**Solution**: Specify generic type

```typescript
const sendMailWithTimeout = new Promise<SMTPTransport.SentMessageInfo>(
  (resolve, reject) => {
    // implementation
  }
);
```

**Benefit**: Eliminates need for "as any" casts

## Validation Patterns

### Pattern: Multi-file Syntax Validation

**Problem**: Need to validate multiple Python files
**Solution**: Use py_compile module

```bash
python3 -m py_compile script1.py script2.py script3.py
```

**Note**: Returns non-zero on syntax errors

### Pattern: JSON Configuration Validation

**Problem**: Invalid JSON breaks application
**Solution**: Validate during CI/CD

```python
import json
json.load(open('config.json'))
```

**Integration**: Add to pre-commit hooks

## Common Issues and Solutions

### Issue: F-string with Literal Newlines

**Problem**: `print(f"\n✅ Result")` causes syntax error
**Solution**: Use escaped newline `print(f"\\n✅ Result")`

### Issue: Pip Installing Wrong PyTorch

**Problem**: requirements.txt overwrites CUDA PyTorch
**Solution**: Filter out torch packages

```dockerfile
RUN grep -v "^torch\|^torchvision" requirements.txt > requirements_no_torch.txt
```

### Issue: Batch Size Configuration Mismatch

**Problem**: optimal_batch_size != max_safe_batch_size
**Solution**: Ensure consistency based on test results

```json
"resunet_advanced": {
  "optimal_batch_size": 1,
  "max_safe_batch_size": 1  // Must match if model fails at higher sizes
}
```

## Security Checklist

- [ ] No credentials in code files
- [ ] All sensitive configs use environment variables
- [ ] Example files contain only placeholders
- [ ] Debug logging disabled by default
- [ ] Credentials marked for rotation if exposed
- [ ] .gitignore includes all sensitive files
- [ ] Docker images don't contain secrets
- [ ] Configuration validation in place
