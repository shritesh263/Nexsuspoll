# ChainVote Contract

Steps:
1. `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
2. `rustup target add wasm32-unknown-unknown`
3. `cargo install --locked stellar-cli --features opt`
4. `stellar keys generate alice`
5. `stellar keys fund alice --network testnet`
6. `stellar contract build`
7. `cargo test`
8. `./deploy.sh`
<video controls src="20260327-0730-11.7721893.mp4" title="Title"></video>