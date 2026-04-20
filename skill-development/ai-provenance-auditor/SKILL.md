---
name: ai-provenance-auditor
description: Specialized workflows for implementing non-invasive AI training auditing and blockchain-based provenance systems. Use when developing or maintaining auditing SDKs (PyTorch/Python), decentralized storage controllers (Node.js/OrbitDB/IPFS), and provenance dashboards (React).
---

# AI Provenance Auditor

This skill codifies the workflows for building a zero-footprint auditing system for AI training processes, integrating cryptographic hashing with decentralized storage and blockchain anchoring.

## Non-Invasive Auditing (PyTorch)

To maintain a "Zero-Footprint" philosophy, use global monkey-patching of PyTorch internal classes rather than requiring explicit logging calls in the training loop.

### Patching Strategy
- **Loss Capture**: Patch `torch.Tensor.backward` to automatically intercept loss scalar items.
- **Weights Capture**: Patch `torch.optim.Optimizer.__init__` to wrap the `step()` method of every instance. This ensures compatibility with all optimizer subclasses (SGD, Adam, etc.) without class-level conflicts.

## Audit Controller (Node.js + OrbitDB + Ethers.js)

### CID Stability & Metadata Separation
**Critical Workflow**: To ensure blockchain verification succeeds, the CID anchored to the blockchain must never change. 
1. Store the **Immutable Audit Packet** in OrbitDB first to get its CID.
2. Anchor that CID to the Blockchain.
3. Store the resulting **Transaction Hash** as a *separate* metadata entry in OrbitDB linked by `packet_hash`.
4. During verification, fetch the primary record by CID to compare against the blockchain anchor.

```javascript
// Correct pattern:
const cid = await db.put(auditRecord) // Get CID
const txHash = await anchorToBlockchain(cid) // Anchor CID
await db.put({ _id: `meta-${hash}`, tx_hash: txHash }) // Store meta separately
```

### Persistent Storage with Helia
Use `blockstore-level` for Helia persistence to ensure data survives process restarts.

## Provenance Dashboard (React + React-Flow)

### Training DAG Visualization
Use `React-Flow` with `Dagre` for automatic layout of the training lineage.
- **Robustness**: Implement null-checks and optional chaining for all provenance metadata (e.g., `packet.provenance?.dataset_merkle_root`) to prevent UI crashes during data loading.
- **Component Lifecycle**: Define `nodeTypes` outside the component or use `useMemo` to prevent unnecessary re-renders and React Flow warnings.

## Cryptographic Standards
- **Datasets**: Use Merkle Roots for static file-system provenance.
- **Aggregation**: Combine all hashes into a signed "Audit Metadata Packet" for blockchain anchoring.

## Troubleshooting
- **Integrity Breach (False Positive)**: Usually caused by updating the audit record with the `tx_hash` *after* anchoring, which changes the CID. Follow the Metadata Separation pattern.
- **Chain ID Mismatch**: In Hardhat/Ganache, ensure the `chainId` in `hardhat.config.js` matches the network (e.g., 1337 for Ganache).
