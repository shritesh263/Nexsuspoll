#!/bin/bash
stellar contract build
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/chainvote_contract.wasm --source alice --network testnet > contract_id.txt
CONTRACT_ID=$(cat contract_id.txt)
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet -- initialize --admin alice
