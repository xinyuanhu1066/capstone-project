// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AI Training Provenance
 * @dev Stores mappings between training steps and their corresponding decentralized storage CIDs.
 */
contract Provenance {
    struct AuditRecord {
        uint256 stepId;
        string orbitdbCid;
        string datasetMerkleRoot;
        uint256 timestamp;
    }

    // Mapping from step ID to its audit record
    mapping(uint256 => AuditRecord) public records;
    
    // Array to keep track of all step IDs recorded
    uint256[] public stepIds;

    event RecordAnchored(uint256 indexed stepId, string orbitdbCid, string datasetMerkleRoot);

    /**
     * @dev Anchors a new audit record to the blockchain.
     * @param _stepId The unique ID of the training step.
     * @param _orbitdbCid The CID of the audit packet stored in OrbitDB.
     * @param _datasetMerkleRoot The Merkle Root of the dataset used in this step.
     */
    function anchorRecord(
        uint256 _stepId, 
        string memory _orbitdbCid, 
        string memory _datasetMerkleRoot
    ) public {
        // Ensure we don't overwrite if it's already there (optional depending on logic)
        // For now, we allow overwriting for simplicity in Phase 1
        
        if (records[_stepId].timestamp == 0) {
            stepIds.push(_stepId);
        }

        records[_stepId] = AuditRecord({
            stepId: _stepId,
            orbitdbCid: _orbitdbCid,
            datasetMerkleRoot: _datasetMerkleRoot,
            timestamp: block.timestamp
        });

        emit RecordAnchored(_stepId, _orbitdbCid, _datasetMerkleRoot);
    }

    /**
     * @dev Returns the record for a specific step.
     */
    function getRecord(uint256 _stepId) public view returns (AuditRecord memory) {
        return records[_stepId];
    }

    /**
     * @dev Returns total number of records.
     */
    function getRecordsCount() public view returns (uint256) {
        return stepIds.length;
    }
}
