/**
 * Utilities for converting between backend and frontend file tree formats.
 * 
 * The backend returns a flat array of FileTreeNode (with depth encoding),
 * while the frontend VaultTree expects a nested FileNode structure.
 */

import type { FileTreeNode } from '@/bindings';
import type { FileNode } from '@/state/editor/types';

/**
 * Map a file name to the frontend FileNode `kind`. Drives which
 * editor view a tab opens with (markdown vs canvas vs pdf), and
 * tells PaneBody whether to text-load the file via `read_file`
 * (which only works for UTF-8 content) vs leave loading to the
 * specialized view (PDFs fetch bytes via `read_file_binary`).
 */
function kindForFile(name: string): FileNode['kind'] {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.canvas')) return 'canvas';
  return 'file';
}

/**
 * Convert flat FileTreeNode[] from backend to nested FileNode[] for frontend.
 * 
 * The backend provides a flat array where depth indicates nesting level:
 * - depth 0 = root level
 * - depth 1 = child of previous depth-0 node
 * - etc.
 * 
 * This function reconstructs the tree structure using a stack-based approach.
 */
export function fileTreeToFileNodes(flatTree: FileTreeNode[]): FileNode[] {
  if (flatTree.length === 0) return [];
  
  const root: FileNode[] = [];
  const stack: { node: FileNode; depth: number }[] = [];
  
  for (const item of flatTree) {
    const fileNode: FileNode = {
      id: item.id,
      name: item.name,
      kind: item.type === 'directory' ? 'folder' : kindForFile(item.name),
      children: item.type === 'directory' ? [] : undefined,
    };
    
    // Pop stack until we find the parent (depth < current depth)
    while (stack.length > 0 && stack[stack.length - 1].depth >= item.depth) {
      stack.pop();
    }
    
    if (stack.length === 0) {
      // Root level node
      root.push(fileNode);
    } else {
      // Child of the last node in stack
      const parent = stack[stack.length - 1].node;
      if (parent.children) {
        parent.children.push(fileNode);
      }
    }
    
    // Push current node onto stack if it's a folder
    if (item.type === 'directory') {
      stack.push({ node: fileNode, depth: item.depth });
    }
  }
  
  return root;
}

/**
 * Flatten a nested FileNode tree to a flat array with depth information.
 * (Inverse of fileTreeToFileNodes, for when we need to send to backend)
 */
export function fileNodesToFileTree(nodes: FileNode[], depth = 0): FileTreeNode[] {
  const result: FileTreeNode[] = [];
  
  for (const node of nodes) {
    result.push({
      id: node.id,
      type: node.kind === 'folder' ? 'directory' : 'file',
      name: node.name,
      depth,
      parentId: null,
      isOpen: false,
      state: null,
      childCount: node.children?.length ?? null,
      size: null,
      modifiedAt: Date.now(),
    });
    
    if (node.children) {
      result.push(...fileNodesToFileTree(node.children, depth + 1));
    }
  }
  
  return result;
}
