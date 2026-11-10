//! The application service: what any client of the app needs over the capabilities (`modules`),
//! which never depend on it. Only the app runs it; the helper runs the modules it serves. It
//! reaches the machines, the stores and the system through ports the infrastructure implements.

pub mod machines;
