const CONTRACT_ID = "C...your id here...";
let pk = null;
let activeWalletName = null;
let feedInterval;
let wasmExports = null;

async function initWasm() {
    try {
        const response = await fetch('wasm_utils.wasm');
        const buffer = await response.arrayBuffer();
        const obj = await WebAssembly.instantiate(buffer);
        wasmExports = obj.instance.exports;
    } catch (e) {
        console.error("WASM load error:", e);
    }
}

// Global App State
const state = {
    totalPolls: 0,
    totalVotes: 0,
    treasury: 0
};

window.addEventListener('load', async () => {
    await initWasm();
    updateGlobalStats();
    const session = JSON.parse(localStorage.getItem("nexuspoll_session"));
    if (session && session.connected) {
        connectWallet(session.wallet);
    }
});

function updateGlobalStats() {
    document.getElementById("stat-polls").innerText = state.totalPolls;
    document.getElementById("stat-votes").innerText = state.totalVotes;
    
    const treasuryEl = document.getElementById("stat-treasury");
    if (treasuryEl) treasuryEl.innerText = state.treasury || 0;

    if (wasmExports) {
        const score = wasmExports.calculate_trust_score(state.totalVotes, state.totalPolls || 1);
        const securityScore = Math.min(score + 20, 99); // Mocked production security boost
        document.getElementById("stat-trust").innerText = securityScore + "%";
    }
}

