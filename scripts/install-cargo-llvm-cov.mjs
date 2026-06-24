#!/usr/bin/env node
/**
 * Install `cargo-llvm-cov` — a cargo subcommand binary that lives
 * in `$CARGO_HOME/bin`, not a Rust dependency. We can't declare
 * it in `Cargo.toml`; the binary has to land on `PATH` somehow.
 *
 * This script tries the fast path first:
 *   1. If `cargo-llvm-cov` is already installed, exit immediately.
 *   2. If `cargo-binstall` is available, use it (~5 s — downloads a
 *      prebuilt binary for the host triple).
 *   3. Fall back to `cargo install --locked cargo-llvm-cov` which
 *      compiles from source (~2 min).
 *
 * The `llvm-tools-preview` toolchain component is auto-installed by
 * `rust-toolchain.toml`, so no `rustup component add` is needed
 * here — rustup picks it up on the first `cargo` call.
 */
import { spawnSync } from "node:child_process";

const PKG = "cargo-llvm-cov";

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  return result.status ?? 1;
}

function has(cmd) {
  const probe = spawnSync(cmd, ["--version"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return probe.status === 0;
}

/** `cargo-llvm-cov` installs as both `cargo-llvm-cov` (the raw
 *  binary cargo dispatches to) and as the `llvm-cov` subcommand
 *  cargo synthesises from the binary's name. The subcommand form
 *  is the canonical user-visible probe — works regardless of
 *  whether `$CARGO_HOME/bin` happens to be on the system PATH. */
function hasCargoSubcommand(name) {
  const probe = spawnSync("cargo", [name, "--version"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return probe.status === 0;
}

function main() {
  if (hasCargoSubcommand("llvm-cov")) {
    console.log(`✔ ${PKG} already installed; nothing to do.`);
    return 0;
  }

  console.log(`→ ${PKG} not found on PATH — installing.`);

  if (has("cargo-binstall")) {
    console.log("→ Using cargo-binstall (prebuilt binary, ~5 s).");
    const status = run("cargo", ["binstall", "--no-confirm", "--locked", PKG]);
    if (status === 0) return 0;
    console.warn("⚠ cargo-binstall failed; falling back to cargo install.");
  } else {
    console.log(
      "ℹ cargo-binstall not found — using `cargo install` (compiles " +
        "from source, ~2 min). For a faster future setup run:",
    );
    console.log("    cargo install --locked cargo-binstall");
  }

  return run("cargo", ["install", "--locked", PKG]);
}

process.exit(main());
