// В релизной сборке под Windows не открывать консоль рядом с окном.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    rust_skin_stacker_lib::run();
}
