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
        if not data:
            return ""

        if isinstance(data, dict):
            # Ensure consistent serialization for dictionaries
            data = json.dumps(data, sort_keys=True).encode("utf-8")
        elif isinstance(data, str):
            data = data.encode("utf-8")

        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def calculate_merkle_root(file_paths: List[str], base_dir: str = None) -> str:
        """
        Calculate Merkle Root of a list of files for data provenance.
        """
        if not file_paths:
            return ""

        valid_paths = [p for p in file_paths if os.path.isfile(p)]
        if not valid_paths:
            return ""
        
        if base_dir is None:
            base_dir = os.path.commonpath(valid_paths) if len(valid_paths) > 1 else os.path.dirname(valid_paths[0])

        path_mapping = []
        for p in valid_paths:
            rel_path = os.path.relpath(p, base_dir)
            path_mapping.append((rel_path, p))

        path_mapping.sort(key=lambda x: x[0])

        # Initial leaf hashes
        hashes = []
        for rel_p, abs_p in path_mapping:
            with open(abs_p, "rb") as f:
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


if __name__ == "__main__":
    import argparse
    import fnmatch

    def _should_exclude(filename: str, exclude: set) -> bool:
        for pattern in exclude:
            if fnmatch.fnmatch(filename, pattern):
                return True
        return False

    parser = argparse.ArgumentParser(description="Hashing Engine for Audit SDK")
    parser.add_argument("--rootdir", help="Root directory for calculating Merkle root")
    parser.add_argument(
        "--exclude",
        nargs="*",
        default=["dummy.txt"],
        help="Space-separated list of files",
    )
    args = parser.parse_args()
    if args.rootdir:
        if not os.path.exists(args.rootdir):
            print("Root directory does not exist.")
            exit(1)
        file_paths = []
        for root, _, files in os.walk(args.rootdir):
            for file in files:
                if _should_exclude(file, args.exclude):
                    continue
                file_paths.append(os.path.join(root, file))
        merkle_root = HashingEngine.calculate_merkle_root(file_paths, base_dir=args.rootdir)
        print(merkle_root)
    else:
        print("No root directory provided. Exiting.")
        exit(1)
