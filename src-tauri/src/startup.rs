use crate::domain::{AppError, AppResult};

const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE_NAME: &str = "ProjectSync";

pub fn is_enabled() -> AppResult<bool> {
    #[cfg(windows)]
    {
        use winreg::{
            enums::{HKEY_CURRENT_USER, KEY_READ},
            RegKey,
        };
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = match hkcu.open_subkey_with_flags(RUN_KEY, KEY_READ) {
            Ok(key) => key,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(AppError::new("STARTUP_REGISTRY_ERROR", error.to_string())),
        };
        Ok(key.get_value::<String, _>(VALUE_NAME).is_ok())
    }
    #[cfg(not(windows))]
    {
        Err(AppError::new(
            "STARTUP_UNSUPPORTED",
            "开机启动只支持 Windows",
        ))
    }
}

pub fn set_enabled(enabled: bool, start_minimized: bool) -> AppResult<()> {
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hkcu
            .create_subkey(RUN_KEY)
            .map_err(|error| AppError::new("STARTUP_REGISTRY_ERROR", error.to_string()))?;
        if enabled {
            let executable = std::env::current_exe()
                .map_err(|error| AppError::new("STARTUP_PATH_ERROR", error.to_string()))?;
            let command = format!(
                "\"{}\"{}",
                executable.display(),
                if start_minimized {
                    " --start-minimized"
                } else {
                    ""
                }
            );
            key.set_value(VALUE_NAME, &command)
                .map_err(|error| AppError::new("STARTUP_REGISTRY_ERROR", error.to_string()))?;
        } else {
            match key.delete_value(VALUE_NAME) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(AppError::new("STARTUP_REGISTRY_ERROR", error.to_string()))
                }
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (enabled, start_minimized);
        Err(AppError::new(
            "STARTUP_UNSUPPORTED",
            "开机启动只支持 Windows",
        ))
    }
}
