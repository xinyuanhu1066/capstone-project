// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AIIntegrityAudit
/// @notice Anchors session-level integrity metadata for AI training provenance
contract AIIntegrityAudit {
    struct Session {
        bytes32 datasetMerkleRoot; // merkle root of the training dataset used in this session
        bytes32 latestPacketHash;  // hash of the latest data packet in OrbitDB
        bool isActive;             // whether the session is initialized
        bool isCompleted;          // whether the session is completed (locked from further modifications)
    }

    mapping(bytes32 => Session) public sessions;

    event SessionStarted(bytes32 indexed sessionId, bytes32 merkleRoot);
    event ProgressSynced(bytes32 indexed sessionId, bytes32 lastPacketHash);
    event SessionCompleted(bytes32 indexed sessionId, bytes32 finalPacketHash);

    /// @notice Start a new training session and record the dataset Merkle root
    function startSession(bytes32 _sessionId, bytes32 _merkleRoot) external {
        require(!sessions[_sessionId].isActive, "Session already initialized");
        sessions[_sessionId].datasetMerkleRoot = _merkleRoot;
        sessions[_sessionId].isActive = true;
        emit SessionStarted(_sessionId, _merkleRoot);
    }

    /// @notice Update the latest OrbitDB packet hash for an active session
    function syncProgress(bytes32 _sessionId, bytes32 _lastPacketHash) external {
        Session storage s = sessions[_sessionId];
        require(s.isActive, "Session not active");
        require(!s.isCompleted, "Session already completed");

        s.latestPacketHash = _lastPacketHash;
        emit ProgressSynced(_sessionId, _lastPacketHash);
    }

    /// @notice Complete the session and lock it from further updates
    function completeSession(bytes32 _sessionId, bytes32 _finalPacketHash) external {
        Session storage s = sessions[_sessionId];
        require(s.isActive, "Session not active");

        s.latestPacketHash = _finalPacketHash;
        s.isCompleted = true;
        emit SessionCompleted(_sessionId, _finalPacketHash);
    }
}