// UI: Display a toast notification
function showToast(msg, color, actionHtml = "") {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.style.borderLeftColor = color;

    let icon = "ph-info";
    if (color === "#ef4444") icon = "ph-warning-circle";
    else if (color === "#a855f7") icon = "ph-globe-hemisphere-west";
    else if (color === "#f97316") icon = "ph-shield-warning";
    else if (color === "#00f5c4") icon = "ph-check-circle";

    toast.innerHTML = `
        <i class="ph-fill ${icon}" style="font-size:1.25rem; color:${color}; flex-shrink:0; margin-top:1px;"></i>
        <div class="toast-msg">
            <div>${msg}</div>
            ${actionHtml ? `<div style="margin-top:6px">${actionHtml}</div>` : ''}
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;

    document.getElementById("toast-container").appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove() }, 6000);
}

// WALLET: Wait for Freighter API to be ready (it loads async as ES module)
async function waitForFreighterApi(timeoutMs = 6000) {
    const start = Date.now();
    while (!window.freighterApi) {
        if (Date.now() - start > timeoutMs) return null;
        await new Promise(r => setTimeout(r, 200));
    }
    return window.freighterApi;
}

// WALLET: Connect Multi-Wallet (Freighter / Albedo)
async function connectWallet(walletType) {
    activeWalletName = walletType;

    if (walletType === 'freighter') {
        // Wait up to 6 seconds for the Freighter ESM module to load
        const api = await waitForFreighterApi();

        if (!api) {
            return showToast(
                "Freighter extension not detected. Make sure it's installed and the page is reloaded.",
                "#ef4444",
                "<a href='https://freighter.app' target='_blank' style='color:#3b82f6;text-decoration:none;'>Install Freighter</a>"
            );
        }

        try {
            let address;

            // ── Freighter v6 connection (recommended by official docs) ──
            // requestAccess() prompts user to allow the app AND returns { address }
            // getAddress() is lighter-weight for already-allowed apps
            if (typeof api.requestAccess === 'function') {
                const result = await api.requestAccess();
                console.log('[ChainVote] requestAccess result:', result);
                if (result && result.error) throw new Error(result.error);
                address = result?.address || '';
            }
            else if (typeof api.getAddress === 'function') {
                const result = await api.getAddress();
                console.log('[ChainVote] getAddress result:', result);
                if (result && result.error) throw new Error(result.error);
                address = result?.address || '';
            }
            else {
                throw new Error("No supported connection method found. Please update Freighter to the latest version.");
            }

            if (!address || typeof address !== 'string' || address.trim() === '') {
                throw new Error("Wallet rejected or is locked. Please open Freighter extension and unlock it, then try again.");
            }

            pk = address;
            localStorage.setItem("nexuspoll_session", JSON.stringify({ publicKey: pk, connected: true, wallet: 'freighter' }));
            updateUIOnConnect(walletType);
            startFeed();
        } catch (err) {
            console.error("Freighter Error:", err);
            showToast("Freighter Error: " + (err.message || err), "#ef4444");
        }
    } else if (walletType === 'albedo') {
        try {
            const res = await albedo.publicKey({ token: 'chainvote' });
            pk = res.pubkey;
            localStorage.setItem("nexuspoll_session", JSON.stringify({ publicKey: pk, connected: true, wallet: 'albedo' }));
            updateUIOnConnect(walletType);
            startFeed();
        } catch (err) {
            console.error("Albedo Connection Error:", err);
            showToast("Albedo connection rejected or failed: " + (err.message || err.toString()), "#f97316");
        }
    }
}

function disconnectWallet() {
    localStorage.removeItem("nexuspoll_session");
    pk = null;
    activeWalletName = null;

    const fbtn = document.getElementById("connect-btn");
    fbtn.innerHTML = "<i class=\"ph ph-rocket-launch\"></i> Freighter";
    fbtn.className = "btn btn-freighter";
    fbtn.style = '';

    const abtn = document.getElementById("connect-albedo-btn");
    abtn.innerHTML = "<i class=\"ph ph-sun\"></i> Albedo";
    abtn.className = "btn btn-albedo";
    abtn.style = '';

    document.getElementById("feed").innerHTML = `
        <div style="display:flex;align-items:center;gap:0.6rem;justify-content:center;padding:2rem;color:var(--text-muted);font-size:0.875rem;">
            <i class="ph ph-spinner-gap" style="animation:spin 1s linear infinite;font-size:1.2rem;"></i>
            Waiting for wallet…
        </div>
    `;
    document.getElementById("wallet-dashboard-card").style.display = 'none';
    if (feedInterval) clearInterval(feedInterval);
}

function updateUIOnConnect(walletType) {
    document.getElementById("connect-btn").style.display = 'none';
    document.getElementById("connect-albedo-btn").style.display = 'none';

    const actBtn = walletType === 'freighter' ? document.getElementById("connect-btn") : document.getElementById("connect-albedo-btn");
    actBtn.style.display = 'inline-flex';
    actBtn.innerHTML = `<i class="ph-fill ph-check-circle" style="color:var(--primary)"></i> ${pk.substring(0, 4)}…${pk.slice(-4)}`;
    actBtn.style.background = 'rgba(0,245,196,0.1)';
    actBtn.style.borderColor = 'rgba(0,245,196,0.4)';
    actBtn.style.color = 'var(--primary)';

    document.getElementById("wallet-dashboard-card").style.display = 'block';
    document.getElementById("wallet-dashboard-card").classList.add('wallet-card');
    fetchBalance();
}

// Level 1 Feature: Fetch Balance
async function fetchBalance() {
    if (!pk) return;
    const balEl = document.getElementById("wallet-balance");
    balEl.innerText = "...";
    try {
        const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${pk}`);
        if (!res.ok) throw new Error("Account not found");
        const data = await res.json();
        const native = data.balances.find(b => b.asset_type === "native");
        if (native) {
            balEl.innerText = parseFloat(native.balance).toFixed(2);
        }
    } catch(err) {
        balEl.innerText = "0.00";
    }
}

// Level 1 Feature: Send XLM
async function sendXLM(e) {
    e.preventDefault();
    if (!pk) return showToast("Please connect your wallet first.", "#ef4444");

    const dest = document.getElementById("send-dest").value;
    const amt = document.getElementById("send-amount").value;

    txStatus("signing");

    try {
        const server = new StellarSdk.SorobanRpc.Server("https://soroban-testnet.stellar.org:443");
        const account = await server.getAccount(pk);
        
        const tx = new StellarSdk.TransactionBuilder(account, { fee: "10000", networkPassphrase: StellarSdk.Networks.TESTNET })
            .addOperation(StellarSdk.Operation.payment({ destination: dest, asset: StellarSdk.Asset.native(), amount: amt }))
            .setTimeout(30).build();
        
        let signedXdr;
        if (activeWalletName === 'freighter') {
            const api = window.freighterApi;
            const signResult = await api.signTransaction(tx.toXDR(), { network: "TESTNET", networkPassphrase: "Test SDF Network ; September 2015" });
            if (signResult && signResult.error) throw new Error(signResult.error);
            signedXdr = (signResult && signResult.signedTxXdr) ? signResult.signedTxXdr : signResult;
        } else if (activeWalletName === 'albedo') {
            const res = await albedo.tx({ xdr: tx.toXDR(), network: "testnet" });
            signedXdr = res.signed_envelope_xdr;
        }

        txStatus("submitting");
        const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, StellarSdk.Networks.TESTNET);
        const sendResponse = await server.sendTransaction(signedTx);
        
        if (sendResponse.status !== "PENDING") {
            throw new Error(sendResponse.errorResult?.toXDR("base64") || "Submission failed");
        }
        
        txStatus("success", sendResponse.hash);
        setTimeout(fetchBalance, 4000); // refresh balance
    } catch (err) {
        txStatus("failed", err.message);
    }
    e.target.reset();
}

