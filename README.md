# 🤖 AI Training Provenance System

This project implements a blockchain-based provenance system designed to audit AI training processes, ensuring complete data integrity from pre-training to archival auditing.

## 🎯 Objective
To develop a robust, secure, and scalable system that verifies the integrity of AI training data and models using cryptographic proofs anchored on a blockchain.

## 💡 Core Principle
Adhering to the concept of **"Zero-Footprint"** ensures that the auditing SDK has minimal performance overhead on the training process.

## 🗺️ Project Roadmap
*   **Phase 1 (W1-W5):** Prototype development using the **MNIST** dataset. Focus on end-to-end functional integration.
*   **Phase 2 (W6-W10):** Performance scaling and stress testing using the **MobileNet V3** model. Focus on asynchronous optimization and high-frequency hashing.

## 📁 Project Structure
The project is organized into four main modules:

1.  **`/ai-training`**: Contains the main training scripts and dataset management.
2.  **`/blockchain`**: The Hardhat project root managing Solidity smart contracts, deployment scripts, and tests.
3.  **`/audit_sdk`**: The core library for data capture and cryptographic proof generation.
    *   `/watcher`: Hooks for non-intrusive data ingestion (weights, hyperparameters).
    *   `/hashing_engine`: Logic for Merkle Tree generation and SHA-256 hashing of metadata.
4.  **`/audit-controller`**: A Node.js Express server responsible for receiving SDK data, storing proofs in OrbitDB, and anchoring CIDs to the blockchain.
5.  **`/dashboard`**: A React application visualising the lineage map using React-flow and displaying the integrity verification status.

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
