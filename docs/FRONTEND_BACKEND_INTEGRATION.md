# Frontend-Backend Integration Architecture

## Overview

The Flux frontend integrates with the Tauri Rust backend through a **layered architecture** with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│                    UI Components                         │
│  (VaultPicker, LeftSidebar, Editor, etc.)               │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ use specific handlers
                 │
┌────────────────┴────────────────────────────────────────┐
│              Operation Handlers (Hooks)                  │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────┐  │
│  │   Vault      │ │    File      │ │   Directory    │  │
│  │  Operations  │ │  Operations  │ │   Operations   │  │
│  └──────────────┘ └──────────────┘ └────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │         File Content Management                   │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ read/write state
                 │
┌────────────────┴────────────────────────────────────────┐
│              Vault Store (Zustand)                       │
│  • Single source of truth for vault state               │
│  • No business logic, pure state management             │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ invoke backend commands
                 │
┌────────────────┴────────────────────────────────────────┐
│                TypeScript Bindings                       │
│              (src/bindings.ts)                           │
│  • Type-safe wrappers for Tauri commands                │
│  • Generated types from Rust backend                    │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ IPC bridge
                 │
┌────────────────┴────────────────────────────────────────┐
│                  Rust Backend                            │
│  • Vault lifecycle • File CRUD • Directory ops          │
│  • Database indexing • Content hashing • Path security  │
└──────────────────────────────────────────────────────────┘
```

## Backend Contract

The backend exposes a **stable, fine-grained contract** that both the frontend and future plugins consume:

### Location: `src-tauri/src/types.rs`

**Domain Types** (shared contract):
- `VaultHandle` - vault metadata
- `FileState` - file lifecycle state (active/archived/trashed)
- `FileEntry` - file/directory entry with metadata
- `FileTreeNode` - flat tree structure with depth encoding
- `MoveResult`, `RenameResult` - operation results with wikilink healing stats
- `AppError` - comprehensive error types

### Location: `src-tauri/src/commands/{vault.rs, fs.rs}`

**Exposed Commands** (the API surface):

**Vault Operations:**
- `open_vault(path: String) -> VaultHandle`
- `create_vault(path: String) -> VaultHandle`
- `close_vault() -> ()`
- `get_vault_info() -> VaultHandle`

**File Operations:**
- `read_file(path: String) -> String`
- `write_file(path: String, content: String) -> ()`
- `create_file(path: String, content: String) -> ()`
- `delete_file(path: String) -> ()` (moves to .trash/)
- `move_file(src: String, dst: String) -> MoveResult`
- `rename_file(path: String, new_name: String) -> RenameResult`

**Directory Operations:**
- `create_directory(path: String) -> ()`
- `list_directory(path: String) -> Vec<FileEntry>`
- `get_file_tree() -> Vec<FileTreeNode>`

**Access Control:** Only functions marked with `#[tauri::command]` AND registered in `invoke_handler!` are accessible. Everything else (database, internal helpers) is private.

## Frontend Architecture

### State Management: `src/state/vault-store.ts`

**Single source of truth** for vault state. Pure state container with no business logic:

```typescript
interface VaultState {
  // Vault lifecycle
  vaultHandle: VaultHandle | null;
  isVaultOpen: boolean;
  
  // File tree
  fileTree: FileNode[];
  isLoadingTree: boolean;
  
  // File contents & dirty tracking
  openFiles: Map<string, string>;
  dirtyFiles: Set<string>;
  
  // State setters (used by operation hooks)
  setVaultHandle, setVaultOpen, setFileTree, etc.
}
```

### Operation Handlers (Hooks)

**Separated by use case** for modularity and clarity:

#### 1. `useVaultOperations` — Vault Lifecycle

**Use case:** Opening, creating, closing vaults  
**Used by:** Vault picker, window controls, settings

```typescript
const { openVault, createVault, closeVault, refreshVault } = useVaultOperations();
```

#### 2. `useFileOperations` — File CRUD

