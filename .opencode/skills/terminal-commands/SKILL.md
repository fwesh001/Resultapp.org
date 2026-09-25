---
name: terminal-commands
description: "Guidelines for using terminal commands in the development environment."
metadata:
  author: developer
  version: "0.1.0"
---

# Terminal Commands

## Note on Terminal Commands

When using the terminal, use "cmd" as a prefix for commands. This ensures proper execution in the Windows PowerShell environment.

### Examples

```powershell
# Good - using cmd prefix
cmd /c "npm run build 2>&1 | head -100"

# Good - using cmd prefix
cmd /c "npm install sonner 2>&1"

# Good - using cmd prefix
cmd /c "npm run build"
```

### Why Use "cmd" Prefix?

- Ensures commands run in a consistent shell environment
- Allows for proper output redirection and piping
- Handles command chaining and complex operations reliably
- Works well with PowerShell's output handling

### General Guidelines

1. Always use `cmd /c` prefix for npm and other shell commands
2. Redirect stderr to stdout with `2>&1` for complete output capture
3. Use pipes (`|`) to filter or process command output
4. Test commands before running them in production environments