//! Linux single-instance via an **abstract-namespace** Unix socket.
//!
//! Earlier this used a filesystem socket, which has two race hazards: a stale
//! file left by a crash, and—worse—two simultaneous launches both missing the
//! socket and self-promoting (or a launch unlinking a live socket while trying
//! to clear a "stale" one), yielding two windows.
//!
//! The Linux abstract namespace (a socket name with no filesystem path) removes
//! both: there is no file to go stale or be unlinked, `bind` is atomic (exactly
//! one instance wins with `AddrInUse` for the rest), and the kernel releases the
//! name automatically when the owning process exits — even on a crash. Everyone
//! who loses the bind simply connects to the winner and signals it.
//!
//! Protocol: the winner listens; secondary launches send `focus\n` (plain
//! re-launch / dock click) or `open\t<token>\n` (launched with `--open-event=`).

use std::io::{Read, Write};
use std::os::linux::net::SocketAddrExt;
use std::os::unix::net::{SocketAddr, UnixListener, UnixStream};

/// Held for the process lifetime. Dropping it (on exit) closes the listener,
/// which releases the abstract name — no file cleanup needed.
pub struct InstanceGuard {
    listener: Option<UnixListener>,
}

/// The abstract socket address, namespaced by euid so two users on one host
/// don't collide. Abstract names have no leading slash and live in their own
/// namespace, distinct from any filesystem path.
fn instance_addr() -> std::io::Result<SocketAddr> {
    let uid = unsafe { libc::geteuid() };
    SocketAddr::from_abstract_name(format!("rencal-{uid}").as_bytes())
}

/// Either acquire the single-instance role (returning a guard holding the
/// listener), or signal the existing instance and return `None` so the caller
/// exits.
///
/// `message` is `"focus"` for a plain re-launch, or `"open\t<token>"` when
/// launched with `--open-event=` so the running app jumps to that event.
pub fn try_acquire_or_signal(message: &str) -> Option<InstanceGuard> {
    let addr = match instance_addr() {
        Ok(a) => a,
        Err(e) => {
            log::warn!("single-instance: cannot build address: {e}");
            return Some(InstanceGuard { listener: None });
        }
    };

    match UnixListener::bind_addr(&addr) {
        // We won — we're the primary instance.
        Ok(listener) => Some(InstanceGuard {
            listener: Some(listener),
        }),
        // Someone already owns the name: connect and signal them, then exit.
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            if let Ok(mut stream) = UnixStream::connect_addr(&addr) {
                let _ = stream.write_all(message.as_bytes());
                let _ = stream.write_all(b"\n");
                return None;
            }
            // In use but unreachable — shouldn't happen with abstract sockets
            // (the owner died → name is freed). Run as a lone window rather
            // than refuse to start; a duplicate is recoverable, no-app isn't.
            log::warn!("single-instance: address in use but not reachable; starting anyway");
            Some(InstanceGuard { listener: None })
        }
        Err(e) => {
            log::warn!("single-instance: could not bind: {e}");
            Some(InstanceGuard { listener: None })
        }
    }
}

/// Spawn a thread that dispatches messages from secondary launches: `"focus"`
/// invokes `on_focus`; `"open\t<token>"` invokes `on_open(token)`.
pub fn spawn_listener<F, G>(guard: &mut InstanceGuard, on_focus: F, on_open: G)
where
    F: Fn() + Send + 'static,
    G: Fn(String) + Send + 'static,
{
    let Some(listener) = guard.listener.take() else {
        return;
    };
    std::thread::spawn(move || {
        for incoming in listener.incoming() {
            let Ok(mut stream) = incoming else { continue };
            let mut buf = String::new();
            let _ = stream.read_to_string(&mut buf);
            let msg = buf.trim();
            if let Some(token) = msg.strip_prefix("open\t") {
                on_open(token.to_string());
            } else if msg == "focus" {
                on_focus();
            }
        }
    });
}
