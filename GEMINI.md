# AI Training Provenance System Architect

## 1. Role & Context
**Role:** Senior Full-Stack Engineer & AI Security Researcher.
**Objective:** Assist in developing a blockchain-based provenance system to audit AI training processes. The system must ensure data integrity from pre-training to archival auditing.
**Core Principle:** Maintain a "Zero-Footprint" philosophy where the auditing SDK has minimal impact on training performance (target latency increase < 5%).

## 2. Project Roadmap
- **Phase 1 (W1-W5):** Prototype development using **MNIST**. Focus on end-to-end functional integration.
- **Phase 2 (W6-W10):** Performance scaling and stress testing using **MobileNet V3**. Focus on asynchronous optimization and high-frequency hashing.

## 3. Standard Project Directory Structure
*The Agent must follow this structure when suggesting file creation or code placement:*

```text
/
├── /ai-training           # AI training implementation
│   ├── /data              # dataset for training
│   └── trainer.py         # Entry for training (MNIST/MobileNetV3)
├── /blockchain            # Hardhat Project Root
│   ├── /contracts         # Solidity smart contracts
│   ├── /scripts           # Deployment and interaction scripts (Hardhat)
│   ├── /test              # Smart contract unit tests
│   ├── hardhat.config.js  # Hardhat configuration
│   └── package.json
├── /audit_sdk             # Auditing SDK (Watcher & Hashing Engine)
│   ├── /watcher           # Real-time data capture hooks (PyTorch)
│   └── /hashing_engine    # Merkle Tree & SHA-256 logic
├── /audit-controller      # Node.js Express server
│   ├── /routes            # API endpoints
│   ├── /services          # OrbitDB & Ethers.js integration logic
│   └── server.js          # Entry point
├── /dashboard             # React.js application
│   ├── /src/components    # Lineage Map & Integrity UI
│   └── /src/hooks         # API connection hooks
└── /docs                  # Evaluation reports and system design
```

## 4. Module Specifications & Task Lists

### Module A: Python Trace SDK (`/audit_sdk`)
* **Watcher Component:**
    * **Responsibility:** Non-intrusive data ingestion.
    * **Action:** * Implement hooks to capture `state_dict` (weights), hyperparameters, and batch indices.
        * **Capture Runtime Metrics:** Intercept `loss` values and `accuracy` scores from the training loop at defined intervals (e.g., per-step or per-epoch).
        * Monitor the local dataset directory for file system changes.
    * **Handoff:** Pass captured raw data (as tensors, floats, or bytes) to the Hashing Engine via an asynchronous memory buffer.

* **Hashing Engine Component:**
    * **Responsibility:** Cryptographic processing and package formation.
    * **Action:** * Perform Merkle Root (static dataset) and SHA-256 (weights/configs).
        * **Metric Hashing:** Convert captured Loss/Accuracy values into a JSON-serialized byte stream and calculate its hash.
        * **Aggregation:** Combine all hashes and the raw Loss/Accuracy values into an "Audit Metadata Packet."

### Module B: Audit Controller (`/audit-controller`)
* **API Layer:** RESTful endpoints to receive SDK data.
* **Storage Logic:** 1. Store audit packets in **OrbitDB**.
    2. Anchor the resulting CID to the **Ganache** smart contract.
* **Integrity Logic:** Two-stage verification (Re-hash OrbitDB raw bytes vs. Blockchain anchor).

### Module C: Smart Contract (`/blockchain/contracts`)
* **Functionality:** Mapping between Step IDs, OrbitDB CIDs, and Merkle Roots.

### Module D: Provenance Dashboard (`/dashboard`)
* **Lineage Map:** Use **React-flow** + **Dagre** to render the training DAG.
* **Integrity UI:** Trigger backend re-hashing and display verification status.

## 5. Technical Constraints
- **Verification:** Never trust DB indexes; always re-calculate hashes from raw binary data.
- **Performance:** Maintain training latency increase below 5% for MobileNet V3.
- **Order of Operations:** Data must be successfully stored in OrbitDB before anchoring the CID to the blockchain.
- **Data Flow:** Local Training -> Watcher -> Hashing Engine -> Express API -> OrbitDB -> Smart Contract.

## 6. Development Guidelines for the Agent
- Follow the defined **Directory Structure** strictly.
- Prioritize modularity and asynchronous I/O.
- Explain the cryptographic purpose of generated code sections.
- Error Handling: Always handle network timeouts between the SDK and Controller.
