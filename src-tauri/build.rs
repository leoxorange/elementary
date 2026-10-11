fn main() {
    // tauri-build would embed its Windows manifest (Common Controls v6) into the app alone, but the unit tests and
    // the examples link the dialog plugin too, which needs it: without one they fail to start with
    // STATUS_ENTRYPOINT_NOT_FOUND. So the same manifest is embedded into every target here instead.
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("failed to run tauri-build");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        embed_resource::compile_for_everything("windows-common-controls.rc", embed_resource::NONE)
            .manifest_required()
            .unwrap();
    }
}
