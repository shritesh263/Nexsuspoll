#![no_std]

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}

#[no_mangle]
pub extern "C" fn get_magic_number() -> i32 {
    42
}

#[no_mangle]
pub extern "C" fn calculate_trust_score(votes: i32, users: i32) -> i32 {
    if users == 0 {
        return 0;
    }
    (votes * 100) / users
}