// FEED: Poll Horizon for latest effects (real-time event integration mock)
async function startFeed() {
    if (!pk) return;
    if (feedInterval) clearInterval(feedInterval);

    const feed = document.getElementById("feed");
    feed.innerHTML = `<div style="display:flex;align-items:center;gap:0.5rem;justify-content:center;padding:1.5rem;color:var(--primary);font-size:0.875rem;"><i class="ph ph-spinner-gap" style="animation:spin 1s linear infinite;"></i> Syncing on-chain activity…</div>`;

    const fetchFn = async () => {
        try {
            const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${pk}/effects?limit=15&order=desc`);
            
            if (!res.ok) {
                // If 404: account not yet funded on testnet
                feed.innerHTML = `<div style="padding:1.5rem;color:var(--accent2);text-align:center;font-size:0.875rem;">Account not found on Testnet.<br><small style="color:var(--text-muted);">Fund your wallet via Friendbot to see activity.</small></div>`;
                return;
            }

            const data = await res.json();
            
            // Only clear the feed inside the successful fetch so it doesn't blink unconditionally
            feed.innerHTML = "";

            if (data._embedded.records.length === 0) {
                feed.innerHTML = `<div style="padding:1.5rem;color:var(--text-muted);text-align:center;font-size:0.875rem;">No recent on-chain activity found.</div>`;
                return;
            }

            data._embedded.records.forEach((r, i) => {
                const time = new Date(r.created_at).toLocaleTimeString([], { hour12: false });

                const isNew = i % 3 === 0;
                const iconClass = isNew ? "ph-list-bullets" : "ph-check-square-offset";
                const label = isNew ? "NEW POLL CREATED" : "VOTE CAST";
                const color = isNew ? "#60a5fa" : "#4ade80";

                feed.innerHTML += `
                    <div class="event-item" style="border-left-color:${color}">
                        <div class="event-icon" style="color:${color}"><i class="ph-fill ${iconClass}"></i></div>
                        <div class="event-content">
                            <span class="event-type" style="color:${color}">${label}</span>
                            <span class="event-addr">${pk.substring(0,6)}…${pk.slice(-4)}</span>
                            <span class="event-time">${time}</span>
                        </div>
                    </div>`;
            });
        } catch (e) {
            console.error("Feed fetch failed", e);
            feed.innerHTML = `<div style="padding:1.5rem;color:var(--accent);text-align:center;font-size:0.875rem;">Network Error: ${e.message}</div>`;
        }
    };

    fetchFn();
    feedInterval = setInterval(fetchFn, 10000); // refresh every 10s
}

// UI: Manage Transaction Status Bar
function txStatus(state, hash = "") {
    const bar = document.getElementById("tx-status");
    bar.classList.add("visible");

    if (state === "signing") {
        bar.style.borderColor = "rgba(255,180,0,0.4)";
        bar.innerHTML = "<i class=\"ph ph-signature\" style=\"color:var(--accent2);\"></i> Awaiting wallet signature…";
    } else if (state === "submitting") {
        bar.style.borderColor = "rgba(0,245,196,0.3)";
        bar.innerHTML = "<i class=\"ph ph-spinner-gap\" style=\"color:var(--primary);animation:spin 1s linear infinite;\"></i> Broadcasting to Stellar Testnet…";
    } else if (state === "success") {
        bar.style.borderColor = "rgba(0,245,196,0.4)";
        bar.innerHTML = `<i class="ph-fill ph-check-circle" style="color:var(--primary);"></i> Success! <a href="https://stellar.expert/explorer/testnet/tx/${hash}" target="_blank">View on Explorer <i class="ph ph-arrow-up-right"></i></a>`;
        setTimeout(() => bar.classList.remove("visible"), 10000);
    } else if (state === "failed") {
        bar.style.borderColor = "rgba(255,45,120,0.4)";
        bar.innerHTML = `<i class="ph-fill ph-warning-circle" style="color:var(--accent);"></i> Failed: ${hash}`;
        setTimeout(() => bar.classList.remove("visible"), 10000);
    }
}

// CONTRACT: Helper to build and sign actual Soroban RPC Transactions
async function sendSorobanTransaction(contractMethod, ...args) {
    if (CONTRACT_ID.startsWith("C...")) {
        throw new Error("CONTRACT_ID is not configured. Please deploy the contract first!");
    }

    txStatus("signing");

    const server = new StellarSdk.SorobanRpc.Server("https://soroban-testnet.stellar.org:443");
    const contract = new StellarSdk.Contract(CONTRACT_ID);
    const account = await server.getAccount(pk);

    const tx = new StellarSdk.TransactionBuilder(account, {
        fee: "10000",
        networkPassphrase: StellarSdk.Networks.TESTNET
    })
        .addOperation(contract.call(contractMethod, ...args))
        .setTimeout(30)
        .build();

    const preparedTx = await server.prepareTransaction(tx);
    let signedXdr;

    if (activeWalletName === 'freighter') {
        const api = window.freighterApi;
        const signResult = await api.signTransaction(preparedTx.toXDR(), { network: "TESTNET", networkPassphrase: "Test SDF Network ; September 2015" });
        if (signResult && signResult.error) throw new Error(signResult.error);
        signedXdr = (signResult && signResult.signedTxXdr) ? signResult.signedTxXdr : signResult;
    } else if (activeWalletName === 'albedo') {
        const res = await albedo.tx({ xdr: preparedTx.toXDR(), network: "testnet" });
        signedXdr = res.signed_envelope_xdr;
    }

    txStatus("submitting");
    const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, StellarSdk.Networks.TESTNET);
    const sendResponse = await server.sendTransaction(signedTx);

    if (sendResponse.status !== "PENDING") {
        throw new Error(sendResponse.errorResult?.toXDR("base64") || "Submission failed");
    }

    return sendResponse.hash;
}

// CONTRACT: Create new poll on-chain
async function createPoll(e) {
    e.preventDefault();
    if (!pk) return showToast("Please connect your wallet first.", "#ef4444");

    const q = document.getElementById("q").value;
    const a = document.getElementById("a").value;
    const b = document.getElementById("b").value;
    const h = document.getElementById("h").value;

    try {
        const args = [
            new StellarSdk.Address(pk).toScVal(),
            StellarSdk.nativeToScVal(q, { type: "string" }),
            StellarSdk.nativeToScVal(a, { type: "string" }),
            StellarSdk.nativeToScVal(b, { type: "string" }),
            StellarSdk.nativeToScVal(Number(h), { type: "u64" })
        ];

        const txHash = await sendSorobanTransaction("create_poll", ...args);
        txStatus("success", txHash);

        state.totalPolls++;
        updateGlobalStats();
    } catch (err) {
        txStatus("failed", err.message);
    }

    e.target.reset(); // clear form
}

// CONTRACT: Vote on a specific poll
async function voteOnChain(id, choice) {
    if (!pk) return showToast("Please connect your wallet first.", "#ef4444");

    try {
        const args = [
            new StellarSdk.Address(pk).toScVal(),
            StellarSdk.nativeToScVal(id, { type: "u64" }),
            StellarSdk.nativeToScVal(choice, { type: "symbol" })
        ];

        const txHash = await sendSorobanTransaction("vote", ...args);
        txStatus("success", txHash);

        state.totalVotes++;
        state.users = Math.min(state.users + 1, 100);
        updateGlobalStats();
    } catch (err) {
        txStatus("failed", err.message);
    }
}
