# Git Commit Messages

This project follows the **Conventional Commits Specification** to maintain an organized and scannable project history.

## Core Code Changes
* **`feat`**: A brand new feature or capability added to the codebase.
* **`fix`**: A bug fix or patch that resolves an active issue.

## Code Quality & Maintenance
* **`refactor`**: Rewriting or restructuring existing code without altering its behavior.
* **`style`**: Formatting changes that do not affect code logic (white-space, linting).
* **`perf`**: A code change aimed specifically at improving performance.

## Supporting Tasks
* **`docs`**: Changes strictly made to documentation (README, wikis, comments).
* **`test`**: Adding new tests or correcting existing test suites.
* **`chore`**: Regular maintenance tasks (updating dependencies, editing `.gitignore`).

## DevOps & Systems
* **`build`**: Changes affecting the build system or project packages (npm, Webpack).
* **`ci`**: Modifications made to CI/CD pipelines (GitHub Actions, CircleCI).
* **`revert`**: Used specifically when undoing a previous commit.

---

## Quick Rules
1. **Imperative Mood**: Write descriptions in the present tense (e.g., `fix: fix bug`, not `fixed: bug`).
2. **Optional Scopes**: You can add a scope in parentheses for context (e.g., `feat(auth): add login`).
3. **Breaking Changes**: Add a `!` before the colon if the change breaks backward compatibility (e.g., `feat(api)!: remove v1 endpoints`).
4. **Multiple files**: when there are multiple changes Commit each  edited/changed file one by one then push all
