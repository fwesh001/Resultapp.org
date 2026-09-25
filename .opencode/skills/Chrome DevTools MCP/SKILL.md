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

- `mcp_chrome-devtoo_new_page` — open the exact page you need.
- `mcp_chrome-devtoo_navigate_page` — reload, go back, or jump to a URL.
- `mcp_chrome-devtoo_take_snapshot` — capture the accessibility tree and stable element IDs.
- `mcp_chrome-devtoo_list_console_messages` — look for JavaScript errors, warnings, and custom logs.
- `mcp_chrome-devtoo_list_network_requests` — verify that scripts, styles, and images are loading.
- `mcp_chrome-devtoo_evaluate_script` — inspect runtime state, query selectors, and DOM attributes.
- `mcp_chrome-devtoo_click` / `mcp_chrome-devtoo_fill` / `mcp_chrome-devtoo_fill_form` — interact with the page.
- `mcp_chrome-devtoo_take_screenshot` — compare visual state before and after a click.