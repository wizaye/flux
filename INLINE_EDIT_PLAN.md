# Inline Edit Implementation Plan

## Current Problems
1. ❌ Using `prompt()` - shows "localhost:1420 says"  
2. ❌ Files created directly - no inline rename opportunity
3. ❌ No inline rename in tree

## Lattice Pattern (Reference)
```typescript
// State structure
inlineEdit: { path: string; type: "newFile" | "newFolder" | "rename" } | null;

// New file flow:
1. Click "New File" button
2. Set inlineEdit = { path: parentFolder, type: "newFile" }
3. InlineInput renders AS A CHILD of the folder
4. User types name, presses Enter
5. Call backend createFile(path)
6. Refresh tree
7. Auto-open the new file

// Rename flow:
1. Right-click → Rename
2. Set inlineEdit = { path: fileId, type: "rename" }
3. InlineInput REPLACES the tree row
4. User edits name, presses Enter
5. Call backend renameFile(oldPath, newPath)
6. Refresh tree
```

## Implementation Steps

### 1. Add InlineInput Component ✅
- [x] Focus on mount
- [x] Select filename without extension  
- [x] Enter to submit
- [x] Escape to cancel
- [x] Blur to cancel

### 2. Update State Management
- [ ] Add `inlineEdit` state to LeftSidebar
- [ ] Pass through component tree: Toolbar, Body, VaultTree, VaultTreeNode

### 3. Update Toolbar Buttons
- [ ] "New File" → `setInlineEdit({ path: '', type: 'newFile' })`
- [ ] "New Folder" → `setInlineEdit({ path: '', type: 'newFolder' })`

### 4. Update VaultTree
- [ ] Render InlineInput at root when `inlineEdit.path === ''`
- [ ] Pass inlineEdit/setInlineEdit to children

### 5. Update VaultTreeNode
- [ ] Render InlineInput as child when creating in this folder
- [ ] Replace row with InlineInput when renaming
- [ ] Right-click → Rename sets inlineEdit

### 6. Add Submit Handlers
- [ ] handleInlineSubmit(value):
  - newFile → createFile(`${parentPath}/${value}`) → refresh → auto-open
  - newFolder → createDirectory(`${parentPath}/${value}`) → refresh
  - rename → renameFile(oldPath, `${parentDir}/${value}`) → refresh

### 7. Remove ALL prompts/dialogs
- [ ] Delete InputDialog components
- [ ] Remove prompt() calls
- [ ] Keep confirm() only for destructive actions (delete, move)

## Files to Modify
1. `src/components/flux-ui/layout/left-sidebar.tsx` - Main changes
2. `src/hooks/use-file-operations.ts` - Return file path after creation
3. NO backend changes needed - already working

## Expected UX
1. Click "New File" → Input appears inline → Type "My Note.md" → Enter → File created & opened
2. Right-click file → Rename → Input replaces row → Edit name → Enter → File renamed
3. NO MORE "localhost:1420 says" prompts!
