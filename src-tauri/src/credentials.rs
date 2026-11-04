use crate::domain::{AppError, AppResult};

pub struct CredentialStore;

impl CredentialStore {
    pub fn set(reference: &str, password: &str) -> AppResult<()> {
        #[cfg(windows)]
        {
            use std::{ffi::c_void, ptr::null_mut};
            use windows_sys::Win32::Security::Credentials::{
                CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
            };
            let target = wide(reference);
            let mut blob = password.as_bytes().to_vec();
            let credential = CREDENTIALW {
                Flags: 0,
                Type: CRED_TYPE_GENERIC,
                TargetName: target.as_ptr() as *mut u16,
                Comment: null_mut(),
                LastWritten: windows_sys::Win32::Foundation::FILETIME {
                    dwLowDateTime: 0,
                    dwHighDateTime: 0,
                },
                CredentialBlobSize: blob.len() as u32,
                CredentialBlob: blob.as_mut_ptr(),
                Persist: CRED_PERSIST_LOCAL_MACHINE,
                AttributeCount: 0,
                Attributes: null_mut(),
                TargetAlias: null_mut(),
                UserName: null_mut(),
            };
            let ok = unsafe { CredWriteW(&credential, 0) };
            blob.fill(0);
            if ok == 0 {
                return Err(AppError::new(
                    "CREDENTIAL_STORE_FAILED",
                    "无法写入 Windows 凭据管理器",
                ));
            }
            let _ = std::marker::PhantomData::<*mut c_void>;
            Ok(())
        }
        #[cfg(not(windows))]
        {
            let _ = (reference, password);
            Err(AppError::new(
                "CREDENTIAL_STORE_UNAVAILABLE",
                "凭据安全存储仅在 Windows 上可用",
            ))
        }
    }

    pub fn get(reference: &str) -> AppResult<String> {
        #[cfg(windows)]
        {
            use std::ptr::null_mut;
            use windows_sys::Win32::Security::Credentials::{
                CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
            };
            let target = wide(reference);
            let mut raw: *mut CREDENTIALW = null_mut();
            let ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) };
            if ok == 0 {
                return Err(AppError::new(
                    "CREDENTIAL_NOT_FOUND",
                    "WebDAV 凭据不存在，请重新输入密码",
                ));
            }
            let credential = unsafe { &*raw };
            let bytes = unsafe {
                std::slice::from_raw_parts(
                    credential.CredentialBlob,
                    credential.CredentialBlobSize as usize,
                )
            };
            let value = String::from_utf8(bytes.to_vec())
                .map_err(|_| AppError::new("CREDENTIAL_INVALID", "保存的 WebDAV 凭据格式无效"));
            unsafe {
                CredFree(raw.cast());
            }
            value
        }
        #[cfg(not(windows))]
        {
            let _ = reference;
            Err(AppError::new(
                "CREDENTIAL_STORE_UNAVAILABLE",
                "凭据安全存储仅在 Windows 上可用",
            ))
        }
    }

    pub fn delete(reference: &str) -> AppResult<()> {
        #[cfg(windows)]
        {
            use windows_sys::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};
            let target = wide(reference);
            let ok = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
            if ok == 0 {
                let code = unsafe { windows_sys::Win32::Foundation::GetLastError() };
                if code != 1168 {
                    return Err(AppError::new(
                        "CREDENTIAL_DELETE_FAILED",
                        "无法删除 Windows 凭据",
                    ));
                }
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            let _ = reference;
            Err(AppError::new(
                "CREDENTIAL_STORE_UNAVAILABLE",
                "凭据安全存储仅在 Windows 上可用",
            ))
        }
    }
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
