# 🤖 AI Training Provenance System

This project implements a blockchain-based provenance system designed to audit AI training processes, ensuring complete data integrity from pre-training to archival auditing.

## 🎯 Objective
To develop a robust, secure, and scalable system that verifies the integrity of AI training data and models using cryptographic proofs anchored on a blockchain.

## 💡 Core Principle
Adhering to the concept of **"Zero-Footprint"** ensures that the auditing SDK has minimal performance overhead on the training process.

## 🗺️ Project Roadmap
*   **Phase 1 (W1-W5):** Prototype development using the **MNIST** dataset. Focus on end-to-end functional integration.
*   **Phase 2 (W6-W10):** Conduct performance evaluation and improvement.

## 📁 Project Structure
The project is organized into four main modules:

1.  **`/ai-training`**: Contains the main training scripts and dataset management.
2.  **`/blockchain`**: The Hardhat project root managing Solidity smart contracts, deployment scripts, and tests.
3.  **`/audit_sdk`**: The core library for data capture and cryptographic proof generation.
    *   `/watcher`: Hooks for non-intrusive data ingestion (weights, hyperparameters).
    *   `/hashing_engine`: Logic for Merkle Tree generation and SHA-256 hashing of metadata.
4.  **`/audit-controller`**: A Node.js Express server responsible for receiving SDK data, storing proofs in OrbitDB, and anchoring CIDs to the blockchain.
5.  **`/dashboard`**: A React application visualising the lineage map using React-flow and displaying the integrity verification status.
6. **`/observability`**: Telemetry services related configuration files.
7. **`/evaluation`**: A Jupyter Notebook containing evaluation description, scripts and figures of result.
8. **`/tests`**: Unit tests and tamper test scripts.

## ⚙️ Data Flow & Architecture

The system follows a strict data flow:
**Local Training $\rightarrow$ Watcher (SDK) $\rightarrow$ Hashing Engine $\rightarrow$ Express API (Controller) $\rightarrow$ OrbitDB $\rightarrow$ Smart Contract (Blockchain)**

## 🛠️ Technical Specifications

*   **Watcher SDK (Python):** Captures runtime metrics (loss, accuracy) and weight states.
*   **Hashing Engine (Python):** Generates Merkle Roots for static data and SHA-256 hashes for configuration/weights.
*   **Controller (Node.js):** Manages database interactions (OrbitDB) and blockchain anchoring (Ethers.js). Communicates with watcher and dashboard via RESTful APIs (Express.js).
*   **Dashboard (React):** Visualises the lineage graph and allows for manual integrity verification.

## 🔒 Constraints & Guidelines

*   **Verification:** All stored data must be independently verifiable by re-calculating hashes from raw binary data.
*   **Performance:** Training latency must remain under a 5% increase.
*   **API Design:** The Controller must handle asynchronous I/O errors gracefully.
*   **Modularity:** Emphasis is placed on asynchronous I/O and clean separation of concerns between the SDK and the Controller.

## Installation

### Setup Python environment
1. Install uv:

    ```shell
    curl -LsSf https://astral.sh/uv/install.sh | sh
    ```

2. Install Python packages:

    ```shell
    uv sync
    ```

### Install audit-controller

```shell
cd audit-controller
npm install
```

### Install blockchain development framework

```shell
cd blockchain
npm install
```

### Install Ganache for local Ethereum network
Download the installer from the website: https://archive.trufflesuite.com/ganache/

### Install dashboard

```shell
cd dashboard
npm install
```

### Install Podman for running observability services

Download the installer from the website: https://podman.io/

## Run the system

### Create Blockchain
1. Start Ganache application
2. Click "NEW WORKSPACE" button
3. Input a name under "WORKSPACE NAME"
4. Click "CHAIN" tab, modify the value of "GAS LIMIT" to `20000000000`
5. Click "START" button on the top right corner

### Compile and Deploy Smart Contract

1. Compile Smart Contract:

    ```shell
    cd blockchain
    npx hardhat compile
    ```

2. Deploy Smart Contract to Ganache:

    ```shell
    npx hardhat run scripts/deploy.js --network ganache
    ```

After deploying successfully, the contract address will be printed. Copy the address and use it later.

### Create .env file

Create `.env` in the top directory with following similar content:

```
GANACHE_URL=http://127.0.0.1:7545
PRIVATE_KEY=0x82b4273b9e5b41cf4b855662c141f4c3687d0a988a494fba560c2fe36ae1360b
CONTRACT_ADDRESS=0x85f1BEF0E88244a2e1c0a7Bde6c8e1D7F7158144
```

The value of `CONTRACT_ADDRESS` must be replaced with the one you have copied when deploying the contract.

The value of `PRIVATE_KEY` can be found in Ganache:

1. Open Ganache, click "ACCOUNTS" on top left corner
2. Click the "key" icon of the first address
3. Copy the "PRIVATE KEY" value

### Run Observability services

1. Run Podman:

    ```shell
    mkdir -p observability/logs
    touch observability/logs/watcher.log observability/logs/audit-controller.log
    cd observability && podman compose -f podman-compose.yml up -d
    ```

2. Modify `.env`, add:

    ```
    OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
    ```

### Run audit-controller

1. Modify `.env`, add:

    ```
    API_BASE_URL=http://localhost:3000
    NODE_ENV=debug
    ```

2. Run server:

    ```shell
    cd audit-controller && touch orphan-txs.log && npm start
    ```

### Run dashboard

1. Start Node server":

    ```shell
    cd dashboard && npm run dev
    ```

2. Open dashboard in web browser: http://localhost:5173


### Start training

```shell
cd ai-training && uv run python trainer.py
```
