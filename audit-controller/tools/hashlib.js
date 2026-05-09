import crypto from 'crypto';
import stringify from 'json-stable-stringify'; // make sure the order of keys is consistent for hashing
import { execSync } from 'child_process';
import path from 'path';
import { pipeline } from 'stream/promises';
import { unixfs } from '@helia/unixfs'
import { Readable } from 'stream'
import { CID } from 'multiformats/cid'
import { getLogger } from './instrumentation.js'

/**
 * Calulate SHA256 hash of Packet, align with Python HashingEngine
 * @param {Object} packet - object containing session_id, type, prev_hash, payload
 * @returns {string} - lower case hash value with 0x prefix
 */
export const calculatePacketHash = (packet) => {
    if (!packet || typeof packet !== 'object') {
        throw new Error("Invalid packet: must be an object");
    }

    // 1. deep sort and serialize
    // json-stable-stringify will recursively sort all keys in alphabetical order
    // this ensures that {"a":1, "b":2} and {"b":2, "a":1} produce identical strings
    const stableString = stringify(packet);

    // 2. create SHA256 instance and specify encoding
    const hash = crypto.createHash('sha256');

    // 3. write data and calculate
    // explicitly use utf8 encoding to convert string to byte stream, aligning with Python's .encode('utf-8')
    const hashBuffer = hash.update(stableString, 'utf8').digest();

    // 4. format output
    // convert to lower case hexadecimal string and add 0x prefix according to blockchain convention
    return '0x' + hashBuffer.toString('hex');
}

/**
 * verify if the calculated hash matches the target hash
 * @param {string} calculatedHash - the hash calculated logically (usually without 0x prefix)
 * @param {string} targetHash - the hash obtained from the blockchain or stored in previous packets (usually with 0x prefix)
 * @returns {boolean} - whether they match exactly
 */
export const verifyHashMatch = (calculatedHash, targetHash) => {
    // 1. basic null/undefined check
    if (!calculatedHash || !targetHash) {
        return false;
    }

    // 2. use lower case and remove spaces to ensure consistent comparison
    // this is to prevent differences in case-sensitive output between different libraries (e.g., ethers.js vs Python hashlib)
    const cleanCalculated = calculatedHash.toString().trim().toLowerCase();
    const cleanTarget = targetHash.toString().trim().toLowerCase();

    // 3. ensure 0x prefix consistency
    // if one has the 0x prefix and the other doesn't, they should still be considered the same (if the content is identical)
    const normalize = (h) => h.startsWith('0x') ? h : `0x${h}`;

    // 4. execute final comparison
    return normalize(cleanCalculated) === normalize(cleanTarget);
}

/**
 * Calculate Merkle Root from local dataset directory, using the same logic as the Python implementation
 * @param {string} rootDir - the root directory of the dataset downloaded from IPFS
 * @returns {string} - the Merkle Root hash as a 0x-prefixed hex string
 */
export const calculateDatasetMerkleRoot = (rootDir) => {
    const log = getLogger();
    // get file path of engine.py, which contains the same logic for calculating Merkle Root as the audit controller
    const enginePath = path.resolve(process.cwd(), '../audit_sdk/hashing_engine/engine.py');

    try {
        // execute the Python script and pass the rootDir as an argument
        // the script will read all files under rootDir, calculate their hashes, build a Merkle Tree, and print the Merkle Root
        const output = execSync(
            `python3 ${enginePath} --rootdir ${rootDir} --exclude "dummy.txt" "*.gz"`,
            { encoding: 'utf-8' }
        ).toString().trim();
        const result = output.split('\n').pop().trim();
        return `0x${result}`;
    } catch (error) {
        log.error({ event: 'merkle_root.calculate_failed', root_dir: rootDir, error: error.message });
        throw error;
    }
}

/**
 * Calculate Hash from IPFS File Stream
 * @param {Object} helia - helia instance
 * @param {string} cidStr - the CID of the file
 * @returns {Promise<string>} - the calculated hexadecimal hash
 */
export const calculateHashFromStream = async (helia, cidStr) => {
    const ufs = unixfs(helia)
    const cid = CID.parse(cidStr)
    const hash = crypto.createHash('sha256')

    for await (const chunk of ufs.cat(cid)) {
        hash.update(chunk)
    }

    return hash.digest('hex')
}