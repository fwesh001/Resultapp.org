---
name: chrome-devtools-debugging
description: Use when a frontend bug needs live browser proof instead of source reading — JS exceptions, failing event handlers, missing assets, hydration mismatches, or "it works in dev but not on the real page". Triggers on "check in the browser", "console error", "why isn't this click working", "debug the UI", "verify in Chrome", "take a screenshot of the page".
---

## 1. Chrome DevTools MCP Debugging

Use the Chrome DevTools MCP tools whenever a frontend issue needs live browser proof instead of guessing from source alone. This is the fastest way to confirm whether a bug is caused by:

- missing script loading,
- event handlers not binding,
- JavaScript exceptions,
- selector mismatches,
- late-rendered DOM nodes,
- or a server-side/template problem.

### 1.1 Recommended workflow

1. Open the target page in a new browser page or reload the selected page.
2. Take a snapshot first so you know the current DOM and element IDs.
3. Check console messages before clicking anything.
4. Inspect network requests to confirm the JS/CSS assets actually loaded.
5. Use an evaluation script to probe DOM state, event bindings, and form values.
6. Click the target control and re-read console output immediately after.
7. If the page is supposed to change state, take another snapshot or screenshot.

### 1.2 Most useful tools

Names are prefixed `chrome-devtools_` — there is no `mcp_` prefix.

- `chrome-devtools_new_page` — open the exact page you need.
- `chrome-devtools_navigate_page` — reload, go back, or jump to a URL.
- `chrome-devtools_take_snapshot` — capture the accessibility tree and stable element IDs.
- `chrome-devtools_list_console_messages` — look for JavaScript errors, warnings, and custom logs.
- `chrome-devtools_list_network_requests` — verify that scripts, styles, and images are loading.
- `chrome-devtools_evaluate_script` — inspect runtime state, query selectors, and DOM attributes.
- `chrome-devtools_click` / `chrome-devtools_fill` / `chrome-devtools_fill_form` — interact with the page.
- `chrome-devtools_take_screenshot` — compare visual state before and after a click.

Prefer `fill_form` over repeated `fill` calls — it is one round trip instead of N.

### 1.3 Reusable init script

`navigate_page` accepts an `initScript` that runs before any page script on the
next navigation. Use it to seed `localStorage` or stub a network response when
you need to reach a state that is tedious to reach by hand (a mid-flow screen,
a specific mobile viewport), without clicking through every preceding step.
