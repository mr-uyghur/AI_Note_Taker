fn main() {
    // On macOS, compile the Swift sidecar before tauri_build runs.
    #[cfg(target_os = "macos")]
    {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let script = format!("{}/../../sidecars/macos/build.sh", manifest_dir);
        let status = std::process::Command::new("bash")
            .arg(&script)
            .status()
            .expect("failed to invoke sidecars/macos/build.sh");
        assert!(status.success(), "Swift sidecar build failed");

        // Re-run if Swift source or build script changes.
        println!("cargo:rerun-if-changed=../../sidecars/macos/UtterRecorder.swift");
        println!("cargo:rerun-if-changed=../../sidecars/macos/build.sh");
    }

    tauri_build::build()
}