**Use case:** Reading, writing, creating, deleting, moving files  
**Used by:** Editor, file tree context menus, command palette

```typescript
const { openFile, saveFile, createFile, deleteFile, moveFile, renameFile } = useFileOperations();
```

#### 3. `useDirectoryOperations` — Directory Management

**Use case:** Creating directories, listing contents  
**Used by:** File tree, new folder dialogs

```typescript
const { createDirectory, listDirectory } = useDirectoryOperations();
```

#### 4. `useFileContent` — Content & Dirty Tracking

**Use case:** In-memory content management, unsaved changes  
**Used by:** Editor components, status bar, auto-save

```typescript
const { 
  getContent, 
  updateContent, 
  isDirty, 
  saveAll, 
  getDirtyCount 
} = useFileContent();
```

## Usage Examples

### Opening a Vault

```typescript
// In VaultPicker component
import { useVaultOperations } from '@/hooks';

function VaultPicker() {
  const { openVault } = useVaultOperations();
  
  const handleOpen = async () => {
    await openVault('/path/to/vault');
    // Vault is now open, file tree loaded automatically
  };
}
```

### File Operations

```typescript
// In Editor component
import { useFileOperations, useFileContent } from '@/hooks';

function Editor({ filePath }: { filePath: string }) {
  const { openFile, saveFile } = useFileOperations();
  const { updateContent, isDirty } = useFileContent();
  
  // Load file
  useEffect(() => {
    openFile(filePath); // Loads from backend, caches in store
  }, [filePath]);
  
  // Handle edits
  const handleChange = (newContent: string) => {
    updateContent(filePath, newContent); // Updates cache, marks dirty
  };
  
  // Save
  const handleSave = async () => {
    const content = getContent(filePath);
    await saveFile(filePath, content); // Writes to backend, marks clean
  };
}
```

### Batch Save All

```typescript
// In StatusBar component
import { useFileContent } from '@/hooks';

function StatusBar() {
  const { getDirtyCount, saveAll } = useFileContent();
  
  return (
    <div>
      {getDirtyCount() > 0 && (
        <button onClick={saveAll}>
          Save {getDirtyCount()} files
        </button>
      )}
    </div>
  );
}
```

## Benefits of This Architecture

1. **Separation of Concerns**
   - Store = state only
   - Hooks = business logic
   - Components = UI only

2. **Fine-Grained Imports**
   - Components import only what they need
   - Smaller bundles, clearer dependencies

3. **Testability**
   - Hooks can be tested in isolation
   - Mock backend easily via bindings layer

4. **Backend Contract Stability**
   - All backend access through typed bindings
   - Plugin API uses same contract as frontend
   - Changes to backend require explicit binding updates

5. **Error Handling**
   - All backend errors caught at hook layer
   - Consistent toast notifications
   - Components don't need error handling boilerplate

## Files Reference

### Backend Contract
- `src-tauri/src/types.rs` - Domain types
- `src-tauri/src/commands/vault.rs` - Vault commands
- `src-tauri/src/commands/fs.rs` - File/directory commands
- `src/bindings.ts` - TypeScript bindings (manually maintained)

### Frontend State
- `src/state/vault-store.ts` - Central state store

### Operation Handlers
- `src/hooks/use-vault-operations.ts` - Vault lifecycle
- `src/hooks/use-file-operations.ts` - File CRUD
- `src/hooks/use-directory-operations.ts` - Directory ops
- `src/hooks/use-file-content.ts` - Content & dirty tracking
- `src/hooks/index.ts` - Barrel export

### Utilities
- `src/lib/file-tree-utils.ts` - Convert flat ↔ nested file trees

## Next Steps

1. **Wire up file tree** - Use `useVaultStore().fileTree` in LeftSidebar
2. **Integrate editor** - Use hooks in editor components for load/save
3. **Add command palette** - File operations via keyboard shortcuts
4. **Implement auto-save** - Use `useFileContent().saveAll()` on interval
5. **Add keyboard shortcuts** - Cmd+S → save, Cmd+Shift+S → save all
