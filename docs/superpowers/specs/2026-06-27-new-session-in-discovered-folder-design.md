# New session in a discovered external folder — Design Spec

**Date:** 2026-06-27
**Branch:** `feat/agent-sdk-rearch`
**Status:** Approved design.

## 1. Summary

Today a *fresh* session can only be started under the cockpit projects root (an existing cockpit project, a new one, or a temporary folder); only **resume** can reach a folder outside that root. This adds the ability to **start a fresh session in an existing folder outside the cockpit root** — a folder discovered by the same machine-wide scan that powers resume. Chosen placement (approach B): a new scope in the **New-session picker**, so "create" stays in the create modal.

## 2. Scope

- **In scope:** a "Discovered folders" scope in the New-session picker that lists folders outside the cockpit root which have prior Claude sessions, and starts a fresh session in the chosen folder.
- **Client-only.** The server already provides everything: the discovery scan tags each folder group as temp / cockpit / neither, and `create` already accepts any existing directory. No server change.
- **Out of scope:** creating brand-new folders outside the root (the folder must already exist / be discovered); resume changes (unchanged).

## 3. Design

- **Scope switch.** The New-session picker gains a scope switch at the top — **Cockpit projects** (default, the current view) and **Discovered folders** — mirroring the Resume modal's existing scope switch.
- **Discovered-folders source.** The "Discovered folders" scope fetches the same discovery endpoint the Resume modal uses (`/api/recent`), and keeps only the folder groups tagged **neither cockpit nor temp** (i.e. outside the cockpit root). Each such folder becomes one clickable row.
- **Row + action.** A row shows the folder's name (basename), its full path, and last-used time, ordered most-recent first. Clicking it starts a **fresh** session there — the existing `create(cwd)` path with the discovered folder as cwd. No new folder is created.
- **Reused controls.** The picker's existing **search box** filters discovered folders by name/path, and the existing **"Older than 7 days"** toggle widens the discovery window (fetches `window=all`) — both reused as-is. The bottom actions (create-new-project, "+ Temporary session") stay; the scope switch only swaps the list above them.

## 4. Error handling & edges

- **Missing folder:** if a discovered folder was deleted since the scan, the fresh start fails at spawn and surfaces as a session error (the existing `session-error` → client error path). No special handling.
- **Empty state:** if no external folders are discovered, the scope shows "No discovered folders outside the cockpit."

## 5. Testing

- The discovery tagging (temp / cockpit / neither) is produced server-side and already unit-tested (`GET /api/recent classifies groups as temp, cockpit, or neither`). The remainder is client UI in the New-session picker, verified in the browser: switch to Discovered folders, start a session in an external folder, confirm it runs in that folder (sidebar "Other" group, correct cwd).

## 6. Invariants

- No new directory is ever created for this flow; the folder must already exist.
- `create` accepts an existing external cwd; subscription-only auth and the SDK driver are unchanged.
