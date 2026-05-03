// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title AIIntegrityAudit
 * @dev An AI training audit contract designed for a unified event stream.
 * Rich Event logic added, supporting multi-dimensional auditing through 
 * transaction hash and sessionId.
 */
contract AIIntegrityAudit {
    
    struct Session {
        bytes32 datasetMerkleRoot; // The initial fingerprint of the dataset
        bytes32 latestPacketHash;  // The hash of the latest data packet in OrbitDB
        bool isActive;             // Whether the session is initialized
        bool isCompleted;          // Whether the session is completed
    }

    // Store Session states
    mapping(bytes32 => Session) public sessions;


    // When a training Session starts
    event SessionStarted(
        bytes32 indexed sessionId, 
        bytes32 datasetMerkleRoot, 
        uint256 timestamp
    );

    // When synchronizing training progress (Step or Epoch) is triggered
    event AuditAnchored(
        bytes32 indexed sessionId, 
        bytes32 packetHash, 
        uint256 stepId,
        uint256 timestamp
    );

    // When a training Session ends and is sealed
    event SessionCompleted(
        bytes32 indexed sessionId, 
        bytes32 finalPacketHash, 
        uint256 timestamp
    );

    /**
     * @dev Session Start
     */
    function startSession(bytes32 _sessionId, bytes32 _merkleRoot) external {
        require(!sessions[_sessionId].isActive, "Session already initialized");

        sessions[_sessionId].datasetMerkleRoot = _merkleRoot;
        sessions[_sessionId].isActive = true;
        sessions[_sessionId].isCompleted = false;

        emit SessionStarted(_sessionId, _merkleRoot, block.timestamp);
    }

    /**
     * @dev Synchronize training progress (Step/Epoch Anchor)
     * Distinguish between periodic aggregation and step metrics via the stepId parameter
     */
    function syncProgress(
        bytes32 _sessionId, 
        bytes32 _packetHash, 
        uint256 _stepId
    ) external {
        Session storage s = sessions[_sessionId];
        require(s.isActive, "Session not active");
        require(!s.isCompleted, "Session already completed");
        
        s.latestPacketHash = _packetHash;

        emit AuditAnchored(_sessionId, _packetHash, _stepId, block.timestamp);
    }

    /**
     * @dev End training session and lock its state (Session End)
     */
    function completeSession(bytes32 _sessionId, bytes32 _finalPacketHash) external {
        Session storage s = sessions[_sessionId];
        require(s.isActive, "Session not active");
        require(!s.isCompleted, "Session already completed");
        
        s.latestPacketHash = _finalPacketHash;
        s.isCompleted = true;

        emit SessionCompleted(_sessionId, _finalPacketHash, block.timestamp);
    }

    /**
     * @dev Helper function: Get session status
     */
    function getSession(bytes32 _sessionId) external view returns (
        bytes32 datasetMerkleRoot,
        bytes32 latestPacketHash,
        bool isActive,
        bool isCompleted
    ) {
        Session storage s = sessions[_sessionId];
        return (s.datasetMerkleRoot, s.latestPacketHash, s.isActive, s.isCompleted);
    }
}