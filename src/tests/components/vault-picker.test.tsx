/**
 * Unit tests for `vault-picker` validation logic.
 *
 * Focus: the `joinVaultPath` + `invalidVaultNameChars` pair that
 * the picker uses to fail fast on bad input before the user hits
 * a cryptic OS error. Renders the dialog with `@testing-library/react`
 * and drives the create flow to verify each validation branch.
 *
 * The component imports `@tauri-apps/plugin-dialog` lazily inside
 * `handleSelectFolder` (which we never click here) so no mocks of
 * the dialog plugin are needed. The vault-operations hook is mocked
 * so we can assert the create command was NOT called for invalid
 * input.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createVault = vi.fn(async () => undefined);
const openVault = vi.fn(async () => undefined);

vi.mock("@/hooks/use-vault-operations", () => ({
  useVaultOperations: () => ({ openVault, createVault }),
}));

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  });
  return { toast };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

import { toast } from "sonner";
import { VaultPicker } from "@/components/flux-ui/modals/vault-picker";

const toastErrorMock = toast.error as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  createVault.mockClear();
  openVault.mockClear();
  toastErrorMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderPicker() {
  return render(<VaultPicker open={true} onClose={() => undefined} />);
}

async function switchToCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Create New/i }));
}

async function setName(user: ReturnType<typeof userEvent.setup>, name: string) {
  const input = screen.getByLabelText(/Vault Name/i);
  await user.clear(input);
  if (name) await user.type(input, name);
}

/** The path input is readOnly (only the Browse button writes to it),
 *  so userEvent.type doesn't work. Drive React's onChange directly. */
function seedSelectedPath(path: string) {
  const input = screen.getByLabelText(/Location/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value: path } });
}

describe("VaultPicker — create flow validation", () => {
  it("disables the Create button until a location is selected", async () => {
    const user = userEvent.setup();
    renderPicker();
    await switchToCreate(user);
    await setName(user, "MyVault");
    const button = screen.getByRole("button", { name: /Create Vault/i });
    expect(button).toBeDisabled();
  });

  it("toasts an error when the name is whitespace-only", async () => {
    const user = userEvent.setup();
    renderPicker();
    await switchToCreate(user);
    seedSelectedPath("/home/v");
    await setName(user, "   ");

    await user.click(screen.getByRole("button", { name: /Create Vault/i }));

    expect(toastErrorMock).toHaveBeenCalledWith("Please enter a vault name");
    expect(createVault).not.toHaveBeenCalled();
  });

  it("rejects a name containing a path separator", async () => {
    const user = userEvent.setup();
    renderPicker();
    await switchToCreate(user);
    seedSelectedPath("/home/v");
    await setName(user, "bad/name");

    await user.click(screen.getByRole("button", { name: /Create Vault/i }));

    expect(toastErrorMock).toHaveBeenCalledWith(
      "Invalid vault name",
      expect.objectContaining({
        description: expect.stringContaining("/"),
      }),
    );
    expect(createVault).not.toHaveBeenCalled();
  });

  it("rejects a name containing Windows-reserved characters", async () => {
    const user = userEvent.setup();
    renderPicker();
    await switchToCreate(user);
    seedSelectedPath("/home/v");
    await setName(user, "my<vault>");

    await user.click(screen.getByRole("button", { name: /Create Vault/i }));

    expect(toastErrorMock).toHaveBeenCalledWith(
      "Invalid vault name",
      expect.objectContaining({
        description: expect.stringMatching(/[<>]/),
      }),
    );
    expect(createVault).not.toHaveBeenCalled();
  });

  it("trims surrounding whitespace before calling the backend", async () => {
    const user = userEvent.setup();
    renderPicker();
    await switchToCreate(user);
    seedSelectedPath("/home/v");
    await setName(user, "   MyVault   ");

    await user.click(screen.getByRole("button", { name: /Create Vault/i }));

    // `handleCreateVault` lazy-imports `withBusy`; wait for it to
    // resolve and the wrapped `createVault` call to land.
    await waitFor(() => {
      expect(createVault).toHaveBeenCalledOnce();
    });
    expect(createVault).toHaveBeenCalledWith("/home/v/MyVault");
  });
});
