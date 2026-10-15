---
name: requirement-workflow
description: Use when a request is broad or ambiguous and needs scoping before implementation. Triggers on "build X", "add a feature", "I want to...", or any multi-step requirement where the exact files, schema, or acceptance criteria are not yet pinned down.
---

# Requirement Workflow

Critical:
  1. Rescearch and find out the files that will be modified and the files that will be needed to carry out the requirements
  2. Ask clarafying questions 
  3. Make a well laid plan for the above requirements
  4. Create a to-do list of the steps to be taken to implement the requirements
  5. Track your progress by checking off the items in the to-do list as you complete them
  6. After implementing the requirements, provide a brief summary of the implementation plan

Notes:
  - Do not start editing before steps 1-4 are done. The research in step 1 is what
    keeps a plan honest about which files actually exist.
  - Prefer `todowrite` over an ad-hoc checklist so progress survives context loss.
  - Ask about the decisions that are expensive to reverse (data model, migration
    shape, auth boundaries). Do not ask about things that are cheap to change.
