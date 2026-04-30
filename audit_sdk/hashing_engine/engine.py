import hashlib
import json
import os
from typing import Any, Dict, List, Union


class HashingEngine:
    """
    Hashing Engine Component: Responsible for cryptographic processing and package formation.
    Provides Merkle Root and SHA-256 calculation for training metadata and datasets.
    """

    @staticmethod
    def calculate_sha256(data: Union[bytes, str, Dict[str, Any]]) -> str:
        """
        Calculate SHA-256 hash of provided data.
        """
        if isinstance(data, dict):
            # Ensure consistent serialization for dictionaries
            data = json.dumps(data, sort_keys=True).encode("utf-8")
        elif isinstance(data, str):
            data = data.encode("utf-8")

        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def calculate_merkle_root(file_paths: List[str]) -> str:
        """
        Calculate Merkle Root of a list of files for data provenance.
        """
        if not file_paths:
            return ""

        # Initial leaf hashes
        hashes = []
        for path in sorted(file_paths):
            if os.path.isfile(path):
                with open(path, "rb") as f:
                    file_hash = hashlib.sha256(f.read()).hexdigest()
                    hashes.append(file_hash)

        if not hashes:
            return ""

        # Iteratively build the Merkle Tree
        while len(hashes) > 1:
            if len(hashes) % 2 != 0:
                hashes.append(hashes[-1])

            new_hashes = []
            for i in range(0, len(hashes), 2):
                combined = hashes[i] + hashes[i + 1]
                new_hashes.append(hashlib.sha256(combined.encode("utf-8")).hexdigest())
            hashes = new_hashes

        return hashes[0]

    def create_audit_packet(
        self,
        step_id: int,
        session_id: str,
        metrics: Dict[str, Any] = {},
        checkpoint_hash: str = "",
        checkpoint_cid: Union[str, None] = None,
    ) -> Dict[str, Any]:
        """
        Aggregation: Combine all hashes and raw metrics into an 'Audit Metadata Packet'.
        """

        packet = {
            "step_id": step_id,
            "session_id": session_id,
        }

        if metrics:
            metrics_json = json.dumps(metrics, sort_keys=True)
            metrics_hash = self.calculate_sha256(metrics_json)
            packet["metrics"] = metrics
            packet["metrics_hash"] = metrics_hash

        if checkpoint_hash:
            packet["checkpoint_hash"] = checkpoint_hash

        if checkpoint_cid:
            packet["checkpoint_cid"] = checkpoint_cid

        # Final signature of the entire packet for integrity
        packet["packet_hash"] = self.calculate_sha256(packet)

        return packet
