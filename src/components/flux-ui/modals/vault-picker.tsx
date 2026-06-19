/**
 * Vault picker dialog — prompts user to open or create a vault.
 * 
 * Shows when no vault is open. Uses Tauri's file dialog to select
 * a folder, then calls the vault store to open/create it.
 */

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useVaultOperations } from '@/hooks/use-vault-operations';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { IcFolder, IcNewFolder } from '@/components/flux-ui/common/icons';
import { toast } from 'sonner';

interface VaultPickerProps {
  open: boolean;
  onClose?: () => void;
}

export function VaultPicker({ open, onClose }: VaultPickerProps) {
  const { openVault, createVault } = useVaultOperations();
  const [loading, setLoading] = React.useState(false);
  const [mode, setMode] = React.useState<'select' | 'create'>('select');
  const [selectedPath, setSelectedPath] = React.useState('');
  const [vaultName, setVaultName] = React.useState('');
  
  const handleSelectFolder = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: mode === 'select' ? 'Select vault folder' : 'Select location for new vault',
      });
      
      if (selected) {
        setSelectedPath(selected);
        
        // Auto-populate vault name from folder name
        if (mode === 'select') {
          const folderName = selected.split(/[\\/]/).pop() || 'My Vault';
          setVaultName(folderName);
        }
      }
    } catch (error) {
      console.error('Failed to open folder dialog:', error);
      toast.error('Failed to open folder dialog', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  
  const handleOpenVault = async () => {
    if (!selectedPath) {
      toast.error('Please select a folder');
      return;
    }
    
    setLoading(true);
    try {
      await openVault(selectedPath);
      onClose?.();
    } catch (error) {
      console.error('Failed to open vault:', error);
      toast.error('Failed to open vault', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };
  
  const handleCreateVault = async () => {
    if (!selectedPath) {
      toast.error('Please select a location');
      return;
    }
    
    if (!vaultName.trim()) {
      toast.error('Please enter a vault name');
      return;
    }
    
    setLoading(true);
    try {
      // Create full path: selectedPath/vaultName
      const fullPath = `${selectedPath}${selectedPath.endsWith('/') || selectedPath.endsWith('\\\\') ? '' : '/'}${vaultName}`;

      await createVault(fullPath);
      onClose?.();
    } catch (error) {
      console.error('Failed to create vault:', error);
      toast.error('Failed to create vault', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {mode === 'select' ? 'Open Vault' : 'Create New Vault'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'select'
              ? 'Select an existing folder to open as a vault.'
              : 'Select a folder location to create a new vault.'}
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex flex-col gap-4 py-4">
          {/* Mode selector */}
          <div className="flex gap-2">
            <Button
              variant={mode === 'select' ? 'default' : 'outline'}
              onClick={() => {
                setMode('select');
                setSelectedPath('');
                setVaultName('');
              }}
              className="flex-1"
            >
              <IcFolder className="mr-2 h-4 w-4" />
              Open Existing
            </Button>
            <Button
              variant={mode === 'create' ? 'default' : 'outline'}
              onClick={() => {
                setMode('create');
                setSelectedPath('');
                setVaultName('');
              }}
              className="flex-1"
            >
              <IcNewFolder className="mr-2 h-4 w-4" />
              Create New
            </Button>
          </div>
          
          {mode === 'create' && (
            <div className="flex flex-col gap-2">
              <label htmlFor="vault-name" className="text-sm font-medium">
                Vault Name
              </label>
              <Input
                id="vault-name"
                value={vaultName}
                onChange={(e) => setVaultName(e.target.value)}
                placeholder="My Vault"
                disabled={loading}
              />
            </div>
          )}
          
          {/* Folder path input */}
          <div className="flex flex-col gap-2">
            <label htmlFor="vault-path" className="text-sm font-medium">
              {mode === 'select' ? 'Vault Folder' : 'Location'}
            </label>
            <div className="flex gap-2">
              <Input
                id="vault-path"
                value={selectedPath}
                onChange={(e) => setSelectedPath(e.target.value)}
                placeholder={mode === 'select' ? 'Select an existing vault folder...' : 'Select where to create the vault...'}
                readOnly
              />
              <Button
                type="button"
                onClick={handleSelectFolder}
                variant="outline"
                disabled={loading}
              >
                Browse
              </Button>
            </div>
          </div>
          
          {/* Preview of full path for create mode */}
          {mode === 'create' && selectedPath && vaultName && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Vault will be created at:</span>
              <code className="text-xs bg-muted px-2 py-1 rounded">
                {selectedPath}{selectedPath.endsWith('/') || selectedPath.endsWith('\\\\') ? '' : '/'}{vaultName}
              </code>
            </div>
          )}
          
          {/* Help text */}
          <p className="text-sm text-muted-foreground">
            {mode === 'select'
              ? 'A vault is a folder containing your markdown files. Flux will create a .zenvault folder for indexing.'
              : 'Flux will create a new folder with the vault structure and initialize it with example files.'}
          </p>
        </div>
        
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={mode === 'select' ? handleOpenVault : handleCreateVault}
            disabled={!selectedPath || loading}
          >
            {loading
              ? mode === 'select'
                ? 'Opening...'
                : 'Creating...'
              : mode === 'select'
                ? 'Open Vault'
                : 'Create Vault'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
