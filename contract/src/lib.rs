#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol
};

#[contracttype]
#[derive(Clone)]
pub struct Poll {
    pub id: u64,
    pub question: String,
    pub option_a: String,
    pub option_b: String,
    pub votes_a: u64,
    pub votes_b: u64,
    pub creator: Address,
    pub ends_at: u64,
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct ContractStats {
    pub total_polls: u64,
    pub total_votes: u64,
    pub treasury_balance: u64,
}

#[contracttype]
pub enum DataKey {
    Poll(u64),
    PollCount,
    Admin,
    Stats,
    VoterRecord(u64, Address),
    VaultAddr,
}

// --- Vault Contract (Simple Inter-contract Target) ---
#[contract]
pub struct VaultContract;

#[contractimpl]
impl VaultContract {
    pub fn deposit(env: Env, _from: Address, amount: u64) -> u64 {
        let key = symbol_short!("bal");
        let mut balance: u64 = env.storage().instance().get(&key).unwrap_or(0);
        balance += amount;
        env.storage().instance().set(&key, &balance);
        balance
    }

    pub fn get_balance(env: Env) -> u64 {
        env.storage().instance().get(&symbol_short!("bal")).unwrap_or(0)
    }
}

// --- Main ChainVote Contract ---
#[contract]
pub struct ChainVoteContract;

#[contractimpl]
impl ChainVoteContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::PollCount, &0u64);
        env.storage().instance().set(&DataKey::Stats, &ContractStats { total_polls: 0, total_votes: 0, treasury_balance: 0 });
        
        // In a real scenario, we'd deploy the vault separately and store its CID.
        // For this demo, we'll assume a mock address for inter-contract call demonstration.
        // We'll use the environment's current contract ID as a stand-in or a generated one.
    }

    pub fn set_vault(env: Env, vault: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        admin.require_auth();
        env.storage().instance().set(&DataKey::VaultAddr, &vault);
    }

    pub fn create_poll(env: Env, creator: Address, question: String, option_a: String, option_b: String, duration_hours: u64) -> u64 {
        creator.require_auth();
        let mut count: u64 = env.storage().instance().get(&DataKey::PollCount).unwrap_or(0);
        count += 1;
        env.storage().instance().set(&DataKey::PollCount, &count);

        let ends_at = env.ledger().timestamp() + (duration_hours * 3600);
        let poll = Poll {
            id: count, question, option_a, option_b,
            votes_a: 0, votes_b: 0, creator, ends_at, is_active: true,
        };
        env.storage().persistent().set(&DataKey::Poll(count), &poll);

        // --- INTER-CONTRACT CALL DEMONSTRATION ---
        // We call the Vault contract to deposit a "creation fee" (mocked as 10 units)
        let mut treasury_plus = 0;
        if let Some(vault_addr) = env.storage().instance().get::<_, Address>(&DataKey::VaultAddr) {
            // This is the actual inter-contract call using the client
            let vault_client = VaultContractClient::new(&env, &vault_addr);
            treasury_plus = vault_client.deposit(&env.current_contract_address(), &10);
        }

        let mut stats: ContractStats = env.storage().instance().get(&DataKey::Stats).unwrap_or(ContractStats { total_polls: 0, total_votes: 0, treasury_balance: 0 });
        stats.total_polls += 1;
        stats.treasury_balance = treasury_plus;
        env.storage().instance().set(&DataKey::Stats, &stats);
        
        env.events().publish((symbol_short!("NEWPOLL"),), count);
        count
    }

    pub fn vote(env: Env, voter: Address, poll_id: u64, choice: Symbol) {
        voter.require_auth();
        let poll_key = DataKey::Poll(poll_id);
        let mut poll: Poll = env.storage().persistent().get(&poll_key).expect("Poll not found");
        
        if !poll.is_active || env.ledger().timestamp() >= poll.ends_at {
            panic!("Poll has ended");
        }
        let voter_key = DataKey::VoterRecord(poll_id, voter.clone());
        if env.storage().persistent().has(&voter_key) {
            panic!("Already voted");
        }
        
        if choice == symbol_short!("A") {
            poll.votes_a += 1;
        } else if choice == symbol_short!("B") {
            poll.votes_b += 1;
        } else {
            panic!("Invalid choice");
        }
        
        env.storage().persistent().set(&voter_key, &true);
        env.storage().persistent().set(&poll_key, &poll);

        let mut stats: ContractStats = env.storage().instance().get(&DataKey::Stats).unwrap_or(ContractStats { total_polls: 0, total_votes: 0, treasury_balance: 0 });
        stats.total_votes += 1;
        env.storage().instance().set(&DataKey::Stats, &stats);
        env.events().publish((symbol_short!("VOTE"),), poll_id);
    }

    pub fn get_poll(env: Env, poll_id: u64) -> Poll {
        env.storage().persistent().get(&DataKey::Poll(poll_id)).expect("Poll not found")
    }

    pub fn get_poll_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::PollCount).unwrap_or(0)
    }

    pub fn get_stats(env: Env) -> ContractStats {
        env.storage().instance().get(&DataKey::Stats).unwrap_or(ContractStats { total_polls: 0, total_votes: 0, treasury_balance: 0 })
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger}, Env};

    #[test]
    fn test_inter_contract_call() {
        let env = Env::default();
        env.mock_all_auths();
        
        // Register main contract
        let main_cid = env.register_contract(None, ChainVoteContract);
        let main_client = ChainVoteContractClient::new(&env, &main_cid);
        
        // Register vault contract
        let vault_cid = env.register_contract(None, VaultContract);
        
        let admin = Address::generate(&env);
        main_client.initialize(&admin);
        
        // Set vault address
        main_client.set_vault(&vault_cid);
        
        // Create poll - this should trigger inter-contract call to vault
        let creator = Address::generate(&env);
        main_client.create_poll(&creator, &String::from_str(&env, "Q"), &String::from_str(&env, "A"), &String::from_str(&env, "B"), &24);
        
        // Verify treasury balance in stats (populated via inter-contract call)
        let stats = main_client.get_stats();
        assert_eq!(stats.treasury_balance, 10);
        
        // Directly check vault balance too
        let vault_client = VaultContractClient::new(&env, &vault_cid);
        assert_eq!(vault_client.get_balance(), 10);
    }

    #[test]
    fn test_vote_increments_correctly() {
        let env = Env::default();
        env.mock_all_auths();
        let cid = env.register_contract(None, ChainVoteContract);
        let client = ChainVoteContractClient::new(&env, &cid);
        client.initialize(&Address::generate(&env));
        let id = client.create_poll(&Address::generate(&env), &String::from_str(&env, "Q"), &String::from_str(&env, "A"), &String::from_str(&env, "B"), &24);
        client.vote(&Address::generate(&env), &id, &symbol_short!("A"));
        assert_eq!(client.get_poll(&id).votes_a, 1);
    }
}
